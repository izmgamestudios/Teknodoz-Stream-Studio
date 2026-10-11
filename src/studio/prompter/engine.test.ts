import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachRaf,
  MAX_SPEED_PX,
  MAX_TICK_DT_MS,
  PrompterEngine,
} from "./engine";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PrompterEngine basics", () => {
  it("starts paused at 0 with the default speed", () => {
    const e = new PrompterEngine();
    expect(e.getSnapshot()).toMatchObject({
      playing: false,
      speedPx: 60,
      positionPx: 0,
      maxPx: 0,
      held: false,
      atEnd: false,
    });
  });

  it("accepts constructor options and sanitises them", () => {
    const e = new PrompterEngine({
      speedPx: 9999,
      maxPx: 500,
      positionPx: 700,
    });
    expect(e.getSnapshot()).toMatchObject({
      speedPx: MAX_SPEED_PX,
      maxPx: 500,
      positionPx: 500,
    });
    expect(
      new PrompterEngine({ speedPx: Number.NaN }).getSnapshot().speedPx,
    ).toBe(60);
  });

  it("play / pause / toggle", () => {
    const e = new PrompterEngine({ maxPx: 1000 });
    e.play();
    expect(e.getSnapshot().playing).toBe(true);
    e.pause();
    expect(e.getSnapshot().playing).toBe(false);
    e.toggle();
    expect(e.getSnapshot().playing).toBe(true);
    e.toggle();
    expect(e.getSnapshot().playing).toBe(false);
  });

  it("does not advance while paused", () => {
    const e = new PrompterEngine({ maxPx: 1000 });
    e.tick(16);
    expect(e.getSnapshot().positionPx).toBe(0);
  });
});

describe("tick", () => {
  it("advances speedPx per second using real dt", () => {
    const e = new PrompterEngine({ speedPx: 60, maxPx: 10_000 });
    e.play();
    e.tick(50);
    e.tick(50);
    expect(e.getSnapshot().positionPx).toBeCloseTo(6, 9);
  });

  it("is independent of the frame rate", () => {
    const a = new PrompterEngine({ speedPx: 100, maxPx: 10_000 });
    const b = new PrompterEngine({ speedPx: 100, maxPx: 10_000 });
    a.play();
    b.play();
    for (let i = 0; i < 60; i++) a.tick(1000 / 60);
    for (let i = 0; i < 30; i++) b.tick(1000 / 30);
    expect(a.getSnapshot().positionPx).toBeCloseTo(100, 6);
    expect(b.getSnapshot().positionPx).toBeCloseTo(100, 6);
  });

  it("accumulates sub-pixel movement at slow speeds", () => {
    const e = new PrompterEngine({ speedPx: 5, maxPx: 1000 });
    e.play();
    for (let i = 0; i < 120; i++) e.tick(1000 / 60);
    // 2 seconds * 5 px/s, even though each frame moves only ~0.083px
    expect(e.getSnapshot().positionPx).toBeCloseTo(10, 6);
  });

  it("clamps dt spikes", () => {
    const e = new PrompterEngine({ speedPx: 100, maxPx: 10_000 });
    e.play();
    e.tick(60_000);
    expect(e.getSnapshot().positionPx).toBeCloseTo(
      (100 * MAX_TICK_DT_MS) / 1000,
      9,
    );
  });

  it("ignores invalid dt values", () => {
    const e = new PrompterEngine({ speedPx: 100, maxPx: 10_000 });
    e.play();
    for (const dt of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) e.tick(dt);
    // Infinity is not finite -> ignored too
    expect(e.getSnapshot().positionPx).toBe(0);
  });

  it("does not move at speed 0 or when maxPx is unknown", () => {
    const stopped = new PrompterEngine({ speedPx: 0, maxPx: 100 });
    stopped.play();
    stopped.tick(50);
    expect(stopped.getSnapshot().positionPx).toBe(0);
    expect(stopped.getSnapshot().playing).toBe(true);

    const unknown = new PrompterEngine({ speedPx: 100 });
    const onEnd = vi.fn();
    unknown.onEnd(onEnd);
    unknown.play();
    unknown.tick(50);
    expect(unknown.getSnapshot()).toMatchObject({
      positionPx: 0,
      playing: true,
    });
    expect(onEnd).not.toHaveBeenCalled();
    unknown.setMaxPx(1000);
    unknown.tick(50);
    expect(unknown.getSnapshot().positionPx).toBeCloseTo(5, 9);
  });
});

