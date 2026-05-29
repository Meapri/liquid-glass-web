# liquid-glass-web

Apple-style **Liquid Glass** for the web. Real optical refraction via SVG
`feDisplacementMap`, baked specular rim, Chromium-native `backdrop-filter`.

Zero WebGL contexts, zero `requestAnimationFrame` loops per instance — everything
is composited by the browser GPU pipeline.

## Approach

- **Physically-based refraction** (Snell's law) displacement map, the way Apple's
  Liquid Glass works: a convex-squircle bevel surface `h = ⁴√(1 − (1 − x)⁴)` over
  a rim band of width `thickness`; the surface normal is the analytic SDF
  gradient (perpendicular to the nearest edge); a straight-down ray refracts
  through it (glass n = 1.5) and the lateral shift `sin(θ₁ − θ₂)` is the
  displacement (precomputed as a 1-D Snell lookup). The bend lives in the rim
  band — the **centre stays optically clear** — so the gradient's medial seam
  sits in the cleared centre and never shows (no diagonal "X"). Strong refraction
  over text stays clean because the backdrop is blurred *before* it's bent.
- **Padded displacement canvas** (`±refraction` px on each side) so the rim
  can sample real backdrop beyond the element box without clipping.
- **Three-pass chromatic aberration** — R / G / B channels run through
  feDisplacementMap at slightly different scales (blue refracts more than red,
  matching glass physics).
- **Baked specular rim** PNG (lit top-left edge + a subtle bottom-right lip for
  thickness), screen-blended inside the filter — no per-frame JS.
- **Engine-owned edge treatment** — a scheme-aware `box-shadow` stack: a crisp
  defined rim around the whole perimeter (the "droplet outline" that gives the
  glass its dimensional edge), a brighter top lip, a faint bottom lip and a soft
  cool float shadow — so a bare element reads as Liquid Glass with no extra CSS.
  A clean 1px rim like Apple's Control Center, not a glossy bevel.
- **Spatial UI & iOS 26 Animations** — Bundled `.lg-interactive` classes that automatically provide physics-based 3D Parallax Tilt, Dynamic Spotlight Glare that tracks the pointer over the 1px edge, and organic "Jelly Squish" morphing on click (`scale3d(1.03, 0.92, 1)`).
- **Shared `MapCache`** keyed by `(w, h, radius, thickness, dpr)` — same-sized
  elements reuse the same data URLs.

## Quick start

```bash
npm install
npm run dev   # demo at http://localhost:5173
```

```ts
import { LiquidGlass, LiquidInteractive } from './src';

// Initialize core refraction engine
new LiquidGlass(document.querySelector('.tab-bar')!, {
  radius: 'pill',
  refraction: 18,
  chromaticAberration: 0.4,
  blur: 4,
  variant: 'regular',
});

// Auto-bind 3D Spatial Interactions (Parallax, Edge Glare, Jelly Squish)
LiquidInteractive.initAll();
```

## Options

| option | default | meaning |
| --- | --- | --- |
| `radius` | `'auto'` | px, `'pill'`, or `'auto'` (reads computed border-radius) |
| `thickness` | `58` | width of the refraction **bevel band** at the rim, in px (auto-capped to 28% of the short side; also the specular rim band) |
| `refraction` | `95` | max inward displacement at the rim, in px — overall refraction strength (auto-capped to 65% of the short side so small controls stay coherent) |
| `chromaticAberration` | `0.22` | 0–1; subtle RGB fringing at the rim (kept low so the body stays clean) |
| `blur` | per-variant | backdrop frost stdDeviation, applied before refraction; default by variant (`regular` 4, `clear` 2, `tinted` 6) |
| `saturation` | `145` | % saturation applied after displacement (Apple keeps the backdrop close to neutral, not over-vivid) |
| `variant` | `'regular'` | `'regular'` (frosted, legible) \| `'clear'` (most transparent, for bold content) \| `'tinted'` — sets tint and the default frost |
| `scheme` | `'auto'` | `'light'` \| `'dark'` \| `'auto'` |
| `tint` | — | explicit CSS color, overrides variant |
| `specular` | `true` | bake the rim specular highlight |
| `specularIntensity` | `0.85` | 0–1 |
| `edges` | `true` | inline glass edge treatment (scheme-aware): bright rim hairline, inner top glow, bottom lip, soft float shadow. `false` to style `box-shadow` yourself |
| `mapPixelRatio` | `2` | DPR cap for the generated maps |
| `quality` | `'auto'` | `'high'` \| `'balanced'` \| `'low'` \| `'auto'` — gates the expensive bits (see below) |
| `lazy` | `false` | defer building the filter until the element scrolls into view (IntersectionObserver) |
| `lazyMargin` | `'200px'` | root-margin for the lazy observer |
| `root` | auto | tree scope for the shared `<svg defs>`; auto-detected from `getRootNode()` so it works inside a Shadow DOM |
| `fallbackFilter` | `'blur(12px) saturate(1.6)'` | CSS `backdrop-filter` used on non-Chromium / `quality:'low'` / reduced-transparency |
| `respectReducedMotion` | `true` | fall back to the cheap filter when `prefers-reduced-transparency` is set |

`update(partial)` patches options live — `blur`, `saturation`, `tint`, `scheme`
and `variant` are applied as live filter/CSS attributes and never rebuild the
maps; only `radius`, `thickness`, `specularIntensity` and a changed refraction
padding regenerate them. `suspend()` / `resume()` cheaply detach / re-attach the
GPU filter for show/hide (e.g. a tooltip), keeping the built maps.
`destroy()` cleans up the filter and styles.

### Quality tiers

| tier | displacement | chromatic | map DPR (disp / spec) |
| --- | --- | --- | --- |
| `high` | single or 3-pass | yes | up to 3 / up to 3 |
| `balanced` | single pass | off | 1 / 1 |
| `low` | none — CSS `fallbackFilter` only | — | — |
| `auto` | picks `high` or `balanced` from `hardwareConcurrency` / `deviceMemory` | | |

The displacement map is a smooth field that `feImage` bilinear-upscales, and the
specular rim wants a soft hairline anyway, so below `high` both render at 1× —
this is where most of the per-instance cost is saved with no visible change.

## Performance notes

Fresh-instance setup is blocking JS — a Canvas2D map render plus a `toDataURL`
PNG encode per map. It is the only non-trivial cost; once built, the glass is
GPU-composited and a repeat show is free. Measured on a retina (DPR 2) machine,
median per instance:

| scenario | tier | cost |
| --- | --- | --- |
| 360×460 panel, fresh | balanced | ~8 ms |
| 360×460 panel, fresh | high | ~16 ms |
| 120×44 button, fresh | balanced | ~2 ms |
| same-size repeat (MapCache hit) | any | ~0.1 ms |
| `suspend()` → `resume()` | any | ~0 ms |
| static, composited (no scroll) | any | ~0 — GPU |

The expensive map work runs once per unique size and is shared across same-size
instances via `MapCache`, so the cost above is paid only on first appearance at
a given size. For many instances, set `lazy: true` so off-screen glass builds
nothing until it scrolls in.

## Use in a Chrome extension

The engine is framework-agnostic and has no `chrome.*` dependencies, so it drops
into a content script. For a content-script UI (e.g. a translation panel) the
defaults that matter:

```ts
// inside your Shadow DOM host (root is auto-detected from getRootNode())
const glass = new LiquidGlass(panelEl, {
  quality: 'balanced',   // single pass, 1× maps — ~8 ms build for a panel
  radius: 16,
  refraction: 16,
  blur: 6,
});

// show / hide the panel without rebuilding the GPU filter:
glass.suspend();  // text deselected → drop GPU cost, keep the instance
glass.resume();   // shown again → instant
```

- **Shadow DOM** — `backdrop-filter: url(#id)` resolves the filter id against the
  element's own tree scope, so the shared `<svg defs>` is injected into the same
  Shadow root automatically. No setup needed; pass `root` only to override.
- **balanced** is the recommended tier in a content script: it drops the 3-pass
  chromatic split (one GPU pass instead of three over the host page's backdrop)
  and renders both maps at 1×, while keeping refraction, the specular rim, frost
  and tint.
- **Resizing panels** (variable translation length) regenerate the maps, debounced
  ~80 ms; at the balanced tier each rebuild is ~8 ms and same heights are cached.

## Browser support

Chromium only — SVG filters inside `backdrop-filter` are unsupported in Safari
and Firefox. Those (and `quality: 'low'`, or `prefers-reduced-transparency`)
fall back to the plain CSS `fallbackFilter` (`blur(12px) saturate(1.6)` by
default) automatically.

## References

- [rizroze/liquid-glass](https://github.com/rizroze/liquid-glass) — gradient-based
  displacement map, R/B channels
- [Liquid Glass in the Browser (kube.io)](https://kube.io/blog/liquid-glass-css-svg/)
  — Snell's law + squircle surface derivation
- [Apple Liquid Glass Design Gallery](https://developer.apple.com/design/new-design-gallery-2026/)

## License

MIT
