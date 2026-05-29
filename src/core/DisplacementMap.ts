/**
 * Convex-squircle lens displacement map.
 *
 * Models the glass as a single thick convex lens spanning the WHOLE surface:
 * the backdrop bends gently through the centre and ramps up sharply toward the
 * rim, so the element reads as one solid glass plate (like Apple's Control
 * Center tiles) rather than a flat panel with a thin lit edge. The height
 * profile follows a squircle (super-ellipse, exponent 4) plus a gentle body
 * dome. Refraction is computed from the surface slope at each pixel:
 *
 *   r        = 1 - edgeDist/maxDepth                        (0 at centre, 1 at rim)
 *   slope(r) = r³ / (1 - r⁴)^(3/4)                          (squircle derivative)
 *   bump     = min(1, slope·k + r²·inner)                   (rim spike + body dome)
 *
 * The result bends light across the whole body and spikes at the rim — the
 * thick-glass refraction Apple's iOS 26 / macOS Tahoe Liquid Glass shows.
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

  const innerW = halfW - r;
  const innerH = halfH - r;

  // Body-refraction strength of the per-axis lens profile (0 at centre → up to
  // 1 at the rim), added on top of the squircle edge spike so the glass refracts
  // through its whole body, not only at the rim.
  const INNER_REFRACT = 0.22;

  // Per-axis convex-lens profile: squircle slope (sharp rim) + a gentle body
  // dome. It is applied SEPARABLY — x-displacement uses |x| only, y uses |y|
  // only — so the field is smooth everywhere and each axis eases through zero at
  // its centre line. There is NO medial axis where the direction flips, hence no
  // diagonal "X" seam (that was an artifact of nearest-edge displacement; real
  // Liquid Glass shows none).
  const lens = (n: number): number => {
    const c = n < 0.9999 ? n : 0.9999; // guard the (1 − n⁴) term
    const c2 = c * c;
    const s = Math.sqrt(1 - c2 * c2); // (1 − n⁴)^0.5
    const slope = (c2 * c) / (s * Math.sqrt(s)); // n³ / (1 − n⁴)^0.75
    const raw = slope * 0.55 + c2 * INNER_REFRACT;
    return raw < 1 ? raw : 1;
  };

  // Encoded displacement below this rounds to neutral (128) — skip those pixels.
  const NEUTRAL = 0.004;

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
    // Vertical lens term depends only on the row — compute once.
    const by = lens(ady / halfH);

    for (let x = 0; x < totalW; x++) {
      const i = rowBase + x * 4;
      const dx = x + 0.5 - cx;
      const adx = dx < 0 ? -dx : dx;
      const qx = adx - innerW;

      // Rounded-rect SDF — only to decide inside vs outside (alpha + corners).
      const inside = (qx > qy ? qx : qy) < 0 ? (qx > qy ? qx : qy) : 0;
      const ox = qx > 0 ? qx : 0;
      const oy = qy > 0 ? qy : 0;
      const outside = ox || oy ? Math.sqrt(ox * ox + oy * oy) : 0;
      if (inside + outside - r >= 0) {
        // Outside the shape — neutral, no alpha.
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 0;
        continue;
      }

      const bx = lens(adx / halfW);
      if (bx < NEUTRAL && by < NEUTRAL) {
        // Clear centre — inside the shape but no displacement.
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 255;
        continue;
      }

      // Each axis displaces toward centre (magnify). |disp| ≤ 1 so
      // 128 ± disp·127 stays in [1, 255] — no clamp needed.
      data[i] = Math.round(128 - (dx < 0 ? -1 : 1) * bx * 127);
      data[i + 1] = Math.round(128 - sy * by * 127);
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
