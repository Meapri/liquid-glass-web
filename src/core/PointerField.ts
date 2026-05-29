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
let rafId = 0;
let pointerX = -1e6;
let pointerY = -1e6;
let listening = false;

/** Distance (px) beyond an element's box at which the light fades to zero. */
const FALLOFF = 220;

function schedule(): void {
  if (rafId) return;
  rafId = requestAnimationFrame(flush);
}

function flush(): void {
  rafId = 0;
  for (const el of elements) {
    if (!el.isConnected) {
      elements.delete(el);
      continue;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    // Pointer position in element space (may fall outside [0,1]).
    const nx = (pointerX - r.left) / r.width;
    const ny = (pointerY - r.top) / r.height;

    // Shortest distance from the pointer to the element box (0 when inside).
    const dx = Math.max(r.left - pointerX, 0, pointerX - r.right);
    const dy = Math.max(r.top - pointerY, 0, pointerY - r.bottom);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const glow = Math.max(0, Math.min(1, 1 - dist / FALLOFF));

    // Clamp the light position to the rim so the bright spot sits on the edge
    // nearest the cursor (even when the cursor is outside the element).
    const cx = Math.max(0, Math.min(1, nx));
    const cy = Math.max(0, Math.min(1, ny));

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
  el.style.removeProperty('--lg-glow');
  el.style.removeProperty('--lg-pointer-x');
  el.style.removeProperty('--lg-pointer-y');
}
