// src/studio/engine/chroma.ts
// Chroma keying (green/blue screen) in the spirit of OBS' chroma key filter.
//
//  - `chromaKeyPixels`  pure CPU implementation working in place on RGBA bytes.
//  - `ChromaProcessor`  picks a WebGL2 fragment-shader path (single draw, premultiplied output) and
//                       falls back to the CPU path automatically; `backend` tells which one is live.
//
// Math (identical in the shader and on the CPU):
//   cbcr(c)    = BT.601 full-range (Cb, Cr) of the colour, each in [-0.5, 0.5]
//   dist       = |cbcr(pixel) - cbcr(key)|                 (brightness independent)
//   base       = dist - similarity
//   alpha     *= smoothstep(0, smoothness, base)           (0 inside `similarity`, 1 past the ramp)
//   spillT     = clamp(base / spill, 0, 1) ^ 1.5
//   rgb        = mix(luma(rgb), rgb, spillT)               (desaturates pixels that are still
//                                                           close to the key colour)
// `similarity`, `smoothness` and `spill` are in the same CbCr-distance units as the UI sliders
// (defaults 0.4 / 0.08 / 0.1 like OBS' 400 / 80 / 100). No DOM access happens at import time.

import type { ChromaKey, Rect } from "../types";

/* ------------------------------------------------------------------ */
/* Errors & canvas helpers                                             */
/* ------------------------------------------------------------------ */

export type ChromaErrorCode =
  | "chroma-no-canvas"
  | "chroma-gl-unavailable"
  | "chroma-gl-failed"
  | "chroma-cpu-failed";

/** Typed error with a stable `code`; the processor stores the last one in `lastError`. */
export class ChromaError extends Error {
  readonly code: ChromaErrorCode;
  constructor(code: ChromaErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ChromaError";
    this.code = code;
  }
}

export type ScratchCanvas = HTMLCanvasElement | OffscreenCanvas;

/**
 * Creates an off-screen canvas of the given size: an OffscreenCanvas when the platform has one,
 * otherwise a detached `<canvas>`. Throws ChromaError("chroma-no-canvas") when neither exists
 * (SSR / very old browsers).
 */
export function createScratchCanvas(
  width: number,
  height: number,
): ScratchCanvas {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  throw new ChromaError(
    "chroma-no-canvas",
    "No canvas implementation available",
  );
}

/** `getContext` on the HTMLCanvasElement | OffscreenCanvas union has no common overload set. */
function getContextOf(
  canvas: ScratchCanvas,
  type: string,
  attrs?: object,
): unknown {
  return (
    canvas as unknown as { getContext(t: string, a?: object): unknown }
  ).getContext(type, attrs);
}

/* ------------------------------------------------------------------ */
/* Parameters                                                          */
/* ------------------------------------------------------------------ */

export type RGB = readonly [number, number, number];

export interface ChromaKeyParams {
  /** Key colour as 0..255 channels. */
  key: RGB;
  /** 0..1: chroma distance that is fully transparent. */
  similarity: number;
  /** 0..1: width of the soft alpha ramp beyond `similarity`. */
  smoothness: number;
  /** 0..1: width of the desaturation zone beyond `similarity` (0 disables spill suppression). */
  spill: number;
}

const GREEN: RGB = [0, 255, 0];
const BLUE: RGB = [0, 0, 255];
/** Below this a range is treated as 0 (hard edge / no spill) to avoid dividing by ~0. */
const MIN_RANGE = 1e-6;

/**
 * Parses a key colour: "green" -> (0,255,0), "blue" -> (0,0,255), "#rgb" / "#rrggbb" / "#rrggbbaa"
 * (alpha ignored). Anything else (including non-strings) falls back to green.
 */
