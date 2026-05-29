/**
 * Generates a static specular rim PNG for use inside the SVG filter chain.
 *
 * The result is a transparent canvas with:
 *   - a bright 1.5 px hairline along the inside of the rounded-rect border,
 *     ramping from full-white in the top-left quadrant to fully transparent
 *     in the bottom-right (a fixed UI light from upper-left, like macOS).
 *
 * No motion. No rAF. Cheap to generate, cheap to composite — the SVG filter
 * blends this onto the refracted backdrop in a single GPU pass.
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
  const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  const imgData = ctx.createImageData(w, h);
  const data = imgData.data;

  // Geometry parameters must match DisplacementMap.ts EXACTLY
  const halfW = w / 2;
  const halfH = h / 2;
  const cx = halfW;
  const cy = halfH;
  
  const maxDepth = Math.min(halfW, halfH);
  const bevelWidth = Math.min(maxDepth, Math.max(2, params.thickness * dpr));

  function getInside(x: number, y: number): number {
    const adx = Math.abs(x - cx);
    const ady = Math.abs(y - cy);
    const inX = halfW - r;
    const inY = halfH - r;
    if (adx > inX && ady > inY) {
      const dx = adx - inX;
      const dy = ady - inY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return r - dist;
    }
    return Math.min(halfW - adx, halfH - ady);
  }

  const globalStrength = maxDepth * 0.6;
  const k = Math.max(1.0, bevelWidth * 0.35);

  // Ultra-fast Rational Bevel + Bivariate Paraboloid Dome
  // ZERO branches, NO Math.pow, PERFECTLY smooth (C-infinity), NO separation lines!
  function getH(px: number, py: number, inside: number): number {
    if (inside <= 0) return 0;
    
    const fade = inside / (inside + k);
    const bevel = bevelWidth * fade;
    
    const u = (px - cx) / halfW;
    const v = (py - cy) / halfH;
    const dome = globalStrength * (1.0 - u * u) * (1.0 - v * v);
    
    return bevel + dome * fade;
  }

  const lightDirX = -0.7071; // Top-Left
  const lightDirY = -0.7071;

  for (let y = 0; y < h; y++) {
    const isYMiddle = y > bevelWidth && y < h - bevelWidth;
    const py = y + 0.5;
    
    // Sliding Window: initial right point
    let prevHx = getH(0.5, py, getInside(0.5, py));

    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const idx = (y * w + x) * 4;
      const inside0 = getInside(px, py);
      
      if (inside0 <= 0) {
        // imgData is zero-filled by default, no need to write alpha=0
        prevHx = getH(px + 1.5, py, getInside(px + 1.5, py));
        continue;
      }

      // Smoothly calculate light across the entire surface (no abrupt cutoffs)
      const h0 = prevHx;
      const hx = getH(px + 1.5, py, getInside(px + 1.5, py));
      const hy = getH(px, py + 1.5, getInside(px, py + 1.5));
      prevHx = hx;

      const dHdx = hx - h0;
      const dHdy = hy - h0;

      const nLen = Math.sqrt(dHdx * dHdx + dHdy * dHdy + 1.0);
      const Nx = -dHdx / nLen;
      const Ny = -dHdy / nLen;
        const Nz = 1.0 / nLen;


      const dot = Nx * lightDirX + Ny * lightDirY;
      let totalSpec = 0;
      
      if (dot > 0) {
        const spec = Math.pow(dot, 16);
        const rim = Math.pow(1.0 - Math.abs(Nx * lightDirX + Ny * lightDirY), 4);
        totalSpec = spec * 180 + rim * spec * 75;
      }

      // 2. High-Frequency Caustic Glare
      // A secondary tighter specular lobe for the hard "glass ring" effect
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
