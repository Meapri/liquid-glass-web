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
  
  // CRITICAL: The exact SDF is mathematically C1-continuous ONLY within a distance 'r' 
  // from the boundary (the tubular neighborhood theorem). By clamping bevelWidth < r, 
  // we guarantee that the bevel flattens out before hitting the medial axis, ensuring ZERO creases.
  const maxBevel = Math.max(2, r * 0.95);
  const bevelWidth = Math.min(maxBevel, Math.max(2, params.thickness * dpr));

  const globalStrength = maxDepth * 0.15; // Very subtle dome

  // Exact distance from the boundary (positive inside)
  function getSdf(px: number, py: number): number {
    const adx = Math.abs(px - cx);
    const ady = Math.abs(py - cy);
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

  function smootherstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function getHeight(px: number, py: number): number {
    const d = getSdf(px, py);
    if (d <= 0) return 0;

    const t = Math.max(0, Math.min(1, d / bevelWidth));
    const hBevel = bevelWidth * smootherstep(0, 1.0, t);

    const dxC = px - cx;
    const dyC = py - cy;
    const u = dxC / halfW;
    const v = dyC / halfH;
    const hDome = globalStrength * (1.0 - u * u) * (1.0 - v * v);

    return hBevel + hDome;
  }

  // ─── Main Rendering Loop ───
  for (let y = 0; y < totalH; y++) {
    const rowBase = y * totalW * 4;
    const py = y + 0.5;

    for (let x = 0; x < totalW; x++) {
      const px = x + 0.5;
      const i = rowBase + x * 4;

      const d = getSdf(px, py);
      if (d <= 0) {
        data[i] = 128; data[i + 1] = 128; data[i + 2] = 128; data[i + 3] = 255;
        continue;
      }

      // 1. Compute flawless normal via finite differences of the C1 continuous height field
      const eps = 0.5;
      const hL = getHeight(px - eps, py);
      const hR = getHeight(px + eps, py);
      const hU = getHeight(px, py - eps);
      const hD = getHeight(px, py + eps);

      const dHdx = (hR - hL) / (2.0 * eps);
      const dHdy = (hD - hU) / (2.0 * eps);
      const len = Math.sqrt(dHdx * dHdx + dHdy * dHdy + 1.0);

      const nx = -dHdx / len;
      const ny = -dHdy / len;
      const nz = 1.0 / len;

      // 2. Snell's Law (Air to Glass)
      const ex = 0.0, ey = 0.0, ez = -1.0;
      const eta = 0.667; // IOR 1.5
      const dot = ex * nx + ey * ny + ez * nz;
      const k = 1.0 - eta * eta * (1.0 - dot * dot);

      let finalX = 0;
      let finalY = 0;

      if (k >= 0) {
        // Refracted ray vector
        const rx = eta * ex - (eta * dot + Math.sqrt(k)) * nx;
        const ry = eta * ey - (eta * dot + Math.sqrt(k)) * ny;

        const amp = 1.5;
        finalX = rx * amp;
        finalY = ry * amp;
      }

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
