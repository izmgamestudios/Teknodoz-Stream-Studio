// src/studio/p2p/throttle.ts
// Two tiny rate-control primitives used by StudioHost. Both take an injectable clock and are
// robust to the wall clock jumping backwards (a negative elapsed time counts as "window over").

const wallClock = (): number => Date.now();

/** Fixed-window limiter: at most `limit` events per `windowMs`. */
export class FixedWindowLimiter {
  private start = Number.NEGATIVE_INFINITY;
  private count = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = wallClock,
  ) {}

  /** Register one event; true when it is within the budget, false when it must be dropped. */
  allow(): boolean {
    const t = this.now();
    const elapsed = t - this.start;
    if (!(elapsed >= 0 && elapsed < this.windowMs)) {
      this.start = t;
      this.count = 0;
    }
    this.count++;
    return this.count <= this.limit;
  }
}

/**
 * Leading + trailing throttle that keeps only the latest value: the first `push` is emitted
 * immediately, further pushes inside `intervalMs` are coalesced into ONE trailing emit of the
 * most recent value, so the emit rate never exceeds 1000 / intervalMs per second.
 */
export class LeadingTrailingThrottle<T> {
  private lastEmit = Number.NEGATIVE_INFINITY;
  private pending: { value: T } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly intervalMs: number,
    private readonly emit: (value: T) => void,
    private readonly now: () => number = wallClock,
  ) {}

  push(value: T): void {
    const elapsed = this.now() - this.lastEmit;
    if (!(elapsed >= 0 && elapsed < this.intervalMs)) {
      // interval over (or the clock went backwards): emit right away, drop anything pending
      this.clearTimer();
      this.pending = null;
      this.fire(value);
      return;
    }
    this.pending = { value };
    this.timer ??= setTimeout(() => {
      this.timer = null;
      const next = this.pending;
      this.pending = null;
      if (next) this.fire(next.value);
    }, this.intervalMs - elapsed);
  }

  /** Drop the pending trailing emit (e.g. on dispose). */
  cancel(): void {
    this.clearTimer();
    this.pending = null;
  }

  private fire(value: T): void {
    this.lastEmit = this.now();
    this.emit(value);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
