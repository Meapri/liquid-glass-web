/**
 * Pooled scratch canvases for map generation. Rendering a map allocated a fresh
 * canvas every call; since generation is synchronous and one-at-a-time, we can
 * reuse a small set of persistent canvases (one per slot) instead, cutting
 * allocation/GC churn. Each slot keeps its own canvas so differently-sized maps
 * (padded displacement vs. specular) don't thrash each other's dimensions.
 */

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

const pool: Record<string, AnyCanvas> = {};

function make(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Get a reusable canvas for `slot`, sized to w×h (resizing clears it). */
export function scratchCanvas(slot: string, w: number, h: number): AnyCanvas {
  let c = pool[slot];
  if (!c) {
    c = make(w, h);
    pool[slot] = c;
  }
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c;
}

const htmlPool: Record<string, HTMLCanvasElement> = {};

/**
 * Get a reusable *HTMLCanvasElement* for `slot` (OffscreenCanvas has no
 * toDataURL, so the data-URL encode step needs a real canvas).
 */
export function scratchHTMLCanvas(slot: string, w: number, h: number): HTMLCanvasElement {
  let c = htmlPool[slot];
  if (!c) {
    c = document.createElement('canvas');
    htmlPool[slot] = c;
  }
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c;
}
