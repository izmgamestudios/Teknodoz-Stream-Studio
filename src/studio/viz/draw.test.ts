import { describe, expect, it } from "vitest";

import {
  binSpectrum,
  drawViz,
  seriesColors,
  smoothBars,
  type VizSeries,
} from "./draw";

describe("binSpectrum", () => {
  it("returns the requested number of bars in 0..1", () => {
    const data = new Uint8Array(512).fill(128);
    const bars = binSpectrum(data, 32);
    expect(bars).toHaveLength(32);
    for (const b of bars) {
      expect(b).toBeGreaterThan(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });
  it("puts a low tone in the left bars and a high tone in the right bars (log axis)", () => {
    const rate = 48_000;
    const bins = 512;
    const hz = (f: number) => Math.round(f / (rate / 2 / bins));
    const low = new Uint8Array(bins);
    low[hz(200)] = 255;
    const high = new Uint8Array(bins);
    high[hz(6000)] = 255;
    const bl = binSpectrum(low, 24, rate);
    const bh = binSpectrum(high, 24, rate);
    expect(bl.indexOf(Math.max(...bl))).toBeLessThan(8);
    expect(bh.indexOf(Math.max(...bh))).toBeGreaterThan(14);
  });
  it("is silent for silence and survives empty input", () => {
    expect(binSpectrum(new Uint8Array(512), 8).every((b) => b === 0)).toBe(
      true,
    );
    expect(binSpectrum([], 4)).toEqual([0, 0, 0, 0]);
  });
});

describe("smoothBars", () => {
  it("rises fast and falls slowly", () => {
    const up = smoothBars([0], [1])[0] as number;
    expect(up).toBeGreaterThan(0.6);
    const down = smoothBars([1], [0], 0.8)[0] as number;
    expect(down).toBeGreaterThan(0.7);
    expect(smoothBars(undefined, [0.5, 0.2])).toHaveLength(2);
  });
});

describe("seriesColors", () => {
  it("uses the two accents, then distinct extra colours", () => {
    const c = seriesColors(4, "#111111", "#222222");
    expect(c.slice(0, 2)).toEqual(["#111111", "#222222"]);
    expect(new Set(c).size).toBe(4);
  });
});

function fakeCtx() {
  const calls: string[] = [];
  const ctx = new Proxy(
    { measureText: () => ({ width: 40 }) } as Record<string, unknown>,
    {
      get(t, k: string) {
        if (k in t) return t[k];
        return (...a: unknown[]) => void calls.push(`${k}(${a.length})`);
      },
      set(t, k: string, v) {
        t[k] = v;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("drawViz", () => {
  const series = (n: number): VizSeries[] =>
    Array.from({ length: n }, (_, i) => ({
      label: `S${i}`,
      color: "#fff",
      bars: [0.2, 0.9, 0.4, 0.1],
      level: 0.5,
    }));
  it("draws something for every style and ignores a box that is too small", () => {
    for (const style of ["bars", "mirror", "wave", "ring"] as const) {
      const { ctx, calls } = fakeCtx();
      drawViz(ctx, { x: 0, y: 0, w: 400, h: 200 }, series(2), {
        style,
        labels: true,
        background: "#000",
      });
      expect(calls.length, style).toBeGreaterThan(10);
    }
    const tiny = fakeCtx();
    drawViz(tiny.ctx, { x: 0, y: 0, w: 2, h: 2 }, series(1), {
      style: "bars",
      labels: true,
      background: "#000",
    });
    expect(tiny.calls).toHaveLength(0);
  });
  it("draws no background when transparent and nothing for no series", () => {
    const { ctx, calls } = fakeCtx();
    drawViz(ctx, { x: 0, y: 0, w: 400, h: 200 }, [], {
      style: "bars",
      labels: false,
      background: "transparent",
    });
    expect(calls).toHaveLength(0);
  });
});
