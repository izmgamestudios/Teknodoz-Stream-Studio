// src/studio/engine/ticker.ts
// Frame pacing for the compositor. The recording is produced by the render loop, so the loop must
// keep running at full rate when the studio tab is in the background:
//
//   * tab visible        -> requestAnimationFrame (vsync aligned, smooth preview)
//   * tab hidden         -> a timer running inside an inline Blob Web Worker (worker timers are not
//                           throttled to 1 Hz like main-thread timers); falls back to setInterval
//   * rAF unavailable    -> same timer path
//   * rAF stalls while "visible" (occluded window) -> a watchdog switches to the timer path
//
// Whatever drives the loop, a drift-free pacer thins the ticks to the target fps: it never
// accumulates a backlog (late frames are skipped, not replayed) and reports how many frames were
// dropped. The pacer, the fps helpers and FrameStats are pure and unit-tested; the DOM access is
// isolated in `TickerEnv`, which tests replace with a fake. Nothing here runs at import time.

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

export const MIN_FPS = 1;
export const MAX_FPS = 240;
export const DEFAULT_FPS = 60;

/** Clamps a requested fps into [1, 240]; NaN / non-numbers become 60. */
export function clampFps(fps: number): number {
  if (typeof fps !== "number" || !Number.isFinite(fps)) return DEFAULT_FPS;
  return fps < MIN_FPS ? MIN_FPS : fps > MAX_FPS ? MAX_FPS : fps;
}

/** Target frame interval in ms (1000 / fps) after clamping. */
export function frameIntervalMs(fps: number): number {
  return 1000 / clampFps(fps);
}

/**
 * Period for the background timer. Timers only have integer-millisecond resolution, so the period
 * is rounded DOWN (16 ms for 60 fps): the timer then over-ticks slightly and the pacer thins the
 * ticks, which is far better than rounding up and permanently running below the target rate.
 */
export function timerIntervalMs(fps: number): number {
  return Math.max(1, Math.floor(frameIntervalMs(fps)));
}

/** Mutable state of the drift-free pacer. */
export interface PacerState {
  /** Timestamp the next frame is due at on the fixed grid; NaN until the first tick. */
  nextDue: number;
}

export interface PaceDecision {
  /** Whether a frame should be rendered for this tick. */
  render: boolean;
  /** Whole frame slots that were missed since the previous frame (only when `render`). */
  dropped: number;
}

export function createPacer(): PacerState {
  return { nextDue: Number.NaN };
}

/** Forgets the grid; the next tick renders immediately and starts a new grid. */
export function resetPacer(state: PacerState): void {
  state.nextDue = Number.NaN;
}

/** Ticks later than this behind schedule (sleep, debugger, tab freeze) resync instead of counting drops. */
export const MAX_GAP_MS = 1000;
/** A tick up to this fraction of an interval EARLY is still accepted (vsync / timer jitter). */
export const EARLY_TOLERANCE = 0.25;

/**
 * Decides whether the tick at `now` should render a frame.
 *
 * Frames live on a fixed grid (`nextDue += interval`), so the average rate equals the target with
 * no accumulated drift. A tick that arrives well before the next slot is skipped; a tick that
 * arrives late renders ONE frame (no catch-up burst) and the slots it jumped over are reported as
 * `dropped`. The grid is re-anchored after a gap longer than MAX_GAP_MS.
 */
export function advancePacer(
  state: PacerState,
  now: number,
  intervalMs: number,
  earlyTolerance: number = EARLY_TOLERANCE,
  maxGapMs: number = MAX_GAP_MS,
): PaceDecision {
  if (!Number.isFinite(now) || !(intervalMs > 0))
    return { render: false, dropped: 0 };
  if (!Number.isFinite(state.nextDue)) {
    state.nextDue = now + intervalMs;
    return { render: true, dropped: 0 };
  }
  const limit = Math.max(maxGapMs, intervalMs * 2);
  const ahead = state.nextDue - now;
  if (ahead > limit) {
    // The clock went backwards (or was reset): start a new grid instead of waiting for it.
    state.nextDue = now + intervalMs;
    return { render: true, dropped: 0 };
  }
  if (ahead > intervalMs * earlyTolerance) return { render: false, dropped: 0 };
  const behind = -ahead;
  if (behind > limit) {
    // Long stall (sleep, debugger, frozen tab): resync without reporting a flood of drops.
    state.nextDue = now + intervalMs;
    return { render: true, dropped: 0 };
  }
  const dropped = behind > 0 ? Math.floor(behind / intervalMs) : 0;
  state.nextDue += (dropped + 1) * intervalMs;
  return { render: true, dropped };
}

