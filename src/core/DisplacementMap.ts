/**
 * Physically-based refraction displacement map (Snell's law).
 *
 * Models the glass as a real refracting solid, the way Apple's Liquid Glass and
 * kube.io's derivation do — not an ad-hoc displacement ramp:
 *
 *   1. Surface  — a convex-squircle bevel, h = ⁴√(1 − (1 − x)⁴) over the distance
 *                 into a rim band of width `thickness`. Flat across the centre,
 *                 curving steeply at the rim. (Beyond the band the surface is
 *                 flat, so the centre is optically clear.)
 *   2. Normal   — the analytic gradient of the rounded-rect SDF: perpendicular to
 *                 the nearest edge (radial out of the corner arcs, axis-aligned
 *                 along the straight edges).
 *   3. Refract  — a straight-down view ray refracts through that surface by
 *                 Snell's law (glass n = 1.5); the lateral shift sin(θ₁ − θ₂) is
 *                 the displacement magnitude, applied INWARD (magnifying).
 *
 * Because the bend lives only in the rim band, the SDF gradient's medial seam
 * (which is in the cleared centre) never shows — there is no diagonal "X".
 * The magnitude is precomputed as a 1-D Snell lookup since it depends only on
 * depth into the bevel.
 *
 * The canvas is **padded** by ±refraction px on each side so the rim values are
 * not clipped by the SVG filter region; padding is neutral (128) with alpha 0.
 */

export interface DisplacementMapParams {
  width: number;
  height: number;
  radius: number;
  thickness: number;
  pixelRatio: number;
  /** Max displacement in CSS px (the same value as FilterChain's refraction). */
  refraction: number;
}

export interface DisplacementMapResult {
  url: string;
  /** Total padding applied per side in CSS px (matches FilterChain padding). */
  padding: number;
  /** Canvas pixel size (DPR-scaled, includes padding). */
  totalWidth: number;
  totalHeight: number;
}

