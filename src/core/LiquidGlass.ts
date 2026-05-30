/**
 * Apple-style Liquid Glass for the web.
 *
 * One backdrop-filter per element, one SVG filter per element, no WebGL
 * contexts, no requestAnimationFrame loops. Refraction is GPU-accelerated by
 * Chromium's compositor via feDisplacementMap; specular rim is baked as a
 * static PNG and blended in screen mode inside the same filter pass.
 *
 * Production / Chrome-extension features:
 *   - Shadow DOM aware (filter is injected into the element's own tree scope)
 *   - quality tiers (high / balanced / low / auto) gate the expensive bits
 *   - lazy init via IntersectionObserver — off-screen glass costs nothing
 *   - suspend()/resume() for cheap show/hide (translation tooltips etc.)
 *   - graceful CSS fallback on non-Chromium and reduced-transparency
 *
 * Usage:
 *   const glass = new LiquidGlass(myEl, { variant: 'regular' });
 *   glass.update({ refraction: 24 });
 *   glass.suspend();  // tooltip hidden — drop GPU cost, keep instance
 *   glass.resume();   // tooltip shown again — cheap
 *   glass.destroy();
 */

import type {
  LiquidGlassOptions,
  LiquidGlassMaterialPreset,
  LiquidGlassOpticalProfile,
  LiquidGlassResolvedState,
  ResolvedOptions,
  LiquidGlassQuality,
  LiquidGlassVariant,
} from './types';
import { resolveLiquidGlassAutoProfile } from './AutoProfile';
import { FilterChain } from './FilterChain';
import { getDisplacementMap, getSpecularMap } from './MapCache';
import { registerPointerLight, unregisterPointerLight } from './PointerField';

const VARIANT_TINT: Record<LiquidGlassVariant, { light: string; dark: string }> = {
  regular: {
    light: 'rgba(255, 255, 255, 0.14)', // light, transparent — content shines through
    dark: 'rgba(0, 0, 0, 0.2)',
  },
  clear: {
    light: 'rgba(255, 255, 255, 0.04)',
    dark: 'rgba(0, 0, 0, 0.04)',
  },
  tinted: {
    // Legacy shortcut. Official Apple guidance uses Regular/Clear plus tinting.
    light: 'rgba(255, 255, 255, 0.32)',
    dark: 'rgba(30, 30, 36, 0.42)',
  },
};

/**
 * Default frost per variant when `blur` isn't given. Liquid Glass blurs the
 * backdrop *before* refracting it, so sharp content (text, edges) is smoothed
 * into colour first and the lens bends a clean image — without enough blur,
 * strong refraction over text looks busy. `regular` is the default system-like
 * variant; `clear` stays more transparent for bold media; `tinted` is retained
 * as a compatibility alias for regular+tint. Explicit `blur` always wins.
 */
const VARIANT_BLUR: Record<LiquidGlassVariant, number> = {
  regular: 7, // light frost — clearer so the refraction/lensing reads like real glass
  clear: 3,    // near-transparent for bold media
  tinted: 14,
};

/**
 * The glass edge treatment, layered as one box-shadow — tuned for tasteful
 * DEPTH (a glass lozenge floating above the content), not a hard embossed
 * button: a faint hairline, a gentle inner top sheen that gives the body volume,
 * and a soft, diffuse cool float shadow that lifts it off the page.
 */
const EDGE_SHADOW_LIGHT =
  'inset 0 0 0 0.5px rgba(255, 255, 255, 0.16), ' + // faint hairline — dynamic light is the primary edge
  'inset 0 2px 4px rgba(255, 255, 255, 0.32), ' + // subtle top sheen (volume)
  'inset 0 -3px 6px rgba(0, 0, 0, 0.06), ' + // subtle bottom inner shade
  '0 4px 12px rgba(31, 38, 135, 0.09)'; // very light float shadow

