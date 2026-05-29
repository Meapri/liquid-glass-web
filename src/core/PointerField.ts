/**
 * Global pointer-light field — the environment light source for every glass
 * element. Apple's Liquid Glass has light that "travels around the material,
 * defining its silhouette" and reacts as you approach; we model the cursor as
 * that light source.
 *
 * One shared `pointermove` listener (rAF-coalesced) updates, for each registered
 * element, three CSS custom properties consumed by `.liquid-glass::after`:
 *   --lg-pointer-x / --lg-pointer-y  position of the light (0..1, clamped to the
 *                                    nearest edge when the cursor is outside)
 *   --lg-glow                        proximity 0..1 — ramps up as the cursor
 *                                    nears, so the edge lights up *from a
 *                                    distance*, not only on direct hover.
 *
 * This lives in the core so ALL glass gets it, not just interactive controls.
 */

const elements = new Set<HTMLElement>();
/** On-screen subset (kept by the IntersectionObserver) — only these are updated. */
const visible = new Set<HTMLElement>();
/** Last glow written per element, so we can skip elements that stay dark. */
const lastGlow = new WeakMap<HTMLElement, number>();
let rafId = 0;
let pointerX = -1e6;
let pointerY = -1e6;
let listening = false;

/** Distance (px) beyond an element's box at which the light fades to zero. */
const FALLOFF = 220;

let observer: IntersectionObserver | null = null;
function ensureObserver(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver === 'undefined') return observer;
  // rootMargin = FALLOFF so elements just off-screen still pre-light near the edge.
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (e.isIntersecting) {
          visible.add(el);
        } else {
          visible.delete(el);
          // Clear any residual glow when it leaves the viewport.
          if ((lastGlow.get(el) ?? 0) !== 0) {
            lastGlow.set(el, 0);
            el.style.setProperty('--lg-glow', '0');
          }
        }
      }
    },
    { rootMargin: `${FALLOFF}px` }
  );
  return observer;
}

function schedule(): void {
  if (rafId) return;
  rafId = requestAnimationFrame(flush);
}

function flush(): void {
  rafId = 0;

  // Read phase — collect every rect first. Reading layout and writing styles in
  // the same loop would thrash (each read after a write forces a reflow), so we
  // batch all the getBoundingClientRect() reads, then do all the writes. Only
  // on-screen elements are touched (off-screen ones are skipped entirely).
  const els: HTMLElement[] = [];
  const rects: DOMRect[] = [];
  for (const el of visible) {
    if (!el.isConnected) {
      visible.delete(el);
      elements.delete(el);
      continue;
    }
    els.push(el);
    rects.push(el.getBoundingClientRect());
  }

  // Write phase — no layout reads here, so no reflow is forced.
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const r = rects[i];
    if (r.width === 0 || r.height === 0) continue;

    // Shortest distance from the pointer to the element box (0 when inside).
    const dx = Math.max(r.left - pointerX, 0, pointerX - r.right);
    const dy = Math.max(r.top - pointerY, 0, pointerY - r.bottom);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const glow = Math.max(0, Math.min(1, 1 - dist / FALLOFF));

    // Skip elements that are dark this frame and were dark last frame — far from
    // the cursor they cost nothing (no style invalidation).
    if (glow === 0 && (lastGlow.get(el) ?? 0) === 0) continue;
    lastGlow.set(el, glow);

    // Light position, clamped to the rim so the bright spot sits on the edge
    // nearest the cursor (even when the cursor is outside the element).
    const cx = Math.max(0, Math.min(1, (pointerX - r.left) / r.width));
    const cy = Math.max(0, Math.min(1, (pointerY - r.top) / r.height));

    el.style.setProperty('--lg-pointer-x', cx.toFixed(4));
    el.style.setProperty('--lg-pointer-y', cy.toFixed(4));
    el.style.setProperty('--lg-glow', glow.toFixed(4));
  }
}

function onPointerMove(e: PointerEvent): void {
  pointerX = e.clientX;
  pointerY = e.clientY;
  schedule();
}

function onPointerGone(): void {
  // Cursor left the window — fade every element out.
  pointerX = -1e6;
  pointerY = -1e6;
  schedule();
}

export function registerPointerLight(el: HTMLElement): void {
  if (typeof window === 'undefined') return;
  elements.add(el);
  const io = ensureObserver();
  if (io) io.observe(el);
  else visible.add(el); // no IntersectionObserver — treat all as visible
  if (!listening) {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('blur', onPointerGone);
    document.addEventListener('pointerleave', onPointerGone);
    listening = true;
  }
  schedule();
}

export function unregisterPointerLight(el: HTMLElement): void {
  elements.delete(el);
  visible.delete(el);
  observer?.unobserve(el);
  el.style.removeProperty('--lg-glow');
  el.style.removeProperty('--lg-pointer-x');
  el.style.removeProperty('--lg-pointer-y');
}
