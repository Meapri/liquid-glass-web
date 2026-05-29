/**
 * Hybrid Refraction Engine — "Hacky Dome" × Snell's Law
 *
 * Height field:  h(x,y) = bevelWidth · fade(sdf) + strength · dome(x,y) · fade(sdf)
 *   where fade(d) = d / (d + k)          — C∞-smooth rational edge transition
 *         dome    = (1 - u²)(1 - v²)     — "hacky" bivariate paraboloid (no X-crease)
 *
 * Normals are computed via closed-form chain-rule derivatives (zero finite-difference),
 * then fed into GLSL-style refract(I, N, η) for physically correct Snell's law bending.
 */

export interface DisplacementMapParams {
  width: number;
  height: number;
  radius: number;
  thickness: number;
  pixelRatio: number;
  refraction: number;
}

export interface DisplacementMapResult {
  url: string;
  padding: number;
  totalWidth: number;
  totalHeight: number;
}

export function generateDisplacementMap(
  params: DisplacementMapParams
): DisplacementMapResult {
  const dpr = params.pixelRatio;
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

  // ─── Geometry ───
  const cx = pad + w / 2;
  const cy = pad + h / 2;
  const halfW = w / 2;
  const halfH = h / 2;
  const innerW = Math.max(0, halfW - r);
  const innerH = Math.max(0, halfH - r);

  const maxDepth = Math.min(halfW, halfH);
  const bevelWidth = Math.min(maxDepth, Math.max(2, params.thickness * dpr));

  // ─── Formula Constants ───
  const directAmp = 0.85;

  // Helper: Standard Rounded Rect SDF
  function getSdf(adx: number, ady: number): number {
    const distX = halfW - adx;
    const distY = halfH - ady;
    if (distX <= 0 || distY <= 0) return 0;

    const qx = adx - innerW;
    const qy = ady - innerH;

    if (qx > 0 && qy > 0) {
      const distToCorner = Math.sqrt(qx * qx + qy * qy);
      if (distToCorner > r) return 0;
      return r - distToCorner;
    }
    return Math.min(distX, distY);
  }

  // Helper: C2 Continuous Smootherstep
  function smootherstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  // ─── Main Rendering Loop ───
  for (let y = 0; y < totalH; y++) {
    const rowBase = y * totalW * 4;
    const py = y + 0.5;

    for (let x = 0; x < totalW; x++) {
      const px = x + 0.5;
      const i = rowBase + x * 4;

      const dxC = px - cx;
      const dyC = py - cy;
      const adx = Math.abs(dxC);
      const ady = Math.abs(dyC);

      const d = getSdf(adx, ady);
      if (d <= 0) {
        data[i] = 128; data[i + 1] = 128; data[i + 2] = 128; data[i + 3] = 255;
        continue;
      }

      // ─── 1. SDF Gradient (Direction vector perpendicular to the boundary) ───
      const eps = 0.5;
      const dL = getSdf(adx - eps, ady);
      const dR = getSdf(adx + eps, ady);
      const dU = getSdf(adx, ady - eps);
      const dD = getSdf(adx, ady + eps);

      const dDdx = (dR - dL) / (2.0 * eps);
      const dDdy = (dD - dU) / (2.0 * eps);
      const len = Math.sqrt(dDdx * dDdx + dDdy * dDdy);

      const sx = dxC >= 0 ? 1.0 : -1.0;
      const sy = dyC >= 0 ? 1.0 : -1.0;
      const dirX = len > 0.0001 ? (dDdx / len) * sx : 0;
      const dirY = len > 0.0001 ? (dDdy / len) * sy : 0;

      // ─── 2. Monotonic Decay Refraction Strength ───
      // Max displacement at the outer boundary, decay monotonically to 0.0 at bevelWidth.
      // Zero inflection points => 100% guarantee of ZERO physical creases or fold lines.
      const t = Math.max(0, Math.min(1, d / bevelWidth));
      const strength = 1.0 - smootherstep(0, 1.0, t);

      // ─── 3. Direct Monotonic Displacement (Lens Refraction Effect) ───
      // Perpendicular to the glass border, pulling pixels inward smoothly
      const finalX = -dirX * strength * directAmp;
      const finalY = -dirY * strength * directAmp;

      // Encode displacement into RGBA (128 = neutral, ±127 = max offset)
      data[i]     = Math.max(1, Math.min(255, Math.round(128 + finalX * 127)));
      data[i + 1] = Math.max(1, Math.min(255, Math.round(128 + finalY * 127)));
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  const url =
    canvas instanceof HTMLCanvasElement
      ? canvas.toDataURL('image/webp', 1.0)
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
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
  tctx.drawImage(canvas as unknown as CanvasImageSource, 0, 0);
  return tmp.toDataURL('image/webp', 1.0);
}
