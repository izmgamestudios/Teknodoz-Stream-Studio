import { describe, expect, it, vi } from "vitest";

import type { Rect } from "../types";
import {
  drawDeviceFrame,
  drawDeviceOverlay,
  frameGeometry,
  MOBILE_SCREEN,
} from "./frames";

const BOX: Rect = { x: 100, y: 50, w: 1000, h: 800 };
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 1e-6 &&
  inner.y >= outer.y - 1e-6 &&
  inner.x + inner.w <= outer.x + outer.w + 1e-6 &&
  inner.y + inner.h <= outer.y + outer.h + 1e-6;

describe("frameGeometry", () => {
  it("kind none returns the box untouched", () => {
    const g = frameGeometry("none", BOX);
    expect(g.screen).toEqual(BOX);
    expect(g.outer).toEqual(BOX);
  });

  it("mobile: letterboxed inside the box, aspect preserved, screen is 390:844", () => {
    const g = frameGeometry("mobile", BOX);
    expect(inside(g.outer, BOX)).toBe(true);
    expect(inside(g.screen, g.outer)).toBe(true);
    expect(g.screen.w / g.screen.h).toBeCloseTo(
      MOBILE_SCREEN.w / MOBILE_SCREEN.h,
      5,
    );
    // limited by height in a landscape-ish box
    expect(g.outer.h).toBeCloseTo(BOX.h, 5);
    expect(g.outer.x + g.outer.w / 2).toBeCloseTo(BOX.x + BOX.w / 2, 5);
  });

  it("mobile in a tall narrow box is limited by width", () => {
    const g = frameGeometry("mobile", { x: 0, y: 0, w: 200, h: 2000 });
    expect(g.outer.w).toBeCloseTo(200, 5);
    expect(g.outer.h).toBeLessThan(2000);
  });

  it("desktop: 16:9 window, toolbar above the screen", () => {
    const g = frameGeometry("desktop", BOX);
    expect(g.outer.w / g.outer.h).toBeCloseTo(16 / 9, 5);
    expect(inside(g.outer, BOX)).toBe(true);
    expect(inside(g.screen, g.outer)).toBe(true);
    expect(g.screen.y).toBeGreaterThan(g.outer.y + g.toolbarH - 1e-6);
  });

  it("is deterministic and scales linearly", () => {
    const a = frameGeometry("mobile", BOX);
    const b = frameGeometry("mobile", BOX);
    expect(a).toEqual(b);
    const big = frameGeometry("mobile", { ...BOX, w: BOX.w * 2, h: BOX.h * 2 });
    expect(big.screen.w / a.screen.w).toBeCloseTo(2, 5);
  });
});

function fakeCtx() {
  const calls: string[] = [];
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      if (prop === "roundRect") return undefined; // force the arcTo fallback path
      return (..._a: unknown[]) => void calls.push(prop);
    },
    set() {
      return true;
    },
  };
  return {
    ctx: new Proxy({}, handler) as unknown as CanvasRenderingContext2D,
    calls,
  };
}

describe("drawing", () => {
  it("drawDeviceFrame returns the same screen rect as frameGeometry and balances save/restore", () => {
    for (const kind of ["mobile", "desktop", "none"] as const) {
      const { ctx, calls } = fakeCtx();
      const r = drawDeviceFrame(ctx, kind, BOX, {
        url: "https://example.com/app",
      });
      expect(r).toEqual(frameGeometry(kind, BOX).screen);
      expect(calls.filter((c) => c === "save").length).toBe(
        calls.filter((c) => c === "restore").length,
      );
    }
  });

  it("falls back to arcTo when ctx.roundRect is missing", () => {
    const { ctx, calls } = fakeCtx();
    drawDeviceFrame(ctx, "mobile", BOX);
    expect(calls).toContain("arcTo");
  });

  it("overlay only draws for mobile and fills even-odd", () => {
    const a = fakeCtx();
    drawDeviceOverlay(a.ctx, "desktop", BOX);
    expect(a.calls).toEqual([]);
    const fill = vi.fn();
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      arcTo() {},
      closePath() {},
      fill,
      set fillStyle(_v: string) {},
    } as unknown as CanvasRenderingContext2D;
    drawDeviceOverlay(ctx, "mobile", BOX);
    expect(fill).toHaveBeenCalledWith("evenodd");
  });
});
