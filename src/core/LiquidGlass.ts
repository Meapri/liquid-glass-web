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

import type { LiquidGlassOptions, ResolvedOptions, LiquidGlassQuality, LiquidGlassVariant } from './types';
import { FilterChain } from './FilterChain';
import { getDisplacementMap, getSpecularMap } from './MapCache';

const VARIANT_TINT: Record<LiquidGlassVariant, { light: string; dark: string }> = {
  regular: {
    light: 'rgba(255, 255, 255, 0.25)', // Slightly more opaque white for standard Apple frosted glass
    dark: 'rgba(0, 0, 0, 0.25)',        // Standard Apple dark glass
  },
  clear: {
    light: 'rgba(255, 255, 255, 0.05)',
    dark: 'rgba(0, 0, 0, 0.05)',
  },
  tinted: {
    light: 'rgba(255, 255, 255, 0.5)',
    dark: 'rgba(30, 30, 36, 0.5)',
  },
};

/**
 * Default frost per variant when `blur` isn't given. Liquid Glass blurs the
 * backdrop *before* refracting it, so sharp content (text, edges) is smoothed
 * into colour first and the lens bends a clean image — without enough blur,
 * strong refraction over text looks busy. `regular` is well-frosted for use
 * over arbitrary content; `clear` stays more transparent for bold media;
 * `tinted` a touch more frosted. Explicit `blur` always wins.
 */
const VARIANT_BLUR: Record<LiquidGlassVariant, number> = {
  regular: 4,
  clear: 2,
  tinted: 8,
};

/**
 * The glass edge treatment, layered as one box-shadow. The edge dimensionality
 * is carried OPTICALLY — by the baked specular rim (light wrapping the curved
 * edge) plus the refraction band — not by a drawn outline. So box-shadow only
 * adds a whisper of a hairline (a baseline so the edge still reads over flat
 * backdrops where there's nothing to refract), a faint top lip, and the soft
 * cool float shadow that lifts it off the page. Cool-tinted shadow like Apple's.
 */
const EDGE_SHADOW_LIGHT =
  'inset 0 0 0 0.5px rgba(255, 255, 255, 0.4), ' + // Sharp hairline rim
  'inset 0 1px 1px rgba(255, 255, 255, 0.8), ' +   // Soft bright top glare
  '0 8px 32px rgba(0, 0, 0, 0.08), ' +            // Extremely soft ambient float shadow
  '0 1px 4px rgba(0, 0, 0, 0.04)';

const EDGE_SHADOW_DARK =
  'inset 0 0 0 0.5px rgba(255, 255, 255, 0.15), ' +
  'inset 0 1px 1px rgba(255, 255, 255, 0.25), ' +
  '0 8px 32px rgba(0, 0, 0, 0.35), ' +            
  '0 1px 4px rgba(0, 0, 0, 0.15)';

const DEFAULT_OPTIONS: ResolvedOptions = {
  radius: 24,
  thickness: 48,
  refraction: 80, // High refraction for strong Apple spatial effect
  chromaticAberration: 0.03,
  blur: 6, // Higher blur for silky smooth diffusion
  saturation: 180, // High saturation for vibrant colors
  variant: 'regular',
  scheme: 'auto',
  tint: null,
  specular: true, // Restored the well-calculated Canvas 2D specular light
  specularIntensity: 1.0,
  edges: true,
  applyRadius: true,
  mapPixelRatio: 2,
  quality: 'auto',
  lazy: false,
  lazyMargin: '200px',
  root: null,
  fallbackFilter: 'blur(12px) saturate(1.6)',
  respectReducedMotion: true,
};

/** rAF-debounced regen so dragging/resizing doesn't run the pixel loop hot. */
const RESIZE_DEBOUNCE_MS = 80;

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
      this.filter.updateBlur(this.options.blur);
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
      prev.specularIntensity !== this.options.specularIntensity ||
      Math.max(8, Math.ceil(prev.refraction)) !== Math.max(8, Math.ceil(this.options.refraction));
    if (mapsChanged) this.scheduleRegen();
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
    const css = this.options.fallbackFilter;
    this.element.style.backdropFilter = css;
    (this.element.style as WebkitStyle).webkitBackdropFilter = css;
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
   * Refraction is an inward displacement in px, so on a small element a large
   * value would oversample past the centre and break up. Cap it to a fraction of
   * the short side — the glass is physically "thinner" when it's small — so the
   * strong default reads on panels/tiles but stays coherent on small controls.
   */
  private effectiveRefraction(): number {
    const cap = Math.min(this.currentWidth, this.currentHeight) * 0.65;
    return Math.min(this.options.refraction, cap);
  }

  /**
   * The displacement map is a smooth gradient that feImage bilinear-upscales to
   * the element box, so below the 'high' tier it renders at 1× — halving its
   * canvas area (and its PNG-encode cost) versus the specular map with no
   * visible loss of refraction. 'high' is unchanged (capped only by the 3× DPR
   * ceiling), so capable machines keep the full-resolution lens.
   */
  private displacementDpr(): number {
    return this.options.mapPixelRatio * 0.6;
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
      refraction: this.options.refraction,
    });

    this.filter = new FilterChain({
      refraction: this.effectiveRefraction(),
      chromaticAberration: this.effectiveChromatic(),
      blur: this.options.blur,
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
        intensity: this.options.specularIntensity,
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
        refraction: this.options.refraction,
      });
      this.filter.updateDisplacement(disp.url, this.currentWidth, this.currentHeight, disp.padding);
      if (this.options.specular) {
        const specUrl = getSpecularMap({
          width: this.currentWidth,
          height: this.currentHeight,
          radius: this.computedRadius(),
          thickness: this.computedThickness(),
          pixelRatio: this.specularDpr(),
          intensity: this.options.specularIntensity,
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
    this.element.style.boxShadow =
      this.resolveScheme() === 'dark' ? EDGE_SHADOW_DARK : EDGE_SHADOW_LIGHT;
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

  /** Rim band, capped at 28% of the short side so small pills stay coherent. */
  private computedThickness(): number {
    const cap = Math.min(this.currentWidth, this.currentHeight) * 0.28;
    return Math.max(2, Math.min(this.options.thickness, cap));
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
