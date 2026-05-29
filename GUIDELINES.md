# Liquid Glass Design Guidelines

Welcome to the Liquid Glass library. This engine relies on physical optics (Snell's Law, physical surface normals) instead of basic CSS hacks to create genuine, volume-based glass. To get the most out of it, follow these design guidelines inspired by modern Spatial UI (like Apple's visionOS).

## 1. Spatial Interaction & iOS 26 Animations (`.lg-interactive`)

Glass UI should feel physically heavy, fluid, and responsive to the environment. The `.lg-interactive` class provides a complete suite of spatial interactions inspired by iOS 26 and visionOS:

- **3D Parallax Tilt**: When the user hovers over a glass element, the engine tracks the pointer and gently tilts the glass in 3D space (`rotateX`, `rotateY`). This creates a visceral sense of physical volume.
- **Dynamic Edge Glare**: A specular spotlight tracks the pointer, wrapping around the 1px edge of the glass (`mask-composite: destination-out`) and providing a very soft surface sheen.
- **Fluid Jelly Squish (Press)**: When clicked, the glass does not simply shrink. It squishes like a physical liquid drop (`scale3d(1.03, 0.92, 1)`), widening slightly and compressing vertically before springing back.
- **Spring Physics**: We have bundled an optimized cubic-bezier spring in the `.lg-interactive` class to ensure all state changes return to resting state with natural physical tension.
- **Entrance (`.lg-entrance`)**: Use this class to spring-load elements as they mount into the DOM.

## 1.5 Background Liquid Morphing (Gooey Effect)

The true magic of Liquid Glass is revealed when it refracts something dynamic. 
- To achieve the iconic "iOS 26 Liquid Drop Merge", apply an SVG Gooey filter (thresholding alpha via `feColorMatrix`) to the *background container* (e.g. glowing orbs or gradients).
- When the background elements organically merge and separate behind the glass, the `feDisplacementMap` bends the light exactly at the merging seams, creating a breathtaking fluid aesthetic.

## 2. Typography & Contrast (Vibrant Text)

Liquid Glass fundamentally alters the background. Text legibility is your primary concern.

- **Do NOT use standard dark text on light glass** unless you have a completely static, light background.
- **DO use Vibrant Text**: White text with a slight, diffuse dark shadow (`text-shadow: 0 1px 2px rgba(0,0,0,0.2)`) is the industry standard for glass overlays. It ensures the text remains readable regardless of whether the glass floats over a dark or bright background element.
- The default `.liquid-glass` class automatically applies a Vibrant Text configuration.

## 3. Layering & Depth

Liquid glass looks best when it has something to refract!
- **Rich Backgrounds**: Place Liquid Glass elements over vibrant, colorful, or high-contrast backgrounds (images, gradients, moving blobs). Glass over a solid gray background will just look gray.
- **Stacking**: You can stack Liquid Glass elements (e.g., a glass button inside a glass card). However, because each layer runs a complex SVG filter, avoid stacking more than 3 layers deep to prevent visual "mud" and maintain 60fps performance.

## 4. Parameter Tuning

The engine accepts parameters via data attributes or JS options. The demo uses
one **Apple-standard set** on every element — `thickness: 30`, `refraction: 44`,
and variant-driven frost — so the material reads consistently across sizes.

- `thickness`: lens depth (glass "thickness"). Deeper ⇒ more pronounced edge
  lensing, matching Apple's "thicker material has more pronounced lensing." `30`
  is the standard; `20–24` for a thinner look, `40–60` for a chunky lens.
- `refraction`: edge lensing strength in px. `44` is the standard; the engine
  auto-caps it to ½ the short side so small controls stay coherent and never fold.
- `blur`: backdrop frost. Defaults per variant (`regular` 10, `clear` 3,
  `tinted` 14) — kept low so the backdrop reads through and the lensing shows.
  Raise for structural surfaces (sidebars) that need more legibility.

## 5. Edges & Lighting

Per Apple's *Meet Liquid Glass* (WWDC25), the material defines itself through
**lensing** — it *"dynamically bends, shapes, and concentrates light"* with
*"responsive lensing along its edges"* — and is lit by an environment whose
*"highlights respond to geometry … causing light to travel around the material,
defining its silhouette."* The engine reproduces both from one shared surface:

- **Refraction** is a single smooth lens whose displacement rises monotonically
  from zero at the centre (clear body) to the edge (so there is no inner-ring
  seam), computed with **Snell's law** — the GLSL `refract()` of a straight-down
  view ray through the air→glass interface (n = 1.5) on the lens normal.
- **Static light** is a razor-thin crisp line on the very edge, brightest at the
  top, tracing the silhouette (baked into the filter, no per-frame JS).
- **Dynamic light** (core — *every* glass element, via `PointerField`) makes the
  edge light *follow the pointer*: the bright segment of the rim tracks the
  cursor and **fades in by proximity** (lights up as the cursor approaches from a
  distance, ~220px, not only on direct hover) — Apple's *"light travels around
  the material … comes to life on touch."*
- You do not need to add your own CSS inner shadows or borders. The engine
  handles the edge lensing and lighting; keep the surrounding content rich so the
  lens has something to bend.
