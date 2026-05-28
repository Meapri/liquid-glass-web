/**
 * Apple-style Liquid Glass for the web.
 *
 * One backdrop-filter per element, one SVG filter per element, no WebGL
 * contexts, no requestAnimationFrame loops. Refraction is GPU-accelerated by
 * Chromium's compositor via feDisplacementMap; specular rim is baked as a
 * static PNG and blended in screen mode inside the same filter pass.
 *
 * Usage:
 *   const glass = new LiquidGlass(myEl, { variant: 'regular' });
 *   glass.update({ refraction: 64 });
 *   glass.destroy();
 */

import type { LiquidGlassOptions, ResolvedOptions } from './types';
import { FilterChain } from './FilterChain';
import { getDisplacementMap, getSpecularMap } from './MapCache';

const VARIANT_TINT: Record<string, { light: string; dark: string }> = {
  regular: {
    light: 'rgba(255, 255, 255, 0.10)',
    dark: 'rgba(28, 28, 34, 0.28)',
  },
  clear: {
    light: 'rgba(255, 255, 255, 0.02)',
    dark: 'rgba(18, 18, 22, 0.06)',
  },
  tinted: {
    light: 'rgba(255, 255, 255, 0.22)',
    dark: 'rgba(40, 40, 48, 0.42)',
  },
};

const DEFAULT_OPTIONS: ResolvedOptions = {
  radius: 24,
  // Specular rim band width in px. The displacement model no longer uses it
  // (the whole surface is the lens), but the baked specular PNG does.
  thickness: 18,
  // Max inward displacement at the boundary. ~10–20% of short side gives the
  // iOS/Figma magnification feel without warping content into mush.
  refraction: 18,
  // Visible-but-natural rim dispersion. 0.4 is roughly where you see RGB
  // fringes on sharp backdrop features.
  chromaticAberration: 0.4,
  blur: 4,
  saturation: 160,
  variant: 'regular',
  scheme: 'auto',
  tint: null,
  specular: true,
  specularIntensity: 0.85,
  applyRadius: true,
  mapPixelRatio: 2,
};

/** rAF-debounced regen so dragging a window doesn't run the pixel loop hot. */
const RESIZE_DEBOUNCE_MS = 80;

export class LiquidGlass {
  readonly element: HTMLElement;
  private options: ResolvedOptions;
  private filter: FilterChain | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private mqlScheme: MediaQueryList | null = null;
  private mqlListener: ((e: MediaQueryListEvent) => void) | null = null;
  private currentWidth = 0;
  private currentHeight = 0;
  private destroyed = false;
  private regenTimer: number | null = null;

  constructor(element: HTMLElement, options: LiquidGlassOptions = {}) {
    this.element = element;
    this.options = this.resolve(options);

    // Element setup. Respect any positioning declared in CSS — we only nudge
    // when the cascaded value would prevent backdrop-filter from clipping or
    // forming its own stacking context.
    const computed = getComputedStyle(element);
    if (computed.position === 'static') element.style.position = 'relative';
    if (computed.isolation !== 'isolate') element.style.isolation = 'isolate';
    if (computed.overflow === 'visible') element.style.overflow = 'hidden';

    const rect = element.getBoundingClientRect();
    this.currentWidth = Math.max(1, rect.width);
    this.currentHeight = Math.max(1, rect.height);

    this.installFilter();
    this.applyTint();

    if (this.options.applyRadius) {
      element.style.borderRadius = `${this.computedRadius()}px`;
    }

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

    if (this.options.scheme === 'auto' && typeof window.matchMedia === 'function') {
      this.mqlScheme = window.matchMedia('(prefers-color-scheme: dark)');
      this.mqlListener = (): void => this.applyTint();
      this.mqlScheme.addEventListener('change', this.mqlListener);
    }
  }

