import { describe, expect, it, vi } from "vitest";
import {
  FrameStats,
  advancePacer,
  clampFps,
  createPacer,
  createTicker,
  frameIntervalMs,
  resetPacer,
  timerIntervalMs,
  type TickerEnv,
  type TimerHandle,
} from "./ticker";

describe("fps helpers", () => {
  it("clampFps bounds and sanitizes", () => {
    expect(clampFps(60)).toBe(60);
    expect(clampFps(0)).toBe(1);
    expect(clampFps(-5)).toBe(1);
    expect(clampFps(1000)).toBe(240);
    expect(clampFps(Number.NaN)).toBe(60);
    expect(clampFps(Number.POSITIVE_INFINITY)).toBe(60);
    expect(clampFps(29.97)).toBe(29.97);
    expect(clampFps("x" as unknown as number)).toBe(60);
  });

  it("frameIntervalMs is 1000/fps", () => {
    expect(frameIntervalMs(60)).toBeCloseTo(16.6667, 3);
    expect(frameIntervalMs(30)).toBeCloseTo(33.3333, 3);
    expect(frameIntervalMs(0)).toBe(1000);
  });

  it("timerIntervalMs rounds down so the timer over-ticks and the pacer thins", () => {
    expect(timerIntervalMs(60)).toBe(16);
    expect(timerIntervalMs(30)).toBe(33);
    expect(timerIntervalMs(240)).toBe(4);
    expect(timerIntervalMs(1)).toBe(1000);
  });
});

describe("advancePacer", () => {
  const I = 1000 / 60;

  it("renders the first tick immediately", () => {
    const p = createPacer();
    expect(advancePacer(p, 123, I)).toEqual({ render: true, dropped: 0 });
    expect(p.nextDue).toBeCloseTo(123 + I, 6);
  });

  it("skips ticks that arrive too early", () => {
    const p = createPacer();
    advancePacer(p, 0, I);
    expect(advancePacer(p, 4, I).render).toBe(false);
    expect(advancePacer(p, 8, I).render).toBe(false);
    expect(advancePacer(p, 12.4, I).render).toBe(false); // due 16.67, tolerance 4.17 -> 12.5
    expect(advancePacer(p, 12.6, I).render).toBe(true);
  });

  it("accepts slightly early ticks (jitter) without drifting the grid", () => {
    const p = createPacer();
    advancePacer(p, 0, I);
    advancePacer(p, 15, I); // 1.67 ms early
    expect(p.nextDue).toBeCloseTo(2 * I, 6); // grid stays at multiples of the interval
  });

  it("has no cumulative drift: 10 s of 144 Hz ticks yields ~600 frames at 60 fps", () => {
    const p = createPacer();
    let frames = 0;
    let dropped = 0;
    for (let t = 0; t <= 10_000; t += 1000 / 144) {
      const d = advancePacer(p, t, I);
      if (d.render) frames++;
      dropped += d.dropped;
    }
    expect(frames).toBeGreaterThanOrEqual(595);
    expect(frames).toBeLessThanOrEqual(605);
    expect(dropped).toBe(0);
  });

  it("has no cumulative drift with a coarse 16 ms timer", () => {
    const p = createPacer();
    let frames = 0;
    for (let t = 0; t <= 10_000; t += 16)
      if (advancePacer(p, t, I).render) frames++;
    expect(frames).toBeGreaterThanOrEqual(595);
    expect(frames).toBeLessThanOrEqual(605);
  });

  it("renders one frame for a late tick and counts the skipped slots (no catch-up burst)", () => {
    const p = createPacer();
    advancePacer(p, 0, I);
    const late = advancePacer(p, I + 2.5 * I, I); // 2.5 slots late
    expect(late).toEqual({ render: true, dropped: 2 });
    // The very next tick is not a catch-up frame.
    expect(advancePacer(p, I + 2.5 * I + 1, I).render).toBe(false);
    // And the grid continues without a phase jump.
    expect(p.nextDue % I).toBeCloseTo(0, 6);
  });

  it("counts nothing for a tick that is merely a little late", () => {
    const p = createPacer();
    advancePacer(p, 0, I);
    expect(advancePacer(p, I + 5, I)).toEqual({ render: true, dropped: 0 });
  });

  it("resyncs after a huge stall instead of reporting thousands of drops", () => {
    const p = createPacer();
    advancePacer(p, 0, I);
    const d = advancePacer(p, 60_000, I);
    expect(d).toEqual({ render: true, dropped: 0 });
    expect(p.nextDue).toBeCloseTo(60_000 + I, 6);
  });

  it("recovers when the clock goes backwards", () => {
    const p = createPacer();
    advancePacer(p, 100_000, I);
    expect(advancePacer(p, 5, I)).toEqual({ render: true, dropped: 0 });
    expect(advancePacer(p, 5 + I, I).render).toBe(true);
  });

  it("works at very low fps", () => {
    const p = createPacer();
    advancePacer(p, 0, 1000);
    expect(advancePacer(p, 500, 1000).render).toBe(false);
    expect(advancePacer(p, 1000, 1000).render).toBe(true);
  });

  it("ignores non-finite input", () => {
    const p = createPacer();
    expect(advancePacer(p, Number.NaN, I).render).toBe(false);
    expect(advancePacer(p, 0, 0).render).toBe(false);
    expect(advancePacer(p, 0, Number.NaN).render).toBe(false);
  });

  it("resetPacer re-anchors the grid", () => {
    const p = createPacer();
    advancePacer(p, 0, I);
    resetPacer(p);
    expect(advancePacer(p, 3, I).render).toBe(true);
  });
});