export function generateDisplacementMap(
  params: DisplacementMapParams
): DisplacementMapResult {
  const dpr = Math.max(1, Math.min(3, params.pixelRatio));
  const w = Math.max(1, Math.round(params.width * dpr));
  const h = Math.max(1, Math.round(params.height * dpr));
  const r = Math.max(0, Math.min(Math.min(w, h) / 2, params.radius * dpr));
  const paddingCss = Math.max(8, Math.ceil(params.refraction));
  const pad = Math.ceil(paddingCss * dpr);

  const totalW = w + pad * 2;
  const totalH = h + pad * 2;

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(totalW, totalH)
      : Object.assign(document.createElement('canvas'), {
          width: totalW,
          height: totalH,
        });
  if (canvas instanceof HTMLCanvasElement) {
    canvas.width = totalW;
    canvas.height = totalH;
  }
  const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext('2d', {
    willReadFrequently: false,
  }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  const img = ctx.createImageData(totalW, totalH);
  const data = img.data;

  // SDF anchored at the padded coordinate space: shape lives at [pad, pad+w/h].
  const cx = pad + w / 2;
  const cy = pad + h / 2;
  const halfW = w / 2;
  const halfH = h / 2;

  const innerW = halfW - r;
  const innerH = halfH - r;
  const maxDepth = Math.min(halfW, halfH);

  // The glass surface is a convex-squircle bevel: flat across the centre, curving
  // down steeply over a band of width `bevel` at the rim — the profile Apple's
  // Liquid Glass and kube.io's physics derivation use, y = ⁴√(1 − (1 − x)⁴).
  // Refraction therefore lives in that rim band and the centre stays optically
  // clear, so the edge-normal's medial seam (which sits in the cleared centre)
  // never shows.
  const bevel = Math.min(maxDepth, Math.max(2, params.thickness * dpr));

  // Per-pixel magnitude = the lateral shift a straight-down ray gains refracting
  // through that surface, by Snell's law (glass n = 1.5) — NOT a linear ramp.
  // It depends only on the surface slope, i.e. only on the normalized depth into
  // the bevel, so precompute it once as a 1-D lookup:
  //   slope = (1−t)³ / (1 − (1−t)⁴)^0.75   (squircle derivative; t = edge/bevel)
  //   θ₁ = atan(slope) ;  θ₂ = asin(sin θ₁ / n) ;  shift = sin(θ₁ − θ₂)
  // normalized so the steepest (rim) shift maps to 1.
  const N = 1.5;
  const LUT = 256;
  const mag = new Float32Array(LUT);
  const MMAX = Math.sin(Math.PI / 2 - Math.asin(1 / N)); // shift at a vertical rim
  for (let i = 0; i < LUT; i++) {
    const rn = 1 - i / (LUT - 1); // 1 at rim → 0 at bevel inner
    const rn4 = rn * rn * rn * rn;
    const s = Math.sqrt(rn4 < 0.999999 ? 1 - rn4 : 1e-6);
    const slope = (rn * rn * rn) / (s * Math.sqrt(s));
    const th1 = Math.atan(slope);
    const th2 = Math.asin(Math.min(1, Math.sin(th1) / N));
    mag[i] = Math.sin(th1 - th2) / MMAX;
  }

  for (let y = 0; y < totalH; y++) {
    const dy = y + 0.5 - cy;
    const ady = dy < 0 ? -dy : dy;
    const rowBase = y * totalW * 4;

    // Whole row beyond the shape's vertical extent → all neutral, no alpha.
    if (ady >= halfH) {
      for (let x = 0; x < totalW; x++) {
        const i = rowBase + x * 4;
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 0;
      }
      continue;
    }

    const qy = ady - innerH;
    const sy = dy < 0 ? -1 : 1;

    for (let x = 0; x < totalW; x++) {
      const i = rowBase + x * 4;
      const dx = x + 0.5 - cx;
      const adx = dx < 0 ? -dx : dx;
      const qx = adx - innerW;

      // Rounded-rect SDF (signed distance) + the pieces of its analytic gradient.
      const inside = (qx > qy ? qx : qy) < 0 ? (qx > qy ? qx : qy) : 0;
      const ox = qx > 0 ? qx : 0;
      const oy = qy > 0 ? qy : 0;
      const outside = ox || oy ? Math.sqrt(ox * ox + oy * oy) : 0;
      const edge = r - inside - outside; // depth inside the shape (>0 inside)

      if (edge <= 0) {
        // Outside the shape — neutral, no alpha.
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 0;
        continue;
      }
      if (edge >= bevel) {
        // Flat clear centre (beyond the bevel) — part of the shape, no bend.
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 255;
        continue;
      }

      const m = mag[((edge / bevel) * (LUT - 1)) | 0];
      if (m < 0.004) {
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 255;
        continue;
      }

      // Outward unit normal = analytic SDF gradient: radial out of the corner arc
      // (ox/oy > 0), axis-aligned along the straight edges, blended across the
      // medial diagonal so it stays seamless.
      const sx = dx < 0 ? -1 : 1;
      let normX: number;
      let normY: number;
      if (ox || oy) {
        const olen = outside || 1;
        normX = (ox / olen) * sx;
        normY = (oy / olen) * sy;
      } else {
        const e = 0.75;
        let bx = qx - qy + e;
        bx = bx < 0 ? 0 : bx > 2 * e ? 2 * e : bx;
        let byy = qy - qx + e;
        byy = byy < 0 ? 0 : byy > 2 * e ? 2 * e : byy;
        const nl = Math.sqrt(bx * bx + byy * byy) || 1;
        normX = (bx / nl) * sx;
        normY = (byy / nl) * sy;
      }

      // Refract inward (toward centre) → magnify the backdrop through the lens.
      // |disp| ≤ 1, so 128 ± disp·127 stays in [1, 255] — no clamp needed.
      data[i] = Math.round(128 - m * normX * 127);
      data[i + 1] = Math.round(128 - m * normY * 127);
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  const url =
    canvas instanceof HTMLCanvasElement
      ? canvas.toDataURL('image/png')
      : offscreenToDataURL(canvas as OffscreenCanvas);

  return {
    url,
    padding: paddingCss,
    totalWidth: totalW / dpr,
    totalHeight: totalH / dpr,
  };
}

function offscreenToDataURL(canvas: OffscreenCanvas): string {
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  const tctx = tmp.getContext('2d')!;
  tctx.drawImage(canvas as unknown as CanvasImageSource, 0, 0);
  return tmp.toDataURL('image/png');
}