export function parseKeyColor(key: "green" | "blue" | string): RGB {
  if (typeof key !== "string") return GREEN;
  const k = key.trim().toLowerCase();
  if (k === "green") return GREEN;
  if (k === "blue") return BLUE;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(k);
  const hex = m?.[1];
  if (!hex) return GREEN;
  if (hex.length === 3) {
    const [r, g, b] = [...hex].map((c) => parseInt(c + c, 16)) as [
      number,
      number,
      number,
    ];
    return [r, g, b];
  }
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function unit(v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function channel(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Clamps every field into its valid range (NaN falls back to the OBS-like defaults). */
export function normalizeChromaParams(p: ChromaKeyParams): ChromaKeyParams {
  return {
    key: [channel(p.key[0]), channel(p.key[1]), channel(p.key[2])],
    similarity: unit(p.similarity, 0.4),
    smoothness: unit(p.smoothness, 0.08),
    spill: unit(p.spill, 0.1),
  };
}

/** Converts a layer's persisted ChromaKey settings into processor parameters. */
export function chromaParamsFromLayer(ck: ChromaKey): ChromaKeyParams {
  return normalizeChromaParams({
    key: parseKeyColor(ck.key),
    similarity: ck.similarity,
    smoothness: ck.smoothness,
    spill: ck.spill,
  });
}

/* ------------------------------------------------------------------ */
/* CPU implementation                                                  */
/* ------------------------------------------------------------------ */

// BT.601 full-range chroma, with the 1/255 channel normalisation folded in.
const CB_R = -0.168736 / 255;
const CB_G = -0.331264 / 255;
const CB_B = 0.5 / 255;
const CR_R = 0.5 / 255;
const CR_G = -0.418688 / 255;
const CR_B = -0.081312 / 255;

/** (Cb, Cr) of an 8-bit RGB colour, each within [-0.5, 0.5]. */
export function rgbToCbCr(r: number, g: number, b: number): [number, number] {
  return [CB_R * r + CB_G * g + CB_B * b, CR_R * r + CR_G * g + CR_B * b];
}

/** Chroma distance between two 8-bit RGB colours (the metric `similarity` is measured in). */
export function chromaDistance(a: RGB, b: RGB): number {
  const [acb, acr] = rgbToCbCr(a[0], a[1], a[2]);
  const [bcb, bcr] = rgbToCbCr(b[0], b[1], b[2]);
  return Math.hypot(acb - bcb, acr - bcr);
}

/**
 * Keys `data` (RGBA bytes, non-premultiplied, e.g. ImageData.data) IN PLACE: alpha is reduced
 * towards 0 for pixels close to the key colour, then pixels still near the key are desaturated
 * (spill suppression). Pixels farther than `similarity + max(smoothness, spill)` are skipped
 * after one distance computation, so a typical frame is mostly cheap comparisons. A trailing
 * partial pixel is ignored.
 */
export function chromaKeyPixels(
  data: Uint8ClampedArray,
  params: ChromaKeyParams,
): void {
  const p = normalizeChromaParams(params);
  const [kcb, kcr] = rgbToCbCr(p.key[0], p.key[1], p.key[2]);
  const sim = p.similarity;
  const smooth = p.smoothness;
  const spill = p.spill;
  const hard = smooth <= MIN_RANGE;
  const hasSpill = spill > MIN_RANGE;
  // Beyond this distance the pixel is guaranteed to be left untouched.
  const reach = sim + Math.max(hard ? 0 : smooth, hasSpill ? spill : 0);
  const end = data.length - (data.length % 4);

  for (let i = 0; i < end; i += 4) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    const dcb = CB_R * r + CB_G * g + CB_B * b - kcb;
    const dcr = CR_R * r + CR_G * g + CR_B * b - kcr;
    const dist = Math.sqrt(dcb * dcb + dcr * dcr);
    if (dist >= reach) continue;

    const base = dist - sim;
    let factor = 1;
    if (hard) {
      factor = base > 0 ? 1 : 0;
    } else if (base < smooth) {
      const t = base <= 0 ? 0 : base / smooth;
      factor = t * t * (3 - 2 * t);
    }
    if (factor === 0) {
      data[i + 3] = 0;
      continue;
    }
    if (factor < 1) data[i + 3] = (data[i + 3] as number) * factor;

    if (hasSpill && base < spill) {
      const t = base <= 0 ? 0 : base / spill;
      const sv = t * Math.sqrt(t); // t ^ 1.5
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      data[i] = luma + (r - luma) * sv;
      data[i + 1] = luma + (g - luma) * sv;
      data[i + 2] = luma + (b - luma) * sv;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Raster sizing                                                       */
/* ------------------------------------------------------------------ */

/**
 * Size of the keyed raster for a requested output size: the aspect ratio is kept and the result
 * is shrunk so that `w * h <= maxPixels` and `max(w, h) <= maxEdge`. Never smaller than 1x1.
 */
export function fitRaster(
  width: number,
  height: number,
  maxPixels: number,
  maxEdge: number,
): { w: number; h: number } {
  const rw = Number.isFinite(width) ? Math.max(1, width) : 1;
  const rh = Number.isFinite(height) ? Math.max(1, height) : 1;
  let scale = 1;
  if (rw * rh > maxPixels)
    scale = Math.min(scale, Math.sqrt(maxPixels / (rw * rh)));
  if (Math.max(rw, rh) > maxEdge)
    scale = Math.min(scale, maxEdge / Math.max(rw, rh));
  return {
    w: Math.max(1, Math.floor(rw * scale)),
    h: Math.max(1, Math.floor(rh * scale)),
  };
}

/* ------------------------------------------------------------------ */
/* ChromaProcessor                                                     */
/* ------------------------------------------------------------------ */

export type ChromaBackend = "webgl2" | "cpu";

/** Result of a keying pass. The object is reused: read it before the next `process` call. */
export interface ChromaResult {
  /** Canvas holding the keyed pixels (premultiplied on the GPU path; both draw correctly). */
  image: CanvasImageSource;
  width: number;
  height: number;
}

/** What the compositor needs from a keyer (lets tests inject a fake). */
export interface ChromaEngine {
  readonly backend: ChromaBackend;
  /**
   * Draws the `crop` region (source pixels) of `source` into a raster of about `outW x outH`
   * pixels and keys it. `layerId` selects the per-layer scratch state. Returns null if keying
   * is impossible right now (the caller should draw the source unkeyed).
   */
  process(
    layerId: string,
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    crop: Rect,
    outW: number,
    outH: number,
    params: ChromaKeyParams,
  ): ChromaResult | null;
  /** Frees scratch state of every layer id not in `activeIds`. */
  prune(activeIds: ReadonlySet<string>): void;
  dispose(): void;
}

export interface ChromaProcessorOptions {
  /** Try WebGL2 first. Default true. */
  preferGpu?: boolean;
  /** Pixel budget of the CPU raster (the result is upscaled when drawn). Default 960x540. */
  maxCpuPixels?: number;
  /** Largest raster edge on the GPU path. Default 2048. */
  maxGpuEdge?: number;
  /** Max simultaneously cached CPU layer scratch entries. Default 16. */
  maxEntries?: number;
  /** Canvas factory override (tests / workers). Defaults to `createScratchCanvas`. */
  createCanvas?: (w: number, h: number) => ScratchCanvas;
}

interface CpuEntry {
  canvas: ScratchCanvas;
  ctx: CanvasRenderingContext2D;
  result: ChromaResult;
  usedAt: number;
}

interface GlState {
  canvas: ScratchCanvas;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
  uKey: WebGLUniformLocation | null;
  uParams: WebGLUniformLocation | null;
  uCrop: WebGLUniformLocation | null;
  result: ChromaResult;
  /** Whether the texture currently samples with mipmaps (used for strong downscales). */
  mip: boolean;
}

const VERTEX_SRC = `#version 300 es
out vec2 v_uv;
void main() {
  // One oversized triangle covers the viewport: (0,0) (2,0) (0,2).
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_key;     // Cb, Cr of the key colour
uniform vec3 u_params;  // similarity, smoothness, spill
uniform vec4 u_crop;    // x, y, w, h of the source region, normalised, top-left origin
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec2 uv = u_crop.xy + vec2(v_uv.x, 1.0 - v_uv.y) * u_crop.zw;
  vec4 c = texture(u_tex, uv);
  float cb = dot(c.rgb, vec3(-0.168736, -0.331264, 0.5));
  float cr = dot(c.rgb, vec3(0.5, -0.418688, -0.081312));
  float base = distance(vec2(cb, cr), u_key) - u_params.x;
  float k = u_params.y > 0.000001 ? smoothstep(0.0, u_params.y, base) : (base > 0.0 ? 1.0 : 0.0);
  float sv = u_params.z > 0.000001 ? pow(clamp(base / u_params.z, 0.0, 1.0), 1.5) : 1.0;
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float a = c.a * k;
  outColor = vec4(mix(vec3(luma), c.rgb, sv) * a, a);
}`;

/** Source-to-raster size ratio above which the GPU path samples through mipmaps. */
const MIPMAP_RATIO = 1.5;
const DEFAULT_MAX_CPU_PIXELS = 960 * 540;
const DEFAULT_MAX_GPU_EDGE = 2048;
const DEFAULT_MAX_ENTRIES = 16;
/** After this many consecutive GPU failures the processor stays on the CPU path. */
const MAX_GL_FAILURES = 3;

/**
 * Keys video/image sources for the compositor. One instance is shared by all layers of a
 * compositor: the GPU path uses a single WebGL2 context, the CPU path keeps one reusable
 * canvas per layer id. Initialisation is lazy, so constructing it never touches the DOM.
 */
export class ChromaProcessor implements ChromaEngine {
  private readonly preferGpu: boolean;
  private readonly maxCpuPixels: number;
  private readonly maxGpuEdge: number;
  private readonly maxEntries: number;
  private readonly makeCanvas: (w: number, h: number) => ScratchCanvas;
  private readonly cpu = new Map<string, CpuEntry>();
  private gl: GlState | null = null;
  private initialized = false;
  private glFailures = 0;
  private tick = 0;
  private disposed = false;
  private lastErr: ChromaError | null = null;

  constructor(opts: ChromaProcessorOptions = {}) {
    this.preferGpu = opts.preferGpu ?? true;
    this.maxCpuPixels = Math.max(
      1,
      opts.maxCpuPixels ?? DEFAULT_MAX_CPU_PIXELS,
    );
    this.maxGpuEdge = Math.max(1, opts.maxGpuEdge ?? DEFAULT_MAX_GPU_EDGE);
    this.maxEntries = Math.max(1, opts.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.makeCanvas = opts.createCanvas ?? createScratchCanvas;
  }

  /** The path currently in use. Accessing it triggers the (one-time) backend selection. */
  get backend(): ChromaBackend {
    this.ensureInit();
    return this.gl ? "webgl2" : "cpu";
  }

  /** The most recent non-fatal problem (e.g. why WebGL2 was not used), or null. */
  get lastError(): ChromaError | null {
    return this.lastErr;
  }

  process(
    layerId: string,
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    crop: Rect,
    outW: number,
    outH: number,
    params: ChromaKeyParams,
  ): ChromaResult | null {
    if (this.disposed) return null;
    if (!(srcW > 0) || !(srcH > 0) || !(outW > 0) || !(outH > 0)) return null;
    this.ensureInit();
    const region = sanitizeCrop(crop, srcW, srcH);
    if (this.gl) {
      const out = this.processGpu(
        this.gl,
        source,
        srcW,
        srcH,
        region,
        outW,
        outH,
        params,
      );
      if (out) return out;
      // GPU hiccup (lost context, unsupported source type...): key this frame on the CPU instead.
    }
    return this.processCpu(layerId, source, region, outW, outH, params);
  }

  /** Drops scratch state of layers that are gone. */
  prune(activeIds: ReadonlySet<string>): void {
    for (const id of [...this.cpu.keys()])
      if (!activeIds.has(id)) this.release(id);
  }

  /** Drops the scratch state of one layer. */
  release(layerId: string): void {
    const e = this.cpu.get(layerId);
    if (!e) return;
    // Shrinking the backing store hints the browser to free it right away.
    e.canvas.width = 1;
    e.canvas.height = 1;
    this.cpu.delete(layerId);
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.cpu.keys()]) this.release(id);
    this.destroyGl();
  }

  /* ----------------------------- init ------------------------------ */

  private ensureInit(): void {
    if (this.initialized || this.disposed) return;
    this.initialized = true;
    if (this.preferGpu) this.initGl();
  }

  private initGl(): void {
    try {
      this.gl = this.createGlState();
    } catch (e) {
      this.gl = null;
      this.lastErr =
        e instanceof ChromaError
          ? e
          : new ChromaError("chroma-gl-failed", describeError(e));
    }
  }

  private createGlState(): GlState {
    const canvas = this.makeCanvas(1, 1);
    const gl = getContextOf(canvas, "webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
      // A software rasteriser is slower than the CPU path, so treat it as "no WebGL2".
      failIfMajorPerformanceCaveat: true,
    }) as WebGL2RenderingContext | null;
    if (!gl)
      throw new ChromaError("chroma-gl-unavailable", "WebGL2 is not available");

    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type);
      if (!sh) throw new ChromaError("chroma-gl-failed", "createShader failed");
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh) ?? "";
        gl.deleteShader(sh);
        throw new ChromaError(
          "chroma-gl-failed",
          `Shader compile failed: ${log}`,
        );
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    const program = gl.createProgram();
    if (!program)
      throw new ChromaError("chroma-gl-failed", "createProgram failed");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? "";
      gl.deleteProgram(program);
      throw new ChromaError("chroma-gl-failed", `Program link failed: ${log}`);
    }
    const texture = gl.createTexture();
    if (!texture)
      throw new ChromaError("chroma-gl-failed", "createTexture failed");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "u_tex"), 0);
    gl.disable(gl.BLEND);

    const onLost = (ev: Event): void => {
      ev.preventDefault(); // allows the browser to fire "webglcontextrestored"
      this.gl = null;
      this.lastErr = new ChromaError("chroma-gl-failed", "WebGL context lost");
    };
    const onRestored = (): void => {
      if (!this.disposed && this.preferGpu) this.initGl();
    };
    const target = canvas as unknown as EventTarget;
    target.addEventListener("webglcontextlost", onLost);
    target.addEventListener("webglcontextrestored", onRestored);

    return {
      canvas,
      gl,
      program,
      texture,
      uKey: gl.getUniformLocation(program, "u_key"),
      uParams: gl.getUniformLocation(program, "u_params"),
      uCrop: gl.getUniformLocation(program, "u_crop"),
      result: { image: canvas, width: 1, height: 1 },
      mip: false,
    };
  }

  private destroyGl(): void {
    const s = this.gl;
    this.gl = null;
    if (!s) return;
    try {
      s.gl.deleteTexture(s.texture);
      s.gl.deleteProgram(s.program);
      s.gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* context already gone */
    }
  }

  /* ----------------------------- GPU ------------------------------- */

  private processGpu(
    s: GlState,
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    crop: Rect,
    outW: number,
    outH: number,
    params: ChromaKeyParams,
  ): ChromaResult | null {
    const { gl } = s;
    try {
      if (gl.isContextLost()) return null;
      const size = fitRaster(outW, outH, Infinity, this.maxGpuEdge);
      if (s.canvas.width !== size.w || s.canvas.height !== size.h) {
        s.canvas.width = size.w;
        s.canvas.height = size.h;
      }
      const p = normalizeChromaParams(params);
      const [kcb, kcr] = rgbToCbCr(p.key[0], p.key[1], p.key[2]);
      gl.viewport(0, 0, size.w, size.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, s.texture);
      // Plain bilinear shimmers when a 1080p source is shrunk a lot (small picture-in-picture),
      // so use mipmaps once the raster is clearly smaller than the cropped source.
      const wantMip =
        crop.w > size.w * MIPMAP_RATIO || crop.h > size.h * MIPMAP_RATIO;
      if (wantMip !== s.mip) {
        const min = wantMip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
        s.mip = wantMip;
      }
      // CanvasImageSource is a superset of TexImageSource (it also admits SVGImageElement,
      // which makes texImage2D throw; that is caught below and demotes us to the CPU path).
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source as TexImageSource,
      );
      if (wantMip) gl.generateMipmap(gl.TEXTURE_2D);
      gl.useProgram(s.program);
      gl.uniform2f(s.uKey, kcb, kcr);
      gl.uniform3f(s.uParams, p.similarity, p.smoothness, p.spill);
      gl.uniform4f(
        s.uCrop,
        crop.x / srcW,
        crop.y / srcH,
        crop.w / srcW,
        crop.h / srcH,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.glFailures = 0;
      s.result.width = size.w;
      s.result.height = size.h;
      return s.result;
    } catch (e) {
      this.glFailures++;
      this.lastErr = new ChromaError("chroma-gl-failed", describeError(e));
      if (this.glFailures >= MAX_GL_FAILURES) this.destroyGl(); // permanent demotion to CPU
      return null;
    }
  }

  /* ----------------------------- CPU ------------------------------- */

  private processCpu(
    layerId: string,
    source: CanvasImageSource,
    crop: Rect,
    outW: number,
    outH: number,
    params: ChromaKeyParams,
  ): ChromaResult | null {
    const size = fitRaster(
      outW,
      outH,
      this.maxCpuPixels,
      Number.MAX_SAFE_INTEGER,
    );
    const entry = this.cpuEntry(layerId, size.w, size.h);
    if (!entry) return null;
    const { ctx } = entry;
    try {
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.drawImage(
        source,
        crop.x,
        crop.y,
        crop.w,
        crop.h,
        0,
        0,
        size.w,
        size.h,
      );
      // getImageData allocates a fresh buffer on every platform (there is no read-into API);
      // the reduced raster keeps that cost small. A tainted canvas throws SecurityError.
      const img = ctx.getImageData(0, 0, size.w, size.h);
      chromaKeyPixels(img.data, params);
      ctx.putImageData(img, 0, 0);
    } catch (e) {
      this.lastErr = new ChromaError("chroma-cpu-failed", describeError(e));
      return null;
    }
    entry.result.width = size.w;
    entry.result.height = size.h;
    return entry.result;
  }

  private cpuEntry(layerId: string, w: number, h: number): CpuEntry | null {
    let entry = this.cpu.get(layerId);
    if (!entry) {
      try {
        const canvas = this.makeCanvas(w, h);
        const ctx = getContextOf(canvas, "2d", {
          willReadFrequently: true,
        }) as CanvasRenderingContext2D | null;
        if (!ctx)
          throw new ChromaError("chroma-no-canvas", "2D context unavailable");
        entry = {
          canvas,
          ctx,
          result: { image: canvas, width: w, height: h },
          usedAt: 0,
        };
      } catch (e) {
        this.lastErr =
          e instanceof ChromaError
            ? e
            : new ChromaError("chroma-no-canvas", describeError(e));
        return null;
      }
      this.cpu.set(layerId, entry);
      this.evictOverflow(layerId);
    }
    entry.usedAt = ++this.tick;
    if (entry.canvas.width !== w || entry.canvas.height !== h) {
      entry.canvas.width = w;
      entry.canvas.height = h;
    }
    return entry;
  }

  private evictOverflow(keepId: string): void {
    while (this.cpu.size > this.maxEntries) {
      let oldestId: string | null = null;
      let oldest = Infinity;
      for (const [id, e] of this.cpu) {
        if (id !== keepId && e.usedAt < oldest) {
          oldest = e.usedAt;
          oldestId = id;
        }
      }
      if (oldestId === null) return;
      this.release(oldestId);
    }
  }
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Clamps a crop rect into the source; invalid rects become the whole source. */
function sanitizeCrop(crop: Rect, srcW: number, srcH: number): Rect {
  const ok =
    Number.isFinite(crop.x) &&
    Number.isFinite(crop.y) &&
    Number.isFinite(crop.w) &&
    Number.isFinite(crop.h) &&
    crop.w > 0 &&
    crop.h > 0;
  if (!ok) return { x: 0, y: 0, w: srcW, h: srcH };
  const x = Math.min(Math.max(0, crop.x), srcW - 1e-3);
  const y = Math.min(Math.max(0, crop.y), srcH - 1e-3);
  return { x, y, w: Math.min(crop.w, srcW - x), h: Math.min(crop.h, srcH - y) };
}
