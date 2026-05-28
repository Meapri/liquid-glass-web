/**
 * Convex-squircle lens displacement map.
 *
 * Models the glass as a convex lens whose height profile follows a squircle
 * (super-ellipse with exponent 4) — the shape Apple uses for "iOS rounded
 * rect". Crucially the lens is concentrated in a **bezel band** of width
 * `thickness` at the rim; the interior is flat and optically clear. This is the
 * defining Liquid Glass behaviour ("the centre remains relatively clear while
 * edges show maximum displacement") — spreading the lens across the whole
 * surface instead reads like a uniform magnifier. Refraction is computed from
 * the surface slope at each pixel:
 *
 *   r        = 1 - edgeDist/band                            (0 at bezel inner, 1 at rim)
 *   slope(r) = r³ / (1 - r⁴)^(3/4)                          (squircle derivative)
 *   bump     = min(1, slope * k)                            (capped for sampling)
 *
 * The result is **flat/clear in the centre and spikes sharply at the rim** —
 * matching what Apple's iOS 26 Liquid Glass shows.
 *
 * Direction is INWARD (toward the shape centre perpendicular to nearest edge),
 * so the lens magnifies the backdrop.
 *
 * The canvas is **padded** by ±refraction px on each side so that the
 * displacement map's rim values can be sampled without being clipped by the
 * SVG filter region. The padding is encoded as neutral (128) and gets a
 * matching alpha 0 outside the shape.
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

  const maxDepth = Math.min(halfW, halfH);
  const innerW = halfW - r;
  const innerH = halfH - r;

  // Lensing band: the refraction lives within `thickness` px of the rim, then
  // the surface goes flat (clear centre). Capped at the short half-side so small
  // controls (where the bezel is the whole thing) still resolve.
  const band = Math.min(maxDepth, Math.max(1, params.thickness * dpr));

  // Below this rNorm the squircle slope is so small that bump·127 rounds to 0,
  // i.e. the encoded displacement is exactly neutral (128). For a rounded-rect
  // that's the whole deep interior — skipping it drops the slope+normal math
  // for the bulk of a large panel with byte-identical output. (rNorm 0.19 is
  // where bump·127 first reaches 0.5; 0.18 keeps a safe margin.)
  const SKIP_RNORM = 0.18;

  for (let y = 0; y < totalH; y++) {
    const dy = y + 0.5 - cy;
    const ady = dy < 0 ? -dy : dy;
    const rowBase = y * totalW * 4;

    // Whole row sits beyond the shape's vertical extent → all neutral, no
    // alpha. Skips the SDF sqrt for every top/bottom padding row.
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

      // Rounded-rect SDF, inlined so qx/qy/ox/oy feed the analytic gradient too.
      const inside = (qx > qy ? qx : qy) < 0 ? (qx > qy ? qx : qy) : 0;
      const ox = qx > 0 ? qx : 0;
      const oy = qy > 0 ? qy : 0;
      const outside = ox || oy ? Math.sqrt(ox * ox + oy * oy) : 0;
      const d = inside + outside - r;

      if (d >= 0) {
        // Outside the shape — neutral, no displacement, no alpha.
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 0;
        continue;
      }

      const edge = -d;
      const rNorm = edge >= band ? 0 : 1 - edge / band; // 0 at bezel inner → 1 at rim

      if (rNorm < SKIP_RNORM) {
        // Deep interior — encodes to neutral but is part of the shape.
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 255;
        continue;
      }

      // Squircle convex-lens slope: rNorm³ / (1 − rNorm⁴)^0.75. The 0.55
      // multiplier sets where bump first saturates. (1 − rNorm⁴)^0.75 is
      // computed as √·⁴√ — exact and far cheaper than Math.pow per pixel.
      const r2 = rNorm * rNorm;
      const r3 = r2 * rNorm;
      const denom = 1 - r2 * r2;
      const s = Math.sqrt(denom);
      const slope = r3 / (s * Math.sqrt(s));
      const bump = slope * 0.55 < 1 ? slope * 0.55 : 1;

      // Outward unit normal = analytic SDF gradient, replacing four
      // finite-difference sdf() samples per pixel.
      const sx = dx < 0 ? -1 : 1;
      let normX: number;
      let normY: number;
      if (ox || oy) {
        // Rounded corner: points radially out of the arc centre.
        const olen = outside || 1;
        normX = (ox / olen) * sx;
        normY = (oy / olen) * sy;
      } else {
        // Straight bands. On the medial diagonal (qx≈qy) the nearest edge is
        // ambiguous; blend the two axis normals across a ±0.75px band so the
        // corner diagonals stay seamless — this reproduces the original
        // finite-difference normal (eps=0.75) instead of a hard axis switch.
        const e = 0.75;
        let mx = qx - qy + e;
        mx = mx < 0 ? 0 : mx > 2 * e ? 2 * e : mx;
        let my = qy - qx + e;
        my = my < 0 ? 0 : my > 2 * e ? 2 * e : my;
        const nl = Math.sqrt(mx * mx + my * my) || 1;
        normX = (mx / nl) * sx;
        normY = (my / nl) * sy;
      }

      // INWARD direction = sample backdrop from closer to shape centre.
      // With <feDisplacementMap scale = 2 × refraction> this lifts the
      // interior into the rim band → magnification. |disp| ≤ bump ≤ 1, so
      // 128 + disp·127 always lands in [1, 255] — no clamp needed.
      data[i] = Math.round(128 - bump * normX * 127);
      data[i + 1] = Math.round(128 - bump * normY * 127);
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
