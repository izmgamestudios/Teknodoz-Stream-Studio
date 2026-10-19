// src/studio/engine/compositor.ts
// The 1080p60 canvas compositor. It paints a Scene (bottom -> top layers) onto a canvas, scales the
// logical 1920x1080 stage to the real output size, applies per-layer transform / opacity / blend /
// filter / mirror / chroma key, and runs scene transitions. It never touches getUserMedia, IndexedDB,
// WebRTC, the prompter or the DOM beyond the canvas it is given: pixel sources and special drawing
// come through `CompositorHooks`.
//
// Drawing model: for every layer the context is saved, then
//   globalAlpha = opacity/100, globalCompositeOperation = blend, filter = layer.filter, and a
//   translate+rotate around the box centre are applied, so everything drawn at the layer's OUTPUT
//   box (`logical * scale`) ends up rotated. Hooks receive that box and a ready-made context state.
//
// Frame pacing lives in ticker.ts (rAF while visible, worker timer while hidden); this class only
// calls `renderOnce(nowMs)` for every accepted tick.

import {
  LOGICAL_H,
  LOGICAL_W,
  type CompositorHooks,
  type FrameSource,
  type Layer,
  type Rect,
  type Scene,
  type ShapeLayer,
  type TextLayer,
  type Transition,
  type TransitionType,
  type WebLayer,
} from "../types";
import { stageFor, type StageSize } from "../format";
import { hasFx } from "./adjust";
import { resolveBlend, sanitizeCssFilter } from "./blend";
import { FxProcessor, type FxEngine } from "./fx";
import {
  glName,
  isGlTransition,
  type TransitionEngine,
} from "./gl-transitions";
import {
  ChromaProcessor,
  chromaParamsFromLayer,
  createScratchCanvas,
  type ChromaBackend,
  type ChromaEngine,
  type ChromaKeyParams,
  type ScratchCanvas,
} from "./chroma";
import {
  FrameStats,
  clampFps,
  createTicker,
  type Ticker,
  type TickerEnv,
} from "./ticker";
import {
  clamp,
  clamp01,
  computeStageFit,
  containRect,
  coverSourceRect,
  degToRad,
  type StageFit,
} from "./transform";

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export interface CompositorOptions {
  /** Output canvas width in px (the logical 1920x1080 stage is scaled to fit). */
  width: number;
  height: number;
  /** Target frame rate of `start()` (1..240). */
  fps: number;
  /** Chroma keyer override (tests). Defaults to a lazily created ChromaProcessor. */
  chroma?: ChromaEngine;
  /** Scratch canvas factory override (tests). Used for the fade buffer and the chroma keyer. */
  createCanvas?: (width: number, height: number) => ScratchCanvas;
  /** Platform override for the frame ticker (tests). */
  tickerEnv?: TickerEnv;
}

export interface CompositorStats {
  /** Measured frames per second over the last half second. */
  fps: number;
  /** Smoothed time spent rendering one frame, in ms. */
  frameMs: number;
  /** Frames the scheduler had to skip since `start()`/construction. */
  droppedFrames: number;
}

/** Called after every rendered frame with the timestamp that was passed to `renderOnce`. */
export type FrameListener = (nowMs: number) => void;

export type CompositorErrorCode = "compositor-no-context";

