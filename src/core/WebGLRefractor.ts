/**
 * WebGLRefractor — cross-browser GPU refraction (Chrome / Safari / Firefox).
 *
 * Why: SVG-in-backdrop-filter is Chromium-only, and the DOM-clone fallback
 * re-aligns every box on every scroll frame (layout thrashing → jank). The
 * industry-standard cross-engine approach is a single shared WebGL canvas that
 * captures the backdrop scene ONCE into a texture, then for each glass box runs
 * a fragment shader that samples that texture with displaced UVs. Scrolling only
 * updates per-box uniforms — no re-capture, no per-frame layout writes — so it
 * stays smooth, and one GL context serves every box (no context-limit blowup).
 *
 * The displacement and specular maps are the SAME ones the Chromium path bakes,
 * uploaded as textures, so the lensing matches across browsers.
 *
 * Each registered element gets a child 2D <canvas> (its display surface); the
 * shared GL context renders a box then blits into that canvas. This keeps the
 * natural per-element stacking (no global z-index juggling) while sharing one
 * GL context.
 */

export interface RefractorBoxParams {
  /** Displacement map data URL (R/G encode the lens shift; same as Chromium). */
  displacementMapUrl: string;
  /** Padding (CSS px per side) baked into the displacement map. */
  displacementPadding: number;
  /** Specular map data URL, or null. */
  specularMapUrl: string | null;
  /** Lens strength in px (feDisplacementMap scale = 2 * refraction). */
  refraction: number;
  /** Backdrop blur stdDeviation in px. */
  blur: number;
  /** Chromatic aberration 0..1. */
  chromaticAberration: number;
  /** Saturation as a fraction (1 = neutral). */
  saturation: number;
}

interface BoxEntry {
  el: HTMLElement;
  surface: HTMLCanvasElement;
  ctx2d: CanvasRenderingContext2D;
  getParams: () => RefractorBoxParams;
  dispTex: WebGLTexture | null;
  specTex: WebGLTexture | null;
  dispUrl: string;
  specUrl: string | null;
}

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos;                       // 0..1 over the box
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}`;

// Samples the scene texture (a viewport-sized snapshot) at the box's on-screen
// position, displaced by the lens map, with chromatic split, a light frost
// blur, saturation and an additive specular rim. Alpha comes from the lens
// map's coverage so the rounded corners stay transparent.
const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_scene;     // viewport snapshot
uniform sampler2D u_disp;      // displacement map (padded)
uniform sampler2D u_spec;      // specular map
uniform bool  u_hasSpec;
uniform vec2  u_scene_px;      // scene texture size (px)
uniform vec2  u_box_origin;    // box top-left in scene px (viewport coords)
uniform vec2  u_box_size;      // box size px
uniform float u_pad;           // displacement padding px
uniform float u_refraction;    // px
uniform float u_blur;          // px
uniform float u_chroma;        // 0..1
uniform float u_sat;           // saturation fraction

vec3 sat(vec3 c, float s) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, s);
}

void main() {
  // The displacement map is padded by u_pad px per side; map box-uv → padded-uv.
  vec2 padFrac = u_pad / (u_box_size + 2.0 * u_pad);
  vec2 dispUv = mix(padFrac, 1.0 - padFrac, v_uv);
  vec4 d = texture(u_disp, dispUv);

  // Coverage: the lens map fills the rounded-rect interior with alpha 1.
  float cover = d.a;
  if (cover < 0.01) { outColor = vec4(0.0); return; }

  // Decode the encoded shift (128 = neutral) → px, then to scene-UV space.
  vec2 shift = (d.rg - 0.5078431) * 2.0;            // ~[-1,1]
  vec2 shiftPx = shift * u_refraction;
  vec2 sceneUv = (u_box_origin + v_uv * u_box_size + shiftPx) / u_scene_px;

  // Chromatic split along the shift direction.
  vec2 ca = shiftPx * u_chroma * 0.6 / u_scene_px;
  vec3 col;
  // Light frost: a small cross blur scaled by u_blur.
  vec2 b = vec2(u_blur) / u_scene_px;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = -2; i <= 2; i++) {
    float w = 1.0 - abs(float(i)) * 0.28;
    vec2 o = vec2(float(i)) * b * 0.6;
    acc.r += texture(u_scene, sceneUv + ca + o).r * w;
    acc.g += texture(u_scene, sceneUv + o).g * w;
    acc.b += texture(u_scene, sceneUv - ca + o).b * w;
    wsum += w;
  }
  col = acc / wsum;
  col = sat(col, u_sat);
  col *= 1.05;                                       // gentle "concentrates light"

  if (u_hasSpec) {
    vec3 s = texture(u_spec, v_uv).rgb * texture(u_spec, v_uv).a;
    col = 1.0 - (1.0 - col) * (1.0 - s);             // screen blend
  }
  outColor = vec4(col, cover);
}`;