  update(partial: LiquidGlassOptions): void {
    this.options = this.resolve({ ...this.optionsAsInput(), ...partial });
    if (this.filter) {
      this.filter.updateBlur(this.options.blur);
      this.filter.updateRefraction(this.options.refraction);
      this.filter.updateSaturation(this.options.saturation);
    }
    if (this.options.applyRadius) {
      this.element.style.borderRadius = `${this.computedRadius()}px`;
    }
    this.applyTint();
    this.scheduleRegen();
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
    if (this.mqlScheme && this.mqlListener) {
      this.mqlScheme.removeEventListener('change', this.mqlListener);
    }
    this.filter?.destroy();
    this.filter = null;
    this.element.style.backdropFilter = '';
    (this.element.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = '';
  }

  private installFilter(): void {
    const disp = getDisplacementMap({
      width: this.currentWidth,
      height: this.currentHeight,
      radius: this.computedRadius(),
      thickness: this.computedThickness(),
      pixelRatio: this.options.mapPixelRatio,
      refraction: this.options.refraction,
    });
    const specUrl = this.options.specular
      ? getSpecularMap({
          width: this.currentWidth,
          height: this.currentHeight,
          radius: this.computedRadius(),
          thickness: this.computedThickness(),
          pixelRatio: this.options.mapPixelRatio,
          intensity: this.options.specularIntensity,
        })
      : null;

    this.filter = new FilterChain({
      refraction: this.options.refraction,
      chromaticAberration: this.options.chromaticAberration,
      blur: this.options.blur,
      saturation: this.options.saturation,
      width: this.currentWidth,
      height: this.currentHeight,
      displacementMapUrl: disp.url,
      displacementPadding: disp.padding,
      specularMapUrl: specUrl,
    });

    const filterCss = this.filter.url;
    this.element.style.backdropFilter = filterCss;
    (this.element.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = filterCss;
  }

  private scheduleRegen(): void {
    if (this.destroyed) return;
    if (this.regenTimer !== null) clearTimeout(this.regenTimer);
    this.regenTimer = window.setTimeout(() => {
      this.regenTimer = null;
      if (this.destroyed || !this.filter) return;
      const disp = getDisplacementMap({
        width: this.currentWidth,
        height: this.currentHeight,
        radius: this.computedRadius(),
        thickness: this.computedThickness(),
        pixelRatio: this.options.mapPixelRatio,
        refraction: this.options.refraction,
      });
      this.filter.updateDisplacement(disp.url, this.currentWidth, this.currentHeight, disp.padding);
      if (this.options.specular) {
        const specUrl = getSpecularMap({
          width: this.currentWidth,
          height: this.currentHeight,
          radius: this.computedRadius(),
          thickness: this.computedThickness(),
          pixelRatio: this.options.mapPixelRatio,
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

    return {
      radius,
      thickness: opts.thickness ?? DEFAULT_OPTIONS.thickness,
      refraction: opts.refraction ?? DEFAULT_OPTIONS.refraction,
      chromaticAberration: opts.chromaticAberration ?? DEFAULT_OPTIONS.chromaticAberration,
      blur: opts.blur ?? DEFAULT_OPTIONS.blur,
      saturation: opts.saturation ?? DEFAULT_OPTIONS.saturation,
      variant: opts.variant ?? DEFAULT_OPTIONS.variant,
      scheme: opts.scheme ?? DEFAULT_OPTIONS.scheme,
      tint: opts.tint ?? null,
      specular: opts.specular ?? DEFAULT_OPTIONS.specular,
      specularIntensity: opts.specularIntensity ?? DEFAULT_OPTIONS.specularIntensity,
      applyRadius: opts.applyRadius ?? DEFAULT_OPTIONS.applyRadius,
      mapPixelRatio: opts.mapPixelRatio ?? DEFAULT_OPTIONS.mapPixelRatio,
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
      applyRadius: o.applyRadius,
      mapPixelRatio: o.mapPixelRatio,
    };
  }
}