/** Typed error with a stable `code`. */
export class CompositorError extends Error {
  readonly code: CompositorErrorCode;
  constructor(code: CompositorErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CompositorError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Transition math (pure)                                              */
/* ------------------------------------------------------------------ */

/** Longest transition accepted; longer requests are clamped. */
export const MAX_TRANSITION_MS = 10_000;

/** Cubic ease-in-out on [0,1]; input is clamped, NaN counts as 0. */
export function easeInOut(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Linear progress in [0,1] of a transition that started `elapsedMs` ago. Zero duration -> 1. */
export function transitionProgress(
  elapsedMs: number,
  durationMs: number,
): number {
  if (!(durationMs > 0)) return 1;
  return clamp01(elapsedMs / durationMs);
}

/**
 * Horizontal offset of the INCOMING scene during a slide: `extent` (fully off to the right) at
 * progress 0, easing to 0 at progress 1.
 */
export function slideOffset(progress: number, extent: number): number {
  return (1 - easeInOut(progress)) * extent;
}

/**
 * Opacity of the incoming scene drawn over the outgoing one: eased progress for "fade", fully
 * opaque for "slide" (it moves instead) and "cut".
 */
export function transitionAlpha(
  type: TransitionType,
  progress: number,
): number {
  return type === "fade" ? easeInOut(progress) : 1;
}

/** Clamps a requested duration to [0, MAX_TRANSITION_MS]; non-finite -> 0. */
export function sanitizeTransitionMs(ms: number): number {
  return Number.isFinite(ms) ? clamp(ms, 0, MAX_TRANSITION_MS) : 0;
}

/* ------------------------------------------------------------------ */
/* Text helpers (pure)                                                 */
/* ------------------------------------------------------------------ */

const MAX_TEXT_CHARS = 2000;
const MAX_TEXT_LINES = 40;

/**
 * Greedy word wrap. `measure` returns the rendered width of a string. Explicit newlines are
 * honoured (blank lines are kept), words wider than `maxWidth` are split by character, and at
 * most `maxLines` lines are returned. A non-positive `maxWidth` disables wrapping.
 */
export function wrapText(
  measure: (s: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number = MAX_TEXT_LINES,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    if (lines.length >= maxLines) break;
    if (!(maxWidth > 0) || paragraph === "") {
      lines.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (word === "") continue;
      const candidate = line === "" ? word : `${line} ${word}`;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line !== "") {
        lines.push(line);
        line = "";
        if (lines.length >= maxLines) break;
      }
      if (measure(word) <= maxWidth) {
        line = word;
        continue;
      }
      // Single word too wide: break it per code point.
      for (const ch of word) {
        if (line !== "" && measure(line + ch) > maxWidth) {
          lines.push(line);
          line = "";
          if (lines.length >= maxLines) break;
        }
        line += ch;
      }
    }
    if (line !== "" && lines.length < maxLines) lines.push(line);
  }
  return lines;
}

/**
 * Horizontal shift of a looping marquee: `0` at t=0, decreasing at `speedPxPerSec` and wrapping
 * every `period` px, so the result is always in (-period, 0]. Deterministic in `nowMs`.
 */
export function marqueeOffset(
  nowMs: number,
  speedPxPerSec: number,
  period: number,
): number {
  if (
    !(period > 0) ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(speedPxPerSec)
  )
    return 0;
  const travelled = (nowMs / 1000) * speedPxPerSec;
  const wrapped = ((travelled % period) + period) % period;
  return wrapped === 0 ? 0 : -wrapped;
}

/* ------------------------------------------------------------------ */
/* Small drawing helpers                                               */
/* ------------------------------------------------------------------ */

type Ctx2D = CanvasRenderingContext2D;
type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

const TAU = Math.PI * 2;
const MIN_DIM = 16;
const MAX_DIM = 7680;
const DEFAULT_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const ACCENT = "#e0483c";
/** Logical px per second of the ticker marquee. */
const TICKER_SPEED = 140;

function perfNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function clampDim(v: number, fallback: number): number {
  return Number.isFinite(v) ? clamp(Math.round(v), MIN_DIM, MAX_DIM) : fallback;
}

/** `getContext` on the HTMLCanvasElement | OffscreenCanvas union has no common overload set. */
function get2d(canvas: CanvasLike): Ctx2D | null {
  const getContext = (
    canvas as unknown as { getContext(t: string, a?: object): unknown }
  ).getContext;
  // The OffscreenCanvas 2D context is API-compatible with the DOM one for everything used here.
  return (
    (getContext.call(canvas, "2d", { alpha: false }) as Ctx2D | null) ?? null
  );
}

function configureContext(ctx: Ctx2D): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
}

function isDrawableBox(t: {
  x: number;
  y: number;
  w: number;
  h: number;
}): boolean {
  return (
    Number.isFinite(t.x) &&
    Number.isFinite(t.y) &&
    Number.isFinite(t.w) &&
    Number.isFinite(t.h) &&
    t.w > 0 &&
    t.h > 0
  );
}

function isTransparentColor(c: string): boolean {
  return c === "" || c === "transparent" || c === "none";
}

/** Begins a new path containing a rounded rectangle (radius clamped to the half-extents). */
function roundedRectPath(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (rr < 0.01) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function fontString(layer: TextLayer, px: number): string {
  const family =
    layer.fontFamily.trim() === "" ? DEFAULT_FONT : layer.fontFamily;
  return `${layer.bold ? "700" : "400"} ${px.toFixed(2)}px ${family}`;
}

interface TextLayout {
  key: string;
  lines: string[];
  /** Widest line (or the whole marquee string), in the font's px. */
  width: number;
  fontPx: number;
}

interface ActiveTransition {
  to: Scene;
  type: TransitionType;
  ms: number;
  /** Timestamp of the first frame rendered for this transition (null until then). */
  startMs: number | null;
  progress: number;
}

interface ChromaParamsEntry {
  key: string;
  similarity: number;
  smoothness: number;
  spill: number;
  params: ChromaKeyParams;
}

/* ------------------------------------------------------------------ */
/* Compositor                                                          */
/* ------------------------------------------------------------------ */

/**
 * Canvas compositor. Typical use:
 *
 * ```ts
 * const comp = new Compositor(canvas, hooks, { width: 1920, height: 1080, fps: 60 });
 * comp.setScene(scene);
 * comp.start();                                   // rAF while visible, worker timer when hidden
 * comp.transitionTo(otherScene, { type: "fade", ms: 400 });
 * ```
 */
export class Compositor {
  private readonly canvas: CanvasLike;
  private readonly ctx: Ctx2D;
  private readonly hooks: CompositorHooks;
  private readonly makeCanvas: (w: number, h: number) => ScratchCanvas;
  private readonly tickerEnv: TickerEnv | undefined;
  private readonly ownsChroma: boolean;
  private chroma: ChromaEngine | null;

  private widthPx: number;
  private heightPx: number;
  private fit: StageFit;
  private fpsTarget: number;
  private readonly supportsFilter: boolean;

  private scene: Scene | null = null;
  private transition: ActiveTransition | null = null;
  private fx: FxEngine | null = null;
  /** logical stage (follows the output aspect: 1920x1080, 1080x1920, 1080x1080...) */
  private stage: StageSize = { w: LOGICAL_W, h: LOGICAL_H };
  private glEngine: TransitionEngine | null = null;
  private glLoading = false;
  private glFailed = false;
  private queued: { scene: Scene; transition: Transition } | null = null;

  private ticker: Ticker | null = null;
  private readonly stats = new FrameStats();
  private readonly listeners = new Set<FrameListener>();
  private disposed = false;

  private fadeBuffer: { canvas: ScratchCanvas; ctx: Ctx2D } | null = null;
  private readonly textCache = new Map<string, TextLayout>();
  private readonly chromaParams = new Map<string, ChromaParamsEntry>();
  private readonly warned = new Set<string>();
  private errors = 0;

  constructor(
    canvas: CanvasLike,
    hooks: CompositorHooks,
    opts: CompositorOptions,
  ) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.makeCanvas = opts.createCanvas ?? createScratchCanvas;
    this.tickerEnv = opts.tickerEnv;
    this.chroma = opts.chroma ?? null;
    this.ownsChroma = opts.chroma === undefined;
    this.fpsTarget = clampFps(opts.fps);
    this.widthPx = clampDim(opts.width, LOGICAL_W);
    this.heightPx = clampDim(opts.height, LOGICAL_H);
    // Resizing a canvas resets its context, so size first and configure afterwards.
    if (canvas.width !== this.widthPx) canvas.width = this.widthPx;
    if (canvas.height !== this.heightPx) canvas.height = this.heightPx;
    const ctx = get2d(canvas);
    if (!ctx) {
      throw new CompositorError(
        "compositor-no-context",
        "2D canvas context is not available",
      );
    }
    this.ctx = ctx;
    configureContext(ctx);
    // `ctx.filter` is missing in some browsers (Safari); feature-detect instead of assuming.
    this.supportsFilter =
      typeof (ctx as { filter?: unknown }).filter === "string";
    this.stage = stageFor(this.widthPx, this.heightPx);
    this.fit = computeStageFit(
      this.widthPx,
      this.heightPx,
      this.stage.w,
      this.stage.h,
    );
  }

  /* ------------------------------ state ------------------------------ */

  get width(): number {
    return this.widthPx;
  }

  get height(): number {
    return this.heightPx;
  }

  /** The scene currently shown (the OUTGOING scene while a transition runs). */
  get currentScene(): Scene | null {
    return this.scene;
  }

  get isTransitioning(): boolean {
    return this.transition !== null;
  }

  get running(): boolean {
    return this.ticker?.running ?? false;
  }

  /** Number of layer draws that threw (hooks or sources misbehaving); the frame still completes. */
  get layerErrorCount(): number {
    return this.errors;
  }

  /** Which keying path the compositor is using, or null until a chroma layer was drawn. */
  get chromaBackend(): ChromaBackend | null {
    return this.chroma?.backend ?? null;
  }

  /**
   * Shows `scene` immediately. If `scene` has the same id as the scene on screen (or as the
   * incoming scene of a running transition, or as the queued one) only the reference is replaced,
   * so live edits of the active scene never interrupt a transition. Any other scene is a hard cut
   * that cancels the running and queued transitions.
   */
  setScene(scene: Scene): void {
    if (this.scene && this.scene.id === scene.id) {
      this.scene = scene;
    } else if (this.transition && this.transition.to.id === scene.id) {
      this.transition.to = scene;
    } else if (this.queued && this.queued.scene.id === scene.id) {
      this.queued.scene = scene;
    } else {
      this.scene = scene;
      this.transition = null;
      this.queued = null;
    }
    this.pruneCaches();
  }

  /**
   * Switches to `scene` with a transition. The outgoing scene keeps rendering live underneath
   * while the incoming one is drawn on top ("fade": eased opacity, "slide": eased slide-in from
   * the right). Timing starts at the first rendered frame, so it is deterministic for a given
   * sequence of `renderOnce` timestamps.
   *
   * Overlap policy: a "cut" (or zero duration) always wins immediately and cancels everything
   * pending. Otherwise, while a transition runs, a request for a different scene is queued (a
   * single slot, latest wins) and starts when the running one ends; a request for the scene
   * already being transitioned to is a no-op that refreshes its reference.
   */
  transitionTo(scene: Scene, transition: Transition): void {
    const ms = sanitizeTransitionMs(transition.ms);
    if (!this.scene || transition.type === "cut" || ms <= 0) {
      this.scene = scene;
      this.transition = null;
      this.queued = null;
    } else if (this.transition) {
      if (this.transition.to.id === scene.id) {
        this.transition.to = scene;
        this.queued = null;
      } else {
        // Different scene (including "back to the outgoing one"): single queue slot, latest wins.
        this.queued = { scene, transition: { type: transition.type, ms } };
      }
    } else if (this.scene.id === scene.id) {
      this.scene = scene;
    } else {
      this.transition = {
        to: scene,
        type: transition.type,
        ms,
        startMs: null,
        progress: 0,
      };
    }
    this.pruneCaches();
  }

  /* ------------------------------ sizing ----------------------------- */

  /** Changes the output resolution (clamped to 16..7680 px). Invalid sizes are ignored. */
  resize(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const w = clampDim(width, this.widthPx);
    const h = clampDim(height, this.heightPx);
    if (w === this.widthPx && h === this.heightPx) return;
    this.widthPx = w;
    this.heightPx = h;
    this.canvas.width = w; // resets the context state...
    this.canvas.height = h;
    configureContext(this.ctx); // ...so restore ours
    this.stage = stageFor(w, h);
    this.fit = computeStageFit(w, h, this.stage.w, this.stage.h);
    if (this.fadeBuffer) {
      this.fadeBuffer.canvas.width = w;
      this.fadeBuffer.canvas.height = h;
      configureContext(this.fadeBuffer.ctx);
    }
    this.textCache.clear();
  }

  /* ------------------------------ loop ------------------------------- */

  /** Starts the render loop (idempotent). See ticker.ts for the visible/hidden driver strategy. */
  start(): void {
    if (this.disposed || this.ticker?.running) return;
    this.ticker ??= createTicker(
      (nowMs, dropped) => {
        this.stats.addDropped(dropped);
        this.renderGuarded(nowMs);
      },
      this.fpsTarget,
      this.tickerEnv,
    );
    this.ticker.start();
  }

  /** Stops the render loop (the last frame stays on the canvas). */
  stop(): void {
    this.ticker?.stop();
  }

  /** Changes the loop frame rate (1..240), also while running. */
  setFps(fps: number): void {
    this.fpsTarget = clampFps(fps);
    this.ticker?.setFps(this.fpsTarget);
  }

  getStats(): CompositorStats {
    return this.stats.snapshot();
  }

  /** Registers a per-frame listener; returns its unsubscribe function. */
  onFrame(cb: FrameListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Stops the loop and frees scratch canvases, caches and listeners. The instance is unusable after. */
  dispose(): void {
    this.disposed = true;
    this.glEngine?.dispose();
    this.glEngine = null;
    this.fx?.dispose();
    this.fx = null;
    this.stop();
    this.listeners.clear();
    if (this.ownsChroma) this.chroma?.dispose();
    this.chroma = null;
    if (this.fadeBuffer) {
      this.fadeBuffer.canvas.width = 1;
      this.fadeBuffer.canvas.height = 1;
      this.fadeBuffer = null;
    }
    this.textCache.clear();
    this.chromaParams.clear();
  }

  /* ----------------------------- rendering --------------------------- */

  /**
   * Renders exactly one frame for time `nowMs` (the same timeline as performance.now()). Public so
   * a caller can paint a still frame or drive the compositor with its own clock.
   */
  renderOnce(nowMs: number): void {
    const started = perfNow();
    const ctx = this.ctx;
    this.advanceTransition(nowMs);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.widthPx, this.heightPx);

    if (this.scene) {
      this.drawScene(ctx, this.scene, nowMs);
      if (this.transition) this.drawIncoming(ctx, this.transition, nowMs);
    }

    this.stats.record(nowMs, perfNow() - started);
    for (const listener of this.listeners) {
      try {
        listener(nowMs);
      } catch (err) {
        console.error("[compositor] frame listener threw", err);
      }
    }
  }

  private renderGuarded(nowMs: number): void {
    try {
      this.renderOnce(nowMs);
    } catch (err) {
      // Never let one bad frame (e.g. a lost canvas context) stop the loop and the recording.
      this.warnOnce("frame", err);
    }
  }

  private advanceTransition(nowMs: number): void {
    const tr = this.transition;
    if (!tr) return;
    tr.startMs ??= nowMs;
    tr.progress = transitionProgress(nowMs - tr.startMs, tr.ms);
    if (tr.progress < 1) return;
    this.scene = tr.to;
    this.transition = null;
    const next = this.queued;
    this.queued = null;
    if (next) this.transitionTo(next.scene, next.transition);
    else this.pruneCaches();
  }

  /** Draws the incoming scene of a running transition on top of the (already drawn) outgoing one. */
  private drawIncoming(ctx: Ctx2D, tr: ActiveTransition, nowMs: number): void {
    if (isGlTransition(tr.type) && this.drawGl(ctx, tr, nowMs)) return;
    if (tr.type === "slide") {
      const dx = slideOffset(tr.progress, this.widthPx);
      if (dx >= this.widthPx) return; // still fully off-screen
      ctx.save();
      ctx.translate(dx, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, this.widthPx, this.heightPx); // the incoming scene is opaque
      this.drawScene(ctx, tr.to, nowMs);
      ctx.restore();
      return;
    }
    // Fade: group-composite the whole incoming scene so overlapping layers do not show through.
    // (WebGL transitions fall back to a fade until the shader engine is ready / on failure.)
    const alpha = isGlTransition(tr.type)
      ? easeInOut(tr.progress)
      : transitionAlpha(tr.type, tr.progress);
    if (alpha <= 0) return; // nothing of the incoming scene is visible yet
    const buffer = this.ensureFadeBuffer();
    if (!buffer) {
      this.drawScene(ctx, tr.to, nowMs); // no scratch canvas available: degrade to a cut
      return;
    }
    buffer.ctx.setTransform(1, 0, 0, 1, 0, 0);
    buffer.ctx.globalAlpha = 1;
    buffer.ctx.globalCompositeOperation = "source-over";
    buffer.ctx.fillStyle = "#000";
    buffer.ctx.fillRect(0, 0, this.widthPx, this.heightPx);
    this.drawScene(buffer.ctx, tr.to, nowMs);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(buffer.canvas as CanvasImageSource, 0, 0);
    ctx.restore();
  }

  /**
   * gl-transitions: the outgoing scene is already on `ctx`, the incoming one is drawn into the
   * scratch buffer and the shader blends both. Returns false when the caller should fall back.
   */
  private drawGl(ctx: Ctx2D, tr: ActiveTransition, nowMs: number): boolean {
    const engine = this.getGlEngine();
    const buffer = this.ensureFadeBuffer();
    if (!engine || !buffer) return false;
    buffer.ctx.setTransform(1, 0, 0, 1, 0, 0);
    buffer.ctx.globalAlpha = 1;
    buffer.ctx.globalCompositeOperation = "source-over";
    buffer.ctx.fillStyle = "#000";
    buffer.ctx.fillRect(0, 0, this.widthPx, this.heightPx);
    this.drawScene(buffer.ctx, tr.to, nowMs);
    try {
      const ok = engine.render(
        glName(tr.type),
        ctx.canvas as TexImageSource,
        buffer.canvas as TexImageSource,
        tr.progress,
        this.widthPx,
        this.heightPx,
      );
      if (!ok) return false;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(engine.canvas, 0, 0, this.widthPx, this.heightPx);
      ctx.restore();
      return true;
    } catch (err) {
      this.warnOnce("gl-transition", err);
      this.glFailed = true;
      return false;
    }
  }

  /** Lazily loads the shader engine; null while loading, unsupported, or after a failure. */
  private getGlEngine(): TransitionEngine | null {
    if (this.glEngine || this.glFailed || this.glLoading) return this.glEngine;
    if (typeof document === "undefined") return null;
    this.glLoading = true;
    void import("./gl-transitions")
      .then((m) => m.createTransitionEngine())
      .then((eng) => {
        if (this.disposed) eng?.dispose();
        else if (eng) this.glEngine = eng;
        else this.glFailed = true;
      })
      .catch((err) => {
        this.glFailed = true;
        this.warnOnce("gl-transition", err);
      })
      .finally(() => {
        this.glLoading = false;
      });
    return null;
  }

  private ensureFadeBuffer(): { canvas: ScratchCanvas; ctx: Ctx2D } | null {
    if (this.fadeBuffer) return this.fadeBuffer;
    try {
      const canvas = this.makeCanvas(this.widthPx, this.heightPx);
      const ctx = get2d(canvas);
      if (!ctx) return null;
      configureContext(ctx);
      this.fadeBuffer = { canvas, ctx };
      return this.fadeBuffer;
    } catch (err) {
      this.warnOnce("fade-buffer", err);
      return null;
    }
  }

  private drawScene(ctx: Ctx2D, scene: Scene, nowMs: number): void {
    const letterboxed = this.fit.offsetX > 0.5 || this.fit.offsetY > 0.5;
    ctx.save();
    if (letterboxed) {
      // Non-16:9 output: keep layers that overhang the stage out of the black bars.
      ctx.beginPath();
      ctx.rect(
        this.fit.offsetX,
        this.fit.offsetY,
        this.stage.w * this.fit.scale,
        this.stage.h * this.fit.scale,
      );
      ctx.clip();
    }
    for (const layer of scene.layers) this.drawLayer(ctx, layer, nowMs);
    ctx.restore();
  }

  /* ------------------------------ layers ----------------------------- */

  private drawLayer(ctx: Ctx2D, layer: Layer, nowMs: number): void {
    if (!layer.visible) return;
    const t = layer.transform;
    if (!isDrawableBox(t)) return;
    const opacity = clamp01(layer.opacity / 100);
    if (opacity <= 0) return;

    // Resolve pixels (or required hooks) BEFORE touching the context so skipped layers are free.
    let frame: FrameSource | null = null;
    switch (layer.kind) {
      case "webcam":
      case "screen":
      case "video":
      case "guest":
      case "image":
      case "web":
        frame = this.sourceOf(layer);
        if (!frame) return;
        break;
      case "prompter":
        if (!this.hooks.drawPrompter) return;
        break;
      case "chat":
        if (!this.hooks.drawChat) return;
        break;
      case "sponsor":
        if (!this.hooks.drawSponsors) return;
        break;
      default:
        break;
    }

    const s = this.fit.scale;
    const box: Rect = {
      x: this.fit.offsetX + t.x * s,
      y: this.fit.offsetY + t.y * s,
      w: t.w * s,
      h: t.h * s,
    };

    ctx.save();
    try {
      this.applyLayerState(ctx, layer, opacity, box);
      switch (layer.kind) {
        case "webcam":
        case "screen":
        case "video":
        case "guest":
        case "image":
          if (frame)
            this.drawFrame(
              ctx,
              layer,
              frame,
              box,
              layer.kind === "image" && layer.fit !== "cover"
                ? "contain"
                : "cover",
            );
          break;
        case "web":
          if (frame) this.drawWeb(ctx, layer, frame, box, nowMs);
          break;
        case "shape":
          this.drawShape(ctx, layer, box);
          break;
        case "text":
          this.drawText(ctx, layer, box, nowMs);
          break;
        case "prompter":
          this.callHook(ctx, () =>
            this.hooks.drawPrompter?.(ctx, layer, box, nowMs),
          );
          break;
        case "chat":
          this.callHook(ctx, () =>
            this.hooks.drawChat?.(ctx, layer, box, nowMs),
          );
          break;
        case "sponsor":
          this.callHook(ctx, () =>
            this.hooks.drawSponsors?.(ctx, layer, box, nowMs),
          );
          break;
      }
    } catch (err) {
      this.errors++;
      this.warnOnce(`${layer.id}:${layer.kind}`, err);
    } finally {
      ctx.restore();
    }
  }

  private applyLayerState(
    ctx: Ctx2D,
    layer: Layer,
    opacity: number,
    box: Rect,
  ): void {
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = resolveBlend(layer.blend, ctx);
    if (this.supportsFilter) {
      const filter = sanitizeCssFilter(layer.filter);
      if (filter !== "none") ctx.filter = filter;
    }
    const rotation = layer.transform.rotation;
    if (Number.isFinite(rotation) && rotation % 360 !== 0) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(degToRad(rotation));
      ctx.translate(-cx, -cy);
    }
  }

