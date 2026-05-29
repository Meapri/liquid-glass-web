/**
 * LiquidMenu — Apple's signature "menu summoned from a control" morph.
 *
 * "When glass flexes and morphs to larger sizes – like when presenting a menu
 * from a toolbar button – its material characteristics change to simulate a
 * thicker, more substantial material. It casts deeper, richer shadows, has more
 * pronounced lensing and refraction effects" (Meet Liquid Glass, WWDC25).
 *
 * The menu grows OUT of the trigger with a gel-like spring: we set the menu's
 * transform-origin to the trigger's position and scale it up from a small seed.
 * Because the whole glass (its baked lensing + box-shadow) scales with the
 * transform, the material reads as thicker — deeper shadow and more pronounced
 * lensing — exactly as it reaches full size, then settles. Dismiss collapses it
 * back into the trigger.
 *
 * The menu element should be a `.liquid-glass` (give it its own `LiquidGlass`
 * instance). It is positioned with `position: fixed` and anchored to the trigger.
 */

export type LiquidMenuPlacement =
  | 'bottom-start'
  | 'bottom-end'
  | 'bottom'
  | 'top-start'
  | 'top-end'
  | 'top';

export interface LiquidMenuOptions {
  /** Where the menu sits relative to the trigger. Default 'bottom-start'. */
  placement?: LiquidMenuPlacement;
  /** Gap between trigger and menu, in px. Default 10. */
  offset?: number;
  /** Close on outside click / Escape. Default true. */
  dismissOnOutside?: boolean;
}

const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const OUT_EASE = 'cubic-bezier(0.4, 0, 1, 1)';

export class LiquidMenu {
  readonly trigger: HTMLElement;
  readonly menu: HTMLElement;
  private placement: LiquidMenuPlacement;
  private offset: number;
  private dismiss: boolean;
  private open_ = false;
  private anim: Animation | null = null;
  private reduceMotion: boolean;

  constructor(trigger: HTMLElement, menu: HTMLElement, options: LiquidMenuOptions = {}) {
    this.trigger = trigger;
    this.menu = menu;
    this.placement = options.placement ?? 'bottom-start';
    this.offset = options.offset ?? 10;
    this.dismiss = options.dismissOnOutside ?? true;
    this.reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    menu.style.position = 'fixed';
    menu.style.visibility = 'hidden';
    menu.style.pointerEvents = 'none';
    menu.dataset.lgMenu = 'closed';

    trigger.addEventListener('click', this.onTriggerClick);
    if (this.dismiss) {
      document.addEventListener('pointerdown', this.onDocPointerDown, true);
      document.addEventListener('keydown', this.onKeyDown);
    }
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    if (this.open_) return;
    this.open_ = true;
    this.menu.dataset.lgMenu = 'open';
    this.menu.style.visibility = 'visible';
    this.menu.style.pointerEvents = 'auto';
    this.position();
    this.morph(true);
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.menu.dataset.lgMenu = 'closed';
    this.morph(false);
  }

  toggle(): void {
    if (this.open_) this.close();
    else this.open();
  }

  destroy(): void {
    this.trigger.removeEventListener('click', this.onTriggerClick);
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
    document.removeEventListener('keydown', this.onKeyDown);
    this.anim?.cancel();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private onTriggerClick = (e: MouseEvent): void => {
    e.stopPropagation();
    this.toggle();
  };

  private onDocPointerDown = (e: Event): void => {
    if (!this.open_) return;
    const t = e.target as Node;
    if (this.menu.contains(t) || this.trigger.contains(t)) return;
    this.close();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  /** Anchor the (fixed-positioned) menu to the trigger per placement. */
  private position(): void {
    const t = this.trigger.getBoundingClientRect();
    const m = this.menu.getBoundingClientRect();
    const g = this.offset;
    const below = this.placement.startsWith('bottom');

    let left: number;
    if (this.placement.endsWith('end')) left = t.right - m.width;
    else if (this.placement.endsWith('start')) left = t.left;
    else left = t.left + t.width / 2 - m.width / 2; // centred

    const top = below ? t.bottom + g : t.top - m.height - g;

    // Keep within the viewport with an 8px margin.
    const maxLeft = window.innerWidth - m.width - 8;
    this.menu.style.left = `${Math.max(8, Math.min(left, maxLeft))}px`;
    this.menu.style.top = `${Math.max(8, top)}px`;
  }

  /** Grow out of (open) / collapse into (close) the trigger. */
  private morph(opening: boolean): void {
    const t = this.trigger.getBoundingClientRect();
    const m = this.menu.getBoundingClientRect();

    // Origin = the trigger's centre, in the menu's local coordinates, so the
    // menu scales toward/away from the control it came from.
    const ox = Math.max(0, Math.min(m.width, t.left + t.width / 2 - m.left));
    const oy = Math.max(0, Math.min(m.height, t.top + t.height / 2 - m.top));
    this.menu.style.transformOrigin = `${ox}px ${oy}px`;

    this.anim?.cancel();

    if (this.reduceMotion) {
      // No elastic morph — just show/hide.
      this.menu.style.transform = '';
      if (!opening) this.hideAfterClose();
      return;
    }

    const seed = { transform: 'scale(0.16)', opacity: 0 };
    const full = { transform: 'scale(1)', opacity: 1 };
    this.anim = this.menu.animate(opening ? [seed, full] : [full, seed], {
      duration: opening ? 460 : 240,
      easing: opening ? SPRING : OUT_EASE,
      fill: 'forwards',
    });
    if (!opening) this.anim.onfinish = () => this.hideAfterClose();
  }

  private hideAfterClose(): void {
    if (this.open_) return; // re-opened mid-animation
    this.menu.style.visibility = 'hidden';
    this.menu.style.pointerEvents = 'none';
    this.menu.style.transform = '';
  }
}
