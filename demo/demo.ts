import { LiquidGlass, LiquidInteractive } from '../src';
import type { LiquidGlassOptions, LiquidGlassVariant } from '../src';

interface GlassConfig extends LiquidGlassOptions {}

// Auto-apply LiquidGlass to every element with [data-glass]
const instances = new Map<HTMLElement, LiquidGlass>();
for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-glass]'))) {
  const raw = el.dataset.glass ?? '{}';
  let config: GlassConfig = {};
  try {
    config = JSON.parse(raw) as GlassConfig;
  } catch (e) {
    console.warn('Bad data-glass JSON on', el, e);
  }
  // The .liquid-glass class sets a default radius so 'auto' picks it up; we let
  // explicit radius win.
  instances.set(el, new LiquidGlass(el, config));
}

// Auto-apply LiquidInteractive to every element with .lg-interactive
for (const el of Array.from(document.querySelectorAll<HTMLElement>('.lg-interactive'))) {
  new LiquidInteractive(el);
}

// === Live playground ===
const target = document.getElementById('lg-play') as HTMLDivElement | null;
if (target) {
  const playGlass = new LiquidGlass(target, {
    radius: 36,
    thickness: 26,
    refraction: 44,
    blur: 3,
    saturation: 180,
    specularIntensity: 0.7,
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

// Tab bar active toggle (purely visual)
for (const tab of Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'))) {
  tab.addEventListener('click', () => {
    for (const t of Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'))) {
      t.classList.toggle('active', t === tab);
    }
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