  /** Runs a hook inside its own save/restore so a sloppy hook cannot corrupt the layer state. */
  private callHook(ctx: Ctx2D, fn: () => void): void {
    ctx.save();
    try {
      fn();
    } finally {
      ctx.restore();
    }
  }

  private sourceOf(layer: Layer): FrameSource | null {
    let frame: FrameSource | null;
    try {
      frame = this.hooks.resolveSource(layer);
    } catch (err) {
      this.errors++;
      this.warnOnce(`${layer.id}:resolve`, err);
      return null;
    }
    if (!frame || !frame.ready || !(frame.width > 0) || !(frame.height > 0))
      return null;
    return frame;
  }

  /** Draws a pixel source into `box` (cover-crop or contain), mirrored and/or chroma keyed. */
  private drawFrame(
    ctx: Ctx2D,
    layer: Layer,
    frame: FrameSource,
    box: Rect,
    mode: "cover" | "contain",
  ): void {
    const crop =
      mode === "cover"
        ? coverSourceRect(frame.width, frame.height, box.w, box.h)
        : { x: 0, y: 0, w: frame.width, h: frame.height };
    const dst =
      mode === "cover" ? box : containRect(frame.width, frame.height, box);
    if (!(dst.w > 0) || !(dst.h > 0)) return;
    // The hook is the authority on mirroring; fall back to the webcam layer's own setting.
    const mirror =
      frame.mirror ?? (layer.kind === "webcam" ? layer.mirror : false);

    let image: CanvasImageSource = frame.source;
    let sx = crop.x;
    let sy = crop.y;
    let sw = crop.w;
    let sh = crop.h;
    if (layer.chroma.enabled) {
      const keyed = this.keyer()?.process(
        layer.id,
        frame.source,
        frame.width,
        frame.height,
        crop,
        dst.w,
        dst.h,
        this.paramsFor(layer),
      );
      if (keyed) {
        image = keyed.image;
        sx = 0;
        sy = 0;
        sw = keyed.width;
        sh = keyed.height;
      }
    }

    const paint = (c: Ctx2D, d: Rect): void => {
      if (mirror) {
        c.save();
        const cx = d.x + d.w / 2;
        c.translate(cx, 0);
        c.scale(-1, 1);
        c.translate(-cx, 0);
        c.drawImage(image, sx, sy, sw, sh, d.x, d.y, d.w, d.h);
        c.restore();
      } else {
        c.drawImage(image, sx, sy, sw, sh, d.x, d.y, d.w, d.h);
      }
    };

    // Layers with sharpen / vignette / warmth go through a scratch canvas that also applies the
    // CSS filter, so the effects see the adjusted picture.
    const fx = layer.fx;
    if (hasFx(fx)) {
      const out = this.fxEngine()?.process(
        layer.id,
        dst.w,
        dst.h,
        sanitizeCssFilter(layer.filter),
        fx,
        (c, w, h) => paint(c as Ctx2D, { x: 0, y: 0, w, h }),
        this.supportsFilter,
      );
      if (out) {
        if (this.supportsFilter) ctx.filter = "none"; // already applied in the scratch canvas
        ctx.drawImage(out, dst.x, dst.y, dst.w, dst.h);
        return;
      }
    }
    paint(ctx, dst);
  }

