import { describe, expect, it } from "vitest";

import {
  getRippleField,
  LIFETIME_MS,
  MAX_RIPPLES,
  releaseRippleField,
  RippleField,
} from "./ripples";

function recCtx() {
  const calls: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_t, p: string) =>
        (..._a: unknown[]) =>
          void calls.push(p),
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("RippleField", () => {
  it("expires ripples after their lifetime", () => {
    const f = new RippleField();
    f.add(0.5, 0.5, 0, "touch");
    f.add(0.2, 0.2, 0, "click");
    expect(f.prune(LIFETIME_MS.click - 1)).toBe(2);
    expect(f.prune(LIFETIME_MS.click)).toBe(1);
    expect(f.prune(LIFETIME_MS.touch)).toBe(0);
  });

  it("caps live ripples, keeping the newest", () => {
    const f = new RippleField();
    for (let i = 0; i < MAX_RIPPLES + 10; i++) f.add(i / 100, 0.5, i, "touch");
    expect(f.count).toBe(MAX_RIPPLES);
    expect(f.snapshot()[0]?.t0).toBe(10);
  });

  it("clamps normalized coords and ignores non-finite input", () => {
    const f = new RippleField();
    f.add(-3, 9, 0);
    f.add(NaN, 0.5, 0);
    expect(f.count).toBe(1);
    expect(f.snapshot()[0]).toMatchObject({ nx: 0, ny: 1 });
  });

  it("draw is a no-op when empty and balanced when not", () => {
    const f = new RippleField();
    const empty = recCtx();
    f.draw(empty.ctx, { x: 0, y: 0, w: 100, h: 100 }, 0);
    expect(empty.calls).toEqual([]);
    f.add(0.5, 0.5, 0, "touch");
    f.add(0.6, 0.6, 10, "drag");
    f.add(0.61, 0.61, 50, "drag");
    f.add(0.3, 0.3, 20, "click");
    const r = recCtx();
    f.draw(r.ctx, { x: 0, y: 0, w: 100, h: 100 }, 100);
    expect(r.calls.filter((c) => c === "save").length).toBe(
      r.calls.filter((c) => c === "restore").length,
    );
    expect(r.calls).toContain("stroke");
  });

  it("registry returns the same field per layer until released", () => {
    const a = getRippleField("L1");
    expect(getRippleField("L1")).toBe(a);
    releaseRippleField("L1");
    expect(getRippleField("L1")).not.toBe(a);
    releaseRippleField("L1");
  });
});
