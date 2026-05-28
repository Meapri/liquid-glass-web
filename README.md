# liquid-glass-web

Apple-style **Liquid Glass** for the web. Real optical refraction via SVG
`feDisplacementMap`, baked specular rim, Chromium-native `backdrop-filter`.

Zero WebGL contexts, zero `requestAnimationFrame` loops per instance — everything
is composited by the browser GPU pipeline.

## Approach

- **Convex-squircle lens** displacement map (canvas-generated), profile
  `r³ / (1 − r⁴)^0.75` — flat in the centre and spikes at the rim, the same
  shape a physical convex lens has and what Apple's macOS / iOS 26 Liquid Glass
  shows.
- **Padded displacement canvas** (`±refraction` px on each side) so the rim
  can sample real backdrop beyond the element box without clipping.
- **Three-pass chromatic aberration** — R / G / B channels run through
  feDisplacementMap at slightly different scales (blue refracts more than red,
  matching glass physics).
- **Baked top-left specular rim** PNG, screen-blended inside the filter — no
  per-frame JS.
- **Shared `MapCache`** keyed by `(w, h, radius, thickness, dpr)` — same-sized
  elements reuse the same data URLs.

## Quick start

```bash
npm install
npm run dev   # demo at http://localhost:5173
```

```ts
import { LiquidGlass } from './src';

new LiquidGlass(document.querySelector('.tab-bar')!, {
  radius: 'pill',
  refraction: 18,
  chromaticAberration: 0.4,
  blur: 4,
  variant: 'regular',
});
```

## Options

| option | default | meaning |
| --- | --- | --- |
| `radius` | `'auto'` | px, `'pill'`, or `'auto'` (reads computed border-radius) |
| `thickness` | `18` | specular rim band width in px |
| `refraction` | `18` | max inward displacement at the boundary, in px |
| `chromaticAberration` | `0.4` | 0–1; at 0.4 the rim shows visible RGB fringes |
| `blur` | `4` | backdrop frost blur stdDeviation |
| `saturation` | `160` | % saturation boost applied after displacement |
| `variant` | `'regular'` | `'regular'` \| `'clear'` \| `'tinted'` |
| `scheme` | `'auto'` | `'light'` \| `'dark'` \| `'auto'` |
| `tint` | — | explicit CSS color, overrides variant |
| `specular` | `true` | bake the rim specular highlight |
| `specularIntensity` | `0.85` | 0–1 |
| `mapPixelRatio` | `2` | DPR cap for the displacement map |

`update(partial)` patches options live. `destroy()` cleans up the filter and
styles.

## Performance notes

| scenario | impact |
| --- | --- |
| Static UI (no scroll, no animation) | ~0 — GPU composited |
| Scrolling with ~17 instances | ~+16 ms per frame in our preview environment |
| Fresh instance setup | ~10 ms blocking JS (Canvas2D pixel loop + toDataURL) |
| Same-size instances | share textures via `MapCache` |

For production use cases with many instances, lazy-init via
`IntersectionObserver` so off-screen glass doesn't pay GPU cost.

## Browser support

Chromium only. SVG filters inside `backdrop-filter` are unsupported in Safari
and Firefox — those fall through to no filter (consider adding a
`backdrop-filter: blur(...)` fallback class).

## References

- [rizroze/liquid-glass](https://github.com/rizroze/liquid-glass) — gradient-based
  displacement map, R/B channels
- [Liquid Glass in the Browser (kube.io)](https://kube.io/blog/liquid-glass-css-svg/)
  — Snell's law + squircle surface derivation
- [Apple Liquid Glass Design Gallery](https://developer.apple.com/design/new-design-gallery-2026/)

## License

MIT
