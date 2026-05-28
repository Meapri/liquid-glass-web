export type LiquidGlassVariant = 'regular' | 'clear' | 'tinted';
export type LiquidGlassScheme = 'light' | 'dark' | 'auto';

export interface LiquidGlassOptions {
  /** Corner radius in px. 'pill' = height/2. 'auto' reads current computed border-radius. Default: 'auto'. */
  radius?: number | 'auto' | 'pill';
  /** Rim thickness in px — how wide the refracting lens border is. Default: 18. */
  thickness?: number;
  /** Max refraction displacement in px. Default: 32. */
  refraction?: number;
  /** Chromatic dispersion (0–1). Pulls R/G/B apart at the edges. Default: 0. */
  chromaticAberration?: number;
  /** Backdrop blur in px (the "frosted" amount). Default: 2. */
  blur?: number;
  /** Saturation boost as %. 100 = neutral. Default: 180. */
  saturation?: number;
  /** Variant — controls baseline tint and behavior. Default: 'regular'. */
  variant?: LiquidGlassVariant;
  /** Color scheme. Default: 'auto'. */
  scheme?: LiquidGlassScheme;
  /** Optional explicit tint, overrides variant. CSS color. */
  tint?: string;
  /** Specular highlight enabled. Default: true. */
  specular?: boolean;
  /** Specular peak intensity (0–1). Default: 0.7. */
  specularIntensity?: number;
  /** Apply the computed radius as the element's border-radius. Default: true. */
  applyRadius?: boolean;
  /** Device-pixel-ratio cap for the displacement map (1–3). Default: 2. */
  mapPixelRatio?: number;
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
  applyRadius: boolean;
  mapPixelRatio: number;
}
