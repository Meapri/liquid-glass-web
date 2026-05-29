/**
 * Specular / light map — crisp, geometry-driven rim highlight.
 *
 * Apple lights Liquid Glass with an environment: "highlights that respond to
 * geometry … light to travel around the material, defining its silhouette"
 * (Meet Liquid Glass, WWDC25). The refraction lens is a broad smooth dome (so it
 * leaves no inner seam), but the *light* must hug the exact rounded-rect edge to
 * read as a crisp rim — so the highlight is computed straight from the SDF, in a
 * thin band at the perimeter, independent of the dome:
 *
 *   • primary lobe  — a bright arc where the edge faces the key light (top-left);
 *   • silhouette rim — a thin continuous trace around the whole edge;
 *   • back fill      — a soft catch on the opposite edge.
 *
 * Everything is confined to a band `rimWidth` wide and faded to nothing on its
 * inner side, so it is light on the rim, never a refraction boundary.
 */

import { makeSurface } from './SurfaceField';
import { scratchCanvas, scratchHTMLCanvas } from './scratch';

export interface SpecularMapParams {
  width: number;
  height: number;
  radius: number;
  thickness: number;
  pixelRatio: number;
  intensity: number;
}

// Key light: straight from the top (no left bias, so no corner hot-spot).
const LIGHT_X = 0;
const LIGHT_Y = -1;

const PRIMARY_EXP = 3; // broad top emphasis (brightest at the top edge)
const W_PRIMARY = 0.6; // gentle static top edge — the dynamic cursor light leads
const W_RIM = 0.1; // faint continuous line tracing the rest of the silhouette
const GAIN = 255;

// Broad convex gloss — light reflecting off the rounded glass surface, brightest
// in the upper area, fading down. This is the soft glassy sheen ("질감") you see
// on real Liquid Glass controls, on top of the crisp rim.
const GLOSS_CX = 0; // upper-centre, in normalised [-1,1] coords
const GLOSS_CY = -0.42;
const GLOSS_RADIUS = 1.3;
const GLOSS_EXP = 2.4;
const W_GLOSS = 0.22;

export function generateSpecularMap(params: SpecularMapParams): string {
  const dpr = params.pixelRatio;
  const w = Math.max(2, Math.round(params.width * dpr));
  const h = Math.max(2, Math.round(params.height * dpr));
  const r = Math.max(0, Math.min(Math.min(w, h) / 2, params.radius * dpr));
  const intensity = Math.max(0, params.intensity);

  const canvas = scratchCanvas('spec', w, h);
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;

  const imgData = ctx.createImageData(w, h);
  const data = imgData.data;

  // Razor-thin edge line — Apple defines the silhouette with a crisp light at the
  // very rim, not a soft wide bevel. ~2 CSS px, capped under the corner radius.
  const lineW = Math.min(2.2 * dpr, Math.max(2, r * 0.6));
  const surf = makeSurface({ cx: w / 2, cy: h / 2, halfW: w / 2, halfH: h / 2, r });

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      const d = surf.sdf(px, py);
      if (d <= 0) continue; // outside the glass

      let s = 0;

      // Broad convex gloss — soft reflection over the upper surface.
      const u = (px - w / 2) / (w / 2);
      const v = (py - h / 2) / (h / 2);
      const gdx = u - GLOSS_CX;
      const gdy = v - GLOSS_CY;
      const gloss = Math.max(0, 1 - Math.sqrt(gdx * gdx + gdy * gdy) / GLOSS_RADIUS);
      if (gloss > 0) s += Math.pow(gloss, GLOSS_EXP) * W_GLOSS;

      // Crisp edge rim — only within the thin line at the very perimeter.
      if (d < lineW) {
        const eps = 0.75;
        const gx = (surf.sdf(px + eps, py) - surf.sdf(px - eps, py)) / (2 * eps);
        const gy = (surf.sdf(px, py + eps) - surf.sdf(px, py - eps)) / (2 * eps);
        const gl = Math.sqrt(gx * gx + gy * gy) || 1;
        const facing = (-gx / gl) * LIGHT_X + (-gy / gl) * LIGHT_Y;
        const t = 1 - d / lineW;
        const fade = t * t;
        const primary = facing > 0 ? Math.pow(facing, PRIMARY_EXP) : 0;
        s += (W_PRIMARY * primary + W_RIM) * fade;
      }

      const a = Math.min(255, s * intensity * GAIN);
      if (a <= 0) continue;
      const idx = (y * w + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = a;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  if (canvas instanceof HTMLCanvasElement) {
    return canvas.toDataURL('image/webp', 1.0);
  }
  return offscreenToDataURL(canvas as OffscreenCanvas);
}

function offscreenToDataURL(canvas: OffscreenCanvas): string {
  const tmp = scratchHTMLCanvas('encode', canvas.width, canvas.height);
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
  tctx.drawImage(canvas as unknown as CanvasImageSource, 0, 0);
  return tmp.toDataURL('image/webp', 1.0);
}