export interface FrameStatsSnapshot {
  /** Frames per second measured over the last completed window (0 until one completes). */
  fps: number;
  /** Smoothed render time of one frame in ms. */
  frameMs: number;
  /** Frames missed since start (scheduler drops plus slow-frame overruns reported by the caller). */
  droppedFrames: number;
}

/** Rolling frame statistics (fps window + exponentially smoothed frame time + drop counter). */
export class FrameStats {
  private windowStart = Number.NaN;
  private frames = 0;
  private fpsValue = 0;
  private frameMsValue = 0;
  private haveFrameMs = false;
  private dropped = 0;

  constructor(
    private readonly windowMs = 500,
    private readonly smoothing = 0.2,
  ) {}

  /** Records one rendered frame. `dropped` frames are added to the cumulative counter. */
  record(nowMs: number, frameMs: number, dropped = 0): void {
    if (dropped > 0) this.dropped += Math.floor(dropped);
    if (Number.isFinite(frameMs) && frameMs >= 0) {
      this.frameMsValue = this.haveFrameMs
        ? this.frameMsValue + (frameMs - this.frameMsValue) * this.smoothing
        : frameMs;
      this.haveFrameMs = true;
    }
    if (!Number.isFinite(nowMs)) return;
    if (!Number.isFinite(this.windowStart) || nowMs < this.windowStart) {
      this.windowStart = nowMs;
      this.frames = 1;
      return;
    }
    this.frames++;
    const elapsed = nowMs - this.windowStart;
    if (elapsed >= this.windowMs) {
      this.fpsValue = (this.frames * 1000) / elapsed;
      this.windowStart = nowMs;
      this.frames = 0;
    }
  }

  /** Adds frames that were missed outside of `record` (e.g. a frame that overran its slot). */
  addDropped(n: number): void {
    if (n > 0) this.dropped += Math.floor(n);
  }

  snapshot(): FrameStatsSnapshot {
    return {
      fps: this.fpsValue,
      frameMs: this.frameMsValue,
      droppedFrames: this.dropped,
    };
  }