const EDGE_SHADOW_DARK =
  'inset 0 0 0 0.5px rgba(255, 255, 255, 0.09), ' +
  'inset 0 2px 4px rgba(255, 255, 255, 0.16), ' +
  'inset 0 -3px 6px rgba(0, 0, 0, 0.18), ' +
  '0 5px 14px rgba(0, 0, 0, 0.24)';

const DEFAULT_OPTIONS: ResolvedOptions = {
  radius: 22, // Apple's standard corner radius
  thickness: 44, // lens depth — drives how pronounced/thick the edge lensing is
  refraction: 46, // edge lensing strength (px) — concentrated at the border
  chromaticAberration: 0.03,
  blur: 7, // light frost, backdrop reads through so the lensing is visible
  saturation: 150, // gentle lift, backdrop stays close to natural
  variant: 'regular',
  profile: 'auto',
  preset: 'auto',
  scheme: 'auto',
  tint: null,
  specular: true,
  specularIntensity: 0.5,
  edges: true,
  applyRadius: true,
  mapPixelRatio: 2,
  quality: 'auto',
  lazy: false,
  lazyMargin: '200px',
  root: null,
  fallbackFilter: 'blur(20px) saturate(1.8)',
  respectReducedMotion: true,
};

/** rAF-debounced regen so dragging/resizing doesn't run the pixel loop hot. */
const RESIZE_DEBOUNCE_MS = 80;

/**
 * A regular content card in the demo is roughly 200px tall; use that as the
 * optical reference for configured blur values. Short bars keep the same
 * material clarity by scaling the absolute blur down from this baseline.
 */
const DEFAULT_SURFACE_REFERENCE_SHORT_SIDE = 200;
const DEFAULT_MIN_SIZE_BLUR_SCALE = 0.32;

interface OpticalTuning {
  /** Scales the configured optical depth. */
  thickness: number;
  /** Scales the configured displacement. */
  refraction: number;
  /** Scales the configured frost. */
  blur: number;
  /** Scales the baked geometry highlight. */
  specular: number;
  /**
   * Size used as the point where the configured blur reaches full strength.
   * Smaller controls proportionally reduce frost so short bars don't look
   * heavier than larger surfaces.
   */
  blurReferenceShortSide: number;
  /**
   * Minimum size scale for blur. Bars need a higher floor: Apple-style
   * navigation materials dissolve moving content for legibility even when
   * their vertical footprint is short.
   */
  minBlurScale: number;
}

interface PresetTuning {
  thickness: number;
  refraction: number;
  blur: number;
  specular: number;
}

const OPTICAL_PROFILE: Record<Exclude<LiquidGlassOpticalProfile, 'auto'>, OpticalTuning> = {
  // Navigation bars and headers are part of the top functional layer, but Apple
  // keeps them visually quiet so content remains the hero. This should feel
  // closer to a scroll-edge/navigation material than a magnifying control.
  bar: {
    thickness: 0.38,
    refraction: 0.22,
    blur: 0.82,
    specular: 0.38,
    blurReferenceShortSide: 160,
    minBlurScale: 0.72,
  },
  // Buttons, switches, sliders, and media controls can flex into the glass more
  // visibly because their footprint is small and their symbols are bold.
  control: {
    thickness: 1.12,
    refraction: 1.16,
    blur: 0.78,
    specular: 1.16,
    blurReferenceShortSide: 160,
    minBlurScale: 0.42,
  },
  // Cards need separation without competing with the content layer.
  card: {
    thickness: 1,
    refraction: 0.96,
    blur: 0.96,
    specular: 1,
    blurReferenceShortSide: DEFAULT_SURFACE_REFERENCE_SHORT_SIDE,
    minBlurScale: DEFAULT_MIN_SIZE_BLUR_SCALE,
  },
  // Large sidebars, sheets, menus, and panels adapt gently; too much lensing
  // across a large area becomes distracting.
  panel: {
    thickness: 0.86,
    refraction: 0.68,
    blur: 1.08,
    specular: 0.86,
    blurReferenceShortSide: 240,
    minBlurScale: 0.48,
  },
  // Selected capsules should feel lifted from the same plane, but not become a
  // separate glass-on-glass object.
  selection: {
    thickness: 0.94,
    refraction: 0.82,
    blur: 0.9,
    specular: 1,
    blurReferenceShortSide: 160,
    minBlurScale: 0.5,
  },
};

