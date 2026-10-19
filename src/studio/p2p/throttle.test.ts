import { afterEach, describe, expect, it, vi } from "vitest";
import { FixedWindowLimiter, LeadingTrailingThrottle } from "./throttle";

afterEach(() => {
  vi.useRealTimers();
});

describe("FixedWindowLimiter", () => {
  it("allows `limit` events per window and starts a fresh window afterwards", () => {
    let t = 1000;
    const limiter = new FixedWindowLimiter(3, 1000, () => t);
    expect([1, 2, 3, 4, 5].map(() => limiter.allow())).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    t += 999;
    expect(limiter.allow()).toBe(false);
    t += 1;
    expect([1, 2, 3, 4].map(() => limiter.allow())).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("treats a backwards clock jump as a new window instead of locking up", () => {
    let t = 5_000_000;
    const limiter = new FixedWindowLimiter(1, 1000, () => t);
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(false);
    t = 1_000; // clock stepped back an hour
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(false);
  });

  it("uses the wall clock by default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const limiter = new FixedWindowLimiter(1, 1000);
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(false);
    vi.setSystemTime(11_000);
    expect(limiter.allow()).toBe(true);
  });
});

describe("LeadingTrailingThrottle", () => {
  it("emits the first value immediately and coalesces the rest into one trailing emit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const out: number[] = [];
    const throttle = new LeadingTrailingThrottle<number>(
      100,
      (v) => void out.push(v),
    );
    throttle.push(1);
    throttle.push(2);
    throttle.push(3);
    expect(out).toEqual([1]);
    vi.advanceTimersByTime(99);
    expect(out).toEqual([1]);
    vi.advanceTimersByTime(1);
    expect(out).toEqual([1, 3]);
    vi.advanceTimersByTime(1000);
    expect(out).toEqual([1, 3]); // nothing pending any more
  });

  it("waits only for the remainder of the interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const out: number[] = [];
    const throttle = new LeadingTrailingThrottle<number>(
      100,
      (v) => void out.push(v),
    );
    throttle.push(1);
    vi.advanceTimersByTime(60);
    throttle.push(2);
    vi.advanceTimersByTime(39);
    expect(out).toEqual([1]);
    vi.advanceTimersByTime(1);
    expect(out).toEqual([1, 2]);
  });

  it("never exceeds the configured rate under sustained input", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let emitted = 0;
    const throttle = new LeadingTrailingThrottle<number>(
      100,
      () => void emitted++,
    );
    for (let i = 0; i < 1000; i++) {
      throttle.push(i);
      vi.advanceTimersByTime(1);
    }
    vi.advanceTimersByTime(200);
    expect(emitted).toBeGreaterThanOrEqual(10);
    expect(emitted).toBeLessThanOrEqual(11);
  });

  it("emits immediately again once the interval has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const out: string[] = [];
    const throttle = new LeadingTrailingThrottle<string>(
      100,
      (v) => void out.push(v),
    );
    throttle.push("a");
    vi.advanceTimersByTime(150);
    throttle.push("b");
    expect(out).toEqual(["a", "b"]);
  });

  it("cancel drops the pending trailing emit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const out: number[] = [];
    const throttle = new LeadingTrailingThrottle<number>(
      100,
      (v) => void out.push(v),
    );
    throttle.push(1);
    throttle.push(2);
    throttle.cancel();
    vi.advanceTimersByTime(500);
    expect(out).toEqual([1]);
    throttle.push(3); // still usable afterwards
    expect(out).toEqual([1, 3]);
  });

  it("survives the clock jumping backwards", () => {
    let t = 9_000_000;
    const out: number[] = [];
    const throttle = new LeadingTrailingThrottle<number>(
      100,
      (v) => void out.push(v),
      () => t,
    );
    throttle.push(1);
    t = 1_000;
    throttle.push(2);
    expect(out).toEqual([1, 2]);
  });
});
