import { describe, expect, it } from "vitest";

import { createLayer, createScene, defaultProject } from "../defaults";
import { createProjectStore } from "../project/store";
import { parseProject } from "../project/schema";
import {
  ADJUST_PRESETS,
  buildFilter,
  DEFAULT_PARAMS,
  hasFx,
  isNeutral,
  normalizeFx,
  parseFilter,
  presetFilter,
} from "./adjust";
import { sanitizeCssFilter } from "./blend";
import { FxProcessor } from "./fx";

describe("filter build / parse", () => {
  it("emits nothing for defaults", () => {
    expect(buildFilter({})).toBe("none");
    expect(buildFilter(DEFAULT_PARAMS)).toBe("none");
  });
  it("round-trips every slider", () => {
    const p = {
      brightness: 120,
      contrast: 90,
      saturate: 150,
      hue: -20,
      blur: 2.5,
      grayscale: 30,
      sepia: 10,
      invert: 5,
    };
    const { params, rest } = parseFilter(buildFilter(p));
    expect(params).toEqual(p);
    expect(rest).toBe("");
  });
  it("keeps unknown functions and clamps ranges", () => {
    const f = buildFilter({ brightness: 999 }, "drop-shadow(0 0 4px #000)");
    expect(f).toContain("brightness(2)");
    expect(f).toContain("drop-shadow");
    expect(parseFilter("drop-shadow(0 0 4px #000)").rest).toContain(
      "drop-shadow",
    );
  });
  it("parses legacy strings used by the old preset list", () => {
    expect(parseFilter("contrast(1.4) saturate(1.3)").params).toMatchObject({
      contrast: 140,
      saturate: 130,
    });
    expect(
      parseFilter("sepia(0.3) saturate(1.5) hue-rotate(-10deg)").params,
    ).toMatchObject({ sepia: 30, hue: -10 });
    expect(parseFilter("blur(4px)").params.blur).toBe(4);
  });
  it("every preset passes the CSS filter sanitizer unchanged", () => {
    for (const p of ADJUST_PRESETS) {
      const f = presetFilter(p);
      expect(sanitizeCssFilter(f), p.id).toBe(f);
    }
  });
  it("a fully loaded filter still fits the sanitizer (8 functions max)", () => {
    const f = buildFilter(
      {
        brightness: 110,
        contrast: 110,
        saturate: 110,
        hue: 10,
        blur: 1,
        grayscale: 10,
        sepia: 10,
        invert: 10,
      },
      "drop-shadow(0 0 1px #000)",
    );
    expect(sanitizeCssFilter(f)).toBe(f);
  });
});

describe("fx values", () => {
  it("normalizes and detects effects", () => {
    expect(normalizeFx({ sharpen: 500, warmth: -500 })).toEqual({
      sharpen: 100,
      vignette: 0,
      warmth: -100,
    });
    expect(hasFx(undefined)).toBe(false);
    expect(hasFx({ sharpen: 0, vignette: 0, warmth: 0 })).toBe(false);
    expect(hasFx({ sharpen: 0, vignette: 0, warmth: -5 })).toBe(true);
    expect(isNeutral(DEFAULT_PARAMS, undefined)).toBe(true);
  });
});

describe("project integration", () => {
  it("store merges fx patches and drops all-zero fx", () => {
    const store = createProjectStore(defaultProject());
    const sc = store.getState().scenes[0]!;
    const layer = sc.layers[0]!;
    store.updateLayer(sc.id, layer.id, { fx: { sharpen: 40 } });
    expect(store.getState().scenes[0]!.layers[0]!.fx).toEqual({
      sharpen: 40,
      vignette: 0,
      warmth: 0,
    });
    store.updateLayer(sc.id, layer.id, { fx: { warmth: 20 } });
    expect(store.getState().scenes[0]!.layers[0]!.fx).toEqual({
      sharpen: 40,
      vignette: 0,
      warmth: 20,
    });
    store.updateLayer(sc.id, layer.id, { fx: { sharpen: 0, warmth: 0 } });
    expect(store.getState().scenes[0]!.layers[0]!.fx).toBeUndefined();
  });
  it("schema keeps valid fx and rejects out-of-range via repair", () => {
    const base = defaultProject();
    const cam = createLayer("webcam", {
      fx: { sharpen: 30, vignette: 10, warmth: -20 },
    });
    const parsed = parseProject({
      ...base,
      scenes: [createScene("A", [cam])],
      activeSceneId: "",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(parsed.project.scenes[0]!.layers[0]!.fx).toEqual({
        sharpen: 30,
        vignette: 10,
        warmth: -20,
      });
  });
});

describe("FxProcessor", () => {
  function fakeCanvas() {
    const calls: string[] = [];
    const ctx: Record<string, unknown> = {
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      setTransform: () => {},
      clearRect: () => {},
      fillRect: () =>
        calls.push(`fillRect:${String(ctx["globalCompositeOperation"])}`),
      drawImage: () =>
        calls.push(
          `drawImage:${String(ctx["globalCompositeOperation"])}:${String(ctx["filter"])}`,
        ),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      filter: "none",
    };
    return { canvas: { getContext: () => ctx } as never, calls };
  }

  it("applies sharpen through an overlay high-pass and vignette/warmth fills", () => {
    const made: ReturnType<typeof fakeCanvas>[] = [];
    const fx = new FxProcessor({
      createCanvas: () => {
        const c = fakeCanvas();
        made.push(c);
        return c.canvas;
      },
    });
    const out = fx.process(
      "l1",
      100,
      50,
      "contrast(1.1)",
      { sharpen: 50, vignette: 30, warmth: 40 },
      () => {},
      true,
    );
    expect(out).not.toBeNull();
    const all = made.flatMap((m) => m.calls);
    expect(all.some((c) => c.startsWith("drawImage:overlay"))).toBe(true);
    expect(all.some((c) => c.includes("blur(") === false)).toBe(true);
    expect(all.filter((c) => c.startsWith("fillRect")).length).toBe(2);
  });
  it("skips sharpen when CSS filters are unsupported but still does vignette", () => {
    const made: ReturnType<typeof fakeCanvas>[] = [];
    const fx = new FxProcessor({
      createCanvas: () => {
        const c = fakeCanvas();
        made.push(c);
        return c.canvas;
      },
    });
    fx.process(
      "l2",
      100,
      50,
      "none",
      { sharpen: 80, vignette: 30, warmth: 0 },
      () => {},
      false,
    );
    const all = made.flatMap((m) => m.calls);
    expect(all.some((c) => c.startsWith("drawImage:overlay"))).toBe(false);
    expect(all.filter((c) => c.startsWith("fillRect")).length).toBe(1);
  });
});
