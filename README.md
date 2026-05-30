# liquid-glass-web

Apple-style **Liquid Glass** for the web. Real optical refraction via SVG
`feDisplacementMap`, baked specular rim, Chromium-native `backdrop-filter`.

Zero WebGL contexts, zero `requestAnimationFrame` loops per instance — everything
is composited by the browser GPU pipeline.

## Approach

- **Context-adaptive lensing** (Snell's law), the way Apple describes Liquid
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
- **Liquid Glass-style optical profiles** — the best result is not one global
  blur/refraction value. This library ships semantic profiles tuned for a vivid
  web Liquid Glass look: `bar` keeps navigation and toolbars dissolved but
  readable, `control` gives buttons and sliders stronger lensing,
  `selection` lifts active tab/segmented capsules, and `panel`/`card` prioritize
  legibility on larger surfaces. `profile: 'auto'` infers from semantic tags,
  ARIA roles, size, and aspect ratio.
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
- **Context-aware edge treatment** — bars use a soft dissolved hairline, while
  compact controls and selections keep more visible glass border artwork and
  gloss. The profiles are tuned so the material reads as glass without making
  every surface look like the same button.
- **Pointer-tracked edge light (core, all glass)** — Apple's environment light
  "travels around the material, defining its silhouette" and reacts as you
  approach. A single shared `PointerField` (one rAF-coalesced `pointermove`)
  feeds every glass element `--lg-pointer-x/y` plus a proximity `--lg-glow`;
  `.liquid-glass::after` paints a crisp bright segment of the rim that follows
  the cursor and **fades in by distance** (it lights up from ~220px away, not
  only on direct hover), masked to a 1.5px border so only the edge lights up.
- **Motion, designed as one with the look** — Apple's official motion:
  **interaction illumination** — on press the glow blooms from under the finger,
  *"spreads throughout the element and onto any Liquid Glass elements nearby"*
  (the core `PointerField` broadcasts the press, so neighbouring glass lights up
  too); a **gel-like flex** squish, 3D parallax tilt and lift-on-touch
  (`.lg-interactive`); and **materialize in/out** (`.lg-materialize` /
  `.lg-dematerialize`) that springs the scale/lensing rather than fading. Honors
  `prefers-reduced-motion` (drops the elastic motion, keeps the light).
- **Morph transitions** — `LiquidMenu` summons a menu that flexes and **flows out
  of its trigger** (thicker glass as it grows — deeper shadow + more lensing),
  and `LiquidSheet` **materializes a sheet up from the bottom** over a dimming
  scrim. Both collapse back on dismiss and honor reduced motion. *"Presenting a
  menu from a toolbar button … as glass morphs to larger sizes it casts deeper,
  richer shadows, has more pronounced lensing and refraction."*
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

// Initialize the core refraction engine. Defaults are profile-aware.
new LiquidGlass(document.querySelector('.tab-bar')!, {
  radius: 'pill',
  profile: 'bar',   // dissolved navigation material
  thickness: 44,    // reference lens depth; profile scales it
  refraction: 46,   // reference lensing; profile scales and caps it
  variant: 'regular',
});

// Auto-bind the pointer-tracked edge light (+ parallax tilt, jelly press)
LiquidInteractive.initAll();
```

## Options

| option | default | meaning |
| --- | --- | --- |
| `radius` | `'auto'` | px, `'pill'`, or `'auto'` (reads computed border-radius) |
| `thickness` | `44` | reference lens depth in px; the selected profile scales it. Deeper ⇒ more pronounced lensing when appropriate. |
| `refraction` | `46` | reference displacement in px; the selected profile scales it and caps it to the element size. |
| `chromaticAberration` | `0.03` | 0–1; subtle RGB fringing at the rim (kept low so the body stays clean) |
| `blur` | per-variant | reference backdrop frost stdDeviation, applied before refraction; default by variant (`regular` 7, `clear` 3, legacy `tinted` 14). Profiles and size scale this down for bars and compact controls. |
| `saturation` | `150` | % saturation applied after displacement (Apple keeps the backdrop close to neutral, not over-vivid) |
| `variant` | `'regular'` | `'regular'` \| `'clear'`; legacy `'tinted'` remains for compatibility. Apple guidance maps prominence through `tint`, not an extra variant. |
| `profile` | `'auto'` | semantic optical context: `'auto'`, `'bar'`, `'control'`, `'card'`, `'panel'`, or `'selection'`. `auto` uses element semantics and geometry. |
| `preset` | `'auto'` | material intensity: `'auto'`, `'subtle'`, `'balanced'`, `'vivid'`, or `'dramatic'`. `auto` chooses `vivid` for controls/selections and `balanced` elsewhere. |
| `scheme` | `'auto'` | `'light'` \| `'dark'` \| `'auto'` (follows the OS) \| `'adaptive'` (follows the content behind it — light glass with dark labels over light backdrops, dark glass with light labels over dark ones, re-sampled on scroll; falls back to OS when the backdrop can't be read) |
| `tint` | — | explicit CSS color for prominence; preferred over `variant:'tinted'` |
| `specular` | `true` | bake the geometry-driven edge light |
| `specularIntensity` | `0.5` | 0–1 |
| `edges` | `true` | inline glass edge treatment (scheme-aware): bright rim hairline, inner top glow, bottom lip, soft float shadow. `false` to style `box-shadow` yourself |
| `mapPixelRatio` | `2` | DPR cap for the generated maps |
| `quality` | `'auto'` | `'high'` \| `'balanced'` \| `'low'` \| `'auto'` — gates the expensive bits (see below) |
| `lazy` | `false` | defer building the filter until the element scrolls into view (IntersectionObserver) |
| `lazyMargin` | `'200px'` | root-margin for the lazy observer |
| `root` | auto | tree scope for the shared `<svg defs>`; auto-detected from `getRootNode()` so it works inside a Shadow DOM |
| `fallbackFilter` | profile-aware | CSS `backdrop-filter` used on non-Chromium / `quality:'low'` / reduced-transparency. Leave unset to derive blur/saturation from the resolved profile; pass a string to override. |
| `respectReducedMotion` | `true` | fall back to the cheap filter when `prefers-reduced-transparency` is set |

`update(partial)` patches options live — `blur`, `saturation`, `tint`, `scheme`,
`variant`, and refraction scale are applied as live filter/CSS attributes when
possible. Map-changing options (`radius`, `thickness`, `profile`, `preset`,
specular intensity, or refraction padding) regenerate the cached maps.
`suspend()` /
`resume()` cheaply detach / re-attach the GPU filter for show/hide.

`glass.resolved` exposes the final engine contract for debugging and design
system tooling:

```ts
const glass = new LiquidGlass(el); // profile:'auto', preset:'auto'
console.log(glass.resolved);
// {
//   profile: 'bar',
//   preset: 'balanced',
//   blur: 4.13,
//   refraction: 20.24,
//   thickness: 16.72,
//   ...
// }
```

### Optical profiles

These profiles are the library's tuned web material presets. They keep Liquid
Glass expressive without forcing the same blur/refraction amount onto every
component.

| profile | intended use | behavior |
| --- | --- | --- |
| `bar` | headers, nav bars, toolbars, notification bars | stronger blur/dissolve, restrained lensing, soft rim |
| `control` | independent buttons, switches, sliders, media controls | strongest lensing and gloss; use with bold glyphs/labels |
| `selection` | selected tab capsules, segmented selections | pronounced floating capsule with medium-high lensing |
| `card` | compact cards in the floating functional layer | vivid refraction, balanced frost, readable text |
| `panel` | sheets, menus, sidebars, popovers | more frost and softer lensing for larger readable surfaces |
| `auto` | default | infers from tag/role first (`button`, `nav`, `toolbar`, `dialog`, `tablist`, etc.), then from size/aspect ratio |

Avoid applying glass to content-layer elements like ordinary article/list cells.
For controls inside an existing glass surface, use a tint/fill overlay instead
of a second `LiquidGlass` instance.
`destroy()` cleans up the filter and styles.

### Material presets

`profile` decides what the element is; `preset` decides how strongly the glass
reads. Most apps should leave both on `auto`.

| preset | behavior |
| --- | --- |
| `subtle` | reduced blur, rim, and lensing for dense/productivity UI |
| `balanced` | default material strength |
| `vivid` | more convex lensing, gloss, and blur for controls and playful UI |
| `dramatic` | strongest look for hero/media surfaces |
| `auto` | resolves by profile: controls/selections use `vivid`, larger/static surfaces use `balanced` |

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

## Testing and fixtures

```bash
npm test                 # typecheck + auto profile resolver tests
npm run test:auto-profile
```

Minimal visual fixtures live in `fixtures/`:

- `fixtures/bar.html`
- `fixtures/control.html`
- `fixtures/card.html`
- `fixtures/panel.html`
- `fixtures/selection.html`

They are intentionally smaller than the demo and are meant for visual regression
screenshots or quick manual inspection of each material profile.

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

Chromium only for real SVG displacement inside `backdrop-filter`. Safari,
Firefox, `quality: 'low'`, and `prefers-reduced-transparency` fall back to a
profile-aware CSS `backdrop-filter` derived from the resolved blur/saturation.

## References

The optical model is informed by Apple's public Liquid Glass material, then
tuned for a practical web engine:

- [Meet Liquid Glass — WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/)
  — the canonical description of lensing, environment lighting, silhouette
  highlights, adaptive shadow and the Regular/Clear variants
- [Liquid Glass — Technology Overviews](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)
- [Adopting Liquid Glass — Technology Overviews](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)
- [Materials — Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/materials)

## License

MIT
