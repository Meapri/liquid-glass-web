import { LiquidGlass, autoEnhance, LiquidMenu, LiquidSheet, LiquidSelection } from '../src';
import type { LiquidGlassOptions, LiquidGlassVariant } from '../src';

// Paint the page scene onto the #lg-scene <canvas>. It's both the visible
// background AND the refraction source: a canvas uploads directly to a WebGL
// texture (taint-free), so the cross-browser GPU path can sample it. Colour
// blobs + diagonal bands give the lensing high-frequency structure to bend.
const sceneCanvas = document.getElementById('lg-scene') as HTMLCanvasElement | null;
function paintScene(): void {
  if (!sceneCanvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  sceneCanvas.width = Math.round(w * dpr);
  sceneCanvas.height = Math.round(h * dpr);
  const ctx = sceneCanvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#1a1030';
  ctx.fillRect(0, 0, w, h);
  const blob = (x: number, y: number, r: number, color: string): void => {
    const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * Math.max(w, h));
    g.addColorStop(0, color);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  blob(0.12, 0.18, 0.42, '#ff5b8b');
  blob(0.86, 0.12, 0.46, '#ffb648');
  blob(0.78, 0.52, 0.44, '#4f7bff');
  blob(0.18, 0.78, 0.42, '#25d36a');
  blob(0.5, 0.92, 0.5, '#a55bff');
  blob(0.6, 0.35, 0.46, '#ff7355');
  // Diagonal high-frequency bands (survive the frost so the lens fold shows).
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((135 * Math.PI) / 180);
  const span = Math.hypot(w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  for (let x = -span; x < span; x += 140) ctx.fillRect(x, -span, 70, span * 2);
  ctx.rotate((-90 * Math.PI) / 180);
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (let x = -span; x < span; x += 180) ctx.fillRect(x, -span, 100, span * 2);
  ctx.restore();
}
paintScene();
let scenePaintTimer = 0;
window.addEventListener('resize', () => {
  window.clearTimeout(scenePaintTimer);
  scenePaintTimer = window.setTimeout(paintScene, 150);
});

// One call wires up every [data-liquid-glass] element (and binds the pointer
// tilt / press behaviour to every .lg-interactive). `registry.instances` is the
// element→LiquidGlass map the morph helpers below reach into.
//
// `backdropSource: '#lg-scene'` routes every box through the shared WebGL
// refractor — ONE full-viewport canvas, one render pass per frame — so the
// lensing is IDENTICAL on Chrome, Safari and Firefox (same shader + scene), and
// scrolling only updates uniforms (smooth, no per-box DOM work). The adaptive
// pills (over their own swatches) override it to null.
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
