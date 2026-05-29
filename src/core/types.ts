export type LiquidGlassVariant = 'regular' | 'clear' | 'tinted';
export type LiquidGlassScheme = 'light' | 'dark' | 'auto';
export type LiquidGlassQuality = 'high' | 'balanced' | 'low' | 'auto';

export interface LiquidGlassOptions {
  /** Corner radius in px. 'pill' = height/2. 'auto' reads current computed border-radius. Default: 'auto'. */
  radius?: number | 'auto' | 'pill';
  /** Lens depth (glass "thickness") in px — deeper ⇒ more pronounced edge lensing. Default: 30. */
  thickness?: number;
  /** Max edge refraction displacement in px (capped to ½ the short side). Default: 44. */
  refraction?: number;
  /** Chromatic dispersion (0–1). Pulls R/G/B apart at the edges. Default: 0.03. */
  chromaticAberration?: number;
  /** Backdrop blur in px (the "frosted" amount). Default: per variant (regular 10, clear 3, tinted 14). */
  blur?: number;
  /** Saturation boost as %. 100 = neutral. Default: 150. */
  saturation?: number;
  /** Variant — controls baseline tint and behavior. Default: 'regular'. */
  variant?: LiquidGlassVariant;
  /** Color scheme. Default: 'auto'. */
  scheme?: LiquidGlassScheme;
  /** Optional explicit tint, overrides variant. CSS color. */
  tint?: string;
  /** Specular (edge light) enabled. Default: true. */
  specular?: boolean;
  /** Specular peak intensity (0–1). Default: 0.5. */
  specularIntensity?: number;
  /**
   * Apply the glass edge treatment inline (scheme-aware box-shadow): a crisp
   * bright rim hairline, a broad inner top glow that lifts the body, a subtle
   * bottom-lip highlight for thickness, and a soft cool float shadow. This is
   * what makes a bare element read as Liquid Glass without extra CSS. Set false
   * to manage box-shadow yourself. Default: true.
   */
  edges?: boolean;
  /** Apply the computed radius as the element's border-radius. Default: true. */
  applyRadius?: boolean;
  /** Device-pixel-ratio cap for the displacement map (1–3). Default: 2. */
  mapPixelRatio?: number;

  // ── Production / Chrome-extension knobs ──────────────────────────────────

  /**
   * Quality tier. Controls the expensive bits:
   *   high     — 3-pass chromatic, full map DPR
   *   balanced — single displacement pass (no chromatic), map DPR capped at 1.5
   *   low      — plain CSS backdrop blur+saturate, no SVG filter at all
   *   auto     — picks one from navigator.hardwareConcurrency / deviceMemory
   * Explicit options (e.g. chromaticAberration) still take effect within the
   * tier's ceiling. Default: 'auto'.
   */
  quality?: LiquidGlassQuality;

  /**
   * Defer building the SVG filter until the element first scrolls into view
   * (IntersectionObserver). Off-screen glass then costs nothing. The filter is
   * torn down again when the element leaves the viewport by `lazyMargin`.
   * Default: false.
   */
  lazy?: boolean;

  /** Root-margin for the lazy IntersectionObserver. Default: '200px'. */
  lazyMargin?: string;

  /**
   * Explicit tree scope to inject the shared <svg><defs> into. Normally
   * auto-detected from the element's getRootNode() so it works inside a Shadow
   * DOM (Chrome-extension content scripts). Pass this only to override.
   */
  root?: Document | ShadowRoot;

  /**
   * CSS backdrop-filter used when SVG-in-backdrop-filter is unsupported
   * (Safari/Firefox) or quality resolves to 'low'. Default:
   * 'blur(12px) saturate(1.6)'.
   */
  fallbackFilter?: string;

  /**
   * Honor prefers-reduced-transparency / prefers-reduced-motion by falling
   * back to a cheaper opaque-ish style. Default: true.
   */
  respectReducedMotion?: boolean;
}

export interface ResolvedOptions {
  radius: number;
  thickness: number;
  refraction: number;
  chromaticAberration: number;
  blur: number;
  saturation: number;
  variant: LiquidGlassVariant;
  scheme: LiquidGlassScheme;
  tint: string | null;
  specular: boolean;
  specularIntensity: number;
  edges: boolean;
  applyRadius: boolean;
  mapPixelRatio: number;
  quality: LiquidGlassQuality;
  lazy: boolean;
  lazyMargin: string;
  root: Document | ShadowRoot | null;
  fallbackFilter: string;
  respectReducedMotion: boolean;
}