  private fxEngine(): FxEngine | null {
    if (!this.fx && !this.disposed) {
      try {
        this.fx = new FxProcessor({ createCanvas: this.makeCanvas });
      } catch (err) {
        this.warnOnce("fx", err);
      }
    }
    return this.fx;
  }

  private drawWeb(
    ctx: Ctx2D,
    layer: WebLayer,
    frame: FrameSource,
    box: Rect,
    nowMs: number,
  ): void {
    let screen: Rect = box;
    this.callHook(ctx, () => {
      const inner = this.hooks.drawWebChrome?.(ctx, layer, box, nowMs);
      if (inner && isDrawableBox(inner)) screen = inner;
    });
    this.drawFrame(ctx, layer, frame, screen, "contain");
    this.callHook(ctx, () =>
      this.hooks.drawWebOverlay?.(ctx, layer, screen, nowMs),
    );
  }

  /* ------------------------------ chroma ----------------------------- */

  private keyer(): ChromaEngine | null {
    if (!this.chroma && !this.disposed) {
      this.chroma = new ChromaProcessor({ createCanvas: this.makeCanvas });
    }
    return this.chroma;
  }

  /** Per-layer parsed chroma parameters, recomputed only when the layer's settings change. */
  private paramsFor(layer: Layer): ChromaKeyParams {
    const ck = layer.chroma;
    let entry = this.chromaParams.get(layer.id);
    if (
      !entry ||
      entry.key !== ck.key ||
      entry.similarity !== ck.similarity ||
      entry.smoothness !== ck.smoothness ||
      entry.spill !== ck.spill
    ) {
      entry = {
        key: ck.key,
        similarity: ck.similarity,
        smoothness: ck.smoothness,
        spill: ck.spill,
        params: chromaParamsFromLayer(ck),
      };
      this.chromaParams.set(layer.id, entry);
    }
    return entry.params;
  }