let singleton: WebGLRefractor | null = null;

export function getWebGLRefractor(): WebGLRefractor | null {
  if (singleton) return singleton.usable ? singleton : null;
  singleton = new WebGLRefractor();
  return singleton.usable ? singleton : null;
}

export class WebGLRefractor {
  usable = false;
  private gl: WebGL2RenderingContext | null = null;
  private glCanvas: HTMLCanvasElement;
  private program: WebGLProgram | null = null;
  private uloc: Record<string, WebGLUniformLocation | null> = {};
  private sceneTex: WebGLTexture | null = null;
  private scenePx: [number, number] = [1, 1];
  private boxes = new Set<BoxEntry>();
  private rafPending = false;
  /** The refractor handles ONE shared scene; boxes asking for a different (or
   * non-uploadable) scene get null from register() and use the CSS fallback. */
  private boundScene: HTMLElement | null = null;

  constructor() {
    this.glCanvas = document.createElement('canvas');
    try {
      const gl = this.glCanvas.getContext('webgl2', {
        premultipliedAlpha: false,
        alpha: true,
        antialias: false,
        preserveDrawingBuffer: true, // so we can blit (drawImage) the result
      });
      if (!gl) return;
      this.gl = gl;
      if (!this.initProgram()) return;
      this.usable = true;
      window.addEventListener('scroll', this.onViewChange, { passive: true, capture: true });
      window.addEventListener('resize', () => this.recaptureScene(), { passive: true });
    } catch {
      /* WebGL2 unavailable → caller falls back */
    }
  }

