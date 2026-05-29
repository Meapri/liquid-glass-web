/**
 * Spatial interaction for `.lg-interactive` glass — the motion half of Liquid
 * Glass, which Apple designed together with the look: it "responds to
 * interaction by instantly flexing and energizing with light … it comes to life
 * on touch" (Meet Liquid Glass, WWDC25).
 *
 * This drives two things via CSS custom properties / classes:
 *   - 3D parallax tilt from the hover position (`--lg-tilt-x/y`).
 *   - Interaction illumination: on press it marks the press point
 *     (`--lg-press-x/y`) and adds `.lg-pressing`, so the CSS glow blooms out
 *     from under the finger. The jelly "flex" squish is pure CSS (:active).
 *
 * The pointer-tracked EDGE light and proximity glow are owned by the core
 * `PointerField`; this class only adds the per-element tilt + press feedback.
 * Honors `prefers-reduced-motion` by dropping the elastic tilt.
 */
export class LiquidInteractive {
  /**
   * Attach spatial interaction to every element matching `selector`
   * (default `.lg-interactive`). Returns the created instances.
   */
  static initAll(selector = '.lg-interactive'): LiquidInteractive[] {
    return Array.from(document.querySelectorAll<HTMLElement>(selector)).map(
      (el) => new LiquidInteractive(el)
    );
  }

  private element: HTMLElement;
  private rafId: number | null = null;
  private isHovered = false;
  private reduceMotion = false;

  // Smoothing states for fluid tilt.
  private targetX = 0.5;
  private targetY = 0.5;
  private currentX = 0.5;
  private currentY = 0.5;

  constructor(element: HTMLElement) {
    this.element = element;
    this.reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Pointer events cover both mouse and touch (so press illumination works on
    // touch devices, where there is no hover).
    element.addEventListener('pointerenter', this.onEnter);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerleave', this.onLeave);
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointerup', this.onUp);
    element.addEventListener('pointercancel', this.onUp);

    element.style.setProperty('--lg-tilt-x', '0deg');
    element.style.setProperty('--lg-tilt-y', '0deg');
  }

  // ── Press: interaction illumination ──────────────────────────────────────
  private onDown = (e: PointerEvent): void => {
    const rect = this.element.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    this.element.style.setProperty('--lg-press-x', clamp01(px).toFixed(4));
    this.element.style.setProperty('--lg-press-y', clamp01(py).toFixed(4));
    this.element.classList.add('lg-pressing');
  };

  private onUp = (): void => {
    this.element.classList.remove('lg-pressing');
  };

  // ── Hover: 3D parallax tilt ──────────────────────────────────────────────
  private onEnter = (): void => {
    this.isHovered = true;
    if (!this.reduceMotion && this.rafId === null) this.loop();
  };

  private onLeave = (): void => {
    this.isHovered = false;
    this.targetX = 0.5;
    this.targetY = 0.5;
    // A press that drags off the element still releases.
    this.element.classList.remove('lg-pressing');
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.isHovered || this.reduceMotion) return;
    const rect = this.element.getBoundingClientRect();
    this.targetX = (e.clientX - rect.left) / rect.width;
    this.targetY = (e.clientY - rect.top) / rect.height;
  };

  private loop = (): void => {
    this.currentX += (this.targetX - this.currentX) * 0.15;
    this.currentY += (this.targetY - this.currentY) * 0.15;

    const tiltX = (0.5 - this.currentY) * 20;
    const tiltY = (this.currentX - 0.5) * 20;
    this.element.style.setProperty('--lg-tilt-x', `${tiltX.toFixed(2)}deg`);
    this.element.style.setProperty('--lg-tilt-y', `${tiltY.toFixed(2)}deg`);

    if (
      !this.isHovered &&
      Math.abs(this.targetX - this.currentX) < 0.001 &&
      Math.abs(this.targetY - this.currentY) < 0.001
    ) {
      this.rafId = null;
      this.element.style.setProperty('--lg-tilt-x', '0deg');
      this.element.style.setProperty('--lg-tilt-y', '0deg');
      return;
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  destroy(): void {
    this.element.removeEventListener('pointerenter', this.onEnter);
    this.element.removeEventListener('pointermove', this.onMove);
    this.element.removeEventListener('pointerleave', this.onLeave);
    this.element.removeEventListener('pointerdown', this.onDown);
    this.element.removeEventListener('pointerup', this.onUp);
    this.element.removeEventListener('pointercancel', this.onUp);
    this.element.classList.remove('lg-pressing');
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  }
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
