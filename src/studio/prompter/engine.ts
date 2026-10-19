// src/studio/prompter/engine.ts
// DOM-free scroll engine for the prompter. It only knows about numbers: a position in px that
// advances at `speedPx` px/second while playing. The UI/runtime applies the position to the DOM
// (or to the burn-in renderer) and drives `tick()` from requestAnimationFrame (`attachRaf`) or from
// the compositor loop.

/** Upper bound of the scroll speed in px per second. */
export const MAX_SPEED_PX = 600;
/** A single tick never advances time by more than this (tab was in background, GC pause...). */
export const MAX_TICK_DT_MS = 100;

/** Immutable view of the engine state. A new object is created on every change. */
export interface PrompterSnapshot {
  readonly playing: boolean;
  /** px per second, 0..MAX_SPEED_PX */
  readonly speedPx: number;
  /** Current scroll offset in px (fractional; round it yourself when painting), 0..maxPx */
  readonly positionPx: number;
  /** Scrollable extent in px (content height minus viewport height). <= 0 means "unknown/none". */
  readonly maxPx: number;
  /** True while at least one `hold()` reason is active: playing but not advancing. */
  readonly held: boolean;
  readonly holdReasons: readonly string[];
  /** True when positionPx has reached maxPx (and maxPx > 0). */
  readonly atEnd: boolean;
}

export interface PrompterEngineOptions {
  speedPx?: number | undefined;
  maxPx?: number | undefined;
  positionPx?: number | undefined;
  /** Called once each time playback reaches the end and auto-stops. */
  onEnd?: (() => void) | undefined;
}

type Listener = () => void;

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Surface a listener exception without breaking the engine loop. */
function reportAsync(err: unknown): void {
  setTimeout(() => {
    throw err;
  }, 0);
}

export class PrompterEngine {
  private playing = false;
  private speedPx: number;
  private positionPx = 0;
  private maxPx = 0;
  private readonly holds = new Set<string>();
  private snapshot: PrompterSnapshot;

  private readonly listeners = new Set<Listener>();
  private readonly coarseListeners = new Set<Listener>();
  private readonly endListeners = new Set<Listener>();

  constructor(options: PrompterEngineOptions = {}) {
    this.speedPx = PrompterEngine.sanitizeSpeed(options.speedPx ?? 60, 60);
    if (options.maxPx !== undefined && Number.isFinite(options.maxPx)) {
      this.maxPx = Math.max(0, options.maxPx);
    }
    if (
      options.positionPx !== undefined &&
      Number.isFinite(options.positionPx)
    ) {
      this.positionPx = clamp(options.positionPx, 0, this.maxPx);
    }
    if (options.onEnd) this.endListeners.add(options.onEnd);
    this.snapshot = this.buildSnapshot();
  }

  private static sanitizeSpeed(speed: number, fallback: number): number {
    if (!Number.isFinite(speed)) return fallback;
    return clamp(speed, 0, MAX_SPEED_PX);
  }

  /* ---------------------------- store API --------------------------- */

  /**
   * useSyncExternalStore-compatible subscribe. Fires on EVERY change, including each tick that
   * moves the position (up to once per animation frame while playing). Arrow function: safe to pass
   * unbound.
   */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Like `subscribe` but does NOT fire for position changes caused by continuous playback ticks. It
   * still fires for play/pause/speed/hold/seek/rewind/maxPx/end. Use this for toolbars and sliders;
   * read `getSnapshot().positionPx` on demand (or use `attachRaf`) for the live position.
   */
  subscribeCoarse = (listener: Listener): (() => void) => {
    this.coarseListeners.add(listener);
    return () => {
      this.coarseListeners.delete(listener);
    };
  };

  /** Always up to date; returns the same object until the next change. */
  getSnapshot = (): PrompterSnapshot => this.snapshot;

  /** Same as `getSnapshot`; for the third argument of useSyncExternalStore (SSR). */
  getServerSnapshot = (): PrompterSnapshot => this.snapshot;

  /** Register an end-of-script listener. Returns an unsubscribe function. */
  onEnd(listener: () => void): () => void {
    this.endListeners.add(listener);
    return () => {
      this.endListeners.delete(listener);
    };
  }

  private buildSnapshot(): PrompterSnapshot {
    return Object.freeze({
      playing: this.playing,
      speedPx: this.speedPx,
      positionPx: this.positionPx,
      maxPx: this.maxPx,
      held: this.holds.size > 0,
      holdReasons: Object.freeze([...this.holds]),
      atEnd: this.maxPx > 0 && this.positionPx >= this.maxPx,
    });
  }

  private commit(coarse: boolean): void {
    this.snapshot = this.buildSnapshot();
    this.notify(this.listeners);
    if (coarse) this.notify(this.coarseListeners);
  }

  private notify(set: Set<Listener>): void {
    for (const l of [...set]) {
      try {
        l();
      } catch (err) {
        reportAsync(err);
      }
    }
  }

  /* ----------------------------- control ---------------------------- */

