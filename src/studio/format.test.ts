import { describe, expect, it } from "vitest";

import { createLayer, createScene, defaultProject } from "./defaults";
import {
  FORMATS,
  fitScenes,
  fitTransform,
  formatOf,
  orientationOf,
  orientedSize,
  stageFor,
} from "./format";
import { createProjectStore } from "./project/store";
import { orientQuality, QUALITIES } from "./live/platforms";

describe("stageFor", () => {
  it("keeps 16:9 outputs on the classic 1920x1080 stage (any resolution)", () => {
    for (const [w, h] of [
      [1920, 1080],
      [1280, 720],
      [3840, 2160],
      [854, 480],
    ])
      expect(stageFor(w!, h!)).toEqual({ w: 1920, h: 1080 });
  });
  it("uses a 1080-wide stage for vertical and a 1080-high stage for the rest", () => {
    expect(stageFor(1080, 1920)).toEqual({ w: 1080, h: 1920 });
    expect(stageFor(720, 1280)).toEqual({ w: 1080, h: 1920 });
    expect(stageFor(1080, 1350)).toEqual({ w: 1080, h: 1350 });
    expect(stageFor(1080, 1080)).toEqual({ w: 1080, h: 1080 });
    expect(stageFor(1440, 1080)).toEqual({ w: 1440, h: 1080 });
  });
  it("falls back safely", () => {
    expect(stageFor(0, 0)).toEqual({ w: 1920, h: 1080 });
    expect(stageFor(NaN, 5)).toEqual({ w: 1920, h: 1080 });
  });
  it("every preset format has a matching orientation", () => {
    for (const f of FORMATS) {
      expect(orientationOf(f.width, f.height)).toBe(f.orientation);
      expect(formatOf(f.width, f.height)?.id).toBe(f.id);
    }
  });
});

describe("fitTransform", () => {
  const L = { w: 1920, h: 1080 };
  const P = { w: 1080, h: 1920 };
  it("keeps full-frame layers full-frame", () => {
    expect(
      fitTransform({ x: 0, y: 0, w: 1920, h: 1080, rotation: 0 }, L, P),
    ).toEqual({ x: 0, y: 0, w: 1080, h: 1920, rotation: 0 });
  });
  it("keeps cameras inside the stage and preserves their aspect ratio", () => {
    const t = fitTransform(
      { x: 1360, y: 700, w: 480, h: 270, rotation: 0 },
      L,
      P,
    );
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.y).toBeGreaterThanOrEqual(0);
    expect(t.x + t.w).toBeLessThanOrEqual(P.w);
    expect(t.y + t.h).toBeLessThanOrEqual(P.h);
    expect(t.w / t.h).toBeCloseTo(480 / 270, 1);
  });
  it("lets wide strips (banners) keep their width", () => {
    const t = fitTransform({ x: 0, y: 990, w: 1920, h: 90, rotation: 0 }, L, P);
    expect(t.w).toBe(1080);
    expect(t.h).toBeGreaterThanOrEqual(50);
  });
  it("is a no-op for the same stage and round-trips full frames", () => {
    const t = { x: 10, y: 20, w: 300, h: 200, rotation: 15 };
    expect(fitTransform(t, L, L)).toBe(t);
    const full = { x: 0, y: 0, w: 1920, h: 1080, rotation: 0 };
    expect(fitTransform(fitTransform(full, L, P), P, L)).toEqual(full);
  });
  it("never produces non-finite numbers", () => {
    for (const to of [P, { w: 1080, h: 1080 }, { w: 1440, h: 1080 }])
      for (const x of [-50, 0, 960, 1900, 5000]) {
        const t = fitTransform(
          { x, y: x / 2, w: 400, h: 300, rotation: 0 },
          L,
          to,
        );
        expect(Object.values(t).every(Number.isFinite)).toBe(true);
      }
  });
});

describe("store.setOutputFormat", () => {
  it("changes the output size, re-lays scenes out, and can be undone", () => {
    const store = createProjectStore(defaultProject());
    const before = store.getState();
    store.setOutputFormat(1080, 1920);
    const after = store.getState();
    expect(after.settings.output.width).toBe(1080);
    expect(after.settings.output.height).toBe(1920);
    const cam = after.scenes[0]!.layers[0]!;
    expect(cam.transform).toMatchObject({ w: 1080, h: 1920 });
    store.undo();
    expect(store.getState().settings.output.width).toBe(
      before.settings.output.width,
    );
    expect(store.getState().scenes[0]!.layers[0]!.transform.w).toBe(1920);
  });
  it("can keep the coordinates", () => {
    const store = createProjectStore(defaultProject());
    store.setOutputFormat(1080, 1080, false);
    expect(store.getState().scenes[0]!.layers[0]!.transform.w).toBe(1920);
  });
  it("fitScenes maps every layer of every scene", () => {
    const scenes = [
      createScene("A", [createLayer("webcam"), createLayer("text")]),
      createScene("B", [createLayer("screen")]),
    ];
    const out = fitScenes(scenes, { w: 1920, h: 1080 }, { w: 1080, h: 1920 });
    expect(
      out
        .flatMap((s) => s.layers)
        .every((l) => l.transform.x + l.transform.w <= 1080 + 1),
    ).toBe(true);
  });
});

describe("live quality follows the format", () => {
  it("keeps landscape sizes exactly and swaps axes for vertical", () => {
    for (const q of QUALITIES) {
      expect(orientQuality(q, 1920, 1080)).toMatchObject({
        width: q.width,
        height: q.height,
      });
      const v = orientQuality(q, 1080, 1920);
      expect(v.width).toBe(q.height);
      expect(v.height).toBe(q.width);
      expect(v.label).toContain("dikey");
    }
    expect(orientedSize({ width: 1280, height: 720 }, 1080, 1080)).toEqual({
      width: 720,
      height: 720,
    });
    expect(orientedSize({ width: 1920, height: 1080 }, 1080, 1350)).toEqual({
      width: 1080,
      height: 1350,
    });
  });
});
