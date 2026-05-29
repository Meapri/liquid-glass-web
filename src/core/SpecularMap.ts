/**
 * Specular Rim Map — Analytical Gradient Edition
 *
 * Uses the same hybrid height field as DisplacementMap (rational bevel + paraboloid dome)
 * with fully analytical normals for specular lighting computation.
 * Zero finite-difference calls — everything is chain-rule derivatives.
 */

export interface SpecularMapParams {
  width: number;
  height: number;
  radius: number;
  thickness: number;
  pixelRatio: number;
  intensity: number;
}

export function generateSpecularMap(params: SpecularMapParams): string {
  const dpr = params.pixelRatio;
  const w = Math.max(2, Math.round(params.width * dpr));
  const h = Math.max(2, Math.round(params.height * dpr));
  const r = Math.max(0, Math.min(Math.min(w, h) / 2, params.radius * dpr));
  const intensity = Math.max(0, params.intensity);

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  if (canvas instanceof HTMLCanvasElement) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  const imgData = ctx.createImageData(w, h);
  const data = imgData.data;

  // ─── Geometry (must match DisplacementMap exactly) ───
  const halfW = w / 2;
  const halfH = h / 2;
  const cx = halfW;
  const cy = halfH;
  const innerW = Math.max(0, halfW - r);
  const innerH = Math.max(0, halfH - r);

  const maxDepth = Math.min(halfW, halfH);
  const bevelWidth = Math.min(maxDepth, Math.max(2, params.thickness * dpr));

  // ─── Formula Constants ───
  const globalStrength = maxDepth * 1.2;
  const lightDirX = -0.7071; // Top-Left
  const lightDirY = -0.7071;
  const strengthMult = intensity;

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

  // Helper: Clean height field without crease (exact match with DisplacementMap)
  function getHeight(px: number, py: number): number {
    const dxC = px - cx;
    const dyC = py - cy;
    const adx = Math.abs(dxC);
    const ady = Math.abs(dyC);

    const d = getSdf(adx, ady);
    if (d <= 0) return 0;

    const fade = smootherstep(0, bevelWidth, d);

    const u = dxC * invHalfW;
    const v = dyC * invHalfH;
    const dome = (1.0 - u * u) * (1.0 - v * v);

    return (bevelWidth + globalStrength * dome) * fade;
  }

  // ─── Main Rendering Loop ───
  for (let y = 0; y < h; y++) {
    const py = y + 0.5;

    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const idx = (y * w + x) * 4;

      const dxC = px - cx;
      const dyC = py - cy;
      const adx = Math.abs(dxC);
      const ady = Math.abs(dyC);

      const d = getSdf(adx, ady);
      if (d <= 0) continue;

      // ─── Numerical Finite Difference Gradient ───
      const eps = 0.5;
      const hL = getHeight(px - eps, py);
      const hR = getHeight(px + eps, py);
      const hU = getHeight(px, py - eps);
      const hD = getHeight(px, py + eps);

      const dHdx = (hR - hL) / (2.0 * eps);
      const dHdy = (hD - hU) / (2.0 * eps);

      const nLen = Math.sqrt(dHdx * dHdx + dHdy * dHdy + 1.0);
      const Nx = -dHdx / nLen;
      const Ny = -dHdy / nLen;

      // ─── Specular Lighting ───
      const dot = Nx * lightDirX + Ny * lightDirY;
      let totalSpec = 0;

      if (dot > 0) {
        const spec = Math.pow(dot, 16);
        const rim = Math.pow(1.0 - Math.abs(dot), 4);
        totalSpec = spec * 180 + rim * spec * 75;
      }

      // High-frequency caustic glare
      if (dot > 0.85) {
        const highFreq = Math.pow((dot - 0.85) * 6.666, 8);
        totalSpec += highFreq * 100;
      }

      if (totalSpec > 0) {
        const outA = Math.min(255, totalSpec * strengthMult);
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = outA;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  if (canvas instanceof HTMLCanvasElement) {
    return canvas.toDataURL('image/webp', 1.0);
  }
  return offscreenToDataURL(canvas as OffscreenCanvas);
}

function offscreenToDataURL(canvas: OffscreenCanvas): string {
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
  tctx.drawImage(canvas as unknown as CanvasImageSource, 0, 0);
  return tmp.toDataURL('image/webp', 1.0);
}