  /**
   * Start scrolling. If the script is already at its end, playback restarts from the top.
   * Playing while `maxPx <= 0` is allowed (nothing to scroll yet); it simply does not advance.
   */
  play(): void {
    if (this.playing) return;
    if (this.maxPx > 0 && this.positionPx >= this.maxPx) this.positionPx = 0;
    this.playing = true;
    this.commit(true);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.commit(true);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Clamped to 0..MAX_SPEED_PX. Non-finite values are ignored. */
  setSpeed(speedPx: number): void {
    if (!Number.isFinite(speedPx)) return;
    const next = clamp(speedPx, 0, MAX_SPEED_PX);
    if (next === this.speedPx) return;
    this.speedPx = next;
    this.commit(true);
  }

  speedUp(step = 10): void {
    this.setSpeed(this.speedPx + Math.abs(Number.isFinite(step) ? step : 10));
  }

  speedDown(step = 10): void {
    this.setSpeed(this.speedPx - Math.abs(Number.isFinite(step) ? step : 10));
  }

  /** Jump to the top and pause. Holds are kept. */
  rewind(): void {
    this.positionPx = 0;
    this.playing = false;
    this.commit(true);
  }

  /** Jump to an absolute position, clamped to 0..maxPx. Does not change play/pause. */
  seek(px: number): void {
    if (!Number.isFinite(px)) return;
    const next = clamp(px, 0, Math.max(0, this.maxPx));
    if (next === this.positionPx) return;
    this.positionPx = next;
    this.commit(true);
  }

  /**
   * Set the scrollable extent (content height - viewport height). The position is clamped to the
   * new extent. `maxPx <= 0` means "unknown": the position stays at 0 and playback never
   * auto-stops. Call this before restoring a saved position with `seek`.
   */
  setMaxPx(px: number): void {
    if (!Number.isFinite(px)) return;
    const next = Math.max(0, px);
    if (next === this.maxPx) return;
    this.maxPx = next;
    this.positionPx = clamp(this.positionPx, 0, next);
    this.commit(true);
  }

  /**
   * Freeze scrolling without leaving the "playing" state (voice-follow uses this when the
   * speaker is silent). Multiple reasons can be held at once; scrolling resumes when all are
   * released.
   */
  hold(reason = "manual"): void {
    if (this.holds.has(reason)) return;
    this.holds.add(reason);
    this.commit(true);
  }

  /** Release one reason, or every reason when called without arguments. */
  release(reason?: string): void {
    if (reason === undefined) {
      if (this.holds.size === 0) return;
      this.holds.clear();
    } else if (!this.holds.delete(reason)) {
      return;
    }
    this.commit(true);
  }

  isHeld(reason?: string): boolean {
    return reason === undefined ? this.holds.size > 0 : this.holds.has(reason);
  }

  /* ------------------------------ clock ----------------------------- */

  /**
   * Advance the clock by `dtMs` real milliseconds. Non-finite or non-positive values are ignored,
   * spikes are clamped to MAX_TICK_DT_MS. The position is kept as a float so slow speeds
   * (< 1 px/frame) still accumulate. When the end is reached the engine pauses and `onEnd`
   * listeners fire once.
   */
  tick(dtMs: number): void {
    if (!this.playing || this.holds.size > 0) return;
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    if (this.speedPx <= 0) return;
    if (this.maxPx <= 0) return;
    const dt = Math.min(dtMs, MAX_TICK_DT_MS);
    const next = Math.min(
      this.maxPx,
      this.positionPx + (this.speedPx * dt) / 1000,
    );
    const ended = next >= this.maxPx;
    if (ended) {
      this.positionPx = this.maxPx;
      this.playing = false;
      this.commit(true);
      this.notify(this.endListeners);
      return;
    }
    if (next === this.positionPx) return;
    this.positionPx = next;
    this.commit(false);
  }
}

/* ------------------------------------------------------------------ */
/* requestAnimationFrame driver                                        */
/* ------------------------------------------------------------------ */

export interface AttachRafOptions {
  /** Override for tests / non-window environments. Defaults to globalThis.requestAnimationFrame. */
  requestFrame?: ((cb: (timestampMs: number) => void) => number) | undefined;
  cancelFrame?: ((handle: number) => void) | undefined;
}

/**
 * Drive `engine.tick` from requestAnimationFrame and report the position to `onPosition`.
 *
 * - The frame loop only runs while the engine is playing and not held, so an idle prompter costs
 *   nothing.
 * - `onPosition(positionPx)` is called once immediately, on every moving frame, and on discrete
 *   jumps (seek/rewind/setMaxPx) so a paused view stays in sync.
 * - SSR-safe: without requestAnimationFrame it only does the initial/jump reporting.
 *
 * @returns detach function (idempotent).
 */
export function attachRaf(
  engine: PrompterEngine,
  onPosition: (positionPx: number) => void,
  options: AttachRafOptions = {},
): () => void {
  const g = globalThis as {
    requestAnimationFrame?: (cb: (t: number) => void) => number;
    cancelAnimationFrame?: (h: number) => void;
  };
  const request =
    options.requestFrame ?? g.requestAnimationFrame?.bind(globalThis);
  const cancel =
    options.cancelFrame ?? g.cancelAnimationFrame?.bind(globalThis);

  let handle: number | null = null;
  let lastTs: number | null = null;
  let lastReported = Number.NaN;
  let detached = false;

  const report = (): void => {
    const pos = engine.getSnapshot().positionPx;
    if (pos === lastReported) return;
    lastReported = pos;
    onPosition(pos);
  };

  const frame = (ts: number): void => {
    handle = null;
    if (detached) return;
    if (lastTs !== null) engine.tick(ts - lastTs);
    lastTs = ts;
    report();
    schedule();
  };

  const schedule = (): void => {
    const s = engine.getSnapshot();
    const active = s.playing && !s.held;
    if (!active) {
      lastTs = null;
      return;
    }
    if (handle === null && request) handle = request(frame);
  };

  const unsubscribe = engine.subscribeCoarse(() => {
    if (detached) return;
    report();
    const s = engine.getSnapshot();
    if (!(s.playing && !s.held)) {
      if (handle !== null && cancel) cancel(handle);
      handle = null;
      lastTs = null;
    } else {
      schedule();
    }
  });

  report();
  schedule();

  return () => {
    if (detached) return;
    detached = true;
    unsubscribe();
    if (handle !== null && cancel) cancel(handle);
    handle = null;
  };
}