  /** Releases per-layer scratch state of layers that are no longer in any live scene. */
  private pruneCaches(): void {
    const live = new Set<string>();
    const scenes = [this.scene, this.transition?.to, this.queued?.scene];
    for (const scene of scenes) {
      if (scene) for (const layer of scene.layers) live.add(layer.id);
    }
    this.chroma?.prune(live);
    for (const id of [...this.chromaParams.keys()])
      if (!live.has(id)) this.chromaParams.delete(id);
    for (const id of [...this.textCache.keys()]) {
      if (!live.has(id.replace(/:s$/, ""))) this.textCache.delete(id);
    }
  }

  /* ------------------------------- shape ----------------------------- */

  private drawShape(ctx: Ctx2D, layer: ShapeLayer, box: Rect): void {
    const s = this.fit.scale;
    ctx.beginPath();
    if (layer.shape === "ellipse") {
      ctx.ellipse(
        box.x + box.w / 2,
        box.y + box.h / 2,
        box.w / 2,
        box.h / 2,
        0,
        0,
        TAU,
      );
    } else {
      roundedRectPath(
        ctx,
        box.x,
        box.y,
        box.w,
        box.h,
        Math.max(0, layer.radius) * s,
      );
    }
    if (!isTransparentColor(layer.fill)) {
      ctx.fillStyle = layer.fill;
      ctx.fill();
    }
    if (layer.strokeWidth > 0 && !isTransparentColor(layer.stroke)) {
      ctx.lineWidth = layer.strokeWidth * s;
      ctx.strokeStyle = layer.stroke;
      ctx.stroke();
    }
    const text = layer.text.slice(0, MAX_TEXT_CHARS);
    if (text === "") return;

    const pad = layer.shape === "banner" ? box.h * 0.22 : box.h * 0.12;
    const innerW = Math.max(1, box.w - pad * 2);
    const innerH = Math.max(1, box.h - pad);
    // Shrink the font until the wrapped text fits the inner box (bounded loop, cached per layer).
    const key = `${text}|${Math.round(innerW)}|${Math.round(innerH)}`;
    let layout = this.textCache.get(`${layer.id}:s`);
    if (!layout || layout.key !== key) {
      let px = Math.max(8, box.h * 0.42);
      let lines: string[] = [];
      for (let i = 0; i < 6; i++) {
        ctx.font = `700 ${px.toFixed(2)}px ${DEFAULT_FONT}`;
        lines = wrapText((v) => ctx.measureText(v).width, text, innerW, 6);
        if (lines.length * px * 1.2 <= innerH || px <= 8) break;
        px = Math.max(8, px * 0.8);
      }
      layout = { key, lines, width: 0, fontPx: px };
      this.cacheLayout(`${layer.id}:s`, layout);
    }
    ctx.font = `700 ${layout.fontPx.toFixed(2)}px ${DEFAULT_FONT}`;
    ctx.fillStyle = layer.textColor;
    ctx.textBaseline = "middle";
    const left = layer.shape === "banner";
    ctx.textAlign = left ? "left" : "center";
    const x = left ? box.x + pad : box.x + box.w / 2;
    const lineH = layout.fontPx * 1.2;
    const top = box.y + (box.h - lineH * layout.lines.length) / 2;
    layout.lines.forEach((line, i) =>
      ctx.fillText(line, x, top + lineH * (i + 0.5)),
    );
  }