  reset(): void {
    this.windowStart = Number.NaN;
    this.frames = 0;
    this.fpsValue = 0;
    this.frameMsValue = 0;
    this.haveFrameMs = false;
    this.dropped = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Environment abstraction                                             */
/* ------------------------------------------------------------------ */

export type TimerKind = "worker" | "interval";

export interface TimerHandle {
  stop(): void;
  /** "worker" = inline Blob worker, "interval" = main-thread setInterval fallback. */
  readonly kind: TimerKind;
}

/** Everything the ticker needs from the platform; replaced by a fake in unit tests. */
export interface TickerEnv {
  now(): number;
  /** requestAnimationFrame, or null when unavailable. */
  requestFrame: ((cb: (timestamp: number) => void) => number) | null;
  cancelFrame: ((id: number) => void) | null;
  /** True when document.visibilityState === "visible" (or there is no document). */
  isVisible(): boolean;
  /** Subscribes to visibility changes; returns the unsubscribe function. */
  onVisibilityChange(handler: () => void): () => void;
  /** Starts a periodic timer that survives background throttling where the platform allows. */
  createTimer(periodMs: number, onTick: () => void): TimerHandle;
  /** Starts a low-frequency main-thread watchdog; returns its stop function. */
  startWatchdog(periodMs: number, onCheck: () => void): () => void;
}

const WORKER_SOURCE =
  "var id=0;self.onmessage=function(e){var m=e.data;clearInterval(id);id=0;" +
  "if(m&&m.cmd==='start'){id=setInterval(function(){self.postMessage(0)},m.ms)}};";

function createIntervalTimer(
  periodMs: number,
  onTick: () => void,
): TimerHandle {
  const id = setInterval(onTick, periodMs);
  return { kind: "interval", stop: () => clearInterval(id) };
}

/**
 * Timer inside an inline Blob worker. Any failure (no Worker/Blob, CSP forbidding blob: workers,
 * worker error event) transparently degrades to a main-thread setInterval.
 */
function createWorkerTimer(periodMs: number, onTick: () => void): TimerHandle {
  let worker: Worker | null = null;
  let url: string | null = null;
  let fallback: TimerHandle | null = null;
  let stopped = false;

  const cleanupWorker = (): void => {
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      try {
        worker.postMessage({ cmd: "stop" });
      } catch {
        /* worker already dead */
      }
      worker.terminate();
      worker = null;
    }
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
  };
  const degrade = (): void => {
    cleanupWorker();
    if (!stopped && !fallback) fallback = createIntervalTimer(periodMs, onTick);
  };

  try {
    if (
      typeof Worker === "undefined" ||
      typeof Blob === "undefined" ||
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function"
    ) {
      throw new Error("Worker/Blob unavailable");
    }
    url = URL.createObjectURL(
      new Blob([WORKER_SOURCE], { type: "text/javascript" }),
    );
    worker = new Worker(url);
    worker.onmessage = () => {
      if (!stopped) onTick();
    };
    worker.onerror = (ev) => {
      ev.preventDefault();
      degrade();
    };
    worker.postMessage({ cmd: "start", ms: periodMs });
  } catch {
    degrade();
  }

  return {
    get kind(): TimerKind {
      return fallback ? "interval" : "worker";
    },
    stop(): void {
      stopped = true;
      cleanupWorker();
      fallback?.stop();
      fallback = null;
    },
  };
}

/** Builds the real platform environment. Reads globals lazily, so it is safe to call only on the client. */
export function defaultTickerEnv(): TickerEnv {
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: (t: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  const raf =
    typeof g.requestAnimationFrame === "function"
      ? g.requestAnimationFrame
      : null;
  const caf =
    typeof g.cancelAnimationFrame === "function"
      ? g.cancelAnimationFrame
      : null;
  return {
    now: () =>
      typeof performance !== "undefined" ? performance.now() : Date.now(),
    requestFrame: raf ? (cb) => raf.call(globalThis, cb) : null,
    cancelFrame: caf ? (id) => caf.call(globalThis, id) : null,
    isVisible: () =>
      typeof document === "undefined" || document.visibilityState === "visible",
    onVisibilityChange: (handler) => {
      if (typeof document === "undefined") return () => {};
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    },
    createTimer: createWorkerTimer,
    startWatchdog: (periodMs, onCheck) => {
      const id = setInterval(onCheck, periodMs);
      return () => clearInterval(id);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Ticker                                                              */
/* ------------------------------------------------------------------ */

export type TickerMode = "stopped" | "raf" | "worker" | "interval";

/** Called once per accepted frame with the frame timestamp (performance.now timeline) and drops. */
export type TickCallback = (nowMs: number, dropped: number) => void;

export interface Ticker {
  /** Starts ticking (idempotent). The first frame is delivered on the first tick. */
  start(): void;
  /** Stops ticking and releases the worker / listeners (idempotent). */
  stop(): void;
  /** Changes the target frame rate on the fly. */
  setFps(fps: number): void;
  readonly running: boolean;
  /** Which driver is active right now. */
  readonly mode: TickerMode;
  readonly fps: number;
}

export interface TickerOptions {
  /** ms without a rAF callback (while visible) before falling back to the timer. Default 600. */
  stallMs?: number;
}

const DEFAULT_STALL_MS = 600;

class FrameTicker implements Ticker {
  private fpsValue: number;
  private isRunning = false;
  private driver: TickerMode = "stopped";
  private env: TickerEnv | null = null;
  private rafId: number | null = null;
  private probeId: number | null = null;
  private timer: TimerHandle | null = null;
  private unsubscribeVisibility: (() => void) | null = null;
  private stopWatchdog: (() => void) | null = null;
  private pacer = createPacer();
  private lastRafAt = 0;
  private rafStalled = false;
  private readonly stallMs: number;

  constructor(
    private readonly cb: TickCallback,
    fps: number,
    private readonly envFactory: () => TickerEnv,
    opts: TickerOptions,
  ) {
    this.fpsValue = clampFps(fps);
    this.stallMs = Math.max(50, opts.stallMs ?? DEFAULT_STALL_MS);
  }

  get running(): boolean {
    return this.isRunning;
  }

  get mode(): TickerMode {
    // The worker timer can degrade to setInterval after the fact, so ask the live handle.
    return this.driver === "worker" || this.driver === "interval"
      ? (this.timer?.kind ?? this.driver)
      : this.driver;
  }

  get fps(): number {
    return this.fpsValue;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.rafStalled = false;
    this.env ??= this.envFactory();
    this.unsubscribeVisibility = this.env.onVisibilityChange(() => {
      this.rafStalled = false; // give rAF a fresh chance whenever visibility flips
      this.engage();
    });
    this.engage();
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.release();
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = null;
    this.driver = "stopped";
  }

  setFps(fps: number): void {
    const next = clampFps(fps);
    if (next === this.fpsValue) return;
    this.fpsValue = next;
    if (this.isRunning) this.engage();
  }

  /** (Re)selects the driver for the current visibility / rAF health. */
  private engage(): void {
    const env = this.env;
    if (!this.isRunning || !env) return;
    this.release();
    resetPacer(this.pacer);
    if (env.requestFrame && env.isVisible() && !this.rafStalled) {
      this.driver = "raf";
      this.lastRafAt = env.now();
      this.rafId = env.requestFrame(this.onRaf);
      this.stopWatchdog = env.startWatchdog(this.stallMs, this.checkStall);
    } else {
      const timer = env.createTimer(
        timerIntervalMs(this.fpsValue),
        this.onTimer,
      );
      this.timer = timer;
      this.driver = timer.kind;
      // Stalled-but-visible: keep probing whether rAF came back.
      if (env.requestFrame && env.isVisible() && this.rafStalled) {
        this.probeId = env.requestFrame(this.onProbe);
      }
    }
  }

  /** Cancels every outstanding driver resource (not the visibility subscription). */
  private release(): void {
    const env = this.env;
    if (env?.cancelFrame) {
      if (this.rafId !== null) env.cancelFrame(this.rafId);
      if (this.probeId !== null) env.cancelFrame(this.probeId);
    }
    this.rafId = null;
    this.probeId = null;
    this.timer?.stop();
    this.timer = null;
    this.stopWatchdog?.();
    this.stopWatchdog = null;
  }

  private readonly onRaf = (timestamp: number): void => {
    if (!this.isRunning || this.driver !== "raf" || !this.env) return;
    this.rafId = this.env.requestFrame
      ? this.env.requestFrame(this.onRaf)
      : null; // schedule first
    this.lastRafAt = this.env.now();
    this.deliver(Number.isFinite(timestamp) ? timestamp : this.lastRafAt);
  };

  private readonly onTimer = (): void => {
    if (!this.isRunning || !this.env) return;
    this.deliver(this.env.now());
  };

  /** rAF fired while we were running on the timer: it is healthy again, switch back. */
  private readonly onProbe = (): void => {
    this.probeId = null;
    if (!this.isRunning) return;
    this.rafStalled = false;
    this.engage();
  };

  private readonly checkStall = (): void => {
    const env = this.env;
    if (!this.isRunning || !env || this.driver !== "raf") return;
    if (env.now() - this.lastRafAt > this.stallMs) {
      this.rafStalled = true;
      this.engage();
    }
  };

  private deliver(now: number): void {
    const decision = advancePacer(
      this.pacer,
      now,
      frameIntervalMs(this.fpsValue),
    );
    if (!decision.render) return;
    try {
      this.cb(now, decision.dropped);
    } catch (err) {
      // A throwing frame must never kill the loop (it would silently stop the recording).
      console.error("[ticker] frame callback threw", err);
    }
  }
}

/**
 * Creates a frame ticker (see the file header for the driver strategy). `cb` receives
 * `(nowMs, dropped)` at most `fps` times per second. Call `start()` / `stop()` on the result.
 * `env` is injectable for tests; by default the real platform is used (resolved at `start()`).
 */
export function createTicker(
  cb: TickCallback,
  fps: number,
  env?: TickerEnv,
  opts: TickerOptions = {},
): Ticker {
  return new FrameTicker(cb, fps, env ? () => env : defaultTickerEnv, opts);
}