describe("end of script", () => {
  it("stops at maxPx and fires onEnd exactly once", () => {
    const onEnd = vi.fn();
    const e = new PrompterEngine({ speedPx: 600, maxPx: 100, onEnd });
    e.play();
    e.tick(100); // 60px
    expect(e.getSnapshot()).toMatchObject({
      positionPx: 60,
      playing: true,
      atEnd: false,
    });
    e.tick(100); // would be 120px -> clamped
    expect(e.getSnapshot()).toMatchObject({
      positionPx: 100,
      playing: false,
      atEnd: true,
    });
    e.tick(100);
    e.tick(100);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("supports multiple onEnd listeners and unsubscribe", () => {
    const e = new PrompterEngine({ speedPx: 600, maxPx: 10 });
    const a = vi.fn();
    const b = vi.fn();
    const offA = e.onEnd(a);
    e.onEnd(b);
    offA();
    e.play();
    e.tick(100);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("play() at the end restarts from the top", () => {
    const e = new PrompterEngine({ speedPx: 600, maxPx: 10 });
    e.play();
    e.tick(100);
    expect(e.getSnapshot().atEnd).toBe(true);
    e.play();
    expect(e.getSnapshot()).toMatchObject({
      playing: true,
      positionPx: 0,
      atEnd: false,
    });
  });

  it("shrinking maxPx below the position clamps it and ends on the next tick", () => {
    const onEnd = vi.fn();
    const e = new PrompterEngine({ speedPx: 60, maxPx: 1000, onEnd });
    e.play();
    e.seek(500);
    e.setMaxPx(200);
    expect(e.getSnapshot().positionPx).toBe(200);
    e.tick(16);
    expect(e.getSnapshot().playing).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("speed", () => {
  it("clamps to 0..600 and ignores non-finite values", () => {
    const e = new PrompterEngine();
    e.setSpeed(-20);
    expect(e.getSnapshot().speedPx).toBe(0);
    e.setSpeed(10_000);
    expect(e.getSnapshot().speedPx).toBe(MAX_SPEED_PX);
    e.setSpeed(123);
    e.setSpeed(Number.NaN);
    e.setSpeed(Number.POSITIVE_INFINITY);
    expect(e.getSnapshot().speedPx).toBe(123);
  });

  it("speedUp / speedDown use a step of 10 by default and clamp", () => {
    const e = new PrompterEngine({ speedPx: 60 });
    e.speedUp();
    expect(e.getSnapshot().speedPx).toBe(70);
    e.speedDown();
    e.speedDown();
    expect(e.getSnapshot().speedPx).toBe(50);
    e.speedUp(25);
    expect(e.getSnapshot().speedPx).toBe(75);
    e.speedDown(1000);
    expect(e.getSnapshot().speedPx).toBe(0);
    e.setSpeed(595);
    e.speedUp(10);
    expect(e.getSnapshot().speedPx).toBe(MAX_SPEED_PX);
    e.speedUp(Number.NaN);
    expect(e.getSnapshot().speedPx).toBe(MAX_SPEED_PX);
  });
});

describe("rewind / seek / setMaxPx", () => {
  it("rewind goes to 0 and pauses", () => {
    const e = new PrompterEngine({ speedPx: 100, maxPx: 1000 });
    e.play();
    e.tick(100);
    e.rewind();
    expect(e.getSnapshot()).toMatchObject({ positionPx: 0, playing: false });
  });

  it("seek clamps to 0..maxPx and keeps play state", () => {
    const e = new PrompterEngine({ maxPx: 300 });
    e.play();
    e.seek(120);
    expect(e.getSnapshot()).toMatchObject({ positionPx: 120, playing: true });
    e.seek(-50);
    expect(e.getSnapshot().positionPx).toBe(0);
    e.seek(9999);
    expect(e.getSnapshot().positionPx).toBe(300);
    e.seek(Number.NaN);
    expect(e.getSnapshot().positionPx).toBe(300);
  });

  it("seek is clamped to 0 while maxPx is unknown", () => {
    const e = new PrompterEngine();
    e.seek(400);
    expect(e.getSnapshot().positionPx).toBe(0);
  });

  it("setMaxPx ignores invalid values and floors negatives at 0", () => {
    const e = new PrompterEngine({ maxPx: 100 });
    e.setMaxPx(Number.NaN);
    expect(e.getSnapshot().maxPx).toBe(100);
    e.setMaxPx(-5);
    expect(e.getSnapshot().maxPx).toBe(0);
  });
});

describe("hold / release", () => {
  it("freezes scrolling while held without pausing", () => {
    const e = new PrompterEngine({ speedPx: 100, maxPx: 1000 });
    e.play();
    e.tick(100);
    e.hold("voice");
    e.tick(100);
    e.tick(100);
    expect(e.getSnapshot()).toMatchObject({
      playing: true,
      held: true,
      holdReasons: ["voice"],
      positionPx: 10,
    });
    expect(e.isHeld()).toBe(true);
    expect(e.isHeld("voice")).toBe(true);
    expect(e.isHeld("other")).toBe(false);
    e.release("voice");
    e.tick(100);
    expect(e.getSnapshot()).toMatchObject({
      held: false,
      holdReasons: [],
      positionPx: 20,
    });
  });

  it("needs every reason to be released", () => {
    const e = new PrompterEngine({ speedPx: 100, maxPx: 1000 });
    e.play();
    e.hold("a");
    e.hold("b");
    e.hold("a");
    expect(e.getSnapshot().holdReasons).toEqual(["a", "b"]);
    e.release("a");
    e.tick(100);
    expect(e.getSnapshot().positionPx).toBe(0);
    e.release("b");
    e.tick(100);
    expect(e.getSnapshot().positionPx).toBeCloseTo(10, 9);
  });

  it("release() without a reason clears all holds; default reason is 'manual'", () => {
    const e = new PrompterEngine({ speedPx: 100, maxPx: 1000 });
    e.hold();
    expect(e.getSnapshot().holdReasons).toEqual(["manual"]);
    e.hold("x");
    e.release();
    expect(e.getSnapshot().held).toBe(false);
  });

  it("releasing something that is not held is a no-op", () => {
    const e = new PrompterEngine();
    const l = vi.fn();
    e.subscribe(l);
    e.release("nope");
    e.release();
    expect(l).not.toHaveBeenCalled();
  });

  it("rewind keeps holds", () => {
    const e = new PrompterEngine({ maxPx: 100 });
    e.hold("voice");
    e.rewind();
    expect(e.getSnapshot().held).toBe(true);
  });
});

describe("store API", () => {
  it("getSnapshot returns a stable reference until something changes", () => {
    const e = new PrompterEngine({ maxPx: 100 });
    const a = e.getSnapshot();
    expect(e.getSnapshot()).toBe(a);
    expect(e.getServerSnapshot()).toBe(a);
    e.setSpeed(61);
    expect(e.getSnapshot()).not.toBe(a);
    const b = e.getSnapshot();
    e.setSpeed(61); // unchanged -> no new snapshot
    expect(e.getSnapshot()).toBe(b);
  });

  it("snapshots are frozen", () => {
    const s = new PrompterEngine().getSnapshot();
    expect(Object.isFrozen(s)).toBe(true);
  });

  it("subscribe fires on every change including playback ticks", () => {
    const e = new PrompterEngine({ speedPx: 100, maxPx: 1000 });
    const l = vi.fn();
    const off = e.subscribe(l);
    e.play();
    expect(l).toHaveBeenCalledTimes(1);
    e.tick(10);
    e.tick(10);
    expect(l).toHaveBeenCalledTimes(3);
    off();
    e.tick(10);
    expect(l).toHaveBeenCalledTimes(3);
  });

  it("subscribeCoarse skips continuous ticks but reports discrete changes", () => {
    const e = new PrompterEngine({ speedPx: 100, maxPx: 1000 });
    const l = vi.fn();
    e.subscribeCoarse(l);
    e.play();
    e.tick(10);
    e.tick(10);
    expect(l).toHaveBeenCalledTimes(1);
    e.seek(500);
    e.setSpeed(10);
    e.hold("x");
    e.release("x");
    e.pause();
    expect(l).toHaveBeenCalledTimes(6);
  });

  it("can be passed unbound to useSyncExternalStore", () => {
    const e = new PrompterEngine();
    const { subscribe, getSnapshot } = e;
    const l = vi.fn();
    const off = subscribe(l);
    e.play();
    expect(getSnapshot().playing).toBe(true);
    off();
  });

  it("a throwing listener does not break the engine or other listeners", () => {
    vi.useFakeTimers();
    const e = new PrompterEngine();
    const ok = vi.fn();
    e.subscribe(() => {
      throw new Error("boom");
    });
    e.subscribe(ok);
    e.play();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(e.getSnapshot().playing).toBe(true);
    expect(() => vi.runAllTimers()).toThrow("boom");
  });
});

describe("attachRaf", () => {
  function fakeRaf() {
    let nextId = 1;
    const queue = new Map<number, (t: number) => void>();
    return {
      requestFrame: (cb: (t: number) => void) => {
        const id = nextId++;
        queue.set(id, cb);
        return id;
      },
      cancelFrame: (id: number) => {
        queue.delete(id);
      },
      pending: () => queue.size,
      step(ts: number) {
        const entries = [...queue.entries()];
        queue.clear();
        for (const [, cb] of entries) cb(ts);
      },
    };
  }

  it("reports the initial position and does not run frames while paused", () => {
    const e = new PrompterEngine({ maxPx: 1000 });
    const raf = fakeRaf();
    const onPos = vi.fn();
    const detach = attachRaf(e, onPos, raf);
    expect(onPos).toHaveBeenCalledWith(0);
    expect(raf.pending()).toBe(0);
    detach();
  });

  it("ticks with real frame deltas while playing and stops when paused", () => {
    const e = new PrompterEngine({ speedPx: 100, maxPx: 1000 });
    const raf = fakeRaf();
    const positions: number[] = [];
    attachRaf(e, (p) => positions.push(p), raf);
    e.play();
    expect(raf.pending()).toBe(1);
    raf.step(1000); // first frame only establishes the time base
    raf.step(1016);
    raf.step(1032);
    expect(positions[positions.length - 1]).toBeCloseTo(3.2, 6);
    e.pause();
    expect(raf.pending()).toBe(0);
  });

  it("does not skip when the first frame timestamp is huge", () => {
    const e = new PrompterEngine({ speedPx: 100, maxPx: 1000 });
    const raf = fakeRaf();
    attachRaf(e, () => {}, raf);
    e.play();
    raf.step(9_999_999);
    expect(e.getSnapshot().positionPx).toBe(0);
  });

  it("pauses the frame loop while held and resumes on release with a fresh time base", () => {
    const e = new PrompterEngine({ speedPx: 100, maxPx: 1000 });
    const raf = fakeRaf();
    attachRaf(e, () => {}, raf);
    e.play();
    raf.step(0);
    raf.step(100);
    expect(e.getSnapshot().positionPx).toBeCloseTo(10, 6);
    e.hold("voice");
    expect(raf.pending()).toBe(0);
    e.release("voice");
    expect(raf.pending()).toBe(1);
    raf.step(60_000); // long pause: first frame after resume must not add time
    expect(e.getSnapshot().positionPx).toBeCloseTo(10, 6);
    raf.step(60_100);
    expect(e.getSnapshot().positionPx).toBeCloseTo(20, 6);
  });

  it("reports discrete jumps while paused", () => {
    const e = new PrompterEngine({ maxPx: 1000 });
    const raf = fakeRaf();
    const onPos = vi.fn();
    attachRaf(e, onPos, raf);
    e.seek(250);
    expect(onPos).toHaveBeenLastCalledWith(250);
    e.rewind();
    expect(onPos).toHaveBeenLastCalledWith(0);
  });

  it("stops the loop at the end of the script", () => {
    const e = new PrompterEngine({ speedPx: 600, maxPx: 30 });
    const raf = fakeRaf();
    const onPos = vi.fn();
    attachRaf(e, onPos, raf);
    e.play();
    raf.step(0);
    raf.step(100);
    expect(e.getSnapshot()).toMatchObject({ playing: false, positionPx: 30 });
    expect(raf.pending()).toBe(0);
    expect(onPos).toHaveBeenLastCalledWith(30);
  });

  it("detach cancels the pending frame and stops reporting", () => {
    const e = new PrompterEngine({ speedPx: 100, maxPx: 1000 });
    const raf = fakeRaf();
    const onPos = vi.fn();
    const detach = attachRaf(e, onPos, raf);
    e.play();
    expect(raf.pending()).toBe(1);
    detach();
    expect(raf.pending()).toBe(0);
    const calls = onPos.mock.calls.length;
    e.seek(100);
    e.play();
    raf.step(100);
    expect(onPos.mock.calls.length).toBe(calls);
    detach(); // idempotent
  });

  it("is SSR-safe without requestAnimationFrame", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    try {
      const e = new PrompterEngine({ maxPx: 100 });
      const onPos = vi.fn();
      const detach = attachRaf(e, onPos);
      e.play();
      expect(onPos).toHaveBeenCalledWith(0);
      expect(() => detach()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