  /* -------------------------------- text ----------------------------- */

  private drawText(
    ctx: Ctx2D,
    layer: TextLayer,
    box: Rect,
    nowMs: number,
  ): void {
    const s = this.fit.scale;
    const fontPx =
      clamp(Number.isFinite(layer.fontSize) ? layer.fontSize : 40, 4, 1000) * s;
    const font = fontString(layer, fontPx);
    const hasBg = !isTransparentColor(layer.background);
    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.fillStyle = layer.color;

    const style = layer.style;
    const accent = style === "banner" ? Math.max(4 * s, fontPx * 0.16) : 0;
    const padX = (style === "plain" && !hasBg ? 0 : fontPx * 0.6) + accent;
    const wrapW = Math.max(1, box.w - padX * 2);
    const layout = this.layoutText(ctx, layer, font, fontPx, wrapW);
    const lineH = fontPx * 1.25;

    if (style === "ticker") {
      this.drawTicker(ctx, layer, layout, box, padX, nowMs);
      return;
    }

    const blockH = layout.lines.length * lineH;
    let textBox = box;
    if (style === "subtitle") {
      const padY = fontPx * 0.3;
      const pillW = Math.min(box.w, layout.width + padX * 2);
      const pillH = Math.min(box.h, blockH + padY * 2);
      const px =
        layer.align === "left"
          ? box.x
          : layer.align === "right"
            ? box.x + box.w - pillW
            : box.x + (box.w - pillW) / 2;
      textBox = { x: px, y: box.y + box.h - pillH, w: pillW, h: pillH };
      roundedRectPath(
        ctx,
        textBox.x,
        textBox.y,
        textBox.w,
        textBox.h,
        fontPx * 0.3,
      );
      ctx.fillStyle = hasBg ? layer.background : "rgba(0,0,0,0.6)";
      ctx.fill();
      ctx.fillStyle = layer.color;
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = Math.max(1, 3 * s);
    } else if (style === "banner") {
      ctx.fillStyle = hasBg ? layer.background : "rgba(15,15,20,0.78)";
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(box.x, box.y, accent, box.h);
      ctx.fillStyle = layer.color;
    } else if (hasBg) {
      ctx.fillStyle = layer.background;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = layer.color;
    }

    // Text may overflow a too-small box: never let it spill outside.
    ctx.beginPath();
    ctx.rect(textBox.x, textBox.y, textBox.w, textBox.h);
    ctx.clip();

    ctx.textAlign = layer.align;
    const x =
      layer.align === "left"
        ? textBox.x + padX
        : layer.align === "right"
          ? textBox.x + textBox.w - padX
          : textBox.x + textBox.w / 2;
    const top = textBox.y + (textBox.h - blockH) / 2;
    layout.lines.forEach((line, i) =>
      ctx.fillText(line, x, top + lineH * (i + 0.5)),
    );
  }

