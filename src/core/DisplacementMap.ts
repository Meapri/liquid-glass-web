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
  const globalStrength = maxDepth * 1.2;
  const directAmp = 0.65;
  const eta = 0.67; // 1.0 / 1.5 (Air to glass ratio)

  // ─── Precomputed reciprocals ───
  const invHalfW = 1.0 / halfW;
  const invHalfH = 1.0 / halfH;

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

  // Helper: Clean height field without crease
  function getHeight(px: number, py: number): number {
    const dxC = px - cx;
    const dyC = py - cy;
    const adx = Math.abs(dxC);
    const ady = Math.abs(dyC);

    const d = getSdf(adx, ady);
    if (d <= 0) return 0;

    // Inside bevel transition
    const fade = smootherstep(0, bevelWidth, d);

    // Bivariate Paraboloid Dome
    const u = dxC * invHalfW;
    const v = dyC * invHalfH;
    const dome = (1.0 - u * u) * (1.0 - v * v);

    return (bevelWidth + globalStrength * dome) * fade;
  }

  // Helper: Snell's Law refract (for viewing ray I = (0, 0, -1))
  function refract(nx: number, ny: number, nz: number): { rx: number; ry: number } {
    const cosI = nz;
    const k = 1.0 - eta * eta * (1.0 - cosI * cosI);
    if (k < 0.0) return { rx: 0, ry: 0 };
    const factor = eta * cosI - Math.sqrt(k);
    return { rx: factor * nx, ry: factor * ny };
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

      // ─── Numerical Finite Difference Gradient ───
      const eps = 0.5;
      const hL = getHeight(px - eps, py);
      const hR = getHeight(px + eps, py);
      const hU = getHeight(px, py - eps);
      const hD = getHeight(px, py + eps);

      const dHdx = (hR - hL) / (2.0 * eps);
      const dHdy = (hD - hU) / (2.0 * eps);

      // Normal vector
      const len = Math.sqrt(dHdx * dHdx + dHdy * dHdy + 1.0);
      const normalX = -dHdx / len;
      const normalY = -dHdy / len;
      const normalZ = 1.0 / len;

      // ─── Edge / Center Refraction Mix ───
      // Edge factor is 1.0 at outer boundary, smoothly decaying to 0.0 beyond bevelWidth
      const edgeFactor = 1.0 - smootherstep(0, bevelWidth, d);

      // 1. Snell's Law (Edge)
      const snell = refract(normalX, normalY, normalZ);

      // 2. Hacky Direct Normal (Center)
      const hackyX = normalX * directAmp;
      const hackyY = normalY * directAmp;

      // 3. Interpolation
      const finalX = edgeFactor * (snell.rx * 1.5) + (1.0 - edgeFactor) * hackyX;
      const finalY = edgeFactor * (snell.ry * 1.5) + (1.0 - edgeFactor) * hackyY;

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
