# liquid-glass-web

Apple-style **Liquid Glass** for the web. Real optical refraction via SVG
`feDisplacementMap`, baked specular rim, Chromium-native `backdrop-filter`.

Zero WebGL contexts, zero `requestAnimationFrame` loops per instance — everything
is composited by the browser GPU pipeline.

## Approach

- **Edge-concentrated lensing** (Snell's law), the way Apple describes Liquid
  Glass — it *"dynamically bends, shapes, and concentrates light in real time"*
  with *"responsive lensing along its edges"* (Meet Liquid Glass, WWDC25). The
  rim is a **convex roundover** — a quarter-ellipse `h = B·√(1 − (1 − t)²)` over a
  band of width `thickness`, near-vertical at the very edge and flat on the
  interior plateau. We take that surface normal and refract a straight-down
  viewing ray through the air→glass interface (n = 1.5) with the GLSL `refract()`
  formula; the lateral shift is the displacement. The surface is **one smooth
  lens**, not a rim band: the displacement increases *monotonically* from zero at
  the exact centre to its maximum at the edge (a C∞ `(1−u²)(1−v²)` field shaped
  by an exponent so the middle stays nearly flat — "letting content shine through
  underneath it" — and the bend ramps up only near the rim). Because it is
  monotonic there is **no inner ring**: nowhere does the bend stop, so no rounded
  rectangle is ever drawn inside the glass. Smooth everywhere ⇒ no diagonal "X"
  crease on any shape. The map is padded so the rim can sample backdrop beyond
  the box ("samples content from an area larger than itself"); the backdrop is
  blurred *before* it's bent so refraction over text stays clean.
- **Padded displacement canvas** (`±refraction` px on each side) so the rim
  can sample real backdrop beyond the element box without clipping.
- **Three-pass chromatic aberration** — R / G / B channels run through
  feDisplacementMap at slightly different scales (blue refracts more than red,
  matching glass physics).
- **Geometry-driven specular rim** PNG — Apple's *"highlights that respond to
  geometry … causing light to travel around the material, defining its
  silhouette."* Computed from the exact rounded-rect edge (SDF) in a thin rim
  band: a bright primary arc where the edge faces the key light (top), a thin
  continuous highlight tracing the whole silhouette, and a soft secondary catch
  on the opposite edge. Screen-blended inside the filter — no per-frame JS. It
  hugs the crisp edge so the glass reads as a defined shape, while the refraction
  lens stays a smooth bend — the clear interior emits no light.
- **Flat edge treatment** — a single faint scheme-aware hairline (`inset 0 0 0
  0.5px`) so the edge still reads over flat backdrops. No drop shadow and no
  inner top-lip glow — those make the glass look like a raised, embossed button;
  Liquid Glass sits flush *on* the content. The dimensional edge is carried
  optically by the lensing + the crisp specular line, not by a drawn bevel.
- **Pointer-tracked edge light (core, all glass)** — Apple's environment light
  "travels around the material, defining its silhouette" and reacts as you
  approach. A single shared `PointerField` (one rAF-coalesced `pointermove`)
  feeds every glass element `--lg-pointer-x/y` plus a proximity `--lg-glow`;
  `.liquid-glass::after` paints a crisp bright segment of the rim that follows
  the cursor and **fades in by distance** (it lights up from ~220px away, not
  only on direct hover), masked to a 1.5px border so only the edge lights up.
  `.lg-interactive` adds 3D parallax tilt + a "jelly squish" press on top.
- **Tasteful depth** — a soft, diffuse cool float shadow and a gentle inner top
  sheen give the glass volume (a lozenge floating above content), without the
  hard embossed look of a raised button.
- **Shared `MapCache`** keyed by `(w, h, radius, thickness, dpr)` — same-sized
  elements reuse the same data URLs.

## Quick start

```bash
npm install
npm run dev   # demo at http://localhost:5173
```

```ts
import { LiquidGlass, LiquidInteractive } from './src';

// Initialize core refraction engine (Apple-standard defaults shown)
new LiquidGlass(document.querySelector('.tab-bar')!, {
  radius: 'pill',
  thickness: 30,    // lens depth
  refraction: 44,   // edge lensing strength
  variant: 'regular',
});

// Auto-bind the pointer-tracked edge light (+ parallax tilt, jelly press)
LiquidInteractive.initAll();
```

## Options

| option | default | meaning |
| --- | --- | --- |
| `radius` | `'auto'` | px, `'pill'`, or `'auto'` (reads computed border-radius) |
| `thickness` | `30` | lens depth (glass "thickness") in px — deeper ⇒ more pronounced edge lensing (Apple: thicker material lenses more). Scales the dome depth. |
| `refraction` | `44` | max edge displacement in px — overall lensing strength (auto-capped to ½ the short side so small controls stay coherent) |
| `chromaticAberration` | `0.03` | 0–1; subtle RGB fringing at the rim (kept low so the body stays clean) |
| `blur` | per-variant | backdrop frost stdDeviation, applied before refraction; default by variant (`regular` 10, `clear` 3, `tinted` 14) |
| `saturation` | `150` | % saturation applied after displacement (Apple keeps the backdrop close to neutral, not over-vivid) |
| `variant` | `'regular'` | `'regular'` (frosted, legible) \| `'clear'` (most transparent, for bold content) \| `'tinted'` — sets tint and the default frost |
| `scheme` | `'auto'` | `'light'` \| `'dark'` \| `'auto'` |
| `tint` | — | explicit CSS color, overrides variant |
| `specular` | `true` | bake the geometry-driven edge light |
| `specularIntensity` | `0.5` | 0–1 |
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

The optical model here is taken **only from Apple's official material** — the
lensing, geometry-driven highlights, edge behaviour and Regular/Clear variants
are reproduced from these sources:

- [Meet Liquid Glass — WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/)
  — the canonical description of lensing, environment lighting, silhouette
  highlights, adaptive shadow and the Regular/Clear variants
- [Liquid Glass — Technology Overviews](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)
- [Adopting Liquid Glass — Technology Overviews](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)
- [Materials — Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/materials)

## License

MIT