  /** Single-line marquee: text loops right-to-left, driven purely by `nowMs`. */
  private drawTicker(
    ctx: Ctx2D,
    layer: TextLayer,
    layout: TextLayout,
    box: Rect,
    padX: number,
    nowMs: number,
  ): void {
    const hasBg = !isTransparentColor(layer.background);
    ctx.fillStyle = hasBg ? layer.background : "rgba(15,15,20,0.85)";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    const text = layout.lines[0] ?? "";
    if (text === "" || !(layout.width > 0)) return;

    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.fillStyle = layer.color;
    ctx.textAlign = "left";
    const period = layout.width + layout.fontPx * 3;
    const offset = marqueeOffset(nowMs, TICKER_SPEED * this.fit.scale, period);
    const y = box.y + box.h / 2;
    const limit = box.x + box.w;
    for (
      let i = 0, x = box.x + padX + offset;
      x < limit && i < 64;
      i++, x += period
    ) {
      ctx.fillText(text, x, y);
    }
  }

  private layoutText(
    ctx: Ctx2D,
    layer: TextLayer,
    font: string,
    fontPx: number,
    wrapW: number,
  ): TextLayout {
    const key = `${font}|${Math.round(wrapW)}|${layer.style}|${layer.text}`;
    const cached = this.textCache.get(layer.id);
    if (cached && cached.key === key) return cached;
    const text = layer.text.slice(0, MAX_TEXT_CHARS);
    const measure = (v: string): number => ctx.measureText(v).width;
    const lines =
      layer.style === "ticker"
        ? [text.replace(/\s*(\r\n|\r|\n)\s*/g, "   •   ")]
        : wrapText(measure, text, wrapW);
    let width = 0;
    for (const line of lines) width = Math.max(width, measure(line));
    const layout: TextLayout = { key, lines, width, fontPx };
    this.cacheLayout(layer.id, layout);
    return layout;
  }

  private cacheLayout(id: string, layout: TextLayout): void {
    if (this.textCache.size >= 128 && !this.textCache.has(id))
      this.textCache.clear();
    this.textCache.set(id, layout);
  }

  /* ------------------------------ errors ----------------------------- */

  private warnOnce(key: string, err: unknown): void {
    if (this.warned.has(key)) return;
    if (this.warned.size > 64) this.warned.clear();
    this.warned.add(key);
    console.warn(`[compositor] ${key} failed`, err);
  }
}
