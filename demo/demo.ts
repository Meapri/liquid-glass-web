import { LiquidGlass, autoEnhance, LiquidMenu, LiquidSheet, LiquidSelection } from '../src';
import type { LiquidGlassOptions, LiquidGlassVariant } from '../src';

// One call wires up every [data-liquid-glass] element (and binds the pointer
// tilt / press behaviour to every .lg-interactive). `registry.instances` is the
// element→LiquidGlass map the morph helpers below reach into.
//
// `backdropSource: '#lg-scene'` points every box at the plain gradient scene
// element, so refraction works cross-browser: on Chromium this is a no-op (its
// native backdrop-filter already refracts the real backdrop), while on
// Safari/Firefox each box refracts a clone / -moz-element of that scene. The
// scene is filter-free so it renders reliably when cloned. Per-element configs
// (the adaptive pills, the cross-browser/Safari demo pills) override it.
const registry = autoEnhance({ defaults: { backdropSource: '#lg-scene' } });
const instances = registry.instances;

// === Live playground ===
const target = document.getElementById('lg-play') as HTMLDivElement | null;
if (target) {
  const playGlass = new LiquidGlass(target, {
    radius: 36,
    thickness: 44,
    refraction: 46,
    blur: 10,
    saturation: 150,
    specularIntensity: 0.5,
    variant: 'regular',
  });
  instances.set(target, playGlass);

  const wire = (
    id: string,
    valueId: string,
    fmt: (n: number) => string,
    apply: (n: number) => Partial<LiquidGlassOptions>
  ) => {
    const input = document.getElementById(id) as HTMLInputElement;
    const value = document.getElementById(valueId) as HTMLSpanElement;
    if (!input || !value) return;
    const update = (): void => {
      const n = parseFloat(input.value);
      value.textContent = fmt(n);
      playGlass.update(apply(n));
    };
    input.addEventListener('input', update);
  };

  wire('i-radius', 'v-radius', (n) => String(n), (n) => ({ radius: n }));
  wire('i-thickness', 'v-thickness', (n) => String(n), (n) => ({ thickness: n }));
  wire('i-refraction', 'v-refraction', (n) => String(n), (n) => ({ refraction: n }));
  wire('i-blur', 'v-blur', (n) => String(n), (n) => ({ blur: n }));
  wire('i-sat', 'v-sat', (n) => String(n), (n) => ({ saturation: n }));
  wire('i-ab', 'v-ab', (n) => n.toFixed(2), (n) => ({ chromaticAberration: n }));
  wire('i-spec', 'v-spec', (n) => n.toFixed(2), (n) => ({ specularIntensity: n }));

  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('.variant-row button'))) {
    btn.addEventListener('click', () => {
      for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('.variant-row button'))) {
        b.classList.toggle('active', b === btn);
      }
      playGlass.update({ variant: (btn.dataset.variant ?? 'regular') as LiquidGlassVariant });
    });
  }
}

// === Animations showcase ===
// Menu summon morph — the menu flows out of the trigger and reads thicker as it
// grows (deeper shadow + more lensing scale with it).
const menuTrigger = document.getElementById('anim-menu-trigger');
const menuEl = document.getElementById('anim-menu');
if (menuTrigger && menuEl) {
  const menu = new LiquidMenu(menuTrigger, menuEl, {
    placement: 'bottom-start',
    offset: 10,
    glass: instances.get(menuEl),
  });
  for (const item of Array.from(menuEl.querySelectorAll<HTMLButtonElement>('.anim-menu-item'))) {
    item.addEventListener('click', () => menu.close());
  }
}

// Materialize in / out — restart the CSS animation by removing then re-adding.
const chip = document.getElementById('anim-chip');
const replay = (el: HTMLElement, cls: string): void => {
  el.classList.remove('lg-materialize', 'lg-dematerialize');
  void el.offsetWidth; // force reflow so the animation restarts
  el.classList.add(cls);
};
document.getElementById('anim-mat-in')?.addEventListener('click', () => chip && replay(chip, 'lg-materialize'));
document.getElementById('anim-mat-out')?.addEventListener('click', () => chip && replay(chip, 'lg-dematerialize'));

// Sheet — materializes up from the bottom over a dimming scrim.
const sheetEl = document.getElementById('anim-sheet');
if (sheetEl) {
  const sheet = new LiquidSheet(sheetEl, { bottomGap: 28 });
  document.getElementById('anim-sheet-trigger')?.addEventListener('click', () => sheet.present());
  document.getElementById('anim-sheet-close')?.addEventListener('click', () => sheet.dismiss());
}

// Context menu (iOS long-press style) — same morph engine, grouped icon rows.
const ctxTrigger = document.getElementById('anim-ctx-trigger');
const ctxEl = document.getElementById('anim-ctx');
if (ctxTrigger && ctxEl) {
  const ctx = new LiquidMenu(ctxTrigger, ctxEl, {
    placement: 'bottom-start',
    offset: 10,
    glass: instances.get(ctxEl),
  });
  for (const item of Array.from(ctxEl.querySelectorAll<HTMLButtonElement>('.ctx-item'))) {
    item.addEventListener('click', () => ctx.close());
  }
}

// Adaptive — smooth auto transition. The stage backdrop crossfades dark↔light
// on a timer; the glass re-samples across the fade (syncToBackdrop) so its
// appearance glides to match — light glass + dark label over light content,
// dark glass + light label over dark content.
const adaptStage = document.getElementById('adapt-stage');
const adaptPill = document.getElementById('adapt-auto');
if (adaptStage && adaptPill) {
  const adaptGlass = instances.get(adaptPill);
  const resample = (): void => adaptGlass?.syncToBackdrop();
  let light = false;
  const toggle = (): void => {
    light = !light;
    adaptStage.classList.toggle('is-light', light);
    // Sample several times across the backdrop's own fade so the glass tracks
    // the brightness crossing rather than snapping at the end.
    for (const t of [140, 300, 460, 620, 780]) window.setTimeout(resample, t);
  };
  window.setInterval(toggle, 2800);
}

// Tab bar — a tinted glass selection capsule glides to the active tab.
const tabbar = document.getElementById('lg-tabbar');
if (tabbar) {
  new LiquidSelection(tabbar, {
    items: '.tab',
    initial: 0,
    tint: 'rgba(255, 255, 255, 0.16)',
  });
}

// Expose for ad-hoc debugging from devtools
declare global {
  interface Window {
    __liquidGlass: {
      instances: Map<HTMLElement, LiquidGlass>;
      LiquidGlass: typeof LiquidGlass;
    };
  }
}
window.__liquidGlass = { instances, LiquidGlass };