const MATERIAL_PRESET: Record<Exclude<LiquidGlassMaterialPreset, 'auto'>, PresetTuning> = {
  subtle: {
    thickness: 0.82,
    refraction: 0.78,
    blur: 0.82,
    specular: 0.78,
  },
  balanced: {
    thickness: 1,
    refraction: 1,
    blur: 1,
    specular: 1,
  },
  vivid: {
    thickness: 1.08,
    refraction: 1.12,
    blur: 1.08,
    specular: 1.14,
  },
  dramatic: {
    thickness: 1.18,
    refraction: 1.28,
    blur: 1.16,
    specular: 1.28,
  },
};

/** SVG-in-backdrop-filter only works on Chromium. */
const IS_CHROMIUM =
  typeof navigator !== 'undefined' && /Chrome\//.test(navigator.userAgent);

/** Cheap device-class heuristic for quality:'auto'. */
function autoQuality(): Exclude<LiquidGlassQuality, 'auto'> {
  if (typeof navigator === 'undefined') return 'balanced';
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (cores <= 4 || mem <= 4) return 'balanced';
  return 'high';
}

type WebkitStyle = CSSStyleDeclaration & { webkitBackdropFilter?: string };

function roundCss(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export class LiquidGlass {
  readonly element: HTMLElement;
  private options: ResolvedOptions;
  private quality: Exclude<LiquidGlassQuality, 'auto'>;
  private root: Document | ShadowRoot;
  private filter: FilterChain | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private mqlScheme: MediaQueryList | null = null;
  private mqlListener: ((e: MediaQueryListEvent) => void) | null = null;
  private currentWidth = 0;
  private currentHeight = 0;
  private destroyed = false;
  private suspended = false;
  private usesFallback = false;
  private regenTimer: number | null = null;

  constructor(element: HTMLElement, options: LiquidGlassOptions = {}) {
    this.element = element;
    this.options = this.resolve(options);
    this.quality = this.options.quality === 'auto' ? autoQuality() : this.options.quality;
    this.root = this.resolveRoot();

    const computed = getComputedStyle(element);
    if (computed.position === 'static') element.style.position = 'relative';
    if (computed.isolation !== 'isolate') element.style.isolation = 'isolate';
    if (computed.overflow === 'visible') element.style.overflow = 'hidden';

    const rect = element.getBoundingClientRect();
    this.currentWidth = Math.max(1, rect.width);
    this.currentHeight = Math.max(1, rect.height);

    this.applyTint();
    if (this.options.applyRadius) {
      element.style.borderRadius = `${this.computedRadius()}px`;
    }

    // Decide the rendering path once.
    this.usesFallback = this.shouldFallback();

    if (this.usesFallback) {
      this.applyFallback();
    } else if (this.options.lazy && typeof IntersectionObserver !== 'undefined') {
      this.setupLazy();
    } else {
      this.installFilter();
    }

    // Size tracking (skip while suspended/fallback — fallback needs no regen).
    if (!this.usesFallback) {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const box = entry.borderBoxSize?.[0];
          const width = box ? box.inlineSize : entry.contentRect.width;
          const height = box ? box.blockSize : entry.contentRect.height;
          if (
            Math.abs(width - this.currentWidth) < 0.5 &&
            Math.abs(height - this.currentHeight) < 0.5
          )
            continue;
          this.currentWidth = Math.max(1, width);
          this.currentHeight = Math.max(1, height);
          if (this.options.applyRadius) {
            this.element.style.borderRadius = `${this.computedRadius()}px`;
          }
          this.scheduleRegen();
        }
      });
      this.resizeObserver.observe(element, { box: 'border-box' });
    }

    if (this.options.scheme === 'auto' && typeof window.matchMedia === 'function') {
      this.mqlScheme = window.matchMedia('(prefers-color-scheme: dark)');
      this.mqlListener = (): void => this.applyTint();
      this.mqlScheme.addEventListener('change', this.mqlListener);
    }

    // Pointer-tracked edge light for every glass element (core, not just
    // .lg-interactive). The CSS `.liquid-glass::after` consumes the vars.
    if (!this.usesFallback) registerPointerLight(this.element);
  }

  update(partial: LiquidGlassOptions): void {
    const prev = this.options;
    const prevQuality = this.quality;
    this.options = this.resolve({ ...this.optionsAsInput(), ...partial });
    this.quality = this.options.quality === 'auto' ? autoQuality() : this.options.quality;
    this.applyTint();
    if (this.options.applyRadius) {
      this.element.style.borderRadius = `${this.computedRadius()}px`;
    }

    // A changed quality tier, fallback decision, or specular toggle flips the
    // filter-chain shape (pass count / nodes) — rebuild from scratch then.
    if (
      prevQuality !== this.quality ||
      prev.specular !== this.options.specular ||
      this.usesFallback !== this.shouldFallback()
    ) {
      this.rebuild();
      return;
    }

    if (this.filter) {
      this.filter.updateBlur(this.effectiveBlur());
      this.filter.updateRefraction(this.effectiveRefraction());
      this.filter.updateSaturation(this.options.saturation);
    }

    // The displacement/specular PNGs are the expensive part. blur, saturation,
    // refraction scale, tint and scheme are applied as live filter/CSS attrs
    // above, so only regenerate the maps when a param that changes their pixels
    // moved — radius, thickness, specular intensity, or the displacement
    // padding (= ceil(refraction)). This keeps live theme/tint toggles free.
    const mapsChanged =
      prev.radius !== this.options.radius ||
      prev.thickness !== this.options.thickness ||
      prev.profile !== this.options.profile ||
      prev.preset !== this.options.preset ||
      prev.specularIntensity !== this.options.specularIntensity ||
      Math.max(
        8,
        Math.ceil(
          prev.refraction *
            this.opticalTuningFor(prev.profile).refraction *
            this.presetTuningFor(prev.preset, prev.profile).refraction
        )
      ) !==
        Math.max(8, Math.ceil(this.profiledRefraction()));
    if (mapsChanged) this.scheduleRegen();
  }

  /**
   * Live-override the lensing (displacement) strength in px WITHOUT rebuilding
   * the maps — a cheap per-frame GPU attribute change for morph / materialize
   * animations (e.g. `LiquidMenu` ramping the refraction as the menu grows).
   * Pass `null` to restore the configured value.
   */
  flexRefraction(px: number | null): void {
    if (!this.filter) return;
    this.filter.updateRefraction(px == null ? this.effectiveRefraction() : Math.max(0, px));
  }

  get resolved(): LiquidGlassResolvedState {
    const profile = this.resolveOpticalProfile();
    const preset = this.resolveMaterialPreset();
    return {
      profile,
      preset,
      variant: this.options.variant,
      scheme: this.resolveScheme(),
      radius: this.computedRadius(),
      thickness: this.computedThickness(),
      refraction: this.effectiveRefraction(),
      blur: this.effectiveBlur(),
      saturation: this.options.saturation,
      specularIntensity: this.profiledSpecularIntensity(),
      tint: this.options.tint ?? this.variantTint(),
      usesFallback: this.usesFallback,
      quality: this.quality,
      width: this.currentWidth,
      height: this.currentHeight,
    };
  }

  /** The configured (size-capped) lensing strength in px. */
  get configuredRefraction(): number {
    return this.effectiveRefraction();
  }

  /** Detach the GPU filter but keep the instance alive (cheap show/hide). */
  suspend(): void {
    if (this.suspended || this.destroyed) return;
    this.suspended = true;
    this.element.style.backdropFilter = 'none';
    (this.element.style as WebkitStyle).webkitBackdropFilter = 'none';
  }

  /** Re-attach the previously built filter. No pixel work if size is unchanged. */
  resume(): void {
    if (!this.suspended || this.destroyed) return;
    this.suspended = false;
    if (this.usesFallback) {
      this.applyFallback();
    } else if (this.filter) {
      const css = this.filter.url;
      this.element.style.backdropFilter = css;
      (this.element.style as WebkitStyle).webkitBackdropFilter = css;
    } else {
      this.installFilter();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.regenTimer !== null) {
      clearTimeout(this.regenTimer);
      this.regenTimer = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    if (this.mqlScheme && this.mqlListener) {
      this.mqlScheme.removeEventListener('change', this.mqlListener);
    }
    this.filter?.destroy();
    this.filter = null;
    unregisterPointerLight(this.element);
    this.element.style.backdropFilter = '';
    (this.element.style as WebkitStyle).webkitBackdropFilter = '';
    if (this.options.edges) this.element.style.boxShadow = '';
  }

  // ── internals ────────────────────────────────────────────────────────────

  private resolveRoot(): Document | ShadowRoot {
    if (this.options.root) return this.options.root;
    const rootNode = this.element.getRootNode();
    return rootNode instanceof ShadowRoot ? rootNode : document;
  }

  private shouldFallback(): boolean {
    if (!IS_CHROMIUM) return true;
    if (this.quality === 'low') return true;
    if (this.options.respectReducedMotion && typeof window.matchMedia === 'function') {
      if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return true;
    }
    return false;
  }

  private applyFallback(): void {
    this.usesFallback = true;
    const css =
      this.options.fallbackFilter === DEFAULT_OPTIONS.fallbackFilter
        ? this.profiledFallbackFilter()
        : this.options.fallbackFilter;
    this.element.style.backdropFilter = css;
    (this.element.style as WebkitStyle).webkitBackdropFilter = css;
  }

  private profiledFallbackFilter(): string {
    const blur = Math.max(4, Math.min(22, this.effectiveBlur() * 1.45));
    const saturation = Math.max(1, Math.min(2, this.options.saturation / 100));
    return `blur(${roundCss(blur)}px) saturate(${roundCss(saturation)})`;
  }

  private setupLazy(): void {
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries[entries.length - 1]?.isIntersecting ?? false;
        if (this.destroyed || this.suspended) return;
        if (visible) {
          if (!this.filter) this.installFilter();
          else {
            const css = this.filter.url;
            this.element.style.backdropFilter = css;
            (this.element.style as WebkitStyle).webkitBackdropFilter = css;
          }
        } else if (this.filter) {
          // Off-screen: drop the GPU cost but keep the built filter for a
          // cheap re-attach when it scrolls back in.
          this.element.style.backdropFilter = 'none';
          (this.element.style as WebkitStyle).webkitBackdropFilter = 'none';
        }
      },
      { rootMargin: this.options.lazyMargin }
    );
    this.intersectionObserver.observe(this.element);
  }

  private effectiveChromatic(): number {
    // Only the 'high' tier pays for the 3-pass chromatic split.
    return this.quality === 'high' ? this.options.chromaticAberration : 0;
  }

  /**
   * Refraction is an inward displacement in px. The lensing lives in the rim
   * band, so if the displacement grows larger than that band, the backdrop
   * mapping folds back on itself and the fold reads as a hard caustic outline
   * just inside the edge (the "inner rectangle"). To stay a clean lens we cap the
   * displacement to the rim band width — Apple's lensing is bounded by the
   * material's thickness, not arbitrarily strong. Also capped to a fraction of
   * the short side so tiny controls stay coherent.
   */
  private effectiveRefraction(): number {
    // The lens is one smooth monotonic field across the whole surface (no band),
    // so there is no inner ring to fold; the only fold risk is at the masked
    // perimeter. Cap to a fraction of the short side so small controls stay
    // coherent.
    const sideCap = Math.min(this.currentWidth, this.currentHeight) * 0.78;
    return Math.min(this.profiledRefraction(), sideCap);
  }

  /**
   * Backdrop blur is an absolute stdDeviation, so a fixed value looks stronger
   * on a short element (a nav bar) than on a regular card. Treat a 200px-short
   * surface as the reference and scale shorter controls down automatically,
   * while still preserving a small amount of frost on tiny pills.
   */
  private effectiveBlur(): number {
    const short = Math.min(this.currentWidth, this.currentHeight);
    const tuning = this.opticalTuning();
    const preset = this.presetTuning();
    const sizeScale = Math.max(tuning.minBlurScale, Math.min(1, short / tuning.blurReferenceShortSide));
    const cap = short * 0.14;
    return Math.min(this.options.blur * tuning.blur * preset.blur * sizeScale, cap);
  }

  /**
   * The displacement map is a smooth gradient that feImage bilinear-upscales to
   * the element box, so it can render well below 1× with no visible loss. Large
   * panels carry a broad, smooth lens that upscales especially cleanly, so they
   * drop further (0.45×) — quadratically less canvas area / encode work — while
   * small controls keep 0.6× so their tighter edge stays crisp.
   */
  private displacementDpr(): number {
    const short = Math.min(this.currentWidth, this.currentHeight);
    const factor = short > 220 ? 0.45 : 0.6;
    return this.options.mapPixelRatio * factor;
  }

  /**
   * The specular PNG is the most expensive map to build, but users requested it 
   * to stay at full resolution (1.0) so the edge lighting remains razor sharp.
   */
  private specularDpr(): number {
    return this.options.mapPixelRatio;
  }

  private installFilter(): void {
    if (this.suspended) return;
    const disp = getDisplacementMap({
      width: this.currentWidth,
      height: this.currentHeight,
      radius: this.computedRadius(),
      thickness: this.computedThickness(),
      pixelRatio: this.displacementDpr(),
      refraction: this.profiledRefraction(),
    });

    this.filter = new FilterChain({
      refraction: this.effectiveRefraction(),
      chromaticAberration: this.effectiveChromatic(),
      blur: this.effectiveBlur(),
      saturation: this.options.saturation,
      width: this.currentWidth,
      height: this.currentHeight,
      displacementMapUrl: disp.url,
      displacementPadding: disp.padding,
      specularMapUrl: this.options.specular ? getSpecularMap({
        width: this.currentWidth,
        height: this.currentHeight,
        radius: this.computedRadius(),
        thickness: this.computedThickness(),
        pixelRatio: this.specularDpr(),
        intensity: this.profiledSpecularIntensity(),
      }) : null,
      root: this.root,
    });

    const css = this.filter.url;
    this.element.style.backdropFilter = css;
    (this.element.style as WebkitStyle).webkitBackdropFilter = css;
  }

  private rebuild(): void {
    this.filter?.destroy();
    this.filter = null;
    this.usesFallback = this.shouldFallback();
    if (this.usesFallback) {
      this.applyFallback();
    } else if (!this.suspended) {
      this.installFilter();
    }
  }

  private scheduleRegen(): void {
    if (this.destroyed || this.usesFallback) return;
    if (this.regenTimer !== null) clearTimeout(this.regenTimer);
    this.regenTimer = window.setTimeout(() => {
      this.regenTimer = null;
      if (this.destroyed || !this.filter) return;
      const disp = getDisplacementMap({
        width: this.currentWidth,
        height: this.currentHeight,
        radius: this.computedRadius(),
        thickness: this.computedThickness(),
        pixelRatio: this.displacementDpr(),
        refraction: this.profiledRefraction(),
      });
      this.filter.updateDisplacement(disp.url, this.currentWidth, this.currentHeight, disp.padding);
      // Blur and refraction are size-dependent (capped to the short side) — re-apply.
      this.filter.updateBlur(this.effectiveBlur());
      this.filter.updateRefraction(this.effectiveRefraction());
      if (this.options.specular) {
        const specUrl = getSpecularMap({
          width: this.currentWidth,
          height: this.currentHeight,
          radius: this.computedRadius(),
          thickness: this.computedThickness(),
          pixelRatio: this.specularDpr(),
          intensity: this.profiledSpecularIntensity(),
        });
        this.filter.updateSpecular(specUrl, this.currentWidth, this.currentHeight);
      }
    }, RESIZE_DEBOUNCE_MS);
  }

  private applyTint(): void {
    const tint = this.options.tint ?? this.variantTint();
    this.element.style.backgroundColor = tint;
    this.element.dataset.scheme = this.resolveScheme();
    this.applyEdges();
  }

  /** Scheme-aware rim + inner glow + float shadow that complete the glass look. */
  private applyEdges(): void {
    if (!this.options.edges) return;
    const scheme = this.resolveScheme();
    this.element.style.boxShadow = scheme === 'dark' ? EDGE_SHADOW_DARK : EDGE_SHADOW_LIGHT;
  }

  private variantTint(): string {
    const scheme = this.resolveScheme();
    return VARIANT_TINT[this.options.variant][scheme];
  }

  private resolveScheme(): 'light' | 'dark' {
    if (this.options.scheme === 'light' || this.options.scheme === 'dark') {
      return this.options.scheme;
    }
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }

  private computedRadius(): number {
    return Math.min(
      this.options.radius,
      Math.min(this.currentWidth, this.currentHeight) / 2
    );
  }

  /** Rim band, capped under half the short side so small pills keep lens volume. */
  private computedThickness(): number {
    const cap = Math.min(this.currentWidth, this.currentHeight) * 0.46;
    return Math.max(
      2,
      Math.min(this.options.thickness * this.opticalTuning().thickness * this.presetTuning().thickness, cap)
    );
  }

  private profiledRefraction(): number {
    return this.options.refraction * this.opticalTuning().refraction * this.presetTuning().refraction;
  }

  private profiledSpecularIntensity(): number {
    return Math.max(
      0,
      this.options.specularIntensity * this.opticalTuning().specular * this.presetTuning().specular
    );
  }

  private opticalTuning(): OpticalTuning {
    return OPTICAL_PROFILE[this.resolveOpticalProfile()];
  }

  private opticalTuningFor(profile: LiquidGlassOpticalProfile): OpticalTuning {
    return OPTICAL_PROFILE[profile === 'auto' ? this.resolveAutoOpticalProfile() : profile];
  }

  private presetTuning(): PresetTuning {
    return this.presetTuningFor(this.options.preset, this.options.profile);
  }

  private presetTuningFor(
    preset: LiquidGlassMaterialPreset,
    profile: LiquidGlassOpticalProfile
  ): PresetTuning {
    return MATERIAL_PRESET[preset === 'auto' ? this.resolveAutoMaterialPreset(profile) : preset];
  }

  private resolveAutoMaterialPreset(
    profile: LiquidGlassOpticalProfile
  ): Exclude<LiquidGlassMaterialPreset, 'auto'> {
    const resolvedProfile = profile === 'auto' ? this.resolveAutoOpticalProfile() : profile;
    if (resolvedProfile === 'control' || resolvedProfile === 'selection') return 'vivid';
    return 'balanced';
  }

  private resolveMaterialPreset(): Exclude<LiquidGlassMaterialPreset, 'auto'> {
    return this.options.preset === 'auto'
      ? this.resolveAutoMaterialPreset(this.options.profile)
      : this.options.preset;
  }

  private resolveOpticalProfile(): Exclude<LiquidGlassOpticalProfile, 'auto'> {
    return this.options.profile === 'auto' ? this.resolveAutoOpticalProfile() : this.options.profile;
  }

  private resolveAutoOpticalProfile(): Exclude<LiquidGlassOpticalProfile, 'auto'> {
    const className =
      typeof this.element.className === 'string' ? this.element.className.toLowerCase() : '';
    return resolveLiquidGlassAutoProfile({
      tagName: this.element.tagName,
      role: this.element.getAttribute('role'),
      ariaLabel: this.element.getAttribute('aria-label'),
      className,
      textLength: this.element.textContent?.trim().length ?? 0,
      buttonCount: this.element.querySelectorAll('button,[role="button"]').length,
      linkCount: this.element.querySelectorAll('a[href]').length,
      inputCount: this.element.querySelectorAll('input,select,textarea,[role="slider"]').length,
      width: this.currentWidth,
      height: this.currentHeight,
      radius: this.computedRadius(),
    });
  }

  private resolve(opts: LiquidGlassOptions): ResolvedOptions {
    const r = opts.radius;
    let radius: number;
    if (r === 'pill') {
      radius = 9999;
    } else if (r === 'auto' || r === undefined) {
      const cs = getComputedStyle(this.element);
      const parsed = parseFloat(cs.borderTopLeftRadius);
      radius = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OPTIONS.radius;
    } else {
      radius = r;
    }

    const variant = opts.variant ?? DEFAULT_OPTIONS.variant;

    return {
      radius,
      thickness: opts.thickness ?? DEFAULT_OPTIONS.thickness,
      refraction: opts.refraction ?? DEFAULT_OPTIONS.refraction,
      chromaticAberration: opts.chromaticAberration ?? DEFAULT_OPTIONS.chromaticAberration,
      blur: opts.blur ?? VARIANT_BLUR[variant],
      saturation: opts.saturation ?? DEFAULT_OPTIONS.saturation,
      variant,
      profile: opts.profile ?? DEFAULT_OPTIONS.profile,
      preset: opts.preset ?? DEFAULT_OPTIONS.preset,
      scheme: opts.scheme ?? DEFAULT_OPTIONS.scheme,
      tint: opts.tint ?? null,
      specular: opts.specular ?? DEFAULT_OPTIONS.specular,
      specularIntensity: opts.specularIntensity ?? DEFAULT_OPTIONS.specularIntensity,
      edges: opts.edges ?? DEFAULT_OPTIONS.edges,
      applyRadius: opts.applyRadius ?? DEFAULT_OPTIONS.applyRadius,
      mapPixelRatio: opts.mapPixelRatio ?? DEFAULT_OPTIONS.mapPixelRatio,
      quality: opts.quality ?? DEFAULT_OPTIONS.quality,
      lazy: opts.lazy ?? DEFAULT_OPTIONS.lazy,
      lazyMargin: opts.lazyMargin ?? DEFAULT_OPTIONS.lazyMargin,
      root: opts.root ?? DEFAULT_OPTIONS.root,
      fallbackFilter: opts.fallbackFilter ?? DEFAULT_OPTIONS.fallbackFilter,
      respectReducedMotion: opts.respectReducedMotion ?? DEFAULT_OPTIONS.respectReducedMotion,
    };
  }

  private optionsAsInput(): LiquidGlassOptions {
    const o = this.options;
    return {
      radius: o.radius,
      thickness: o.thickness,
      refraction: o.refraction,
      chromaticAberration: o.chromaticAberration,
      blur: o.blur,
      saturation: o.saturation,
      variant: o.variant,
      profile: o.profile,
      preset: o.preset,
      scheme: o.scheme,
      tint: o.tint ?? undefined,
      specular: o.specular,
      specularIntensity: o.specularIntensity,
      edges: o.edges,
      applyRadius: o.applyRadius,
      mapPixelRatio: o.mapPixelRatio,
      quality: o.quality,
      lazy: o.lazy,
      lazyMargin: o.lazyMargin,
      root: o.root ?? undefined,
      fallbackFilter: o.fallbackFilter,
      respectReducedMotion: o.respectReducedMotion,
    };
  }
}
