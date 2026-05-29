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

The engine accepts parameters via data attributes or JS options:
- `thickness`: Defines the "bevel" width. Keep this around `8` to `12` for UI cards, and `4` to `6` for small buttons.
- `refraction`: Defines how strongly the background is pulled. Too high (e.g., > 30) can make the UI look messy. `12` to `20` is the sweet spot.
- `blur`: Use high blur (`24+`) for structural elements like sidebars, and low blur (`8-12`) for floating cards to keep them feeling lightweight.

## 5. Edges & Lighting

- Liquid Glass automatically calculates a glossy "rim light" (Specular Map) based on a custom Cubic Spline and Quadratic Dome algorithm. 
- You do not need to add your own CSS inner shadows or borders. The engine handles the physical lighting perfectly.