describe("FrameStats", () => {
  it("measures fps over a window and smooths the frame time", () => {
    const s = new FrameStats(500);
    for (let i = 0; i <= 60; i++) s.record(i * (1000 / 60), 4);
    const snap = s.snapshot();
    expect(snap.fps).toBeGreaterThan(58);
    expect(snap.fps).toBeLessThan(62);
    expect(snap.frameMs).toBeCloseTo(4, 5);
    expect(snap.droppedFrames).toBe(0);
  });

  it("smooths towards new frame times", () => {
    const s = new FrameStats();
    s.record(0, 10);
    s.record(16, 20);
    const ms = s.snapshot().frameMs;
    expect(ms).toBeGreaterThan(10);
    expect(ms).toBeLessThan(20);
  });

  it("accumulates drops and survives junk", () => {
    const s = new FrameStats();
    s.record(0, 5, 3);
    s.record(Number.NaN, Number.NaN, 2);
    s.addDropped(4);
    s.addDropped(-1);
    expect(s.snapshot().droppedFrames).toBe(9);
    expect(Number.isFinite(s.snapshot().fps)).toBe(true);
  });

  it("restarts the window if time goes backwards and can reset", () => {
    const s = new FrameStats(100);
    s.record(1000, 1);
    s.record(1050, 1);
    s.record(10, 1);
    s.record(60, 1);
    s.record(120, 1);
    expect(s.snapshot().fps).toBeGreaterThan(0);
    s.reset();
    expect(s.snapshot()).toEqual({ fps: 0, frameMs: 0, droppedFrames: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* Ticker with a fake platform                                         */
/* ------------------------------------------------------------------ */

function makeFakeEnv(
  opts: {
    raf?: boolean;
    visible?: boolean;
    timerKind?: "worker" | "interval";
  } = {},
) {
  let time = 0;
  let visible = opts.visible ?? true;
  let nextId = 1;
  const rafs = new Map<number, (ts: number) => void>();
  const visHandlers = new Set<() => void>();
  const timers = new Set<{
    period: number;
    onTick: () => void;
    handle: TimerHandle;
  }>();
  const watchdogs = new Set<{ period: number; onCheck: () => void }>();
  const env: TickerEnv = {
    now: () => time,
    requestFrame:
      opts.raf === false
        ? null
        : (cb) => {
            const id = nextId++;
            rafs.set(id, cb);
            return id;
          },
    cancelFrame: opts.raf === false ? null : (id) => void rafs.delete(id),
    isVisible: () => visible,
    onVisibilityChange: (h) => {
      visHandlers.add(h);
      return () => visHandlers.delete(h);
    },
    createTimer: (period, onTick) => {
      const entry = {
        period,
        onTick,
        handle: {
          kind: opts.timerKind ?? "worker",
          stop: () => void timers.delete(entry),
        } as TimerHandle,
      };
      timers.add(entry);
      return entry.handle;
    },
    startWatchdog: (period, onCheck) => {
      const w = { period, onCheck };
      watchdogs.add(w);
      return () => void watchdogs.delete(w);
    },
  };
  return {
    env,
    setTime: (t: number) => void (time = t),
    /** Fires every pending rAF callback once at the current time (like a vsync). */
    vsync: () => {
      const pending = [...rafs.entries()];
      rafs.clear();
      for (const [, cb] of pending) cb(time);
    },
    tickTimers: () => {
      for (const t of [...timers]) t.onTick();
    },
    runWatchdogs: () => {
      for (const w of [...watchdogs]) w.onCheck();
    },
    setVisible: (v: boolean) => {
      visible = v;
      for (const h of [...visHandlers]) h();
    },
    counts: () => ({
      rafs: rafs.size,
      timers: timers.size,
      watchdogs: watchdogs.size,
      listeners: visHandlers.size,
    }),
    timerPeriods: () => [...timers].map((t) => t.period),
  };
}

describe("createTicker", () => {
  it("uses rAF while visible and thins ticks to the target fps (144 Hz display, 60 fps)", () => {
    const fake = makeFakeEnv();
    const cb = vi.fn();
    const ticker = createTicker(cb, 60, fake.env);
    ticker.start();
    expect(ticker.mode).toBe("raf");
    expect(ticker.running).toBe(true);
    for (let i = 0; i < 1440; i++) {
      fake.setTime(i * (1000 / 144));
      fake.vsync();
    }
    // 10 seconds of 144 Hz vsyncs -> ~600 delivered frames.
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(595);
    expect(cb.mock.calls.length).toBeLessThanOrEqual(605);
    expect(fake.counts().rafs).toBe(1); // exactly one outstanding request, never a pile-up
    ticker.stop();
  });

  it("passes the frame timestamp and drop count", () => {
    const fake = makeFakeEnv();
    const calls: [number, number][] = [];
    const ticker = createTicker((n, d) => calls.push([n, d]), 60, fake.env);
    ticker.start();
    fake.setTime(100);
    fake.vsync();
    fake.setTime(100 + 16.6667 * 4); // four slots late
    fake.vsync();
    expect(calls[0]).toEqual([100, 0]);
    expect(calls[1]?.[0]).toBeCloseTo(100 + 16.6667 * 4, 3);
    expect(calls[1]?.[1]).toBe(3);
    ticker.stop();
  });

  it("switches to the timer when the tab gets hidden and back to rAF when visible again", () => {
    const fake = makeFakeEnv();
    const cb = vi.fn();
    const ticker = createTicker(cb, 60, fake.env);
    ticker.start();
    expect(ticker.mode).toBe("raf");

    fake.setVisible(false);
    expect(ticker.mode).toBe("worker");
    expect(fake.counts()).toMatchObject({ rafs: 0, timers: 1, watchdogs: 0 });
    expect(fake.timerPeriods()).toEqual([16]);

    // Timer ticks every 16 ms keep frames flowing at ~60 fps while hidden.
    for (let i = 1; i <= 625; i++) {
      fake.setTime(i * 16);
      fake.tickTimers();
    }
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(595);
    expect(cb.mock.calls.length).toBeLessThanOrEqual(605);

    fake.setVisible(true);
    expect(ticker.mode).toBe("raf");
    expect(fake.counts()).toMatchObject({ rafs: 1, timers: 0, watchdogs: 1 });
    ticker.stop();
  });

  it("starts on the timer when the tab is hidden or rAF does not exist", () => {
    const hidden = makeFakeEnv({ visible: false });
    const t1 = createTicker(vi.fn(), 30, hidden.env);
    t1.start();
    expect(t1.mode).toBe("worker");
    expect(hidden.timerPeriods()).toEqual([33]);
    t1.stop();

    const noRaf = makeFakeEnv({ raf: false, timerKind: "interval" });
    const t2 = createTicker(vi.fn(), 60, noRaf.env);
    t2.start();
    expect(t2.mode).toBe("interval");
    t2.stop();
  });

  it("falls back to the timer if rAF stalls while visible, and returns when rAF resumes", () => {
    const fake = makeFakeEnv();
    const cb = vi.fn();
    const ticker = createTicker(cb, 60, fake.env, { stallMs: 500 });
    ticker.start();
    fake.setTime(0);
    fake.vsync();
    expect(cb).toHaveBeenCalledTimes(1);

    // No vsync for a long time (occluded window), then the watchdog fires.
    fake.setTime(2000);
    fake.runWatchdogs();
    expect(ticker.mode).toBe("worker");
    expect(fake.counts().timers).toBe(1);
    expect(fake.counts().rafs).toBe(1); // probe

    fake.setTime(2016);
    fake.tickTimers();
    expect(cb).toHaveBeenCalledTimes(2);

    // rAF comes back: the probe fires and we move back to rAF.
    fake.setTime(2100);
    fake.vsync();
    expect(ticker.mode).toBe("raf");
    expect(fake.counts().timers).toBe(0);
    ticker.stop();
  });

  it("does not trip the watchdog while rAF keeps firing", () => {
    const fake = makeFakeEnv();
    const ticker = createTicker(vi.fn(), 60, fake.env, { stallMs: 500 });
    ticker.start();
    fake.setTime(100);
    fake.vsync();
    fake.setTime(400);
    fake.runWatchdogs();
    expect(ticker.mode).toBe("raf");
    ticker.stop();
  });

  it("stop releases everything and is idempotent; start is idempotent", () => {
    const fake = makeFakeEnv();
    const ticker = createTicker(vi.fn(), 60, fake.env);
    ticker.start();
    ticker.start();
    expect(fake.counts()).toEqual({
      rafs: 1,
      timers: 0,
      watchdogs: 1,
      listeners: 1,
    });
    ticker.stop();
    ticker.stop();
    expect(fake.counts()).toEqual({
      rafs: 0,
      timers: 0,
      watchdogs: 0,
      listeners: 0,
    });
    expect(ticker.running).toBe(false);
    expect(ticker.mode).toBe("stopped");

    // Hidden-mode cleanup too.
    fake.setVisible(false);
    ticker.start();
    expect(fake.counts().timers).toBe(1);
    ticker.stop();
    expect(fake.counts()).toEqual({
      rafs: 0,
      timers: 0,
      watchdogs: 0,
      listeners: 0,
    });
  });

  it("can be restarted after stop", () => {
    const fake = makeFakeEnv();
    const cb = vi.fn();
    const ticker = createTicker(cb, 60, fake.env);
    ticker.start();
    ticker.stop();
    ticker.start();
    fake.setTime(10);
    fake.vsync();
    expect(cb).toHaveBeenCalledTimes(1);
    ticker.stop();
  });

  it("ignores stale rAF callbacks delivered after stop", () => {
    const fake = makeFakeEnv();
    const cb = vi.fn();
    const ticker = createTicker(cb, 60, fake.env);
    ticker.start();
    ticker.stop();
    fake.vsync();
    expect(cb).not.toHaveBeenCalled();
  });

  it("setFps re-engages the driver with the new period", () => {
    const fake = makeFakeEnv({ visible: false });
    const ticker = createTicker(vi.fn(), 60, fake.env);
    ticker.start();
    expect(fake.timerPeriods()).toEqual([16]);
    ticker.setFps(30);
    expect(ticker.fps).toBe(30);
    expect(fake.timerPeriods()).toEqual([33]);
    ticker.setFps(Number.NaN);
    expect(ticker.fps).toBe(60);
    ticker.stop();
  });

  it("keeps ticking when the callback throws", () => {
    const fake = makeFakeEnv();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    const ticker = createTicker(
      () => {
        n++;
        throw new Error("boom");
      },
      60,
      fake.env,
    );
    ticker.start();
    fake.setTime(0);
    fake.vsync();
    fake.setTime(17);
    fake.vsync();
    expect(n).toBe(2);
    expect(ticker.running).toBe(true);
    ticker.stop();
    spy.mockRestore();
  });
});

describe("default environment (jsdom)", () => {
  it("runs on the real clock with rAF or the interval fallback and stops cleanly", async () => {
    const frames: number[] = [];
    const ticker = createTicker((now) => frames.push(now), 60);
    ticker.start();
    expect(ticker.running).toBe(true);
    await new Promise((r) => setTimeout(r, 120));
    ticker.stop();
    const after = frames.length;
    expect(after).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 60));
    expect(frames.length).toBe(after);
  });
});
