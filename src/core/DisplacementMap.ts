/**
 * Physically-based refraction displacement map (Snell's law) via GLSL Port.
 *
 * Implements exact 3D optic rendering for Apple Liquid Glass:
 *   SDF -> height field (h) -> normal (N) -> refract(I, N, 1/IOR) -> UV displacement
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

  const cx = pad + w / 2;
  const cy = pad + h / 2;
  const halfW = w / 2;
  const halfH = h / 2;
  const innerW = Math.max(0, halfW - r);
  const innerH = Math.max(0, halfH - r);
  
  const maxDepth = Math.min(halfW, halfH);
  const bevelWidth = Math.min(maxDepth, Math.max(2, params.thickness * dpr));

  // Exact SDF inside distance
  function getInside(x: number, y: number): number {
    const adx = Math.abs(x - cx);
    const ady = Math.abs(y - cy);
    const qx = adx - innerW;
    const qy = ady - innerH;

    if (qx > 0 && qy > 0) {
      const dist = Math.sqrt(qx * qx + qy * qy);
      return r - dist;
    }
    
    return Math.min(halfW - adx, halfH - ady);
  }

  // Global Magnification Constants
  // Adjusted to 0.8 for the perfect balance of central lens refraction
  const globalStrength = maxDepth * 0.8;

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

  const eta = 1.0 / 1.45; // IOR for glass
  const strengthMult = 1.0; 

  for (let y = 0; y < totalH; y++) {
    const rowBase = y * totalW * 4;
    const py = y + 0.5;

    // Sliding Window: pre-calculate the very first 'right' point of the row
    let prevHx = getH(0.5, py, getInside(0.5, py));

    for (let x = 0; x < totalW; x++) {
      const px = x + 0.5;
      const i = rowBase + x * 4;

      const inside0 = getInside(px, py);
      if (inside0 <= 0) {
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 255;
        // Keep window updated
        prevHx = getH(px + 1.5, py, getInside(px + 1.5, py));
        continue;
      }

      // 1. Sliding Window Optimization (33% fewer getH calls)
      const h0 = prevHx;
      const hx = getH(px + 1.5, py, getInside(px + 1.5, py));
      const hy = getH(px, py + 1.5, getInside(px, py + 1.5));
      prevHx = hx; // Shift window rightwards

      const dHdx = hx - h0;
      const dHdy = hy - h0;

      // 2. Normal vector N = normalize(-dHdx, -dHdy, 1.0)
      const len = Math.sqrt(dHdx * dHdx + dHdy * dHdy + 1.0);
      const N0 = -dHdx / len;
      const N1 = -dHdy / len;
      const N2 = 1.0 / len;

      // 3. GLSL refract(I, N, eta) where I = (0, 0, -1)
      const cosi = -N2;
      const k = 1.0 - eta * eta * (1.0 - N2 * N2);
      
      let finalX = 0;
      let finalY = 0;
      
      if (k >= 0) {
        const b = eta * (-N2) + Math.sqrt(k);
        const T0 = -b * N0;
        const T1 = -b * N1;
        const T2 = -eta - b * N2;
        
        // 4. UV offset
        const tz = Math.max(Math.abs(T2), 0.1);
        finalX = (T0 / tz) * strengthMult;
        finalY = (T1 / tz) * strengthMult;
      }

      // Encode into RGBA 
      // Multiplier of 127 fits perfectly as |T.xy/T.z| <= ~0.95 for IOR 1.45
      data[i] = Math.max(1, Math.min(255, Math.round(128 + finalX * 127)));
      data[i + 1] = Math.max(1, Math.min(255, Math.round(128 + finalY * 127)));
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  const url =
    canvas instanceof HTMLCanvasElement
      ? canvas.toDataURL('image/webp', 1.0) // Lossless WebP is faster/smaller
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
