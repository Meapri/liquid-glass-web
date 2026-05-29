/**
 * Generates a static specular rim PNG for use inside the SVG filter chain.
 *
 * The result is a transparent canvas with:
 *   - a bright 1.5 px hairline along the inside of the rounded-rect border,
 *     ramping from full-white in the top-left quadrant to fully transparent
 *     in the bottom-right (a fixed UI light from upper-left, like macOS),
 *   - a soft white hotspot centred near the top-left interior to mimic the
 *     broad reflection of an ambient ceiling source.
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
  const dpr = Math.max(1, Math.min(3, params.pixelRatio));
  const w = Math.max(2, Math.round(params.width * dpr));
  const h = Math.max(2, Math.round(params.height * dpr));
  const r = Math.max(0, Math.min(Math.min(w, h) / 2, params.radius * dpr));
  const intensity = Math.max(0, Math.min(1.5, params.intensity));

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  if (canvas instanceof HTMLCanvasElement) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext('2d', {
    alpha: true,
  }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  ctx.clearRect(0, 0, w, h);

  // 1. Bright hairline along the inside of the rim. A doubled stroke (wider
  //    soft halo + narrower hard core) gives the rim depth without aliasing.
  const stroke = Math.max(1, dpr * 1.5);
  const haloWidth = stroke * 3.2;

  // Soft halo first
  ctx.lineWidth = haloWidth;
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.32 * intensity})`;
  roundRectPath(ctx, 0.5, 0.5, w - 1, h - 1, r - 0.5);
  ctx.stroke();

  // Hard rim core
  ctx.lineWidth = stroke;
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.95 * intensity})`;
  roundRectPath(ctx, 0.5, 0.5, w - 1, h - 1, r - 0.5);
  ctx.stroke();

  // 2. Anisotropic mask — brightest on the lit (top-left) edge, fading through
  //    the shadowed middle, then a subtle return at the far bottom-right corner.
  //    That far "lip" highlight is what gives Liquid Glass its sense of physical
  //    thickness (the edge catches light on both sides, not just the top).
  ctx.globalCompositeOperation = 'destination-in';
  const litGrad = ctx.createLinearGradient(0, 0, w, h);
  litGrad.addColorStop(0.0, 'rgba(0, 0, 0, 1.0)');   // lit top-left edge — full
  litGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0.42)');
  litGrad.addColorStop(0.82, 'rgba(0, 0, 0, 0.08)'); // shadowed middle
  litGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.30)');  // bottom-right lip catches light
  ctx.fillStyle = litGrad;
  ctx.fillRect(0, 0, w, h);

  // 3. Soft hotspot — a restrained diffuse highlight near the top-left interior,
  //    the gentle sheen of an overhead light on the glass. Kept subtle so flat
  //    tiles read as refined frost (not a glossy bead) — Apple's Control Center
  //    material is understated, carried by the frost + rim, not a wet gloss.
  ctx.globalCompositeOperation = 'lighter';
  const hotX = w * 0.3;
  const hotY = h * 0.26;
  const hotR = Math.max(w, h) * 0.5;
  const hot = ctx.createRadialGradient(hotX, hotY, 0, hotX, hotY, hotR);
  hot.addColorStop(0, `rgba(255, 255, 255, ${0.14 * intensity})`);
  hot.addColorStop(0.55, `rgba(255, 255, 255, ${0.04 * intensity})`);
  hot.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = hot;
  // Clip the hotspot to the rounded shape so it doesn't bleed past corners.
  ctx.save();
  roundRectPath(ctx, 0, 0, w, h, r);
  ctx.clip();
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  ctx.globalCompositeOperation = 'source-over';

  if (canvas instanceof HTMLCanvasElement) {
    return canvas.toDataURL('image/png');
  }
  return offscreenToDataURL(canvas as OffscreenCanvas);
}

function roundRectPath(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function offscreenToDataURL(canvas: OffscreenCanvas): string {
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  const tctx = tmp.getContext('2d')!;
  tctx.drawImage(canvas as unknown as CanvasImageSource, 0, 0);
  return tmp.toDataURL('image/png');
}
