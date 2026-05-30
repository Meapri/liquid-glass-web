/**
 * Refraction (displacement) map — edge-concentrated lensing via Snell's law.
 *
 * Apple's Liquid Glass bends light through "responsive lensing along its edges"
 * while keeping the body optically clear (Meet Liquid Glass, WWDC25). We build
 * the convex-roundover rim in `SurfaceField`, take its surface normal, refract a
 * straight-down viewing ray through the air→glass interface (n = 1.5) with the
 * GLSL `refract()` formula, and encode the resulting lateral shift into the R/G
 * channels of a displacement map that `feDisplacementMap` resolves on the GPU.
 *
 * The map is padded by `refraction` px on every side so the rim can sample
 * backdrop from *beyond* the element box — matching Apple's note that the glass
 * "samples content from an area larger than itself".
 */

import { makeSurface } from './SurfaceField';
import { scratchCanvas, scratchHTMLCanvas } from './scratch';

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

/** Index of refraction of the glass body (air = 1.0). */
const GLASS_IOR = 1.5;
/** Lens depth at the reference thickness, as a fraction of the half short-side.
 * Larger ⇒ a deeper, more dimensional lens (thicker-glass volume). */
const LENS_DEPTH_BASE = 1.95;
/** `thickness` (CSS px) that maps to the base depth; others scale linearly. */
const THICKNESS_REF = 30;
/**
 * Maps the refracted ray's normalised lateral component onto the encodable
 * ±1 range so the steepest rim saturates to ~the full `refraction` displacement
 * while the clear interior stays at the neutral 128.
 */
const RIM_GAIN = 1.7;

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

  const canvas = scratchCanvas('disp', totalW, totalH);
  const ctx = canvas.getContext('2d', {
    willReadFrequently: false,
  }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  const img = ctx.createImageData(totalW, totalH);
  const data = img.data;

  // ─── Geometry (shared with the specular map) ───
  // `thickness` scales the lens depth: thicker glass ⇒ deeper lens ⇒ more
  // pronounced edge lensing (Apple: "thicker material has more pronounced
  // lensing and refraction"). Clamped so it stays a sensible fraction of size.
  const halfMin = Math.min(w, h) / 2;
  const thicknessScale = Math.max(0.3, Math.min(1.6, params.thickness / THICKNESS_REF));
  const lensDepth = halfMin * LENS_DEPTH_BASE * thicknessScale;
  const surf = makeSurface({
    cx: pad + w / 2,
    cy: pad + h / 2,
    halfW: w / 2,
    halfH: h / 2,
    r,
    lensDepth,
  });

  // Snell's law, air → glass. Straight-down viewing ray I = (0, 0, -1).
  const eta = 1 / GLASS_IOR;

  for (let y = 0; y < totalH; y++) {
    const rowBase = y * totalW * 4;
    const py = y + 0.5;

    for (let x = 0; x < totalW; x++) {
      const px = x + 0.5;
      const i = rowBase + x * 4;

      if (surf.sdf(px, py) <= 0) {
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 255;
        continue;
      }

      const { nx, ny, nz } = surf.lensNormal(px, py);

      // refract(I, N, eta) with I = (0,0,-1): I·N = -nz.
      const dot = -nz;
      const k = 1 - eta * eta * (1 - dot * dot);

      let fx = 0;
      let fy = 0;
      if (k >= 0) {
        const c = eta * dot + Math.sqrt(k);
        // I component is 0 in x/y, so the refracted lateral shift is −c·N_xy.
        fx = -c * nx * RIM_GAIN;
        fy = -c * ny * RIM_GAIN;
      }

      // 128 = neutral (no shift); ±127 = full ±scale displacement.
      data[i] = Math.max(1, Math.min(255, Math.round(128 + fx * 127)));
      data[i + 1] = Math.max(1, Math.min(255, Math.round(128 + fy * 127)));
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
  const tmp = scratchHTMLCanvas('encode', canvas.width, canvas.height);
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
  tctx.drawImage(canvas as unknown as CanvasImageSource, 0, 0);
  return tmp.toDataURL('image/webp', 1.0);
}
