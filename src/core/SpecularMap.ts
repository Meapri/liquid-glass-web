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

  // ─── Hybrid Formula Constants ───
  const globalStrength = maxDepth * 1.2;
  const kFade = Math.max(1.0, bevelWidth * 0.35);
  const lightDirX = -0.7071; // Top-Left
  const lightDirY = -0.7071;
  const strengthMult = intensity;

  // ─── Precomputed reciprocals ───
  const invHalfW = 1.0 / halfW;
  const invHalfH = 1.0 / halfH;

  // ─── Main Rendering Loop ───
  for (let y = 0; y < h; y++) {
    const py = y + 0.5;

    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const idx = (y * w + x) * 4;

      // ─── 1. Inline Rounded-Rect SDF + Analytical Gradient ───
      const dxC = px - cx;
      const dyC = py - cy;
      const adx = Math.abs(dxC);
      const ady = Math.abs(dyC);
      const sx = dxC >= 0 ? 1.0 : -1.0;
      const sy = dyC >= 0 ? 1.0 : -1.0;

      const qx = adx - innerW;
      const qy = ady - innerH;

      let inside: number;
      let dIdx: number;
      let dIdy: number;

      if (qx > 0 && qy > 0) {
        const dist = Math.sqrt(qx * qx + qy * qy);
        inside = r - dist;
        const invD = dist > 0.001 ? 1.0 / dist : 0;
        dIdx = -sx * qx * invD;
        dIdy = -sy * qy * invD;
      } else if (halfW - adx < halfH - ady) {
        inside = halfW - adx;
        dIdx = -sx;
        dIdy = 0;
      } else {
        inside = halfH - ady;
        dIdx = 0;
        dIdy = -sy;
      }

      if (inside <= 0) continue;

      // ─── 2. Rational Fade ───
      const ipk = inside + kFade;
      const fade = inside / ipk;
      const dFdI = kFade / (ipk * ipk);

      // ─── 3. Bivariate Paraboloid Dome ───
      const u = dxC * invHalfW;
      const v = dyC * invHalfH;
      const uu = u * u;
      const vv = v * v;
      const dome = (1.0 - uu) * (1.0 - vv);

      // ─── 4. Analytical Normal (Chain Rule) ───
      const dFdx = dFdI * dIdx;
      const dFdy = dFdI * dIdy;
      const fadeCoeff = bevelWidth + globalStrength * dome;
      const dDdx = -2.0 * u * invHalfW * (1.0 - vv);
      const dDdy = -2.0 * v * invHalfH * (1.0 - uu);
      const dHdx = fadeCoeff * dFdx + globalStrength * dDdx * fade;
      const dHdy = fadeCoeff * dFdy + globalStrength * dDdy * fade;

      const nLen = Math.sqrt(dHdx * dHdx + dHdy * dHdy + 1.0);
      const Nx = -dHdx / nLen;
      const Ny = -dHdy / nLen;

      // ─── 5. Specular Lighting ───
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
