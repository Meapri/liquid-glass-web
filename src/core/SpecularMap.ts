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

  const globalStrength = maxDepth * 0.65;

  // Hybrid Height Field: Official Apple Quartic Root Bevel + Hacky Bivariate Paraboloid Dome
  function getH(px: number, py: number, inside: number): number {
    if (inside <= 0) return 0;
    
    let h = 0;
    // 1. Anti-aliased Apple Bevel (Quartic Polynomial: y = 1 - (1 - t)⁴)
    // Finite slope at the edge completely removes jaggies while keeping the steep refraction
    if (inside < bevelWidth) {
      const invT = 1.0 - (inside / bevelWidth);
      const invT4 = invT * invT * invT * invT;
      h += bevelWidth * (1.0 - invT4);
    } else {
      h += bevelWidth;
    }
    
    // 2. Hacky Bivariate Paraboloid Dome (Completely removes "X" artifact, soft center refraction)
    const u = (px - cx) / halfW;
    const v = (py - cy) / halfH;
    const dome = (1.0 - u * u) * (1.0 - v * v);
    
    h += globalStrength * dome;
    
    return h;
  }

  const lightDirX = -0.7071; // Top-Left
  const lightDirY = -0.7071;

  for (let y = 0; y < h; y++) {
    const isYMiddle = y > bevelWidth && y < h - bevelWidth;
    const py = y + 0.5;
    
    // Sliding Window: initial right point
    let prevHx = getH(0.5, py, getInside(0.5, py));

    for (let x = 0; x < w; x++) {
      // 3. Bounding Box Optimization: Skip the entire massive flat interior
      if (isYMiddle && x > bevelWidth && x < w - bevelWidth) {
        x = Math.max(x, Math.floor(w - bevelWidth - 1));
        prevHx = getH(x + 1.5, py, getInside(x + 1.5, py)); // Sync window
        continue;
      }

      const px = x + 0.5;
      const idx = (y * w + x) * 4;
      const inside0 = getInside(px, py);
      
      if (inside0 <= 0) {
        // imgData is zero-filled by default, no need to write alpha=0
        prevHx = getH(px + 1.5, py, getInside(px + 1.5, py));
        continue;
      }

      let totalSpec = 0;

      // strictly constrain light to the border edge (bevel). NO internal light processing.
      if (inside0 <= bevelWidth) {
        // 1. Sliding Window Optimization
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

        // "Our Unique Formula": Blending physical 3D properties with vector precision
        // 1. Fresnel: Peaks at the extreme outer edge (Nz=0), drops to zero at inner boundary (Nz=1)
        const fresnel = Math.max(0, 1.0 - Nz); 
        
        // 2. Dual-Layered Vector Precision: A razor-sharp core + soft halo
        const core = Math.pow(fresnel, 12.0) * 1.5; // Razor thin inner bright line
        const halo = Math.pow(fresnel, 3.0) * 0.35; // Soft 3D curvature glow
        
        // 3. Directional Flow: Wraps beautifully around the top-left curve
        const dirLen = Math.sqrt(Nx*Nx + Ny*Ny) || 1.0;
        const nxDir = Nx / dirLen;
        const nyDir = Ny / dirLen;
        
        // Main light from Top-Left
        const dotDir = Math.max(0, nxDir * lightDirX + nyDir * lightDirY);
        const rimHighlight = (core + halo) * Math.pow(dotDir, 1.5) * 1.8;

        // Subtle Bottom-Right bounce for completeness
        const bounceDot = Math.max(0, nxDir * -lightDirX + nyDir * -lightDirY);
        const bounceHighlight = Math.pow(fresnel, 4.0) * Math.pow(bounceDot, 2.0) * 0.2;

        totalSpec = (rimHighlight + bounceHighlight) * intensity;
      }

      if (totalSpec > 0) {
        totalSpec = Math.max(0, Math.min(1.0, totalSpec));
        const alpha = Math.round(totalSpec * 255);
        data[idx] = 255;
        data[idx+1] = 255;
        data[idx+2] = 255;
        data[idx+3] = alpha;
      } else {
        prevHx = getH(getInside(px + 1.5, py));
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