  private initProgram(): boolean {
    const gl = this.gl!;
    const vs = this.compile(gl.VERTEX_SHADER, VERT);
    const fs = this.compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return false;
    this.program = p;
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of [
      'u_scene', 'u_disp', 'u_spec', 'u_hasSpec', 'u_scene_px', 'u_box_origin',
      'u_box_size', 'u_pad', 'u_refraction', 'u_blur', 'u_chroma', 'u_sat',
    ]) {
      this.uloc[n] = gl.getUniformLocation(p, n);
    }
    return true;
  }

  private compile(type: number, src: string): WebGLShader | null {
    const gl = this.gl!;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[liquid-glass] WebGL shader error:', gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }

  /** The directly-uploadable pixel source of a scene element, or null. A scene
   * must be a <canvas>/<img>/<video> — a DOM element would taint the GPU texture
   * in every browser (security), so WebGL rejects it. */
  private static sceneSource(el: HTMLElement): TexImageSource | null {
    if (el instanceof HTMLCanvasElement && el.width && el.height) return el;
    if (el instanceof HTMLImageElement && el.complete && el.naturalWidth) return el;
    if (el instanceof HTMLVideoElement && el.readyState >= 2) return el;
    return null;
  }

  /** Bind the shared scene (first uploadable scene wins). Returns false if the
   * scene isn't an uploadable source — the caller then uses the CSS fallback,
   * and the refractor stays usable for other boxes. */
  private bindScene(el: HTMLElement): boolean {
    const src = WebGLRefractor.sceneSource(el);
    if (!src) return false;
    this.boundScene = el;
    this.recaptureScene();
    return true;
  }

  /** Re-upload the bound scene's current pixels (call when it repaints/resizes). */
  recaptureScene(): void {
    if (!this.gl || !this.boundScene) return;
    const src = WebGLRefractor.sceneSource(this.boundScene);
    if (!src) return;
    // The scene element covers the viewport (fixed, inset:0); UV is normalised
    // over it, and box rects are CSS px, so map by viewport CSS size.
    const r = this.boundScene.getBoundingClientRect();
    this.scenePx = [
      Math.max(1, r.width || window.innerWidth),
      Math.max(1, r.height || window.innerHeight),
    ];
    this.sceneTex = this.uploadImage(src, this.sceneTex);
    this.requestRender();
  }

  private uploadImage(
    src: TexImageSource,
    reuse: WebGLTexture | null
  ): WebGLTexture | null {
    const gl = this.gl!;
    const tex = reuse ?? gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private uploadFromUrl(url: string, onReady: (tex: WebGLTexture | null) => void): void {
    const img = new Image();
    img.onload = () => { onReady(this.uploadImage(img, null)); this.requestRender(); };
    img.onerror = () => onReady(null);
    img.src = url;
  }

  register(
    el: HTMLElement,
    scene: HTMLElement,
    getParams: () => RefractorBoxParams
  ): { surface: HTMLCanvasElement; destroy: () => void; refresh: () => void } | null {
    if (!this.usable) return null;
    // One shared scene: bind the first uploadable one; reject others (they fall
    // back to the CSS path) without disabling the refractor.
    if (!this.boundScene) {
      if (!this.bindScene(scene)) return null;
    } else if (this.boundScene !== scene) {
      return null;
    }
    const surface = document.createElement('canvas');
    surface.setAttribute('aria-hidden', 'true');
    surface.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;border-radius:inherit;pointer-events:none;z-index:-1;';
    const ctx2d = surface.getContext('2d');
    if (!ctx2d) return null;

    const entry: BoxEntry = {
      el, surface, ctx2d, getParams,
      dispTex: null, specTex: null, dispUrl: '', specUrl: null,
    };
    this.boxes.add(entry);
    this.refreshTextures(entry);
    this.requestRender();

    return {
      surface,
      refresh: () => { this.refreshTextures(entry); this.requestRender(); },
      destroy: () => {
        this.boxes.delete(entry);
        const gl = this.gl;
        if (gl) {
          if (entry.dispTex) gl.deleteTexture(entry.dispTex);
          if (entry.specTex) gl.deleteTexture(entry.specTex);
        }
        surface.remove();
      },
    };
  }

  private refreshTextures(entry: BoxEntry): void {
    const p = entry.getParams();
    if (p.displacementMapUrl !== entry.dispUrl) {
      entry.dispUrl = p.displacementMapUrl;
      this.uploadFromUrl(p.displacementMapUrl, (t) => (entry.dispTex = t));
    }
    if (p.specularMapUrl !== entry.specUrl) {
      entry.specUrl = p.specularMapUrl;
      if (p.specularMapUrl) this.uploadFromUrl(p.specularMapUrl, (t) => (entry.specTex = t));
      else entry.specTex = null;
    }
  }

  private onViewChange = (): void => this.requestRender();
  /** Public hook so the app can refresh the texture after repainting the scene. */
  refreshScene(): void {
    this.recaptureScene();
  }

  requestRender(): void {
    if (this.rafPending || !this.usable) return;
    this.rafPending = true;
    requestAnimationFrame(() => { this.rafPending = false; this.render(); });
  }

  private render(): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.sceneTex) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(this.uloc.u_scene, 0);
    gl.uniform2f(this.uloc.u_scene_px, this.scenePx[0], this.scenePx[1]);

    // One render + blit per box. Rects are read in this single rAF pass.
    for (const e of this.boxes) {
      if (!e.dispTex) continue;
      const r = e.el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      if (this.glCanvas.width !== w || this.glCanvas.height !== h) {
        this.glCanvas.width = w;
        this.glCanvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const p = e.getParams();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, e.dispTex);
      gl.uniform1i(this.uloc.u_disp, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, e.specTex ?? e.dispTex);
      gl.uniform1i(this.uloc.u_spec, 2);
      gl.uniform1i(this.uloc.u_hasSpec, e.specTex ? 1 : 0);

      gl.uniform2f(this.uloc.u_box_origin, r.left, r.top);
      gl.uniform2f(this.uloc.u_box_size, r.width, r.height);
      gl.uniform1f(this.uloc.u_pad, p.displacementPadding);
      gl.uniform1f(this.uloc.u_refraction, p.refraction);
      gl.uniform1f(this.uloc.u_blur, p.blur);
      gl.uniform1f(this.uloc.u_chroma, p.chromaticAberration);
      gl.uniform1f(this.uloc.u_sat, p.saturation / 100);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Blit the GL result into the element's display canvas.
      if (e.surface.width !== w || e.surface.height !== h) {
        e.surface.width = w;
        e.surface.height = h;
      }
      e.ctx2d.clearRect(0, 0, w, h);
      e.ctx2d.drawImage(this.glCanvas, 0, 0);
    }
  }
}
