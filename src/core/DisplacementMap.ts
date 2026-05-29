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

  // ─── Hybrid Formula Constants ───
  const globalStrength = maxDepth * 1.2;
  const kFade = Math.max(1.0, bevelWidth * 0.35);
  const eta = 1.0 / 1.45; // Glass IOR
  const etaSq = eta * eta;
  const directAmp = 0.6; // Apple-style direct normal amplification for dome interior
  const kSmooth = 4.0;   // Smooth-min radius to eliminate X-crease (pixels)
  const kSmooth2 = kSmooth * kSmooth; // Pre-squared for perf

  // ─── Precomputed reciprocals for dome derivatives ───
  const invHalfW = 1.0 / halfW;
  const invHalfH = 1.0 / halfH;

  // ─── Main Rendering Loop ───
  for (let y = 0; y < totalH; y++) {
    const rowBase = y * totalW * 4;
    const py = y + 0.5;

    for (let x = 0; x < totalW; x++) {
      const px = x + 0.5;
      const i = rowBase + x * 4;

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
      let dIdx: number; // ∂(inside)/∂x
      let dIdy: number; // ∂(inside)/∂y

      if (qx > 0 && qy > 0) {
        // Corner arc — gradient points radially inward (already C∞ smooth)
        const dist = Math.sqrt(qx * qx + qy * qy);
        inside = r - dist;
        const invD = dist > 0.001 ? 1.0 / dist : 0;
        dIdx = -sx * qx * invD;
        dIdy = -sy * qy * invD;
      } else {
        // Flat region — use Smooth Minimum instead of min(a,b) to eliminate
        // the X-shaped Mach band crease where (halfW - adx) == (halfH - ady).
        // smoothMin(a, b, k) = (a + b - √((a-b)² + k²)) / 2
        const a = halfW - adx;
        const b = halfH - ady;
        const diff = a - b;
        const denom = Math.sqrt(diff * diff + kSmooth2);
        inside = (a + b - denom) * 0.5;
        // Analytical gradient weights: wa + wb = 1, smooth blend
        const wa = (1.0 - diff / denom) * 0.5; // weight for a (x-edge)
        const wb = (1.0 + diff / denom) * 0.5; // weight for b (y-edge)
        dIdx = wa * (-sx);
        dIdy = wb * (-sy);
      }

      if (inside <= 0) {
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 255;
        continue;
      }

      // ─── 2. Rational Fade: f(d) = d/(d+k), f'(d) = k/(d+k)² ───
      const ipk = inside + kFade;
      const fade = inside / ipk;
      const dFdI = kFade / (ipk * ipk);

      // ─── 3. "Hacky" Bivariate Paraboloid Dome ───
      const u = dxC * invHalfW;
      const v = dyC * invHalfH;
      const uu = u * u;
      const vv = v * v;
      const dome = (1.0 - uu) * (1.0 - vv);

      // ─── 4. Analytical Height Gradient (Chain Rule) ───
      // h = bevelWidth·fade + globalStrength·dome·fade
      // ∂h/∂x = (bevelWidth + globalStrength·dome) · ∂fade/∂x  +  globalStrength · ∂dome/∂x · fade
      const dFdx = dFdI * dIdx;
      const dFdy = dFdI * dIdy;
      const fadeCoeff = bevelWidth + globalStrength * dome;
      const dDdx = -2.0 * u * invHalfW * (1.0 - vv);
      const dDdy = -2.0 * v * invHalfH * (1.0 - uu);
      const dHdx = fadeCoeff * dFdx + globalStrength * dDdx * fade;
      const dHdy = fadeCoeff * dFdy + globalStrength * dDdy * fade;

      // ─── 5. Surface Normal ───
      const len = Math.sqrt(dHdx * dHdx + dHdy * dHdy + 1.0);
      const N0 = -dHdx / len;
      const N1 = -dHdy / len;
      const N2 = 1.0 / len;

      // ─── 6. Hybrid Refraction: Snell's Law × Direct Normal Mapping ───
      //
      // Pure Snell's law gives near-zero displacement in the flat dome center
      // because the normals are almost vertical (N ≈ (0,0,1)).
      // Apple's Liquid Glass uses amplified normal-based displacement everywhere
      // to create the characteristic "magnifying glass" look.
      //
      // Our hybrid: blend Snell's law (physically correct at steep edges) with
      // direct normal displacement (visually strong at shallow dome center).

      // A) Snell's Law for edge bevel
      const kRefr = 1.0 - etaSq * (1.0 - N2 * N2);
      let snellX = 0;
      let snellY = 0;
      if (kRefr >= 0) {
        const b = eta * (-N2) + Math.sqrt(kRefr);
        snellX = -b * N0;
        snellY = -b * N1;
        const tz = Math.max(Math.abs(-eta - b * N2), 0.1);
        snellX /= tz;
        snellY /= tz;
      }

      // B) Direct Normal Mapping for dome interior (Apple-style amplification)
      // N0, N1 are the XY components of the surface normal — directly proportional
      // to surface slope. Multiplying by a strength factor gives controllable
      // displacement that works even on very gentle slopes.
      const directX = N0 * directAmp;
      const directY = N1 * directAmp;

      // C) Blend: edge region uses Snell, interior uses direct normal mapping.
      // fade goes 0→1 from edge to center, so we crossfade smoothly.
      const edgeness = 1.0 - fade; // 1 at edge, 0 at center
      const ee = edgeness * edgeness; // Sharpen the transition
      const finalX = snellX * ee + directX * (1.0 - ee);
      const finalY = snellY * ee + directY * (1.0 - ee);

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
