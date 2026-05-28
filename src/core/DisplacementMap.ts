/**
 * Convex-squircle lens displacement map.
 *
 * Models the glass as a convex lens whose height profile follows a squircle
 * (super-ellipse with exponent 4) — the shape Apple uses for "iOS rounded
 * rect". Refraction is computed from the surface slope at each pixel:
 *
 *   r        = 1 - edgeDist/maxDepth                        (0 at centre, 1 at rim)
 *   slope(r) = r³ / (1 - r⁴)^(3/4)                          (squircle derivative)
 *   bump     = min(1, slope * k)                            (capped for sampling)
 *
 * The result is **flat in the centre and spikes sharply at the rim** —
 * matching what a real convex lens does and what iOS/Figma show.
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

  const sdf = (x: number, y: number): number => {
    const qx = Math.abs(x - cx) - (halfW - r);
    const qy = Math.abs(y - cy) - (halfH - r);
    const inside = Math.min(Math.max(qx, qy), 0);
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    const outside = Math.sqrt(ox * ox + oy * oy);
    return inside + outside - r;
  };

  const maxDepth = Math.min(halfW, halfH);
  const eps = 0.75;

  for (let y = 0; y < totalH; y++) {
    for (let x = 0; x < totalW; x++) {
      const i = (y * totalW + x) * 4;
      const d = sdf(x + 0.5, y + 0.5);

      if (d >= 0) {
        // Outside the shape — neutral, no displacement, no alpha.
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 0;
        continue;
      }

      const edge = -d;
      const rNorm = 1 - Math.min(1, edge / maxDepth); // 0 centre → 1 rim

      // Squircle convex-lens slope. Spikes near rNorm=1; clamped to keep
      // sampling sane. The 0.55 multiplier sets where bump first saturates;
      // tweak to control how aggressive the rim spike feels.
      const x4 = rNorm * rNorm * rNorm * rNorm;
      const denom = Math.max(0.01, 1 - x4);
      const slope = (rNorm * rNorm * rNorm) / Math.pow(denom, 0.75);
      const bump = Math.min(1, slope * 0.55);

      // Outward normal from SDF gradient.
      const nx = sdf(x + eps, y) - sdf(x - eps, y);
      const ny = sdf(x, y + eps) - sdf(x, y - eps);
      const nlen = Math.sqrt(nx * nx + ny * ny) || 1;
      const normX = nx / nlen;
      const normY = ny / nlen;

      // INWARD direction = sample backdrop from closer to shape centre.
      // With <feDisplacementMap scale = 2 × refraction> this lifts the
      // interior into the rim band → magnification.
      const dispX = -bump * normX;
      const dispY = -bump * normY;

      const enc = (v: number) =>
        Math.max(0, Math.min(255, Math.round(128 + v * 127)));

      data[i] = enc(dispX);
      data[i + 1] = enc(dispY);
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
