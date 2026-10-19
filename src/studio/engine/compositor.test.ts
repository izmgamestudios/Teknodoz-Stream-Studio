import { afterEach, describe, expect, it, vi } from "vitest";
import { createLayer, createScene } from "../defaults";
import type {
  CompositorHooks,
  FrameSource,
  Layer,
  Rect,
  Scene,
} from "../types";
import type { ChromaEngine, ChromaResult, ScratchCanvas } from "./chroma";
import {
  Compositor,
  CompositorError,
  MAX_TRANSITION_MS,
  easeInOut,
  marqueeOffset,
  sanitizeTransitionMs,
  slideOffset,
  transitionAlpha,
  transitionProgress,
  wrapText,
} from "./compositor";
import type { TickerEnv } from "./ticker";

/* ------------------------------------------------------------------ */
/* Recording stub of CanvasRenderingContext2D                          */
/* ------------------------------------------------------------------ */

interface Call {
  name: string;
  args: unknown[];
  alpha: number;
  op: string;
  filter: string | undefined;
  depth: number;
  textAlign: string;
  shadowBlur: number;
  fillStyle: unknown;
  font: string;
}

interface StubOptions {
  rejectBlend?: string[];
  filter?: boolean;
  /** Makes the named context method throw while the predicate returns true. */
  shouldThrow?: (method: string) => boolean;
}

function createRecordingContext(opts: StubOptions = {}) {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    font: "10px sans-serif",
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    textAlign: "start",
    textBaseline: "alphabetic",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    shadowColor: "rgba(0,0,0,0)",
    shadowBlur: 0,
  };
  if (opts.filter !== false) props["filter"] = "none";
  const stack: Record<string, unknown>[] = [];
  const sets: { prop: string; value: unknown }[] = [];

  const snapshot = (name: string, args: unknown[]): Call => ({
    name,
    args,
    alpha: props["globalAlpha"] as number,
    op: props["globalCompositeOperation"] as string,
    filter: props["filter"] as string | undefined,
    depth: stack.length,
    textAlign: props["textAlign"] as string,
    shadowBlur: props["shadowBlur"] as number,
    fillStyle: props["fillStyle"],
    font: props["font"] as string,
  });

  const context = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop in props) return props[prop];
      switch (prop) {
        case "save":
          return () => {
            calls.push(snapshot("save", []));
            stack.push({ ...props });
          };
        case "restore":
          return () => {
            const prev = stack.pop();
            if (!prev) throw new Error("restore() without matching save()");
            Object.assign(props, prev);
            calls.push(snapshot("restore", []));
          };
        case "measureText":
          return (text: string) => ({ width: text.length * 10 });
        default:
          return (...args: unknown[]) => {
            if (opts.shouldThrow?.(prop)) throw new Error(`${prop} failed`);
            calls.push(snapshot(prop, args));
          };
      }
    },
    set(_t, prop: string, value: unknown) {
      if (
        prop === "globalCompositeOperation" &&
        opts.rejectBlend?.includes(String(value))
      ) {
        return true; // real canvases silently ignore unknown operations
      }
      props[prop] = value;
      sets.push({ prop, value });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return {
    context,
    calls,
    sets,
    depth: () => stack.length,
    named: (name: string) => calls.filter((c) => c.name === name),
    clear: () => {
      calls.length = 0;
      sets.length = 0;
    },
  };
}

type Recorder = ReturnType<typeof createRecordingContext>;

function recordingCanvas(opts: StubOptions = {}) {
  const rec = createRecordingContext(opts);
  const raw = { width: 0, height: 0, getContext: vi.fn(() => rec.context) };
  return { rec, raw, canvas: raw as unknown as HTMLCanvasElement };
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const img = (name: string): CanvasImageSource =>
  ({ name }) as unknown as CanvasImageSource;
const frame = (
  name: string,
  w = 1920,
  h = 1080,
  extra: Partial<FrameSource> = {},
): FrameSource => ({
  source: img(name),
  width: w,
  height: h,
  ready: true,
  ...extra,
});

function layerOf<K extends Layer["kind"]>(
  kind: K,
  id: string,
  patch: Record<string, unknown> = {},
): Extract<Layer, { kind: K }> {
  return createLayer(kind, { id, ...patch } as never);
}

const tf = (x: number, y: number, w: number, h: number, rotation = 0) => ({
  x,
  y,
  w,
  h,
  rotation,
});

function hooksFor(
  sources: Record<string, FrameSource | null>,
  extra: Partial<CompositorHooks> = {},
) {
  const resolved: string[] = [];
  const hooks: CompositorHooks = {
    resolveSource: (layer) => {
      resolved.push(layer.id);
      return sources[layer.id] ?? null;
    },
    ...extra,
  };
  return { hooks, resolved };
}

function setup(
  scene: Scene | null,
  sources: Record<string, FrameSource | null> = {},
  extra: Partial<CompositorHooks> = {},
  opts: {
    width?: number;
    height?: number;
    stub?: StubOptions;
    chroma?: ChromaEngine;
  } = {},
) {
  const main = recordingCanvas(opts.stub);
  const buffers: ReturnType<typeof recordingCanvas>[] = [];
  const { hooks, resolved } = hooksFor(sources, extra);
  const comp = new Compositor(main.canvas, hooks, {
    width: opts.width ?? 1920,
    height: opts.height ?? 1080,
    fps: 60,
    ...(opts.chroma ? { chroma: opts.chroma } : {}),
    createCanvas: (w, h) => {
      const b = recordingCanvas();
      b.raw.width = w;
      b.raw.height = h;
      buffers.push(b);
      return b.canvas as unknown as ScratchCanvas;
    },
  });
  if (scene) comp.setScene(scene);
  return { comp, main, rec: main.rec, buffers, hooks, resolved };
}

const drawn = (rec: Recorder): unknown[] =>
  rec.named("drawImage").map((c) => c.args[0]);

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

describe("transition math", () => {
  it("easeInOut hits the endpoints and the midpoint, is monotonic and clamps", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOut(-3)).toBe(0);
    expect(easeInOut(9)).toBe(1);
    expect(easeInOut(Number.NaN)).toBe(0);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = easeInOut(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // slow start, slow end
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
  });

  it("transitionProgress is linear, clamped and handles zero duration", () => {
    expect(transitionProgress(0, 400)).toBe(0);
    expect(transitionProgress(200, 400)).toBe(0.5);
    expect(transitionProgress(400, 400)).toBe(1);
    expect(transitionProgress(9999, 400)).toBe(1);
    expect(transitionProgress(-50, 400)).toBe(0);
    expect(transitionProgress(10, 0)).toBe(1);
    expect(transitionProgress(10, Number.NaN)).toBe(1);
  });

  it("slideOffset goes from the full extent to zero", () => {
    expect(slideOffset(0, 1920)).toBe(1920);
    expect(slideOffset(1, 1920)).toBe(0);
    expect(slideOffset(0.5, 1920)).toBeCloseTo(960, 6);
    expect(slideOffset(0.25, 1000)).toBeCloseTo(
      1000 * (1 - easeInOut(0.25)),
      10,
    );
    expect(slideOffset(2, 1920)).toBe(0);
  });

  it("transitionAlpha: eased for fade, opaque for slide and cut", () => {
    expect(transitionAlpha("fade", 0)).toBe(0);
    expect(transitionAlpha("fade", 1)).toBe(1);
    expect(transitionAlpha("fade", 0.25)).toBeCloseTo(0.0625, 10);
    expect(transitionAlpha("slide", 0.3)).toBe(1);
    expect(transitionAlpha("cut", 0)).toBe(1);
  });

  it("sanitizeTransitionMs clamps", () => {
    expect(sanitizeTransitionMs(400)).toBe(400);
    expect(sanitizeTransitionMs(-5)).toBe(0);
    expect(sanitizeTransitionMs(1e9)).toBe(MAX_TRANSITION_MS);
    expect(sanitizeTransitionMs(Number.NaN)).toBe(0);
  });
});

describe("wrapText / marqueeOffset", () => {
  const measure = (s: string) => s.length * 10;

  it("wraps greedily at word boundaries", () => {
    expect(wrapText(measure, "hello world foo bar", 120)).toEqual([
      "hello world",
      "foo bar",
    ]);
    expect(wrapText(measure, "a b c", 1000)).toEqual(["a b c"]);
  });

  it("honours explicit newlines and keeps blank lines", () => {
    expect(wrapText(measure, "one\ntwo\r\n\nthree", 1000)).toEqual([
      "one",
      "two",
      "",
      "three",
    ]);
  });

  it("splits words longer than the width by character", () => {
    expect(wrapText(measure, "abcdefghij", 40)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("limits the number of lines and handles empty / non-positive widths", () => {
    expect(wrapText(measure, "a\nb\nc\nd", 100, 2)).toEqual(["a", "b"]);
    expect(wrapText(measure, "", 100)).toEqual([""]);
    expect(wrapText(measure, "x y z", 0)).toEqual(["x y z"]);
    expect(wrapText(measure, "x ".repeat(500), 20, 5)).toHaveLength(5);
  });

  it("does not split surrogate pairs", () => {
    const lines = wrapText(measure, "😀😀😀😀", 10);
    expect(lines.join("")).toBe("😀😀😀😀");
    for (const l of lines) expect([...l].every((c) => c === "😀")).toBe(true);
  });

  it("marqueeOffset starts at 0, moves left and wraps within (-period, 0]", () => {
    expect(marqueeOffset(0, 100, 500)).toBe(0);
    expect(marqueeOffset(1000, 100, 500)).toBe(-100);
    expect(marqueeOffset(5000, 100, 500)).toBe(0); // exactly one full period
    expect(marqueeOffset(5500, 100, 500)).toBe(-50);
    for (let t = 0; t < 20_000; t += 137) {
      const o = marqueeOffset(t, 140, 333);
      expect(o).toBeLessThanOrEqual(0);
      expect(o).toBeGreaterThan(-333);
    }
    expect(marqueeOffset(1000, 100, 0)).toBe(0);
    expect(marqueeOffset(Number.NaN, 100, 500)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Layer drawing                                                       */
/* ------------------------------------------------------------------ */

describe("Compositor layer drawing", () => {
  it("throws a typed error when the canvas has no 2D context", () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    try {
      new Compositor(canvas, hooksFor({}).hooks, {
        width: 1920,
        height: 1080,
        fps: 60,
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CompositorError);
      expect((e as CompositorError).code).toBe("compositor-no-context");
    }
  });

  it("sizes the canvas from the options and clamps absurd sizes", () => {
    const { main } = setup(null, {}, {}, { width: 1280, height: 720 });
    expect(main.raw.width).toBe(1280);
    expect(main.raw.height).toBe(720);
    const huge = setup(null, {}, {}, { width: 1e9, height: -4 });
    expect(huge.main.raw.width).toBe(7680);
    expect(huge.main.raw.height).toBe(16);
  });

  it("clears to black and draws nothing without a scene", () => {
    const { comp, rec } = setup(null);
    comp.renderOnce(0);
    expect(rec.named("fillRect")).toHaveLength(1);
    expect(rec.named("drawImage")).toHaveLength(0);
    expect(rec.depth()).toBe(0);
  });

  it("draws layers bottom -> top in array order", () => {
    const scene = createScene("s", [
      layerOf("screen", "a", { transform: tf(0, 0, 1920, 1080) }),
      layerOf("webcam", "b", { transform: tf(100, 100, 400, 225) }),
      layerOf("image", "c", { transform: tf(10, 10, 100, 100) }),
    ]);
    const srcs = { a: frame("A"), b: frame("B"), c: frame("C", 100, 100) };
    const { comp, rec, resolved } = setup(scene, srcs);
    comp.renderOnce(0);
    expect(drawn(rec)).toEqual([srcs.a.source, srcs.b.source, srcs.c.source]);
    expect(resolved).toEqual(["a", "b", "c"]);
    expect(rec.depth()).toBe(0);
  });

  it("skips invisible, zero-size, fully transparent and unresolvable layers", () => {
    const scene = createScene("s", [
      layerOf("webcam", "hidden", { visible: false }),
      layerOf("webcam", "zero", { transform: tf(0, 0, 0, 100) }),
      layerOf("webcam", "neg", { transform: tf(0, 0, 100, -4) }),
      layerOf("webcam", "nan", { transform: tf(Number.NaN, 0, 100, 100) }),
      layerOf("webcam", "clear", { opacity: 0 }),
      layerOf("webcam", "none"), // resolveSource -> null
      layerOf("webcam", "loading"), // ready=false
      layerOf("webcam", "empty"), // width 0
      layerOf("webcam", "ok"),
    ]);
    const srcs = {
      hidden: frame("H"),
      zero: frame("Z"),
      neg: frame("N"),
      nan: frame("NaN"),
      clear: frame("CL"),
      none: null,
      loading: frame("L", 1920, 1080, { ready: false }),
      empty: frame("E", 0, 0),
      ok: frame("OK"),
    };
    const { comp, rec, resolved } = setup(scene, srcs);
    comp.renderOnce(0);
    expect(drawn(rec)).toEqual([srcs.ok.source]);
    // Invisible / degenerate layers are not even resolved.
    expect(resolved).toEqual(["none", "loading", "empty", "ok"]);
    expect(rec.depth()).toBe(0);
  });

  it("applies opacity and blend per layer without leaking state to the next layer", () => {
    const scene = createScene("s", [
      layerOf("webcam", "a", { opacity: 50, blend: "multiply" }),
      layerOf("webcam", "b"),
      layerOf("webcam", "c", { opacity: 25, blend: "screen" }),
    ]);
    const { comp, rec } = setup(scene, {
      a: frame("A"),
      b: frame("B"),
      c: frame("C"),
    });
    comp.renderOnce(0);
    const d = rec.named("drawImage");
    expect(d.map((c) => [c.alpha, c.op])).toEqual([
      [0.5, "multiply"],
      [1, "source-over"],
      [0.25, "screen"],
    ]);
  });

  it("falls back to source-over for blend modes the browser rejects or that are invalid", () => {
    const scene = createScene("s", [
      layerOf("webcam", "a", { blend: "hue" }),
      layerOf("webcam", "b", { blend: "bogus" }),
      layerOf("webcam", "c", { blend: "difference" }),
    ]);
    const { comp, rec } = setup(
      scene,
      { a: frame("A"), b: frame("B"), c: frame("C") },
      {},
      { stub: { rejectBlend: ["hue"] } },
    );
    comp.renderOnce(0);
    expect(rec.named("drawImage").map((c) => c.op)).toEqual([
      "source-over",
      "source-over",
      "difference",
    ]);
  });

  it("applies a sanitized CSS filter when the context supports it", () => {
    const scene = createScene("s", [
      layerOf("webcam", "a", { filter: "blur(4px) brightness(1.2)" }),
      layerOf("webcam", "b", { filter: "url(https://evil.example/x.svg#f)" }),
      layerOf("webcam", "c", { filter: "none" }),
    ]);
    const { comp, rec } = setup(scene, {
      a: frame("A"),
      b: frame("B"),
      c: frame("C"),
    });
    comp.renderOnce(0);
    expect(rec.named("drawImage").map((c) => c.filter)).toEqual([
      "blur(4px) brightness(1.2)",
      "none",
      "none",
    ]);
  });

  it("feature-detects ctx.filter: never assigns it when unsupported", () => {
    const scene = createScene("s", [
      layerOf("webcam", "a", { filter: "blur(4px)" }),
    ]);
    const { comp, rec } = setup(
      scene,
      { a: frame("A") },
      {},
      { stub: { filter: false } },
    );
    comp.renderOnce(0);
    expect(rec.named("drawImage")).toHaveLength(1);
    expect(rec.named("drawImage")[0]?.filter).toBeUndefined();
  });

  it("rotates around the box centre before drawing", () => {
    const scene = createScene("s", [
      layerOf("webcam", "a", {
        transform: tf(100, 100, 200, 100, 90),
        mirror: false,
      }),
    ]);
    const { comp, rec } = setup(scene, { a: frame("A") });
    comp.renderOnce(0);
    const names = rec.calls.map((c) => c.name);
    const tIdx = names.indexOf("translate");
    expect(rec.calls[tIdx]?.args).toEqual([200, 150]);
    expect(rec.calls[tIdx + 1]?.name).toBe("rotate");
    expect(rec.calls[tIdx + 1]?.args[0]).toBeCloseTo(Math.PI / 2, 10);
    expect(rec.calls[tIdx + 2]).toMatchObject({
      name: "translate",
      args: [-200, -150],
    });
    expect(names.indexOf("drawImage")).toBeGreaterThan(tIdx + 2);
  });

  it("does not rotate unrotated layers", () => {
    const scene = createScene("s", [layerOf("webcam", "a", { mirror: false })]);
    const { comp, rec } = setup(scene, { a: frame("A") });
    comp.renderOnce(0);
    expect(rec.named("rotate")).toHaveLength(0);
  });

  it("cover-crops webcam / screen / video / guest sources into the box", () => {
    const scene = createScene("s", [
      layerOf("webcam", "w", { transform: tf(0, 0, 400, 400), mirror: false }),
      layerOf("screen", "s", { transform: tf(0, 0, 400, 400) }),
      layerOf("video", "v", { transform: tf(0, 0, 400, 400) }),
      layerOf("guest", "g", { transform: tf(0, 0, 400, 400) }),
    ]);
    const srcs = { w: frame("W"), s: frame("S"), v: frame("V"), g: frame("G") };
    const { comp, rec } = setup(scene, srcs);
    comp.renderOnce(0);
    for (const call of rec.named("drawImage")) {
      expect(call.args.slice(1)).toEqual([420, 0, 1080, 1080, 0, 0, 400, 400]);
    }
    expect(rec.named("drawImage")).toHaveLength(4);
  });

  it("contains image sources inside the box (no crop)", () => {
    const scene = createScene("s", [
      layerOf("image", "i", { transform: tf(0, 0, 400, 200) }),
    ]);
    const { comp, rec } = setup(scene, { i: frame("I", 100, 100) });
    comp.renderOnce(0);
    expect(rec.named("drawImage")[0]?.args.slice(1)).toEqual([
      0, 0, 100, 100, 100, 0, 200, 200,
    ]);
  });

  it("scales logical coordinates to the output resolution", () => {
    const scene = createScene("s", [
      layerOf("webcam", "a", {
        transform: tf(960, 540, 480, 270),
        mirror: false,
      }),
    ]);
    const { comp, rec } = setup(
      scene,
      { a: frame("A") },
      {},
      { width: 960, height: 540 },
    );
    comp.renderOnce(0);
    expect(rec.named("drawImage")[0]?.args.slice(1)).toEqual([
      0, 0, 1920, 1080, 480, 270, 240, 135,
    ]);
  });

  it("letterboxes non-16:9 outputs: uniform scale, centred stage, clipped to it", () => {
    const scene = createScene("s", [
      layerOf("webcam", "a", {
        transform: tf(0, 0, 1920, 1080),
        mirror: false,
      }),
    ]);
    const { comp, rec } = setup(
      scene,
      { a: frame("A") },
      {},
      { width: 960, height: 960 },
    );
    comp.renderOnce(0);
    const d = rec.named("drawImage")[0];
    expect(d?.args[5]).toBeCloseTo(0, 6); // x
    expect(d?.args[6]).toBeCloseTo((960 - 540) / 2, 6); // y offset of the bars
    expect(d?.args[7]).toBeCloseTo(960, 6);
    expect(d?.args[8]).toBeCloseTo(540, 6);
    expect(rec.named("clip").length).toBeGreaterThan(0);
  });

  it("mirrors webcams via layer.mirror and lets FrameSource.mirror override it", () => {
    const scene = createScene("s", [
      layerOf("webcam", "a", { transform: tf(100, 0, 200, 100), mirror: true }),
      layerOf("webcam", "b", { transform: tf(100, 0, 200, 100), mirror: true }),
      layerOf("webcam", "c", {
        transform: tf(100, 0, 200, 100),
        mirror: false,
      }),
      layerOf("screen", "d", { transform: tf(100, 0, 200, 100) }),
    ]);
    const srcs = {
      a: frame("A"),
      b: frame("B", 1920, 1080, { mirror: false }),
      c: frame("C", 1920, 1080, { mirror: true }),
      d: frame("D"),
    };
    const { comp, rec } = setup(scene, srcs);
    comp.renderOnce(0);
    const flips: boolean[] = [];
    let flipped = false;
    for (const c of rec.calls) {
      if (c.name === "scale" && c.args[0] === -1) flipped = true;
      if (c.name === "drawImage") {
        flips.push(flipped);
        flipped = false;
      }
    }
    expect(flips).toEqual([true, false, true, false]);
    const scaleCall = rec.named("scale")[0];
    expect(scaleCall?.args).toEqual([-1, 1]);
    // flipping happens around the box centre x = 200
    expect(
      rec.calls.find((c) => c.name === "translate" && c.args[1] === 0)?.args[0],
    ).toBe(200);
  });

  it("keeps save/restore balanced even when a hook throws, and continues with the next layer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scene = createScene("s", [
      layerOf("prompter", "p"),
      layerOf("webcam", "ok", { mirror: false }),
    ]);
    const { comp, rec } = setup(
      scene,
      { ok: frame("OK") },
      {
        drawPrompter: () => {
          throw new Error("boom");
        },
      },
    );
    comp.renderOnce(0);
    comp.renderOnce(16);
    expect(rec.depth()).toBe(0);
    expect(rec.named("drawImage")).toHaveLength(2);
    expect(comp.layerErrorCount).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1); // reported once per layer
  });

  it("survives resolveSource throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scene = createScene("s", [
      layerOf("webcam", "bad"),
      layerOf("webcam", "ok", { mirror: false }),
    ]);
    const main = recordingCanvas();
    const comp = new Compositor(
      main.canvas,
      {
        resolveSource: (l) => {
          if (l.id === "bad") throw new Error("nope");
          return frame("OK");
        },
      },
      { width: 1920, height: 1080, fps: 60 },
    );
    comp.setScene(scene);
    comp.renderOnce(0);
    expect(main.rec.named("drawImage")).toHaveLength(1);
    expect(comp.layerErrorCount).toBe(1);
    expect(warn).toHaveBeenCalled();
  });
});

describe("Compositor shape / text / prompter / web layers", () => {
  it("draws shapes: rounded rect fill + stroke + centred text", () => {
    const scene = createScene("s", [
      layerOf("shape", "r", {
        transform: tf(100, 100, 400, 100),
        shape: "rect",
        fill: "#ff0000",
        stroke: "#00ff00",
        strokeWidth: 4,
        radius: 20,
        text: "HELLO",
        textColor: "#ffffff",
      }),
    ]);
    const { comp, rec } = setup(scene);
    comp.renderOnce(0);
    expect(rec.named("arcTo").length).toBe(4);
    expect(rec.named("fill")).toHaveLength(1);
    expect(rec.named("fill")[0]?.fillStyle).toBe("#ff0000");
    expect(rec.named("stroke")).toHaveLength(1);
    const text = rec.named("fillText")[0];
    expect(text?.args[0]).toBe("HELLO");
    expect(text?.textAlign).toBe("center");
    expect(text?.args[1]).toBe(300); // centred horizontally
    expect(rec.depth()).toBe(0);
  });

  it("draws ellipses with ctx.ellipse and left-aligns banner text", () => {
    const scene = createScene("s", [
      layerOf("shape", "e", {
        shape: "ellipse",
        text: "",
        transform: tf(0, 0, 200, 100),
      }),
      layerOf("shape", "b", {
        shape: "banner",
        text: "LIVE",
        transform: tf(0, 500, 600, 100),
        strokeWidth: 0,
      }),
    ]);
    const { comp, rec } = setup(scene);
    comp.renderOnce(0);
    expect(rec.named("ellipse")).toHaveLength(1);
    expect(rec.named("ellipse")[0]?.args.slice(0, 4)).toEqual([
      100, 50, 100, 50,
    ]);
    expect(rec.named("stroke")).toHaveLength(0);
    expect(rec.named("fillText")[0]?.textAlign).toBe("left");
  });

  it("does not fill transparent shapes", () => {
    const scene = createScene("s", [
      layerOf("shape", "t", { fill: "transparent", strokeWidth: 0, text: "" }),
    ]);
    const { comp, rec } = setup(scene);
    comp.renderOnce(0);
    expect(rec.named("fill")).toHaveLength(0);
  });

  it("wraps plain text and honours alignment and background", () => {
    const scene = createScene("s", [
      layerOf("text", "t", {
        transform: tf(0, 0, 120, 200),
        text: "hello world foo bar",
        fontSize: 20,
        align: "center",
        background: "#112233",
        style: "plain",
      }),
    ]);
    const { comp, rec } = setup(scene);
    comp.renderOnce(0);
    // padX = 0.6 * 20 = 12 -> wrap width 96: "hello" / "world foo" is 90 / "bar"
    const lines = rec.named("fillText").map((c) => c.args[0]);
    expect(lines).toEqual(["hello", "world foo", "bar"]);
    expect(rec.named("fillText")[0]?.textAlign).toBe("center");
    expect(rec.named("fillRect").some((c) => c.fillStyle === "#112233")).toBe(
      true,
    );
  });

  it("subtitle style draws a translucent pill with a text shadow", () => {
    const scene = createScene("s", [
      layerOf("text", "t", {
        transform: tf(0, 800, 1920, 200),
        text: "Merhaba dünya",
        fontSize: 40,
        style: "subtitle",
        background: "transparent",
      }),
    ]);
    const { comp, rec } = setup(scene);
    comp.renderOnce(0);
    const fills = rec.named("fill");
    expect(fills[0]?.fillStyle).toBe("rgba(0,0,0,0.6)");
    expect(rec.named("fillText")[0]?.shadowBlur).toBeGreaterThan(0);
    expect(rec.depth()).toBe(0);
  });

  it("banner style draws a bar with an accent stripe", () => {
    const scene = createScene("s", [
      layerOf("text", "t", {
        transform: tf(0, 800, 1000, 100),
        text: "Başlık",
        style: "banner",
        background: "transparent",
      }),
    ]);
    const { comp, rec } = setup(scene);
    comp.renderOnce(0);
    const fills = rec.named("fillRect").map((c) => c.fillStyle);
    expect(fills).toContain("rgba(15,15,20,0.78)");
    expect(fills).toContain("#e0483c");
  });

  it("ticker style scrolls with nowMs and wraps seamlessly", () => {
    const scene = createScene("s", [
      layerOf("text", "t", {
        transform: tf(0, 900, 1000, 80),
        text: "NEWS",
        fontSize: 20,
        style: "ticker",
        background: "transparent",
      }),
    ]);
    const { comp, rec } = setup(scene);
    const firstX = (t: number): number => {
      rec.clear();
      comp.renderOnce(t);
      return rec.named("fillText")[0]?.args[1] as number;
    };
    const x0 = firstX(0);
    const x1 = firstX(250);
    expect(x0 - x1).toBeCloseTo(0.25 * 140, 6); // scrolls left at 140 logical px/s
    // period = textWidth(40) + 3 * fontPx(20) = 100 -> back to the start after 100/140 s
    expect(firstX((100 / 140) * 1000)).toBeCloseTo(x0, 4);
    // several copies fill the box
    rec.clear();
    comp.renderOnce(0);
    expect(rec.named("fillText").length).toBeGreaterThan(5);
    expect(rec.named("clip").length).toBeGreaterThan(0);
  });

  it("ticker frames are deterministic for the same timestamp", () => {
    const scene = createScene("s", [
      layerOf("text", "t", {
        text: "A B C",
        style: "ticker",
        transform: tf(0, 0, 500, 60),
      }),
    ]);
    const { comp, rec } = setup(scene);
    comp.renderOnce(1234);
    const a = rec.named("fillText").map((c) => c.args[1]);
    rec.clear();
    comp.renderOnce(1234);
    expect(rec.named("fillText").map((c) => c.args[1])).toEqual(a);
  });

  it("prompter layers delegate to hooks.drawPrompter with the output box and state applied", () => {
    const seen: { box: Rect; now: number; alpha: number; op: string }[] = [];
    const scene = createScene("s", [
      layerOf("prompter", "p", {
        transform: tf(960, 540, 480, 270),
        opacity: 80,
        blend: "screen",
      }),
    ]);
    const { comp, rec } = setup(
      scene,
      {},
      {
        drawPrompter: (ctx, _layer, box, now) => {
          seen.push({
            box,
            now,
            alpha: ctx.globalAlpha,
            op: ctx.globalCompositeOperation,
          });
        },
      },
      { width: 960, height: 540 },
    );
    comp.renderOnce(777);
    expect(seen).toEqual([
      {
        box: { x: 480, y: 270, w: 240, h: 135 },
        now: 777,
        alpha: 0.8,
        op: "screen",
      },
    ]);
    expect(rec.depth()).toBe(0);
  });

  it("prompter layers without a hook are skipped", () => {
    const scene = createScene("s", [layerOf("prompter", "p")]);
    const { comp, rec } = setup(scene);
    comp.renderOnce(0);
    expect(rec.named("save").length).toBe(1); // only the scene-level save
  });

  it("web layers: chrome -> source contained in the screen rect -> overlay", () => {
    const order: string[] = [];
    const screenRect: Rect = { x: 120, y: 130, w: 200, h: 400 };
    const scene = createScene("s", [
      layerOf("web", "w", {
        transform: tf(100, 100, 240, 460),
        frame: "mobile",
      }),
    ]);
    const { comp, rec } = setup(
      scene,
      { w: frame("WEB", 390, 844) },
      {
        drawWebChrome: (_ctx, _layer, box) => {
          order.push(`chrome:${box.x},${box.y},${box.w},${box.h}`);
          return screenRect;
        },
        drawWebOverlay: (_ctx, _layer, screen, now) => {
          order.push(
            `overlay:${screen.x},${screen.y},${screen.w},${screen.h}@${now}`,
          );
        },
      },
    );
    comp.renderOnce(55);
    const d = rec.named("drawImage")[0];
    // 390x844 contained in 200x400 -> scale = min(200/390, 400/844)
    const k = Math.min(200 / 390, 400 / 844);
    expect(d?.args[1]).toBe(0);
    expect(d?.args[3]).toBe(390);
    expect(d?.args[4]).toBe(844);
    expect(d?.args[7] as number).toBeCloseTo(390 * k, 6);
    expect(d?.args[8] as number).toBeCloseTo(844 * k, 6);
    expect(order).toEqual([
      "chrome:100,100,240,460",
      "overlay:120,130,200,400@55",
    ]);
    expect(rec.depth()).toBe(0);
  });

  it("web layers fall back to the whole box when the chrome hook is missing or returns junk", () => {
    const scene = createScene("s", [
      layerOf("web", "w", { transform: tf(0, 0, 400, 400), frame: "none" }),
    ]);
    const bad = setup(
      scene,
      { w: frame("WEB", 400, 400) },
      { drawWebChrome: () => ({ x: Number.NaN, y: 0, w: 10, h: 10 }) },
    );
    bad.comp.renderOnce(0);
    expect(bad.rec.named("drawImage")[0]?.args.slice(5)).toEqual([
      0, 0, 400, 400,
    ]);
    const none = setup(scene, { w: frame("WEB", 400, 400) });
    none.comp.renderOnce(0);
    expect(none.rec.named("drawImage")[0]?.args.slice(5)).toEqual([
      0, 0, 400, 400,
    ]);
  });

  it("web layers without a ready source draw no chrome", () => {
    const chrome = vi.fn((_c: unknown, _l: unknown, box: Rect) => box);
    const scene = createScene("s", [layerOf("web", "w")]);
    const { comp, rec } = setup(scene, { w: null }, { drawWebChrome: chrome });
    comp.renderOnce(0);
    expect(chrome).not.toHaveBeenCalled();
    expect(rec.named("drawImage")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Chroma wiring                                                       */
/* ------------------------------------------------------------------ */

describe("Compositor chroma key", () => {
  const keyedImage = img("KEYED");
  const result: ChromaResult = { image: keyedImage, width: 400, height: 225 };

  function fakeEngine(ret: ChromaResult | null = result) {
    return {
      backend: "cpu" as const,
      process: vi.fn(() => ret),
      prune: vi.fn(),
      dispose: vi.fn(),
    };
  }

  it("routes only chroma-enabled layers through the keyer and draws its output", () => {
    const engine = fakeEngine();
    const scene = createScene("s", [
      layerOf("webcam", "plain", {
        transform: tf(0, 0, 400, 225),
        mirror: false,
      }),
      layerOf("webcam", "keyed", {
        transform: tf(100, 100, 400, 225),
        mirror: false,
        chroma: {
          enabled: true,
          key: "#00ff00",
          similarity: 0.3,
          smoothness: 0.05,
          spill: 0.2,
        },
      }),
    ]);
    const srcs = { plain: frame("P"), keyed: frame("K") };
    const { comp, rec } = setup(scene, srcs, {}, { chroma: engine });
    comp.renderOnce(0);
    expect(engine.process).toHaveBeenCalledTimes(1);
    const args = engine.process.mock.calls[0] as unknown as unknown[];
    expect(args[0]).toBe("keyed");
    expect(args[1]).toBe(srcs.keyed.source);
    expect(args.slice(2, 4)).toEqual([1920, 1080]);
    expect(args[5]).toBe(400);
    expect(args[6]).toBe(225);
    expect(args[7]).toEqual({
      key: [0, 255, 0],
      similarity: 0.3,
      smoothness: 0.05,
      spill: 0.2,
    });
    const draws = rec.named("drawImage");
    expect(draws[0]?.args[0]).toBe(srcs.plain.source);
    expect(draws[1]?.args).toEqual([
      keyedImage,
      0,
      0,
      400,
      225,
      100,
      100,
      400,
      225,
    ]);
  });

  it("reuses parsed parameters across frames until the layer settings change", () => {
    const engine = fakeEngine();
    const layer = layerOf("webcam", "k", {
      mirror: false,
      chroma: {
        enabled: true,
        key: "blue",
        similarity: 0.3,
        smoothness: 0.05,
        spill: 0.2,
      },
    });
    const scene = createScene("s", [layer]);
    const { comp } = setup(scene, { k: frame("K") }, {}, { chroma: engine });
    comp.renderOnce(0);
    comp.renderOnce(16);
    const first = (engine.process.mock.calls[0] as unknown as unknown[])[7];
    const second = (engine.process.mock.calls[1] as unknown as unknown[])[7];
    expect(second).toBe(first); // same object: nothing re-parsed per frame
    comp.setScene({
      ...scene,
      layers: [{ ...layer, chroma: { ...layer.chroma, similarity: 0.5 } }],
    });
    comp.renderOnce(32);
    const third = (engine.process.mock.calls[2] as unknown as unknown[])[7] as {
      similarity: number;
    };
    expect(third.similarity).toBe(0.5);
  });

  it("falls back to the unkeyed source if the keyer cannot process the frame", () => {
    const engine = fakeEngine(null);
    const scene = createScene("s", [
      layerOf("webcam", "k", {
        transform: tf(0, 0, 400, 225),
        mirror: false,
        chroma: {
          enabled: true,
          key: "green",
          similarity: 0.4,
          smoothness: 0.08,
          spill: 0.1,
        },
      }),
    ]);
    const srcs = { k: frame("K") };
    const { comp, rec } = setup(scene, srcs, {}, { chroma: engine });
    comp.renderOnce(0);
    expect(rec.named("drawImage")[0]?.args[0]).toBe(srcs.k.source);
  });

  it("never touches the keyer when chroma is disabled and does not create one", () => {
    const scene = createScene("s", [layerOf("webcam", "a", { mirror: false })]);
    const { comp } = setup(scene, { a: frame("A") });
    comp.renderOnce(0);
    expect(comp.chromaBackend).toBeNull();
  });

  it("prunes keyer scratch state when layers leave the live scenes and does not dispose an injected keyer", () => {
    const engine = fakeEngine();
    const a = createScene("A", [layerOf("webcam", "la")]);
    const b = createScene("B", [layerOf("webcam", "lb")]);
    const { comp } = setup(a, {}, {}, { chroma: engine });
    comp.transitionTo(b, { type: "cut", ms: 0 });
    const last = engine.prune.mock.calls.at(-1)?.[0] as ReadonlySet<string>;
    expect([...last]).toEqual(["lb"]);
    comp.dispose();
    expect(engine.dispose).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

describe("Compositor transitions", () => {
  const mkScene = (name: string, id: string) =>
    createScene(name, [layerOf("webcam", id, { mirror: false })]);
  const srcs = () => ({
    a: frame("A"),
    b: frame("B"),
    c: frame("C"),
    d: frame("D"),
    e: frame("E"),
  });

  it("cut switches immediately", () => {
    const A = mkScene("A", "a");
    const B = mkScene("B", "b");
    const s = srcs();
    const { comp, rec } = setup(A, s);
    comp.transitionTo(B, { type: "cut", ms: 400 });
    expect(comp.isTransitioning).toBe(false);
    expect(comp.currentScene).toBe(B);
    comp.renderOnce(0);
    expect(drawn(rec)).toEqual([s.b.source]);
  });

  it("zero-duration and first-ever transitions are cuts", () => {
    const A = mkScene("A", "a");
    const B = mkScene("B", "b");
    const first = setup(null, srcs());
    first.comp.transitionTo(A, { type: "fade", ms: 400 });
    expect(first.comp.currentScene).toBe(A);
    expect(first.comp.isTransitioning).toBe(false);
    first.comp.transitionTo(B, { type: "slide", ms: 0 });
    expect(first.comp.currentScene).toBe(B);
  });

  it("fade: the old scene keeps rendering live; the new one is composited on top with eased alpha", () => {
    const A = mkScene("A", "a");
    const B = mkScene("B", "b");
    const s = srcs();
    const { comp, rec, buffers } = setup(A, s);
    comp.transitionTo(B, { type: "fade", ms: 1000 });
    expect(comp.isTransitioning).toBe(true);
    expect(comp.currentScene).toBe(A);

    // First frame defines t=0: only the old scene is visible, no buffer needed yet.
    comp.renderOnce(5000);
    expect(drawn(rec)).toEqual([s.a.source]);
    expect(buffers).toHaveLength(0);

    // 25% in: old scene live on the main canvas + buffer composited with eased alpha.
    rec.clear();
    comp.renderOnce(5250);
    const main = rec.named("drawImage");
    expect(main).toHaveLength(2);
    expect(main[0]?.args[0]).toBe(s.a.source);
    expect(main[1]?.args[0]).toBe(buffers[0]?.canvas);
    expect(main[1]?.alpha).toBeCloseTo(easeInOut(0.25), 10);
    expect(drawn(buffers[0]!.rec)).toEqual([s.b.source]);
    expect(buffers[0]?.rec.depth()).toBe(0);
    expect(rec.depth()).toBe(0);

    // Halfway.
    rec.clear();
    comp.renderOnce(5500);
    expect(rec.named("drawImage")[1]?.alpha).toBeCloseTo(0.5, 10);

    // Done: B is current, only B is drawn, nothing from A.
    rec.clear();
    comp.renderOnce(6000);
    expect(comp.isTransitioning).toBe(false);
    expect(comp.currentScene).toBe(B);
    expect(drawn(rec)).toEqual([s.b.source]);
    expect(buffers).toHaveLength(1); // one reusable buffer, never one per frame
  });

  it("the outgoing scene is re-resolved every frame during the transition (live sources)", () => {
    const A = mkScene("A", "a");
    const B = mkScene("B", "b");
    const { comp, resolved } = setup(A, srcs());
    comp.transitionTo(B, { type: "fade", ms: 1000 });
    comp.renderOnce(0);
    comp.renderOnce(500);
    comp.renderOnce(750);
    expect(resolved.filter((id) => id === "a")).toHaveLength(3);
    expect(resolved.filter((id) => id === "b")).toHaveLength(2); // skipped at progress 0
  });

  it("slide: the incoming scene is translated by slideOffset over an opaque backdrop", () => {
    const A = mkScene("A", "a");
    const B = mkScene("B", "b");
    const s = srcs();
    const { comp, rec } = setup(A, s);
    comp.transitionTo(B, { type: "slide", ms: 1000 });
    comp.renderOnce(0);
    expect(drawn(rec)).toEqual([s.a.source]); // fully off-screen at progress 0

    rec.clear();
    comp.renderOnce(500);
    const tr = rec
      .named("translate")
      .find((c) => c.args[1] === 0 && c.args[0] !== 0);
    expect(tr?.args[0]).toBeCloseTo(slideOffset(0.5, 1920), 6);
    expect(drawn(rec)).toEqual([s.a.source, s.b.source]);
    expect(rec.named("fillRect").length).toBeGreaterThanOrEqual(2); // frame clear + backdrop
    expect(rec.depth()).toBe(0);
  });

  it("timing uses the timestamps passed to renderOnce, so equal inputs give equal frames", () => {
    const run = () => {
      const { comp, rec } = setup(mkScene("A", "a"), srcs());
      comp.transitionTo(mkScene("B", "b"), { type: "fade", ms: 400 });
      const alphas: number[] = [];
      for (const t of [100, 180, 260, 340, 420, 500, 580]) {
        rec.clear();
        comp.renderOnce(t);
        alphas.push(rec.named("drawImage")[1]?.alpha ?? -1);
      }
      return alphas;
    };
    expect(run()).toEqual(run());
    const alphas = run();
    expect(
      alphas
        .slice(1, 5)
        .every((a, i, arr) => i === 0 || a >= (arr[i - 1] ?? 0)),
    ).toBe(true);
  });

  it("queues overlapping transitions (single slot, latest wins) and runs them in order", () => {
    const A = mkScene("A", "a");
    const B = mkScene("B", "b");
    const C = mkScene("C", "c");
    const D = mkScene("D", "d");
    const { comp } = setup(A, srcs());
    comp.transitionTo(B, { type: "fade", ms: 1000 });
    comp.renderOnce(0);
    comp.transitionTo(C, { type: "fade", ms: 1000 });
    comp.transitionTo(D, { type: "slide", ms: 500 }); // replaces C in the queue
    comp.renderOnce(500);
    expect(comp.currentScene).toBe(A);

    comp.renderOnce(1000); // B arrives; D starts
    expect(comp.currentScene).toBe(B);
    expect(comp.isTransitioning).toBe(true);
    comp.renderOnce(1016); // t0 of D
    comp.renderOnce(1400);
    expect(comp.currentScene).toBe(B);
    comp.renderOnce(1516); // 500 ms later
    expect(comp.currentScene).toBe(D);
    expect(comp.isTransitioning).toBe(false);
  });

  it("a request for the scene already being transitioned to just refreshes it", () => {
    const A = mkScene("A", "a");
    const B = mkScene("B", "b");
    const B2 = { ...B, name: "B v2" };
    const { comp } = setup(A, srcs());
    comp.transitionTo(B, { type: "fade", ms: 400 });
    comp.renderOnce(0);
    comp.transitionTo(B2, { type: "fade", ms: 400 });
    comp.renderOnce(400);
    expect(comp.currentScene).toBe(B2);
    expect(comp.isTransitioning).toBe(false); // nothing was queued
  });

  it("a cut cancels the running transition and the queue", () => {
    const A = mkScene("A", "a");
    const B = mkScene("B", "b");
    const C = mkScene("C", "c");
    const E = mkScene("E", "e");
    const { comp } = setup(A, srcs());
    comp.transitionTo(B, { type: "fade", ms: 1000 });
    comp.renderOnce(0);
    comp.transitionTo(C, { type: "fade", ms: 1000 });
    comp.transitionTo(E, { type: "cut", ms: 0 });
    expect(comp.currentScene).toBe(E);
    expect(comp.isTransitioning).toBe(false);
    comp.renderOnce(2000);
    comp.renderOnce(5000);
    expect(comp.currentScene).toBe(E);
  });

  it("transitionTo the scene that is already on screen replaces the reference, no transition", () => {
    const A = mkScene("A", "a");
    const A2 = { ...A, name: "A v2" };
    const { comp } = setup(A, srcs());
    comp.transitionTo(A2, { type: "fade", ms: 500 });
    expect(comp.currentScene).toBe(A2);
    expect(comp.isTransitioning).toBe(false);
  });

  it("clamps absurd durations", () => {
    const { comp } = setup(mkScene("A", "a"), srcs());
    comp.transitionTo(mkScene("B", "b"), { type: "fade", ms: 1e12 });
    comp.renderOnce(0);
    comp.renderOnce(MAX_TRANSITION_MS - 1);
    expect(comp.isTransitioning).toBe(true);
    comp.renderOnce(MAX_TRANSITION_MS);
    expect(comp.isTransitioning).toBe(false);
  });

  it("setScene with the same id refreshes without interrupting a transition", () => {
    const A = mkScene("A", "a");
    const B = mkScene("B", "b");
    const { comp } = setup(A, srcs());
    comp.transitionTo(B, { type: "fade", ms: 1000 });
    comp.renderOnce(0);
    const A2 = { ...A, name: "A edited" };
    const B2 = { ...B, name: "B edited" };
    comp.setScene(A2);
    comp.setScene(B2);
    expect(comp.isTransitioning).toBe(true);
    expect(comp.currentScene).toBe(A2);
    comp.renderOnce(1000);
    expect(comp.currentScene).toBe(B2);
  });

  it("setScene with a different scene is a hard cut that cancels transitions", () => {
    const A = mkScene("A", "a");
    const B = mkScene("B", "b");
    const C = mkScene("C", "c");
    const { comp } = setup(A, srcs());
    comp.transitionTo(B, { type: "fade", ms: 1000 });
    comp.renderOnce(0);
    comp.setScene(C);
    expect(comp.currentScene).toBe(C);
    expect(comp.isTransitioning).toBe(false);
  });

  it("without a scratch canvas a fade degrades to showing the new scene", () => {
    const A = mkScene("A", "a");
    const B = mkScene("B", "b");
    const s = srcs();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const main = recordingCanvas();
    const comp = new Compositor(main.canvas, hooksFor(s).hooks, {
      width: 1920,
      height: 1080,
      fps: 60,
      createCanvas: () => {
        throw new Error("no canvas");
      },
    });
    comp.setScene(A);
    comp.transitionTo(B, { type: "fade", ms: 1000 });
    comp.renderOnce(0);
    main.rec.clear();
    comp.renderOnce(500);
    expect(drawn(main.rec)).toEqual([s.a.source, s.b.source]);
    expect(warn).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Loop, stats, resize, lifecycle                                      */
/* ------------------------------------------------------------------ */

function fakeTickerEnv() {
  let time = 0;
  const rafs = new Map<number, (t: number) => void>();
  let id = 1;
  const env: TickerEnv = {
    now: () => time,
    requestFrame: (cb) => {
      rafs.set(id, cb);
      return id++;
    },
    cancelFrame: (n) => void rafs.delete(n),
    isVisible: () => true,
    onVisibilityChange: () => () => {},
    createTimer: () => ({ kind: "interval", stop: () => {} }),
    startWatchdog: () => () => {},
  };
  return {
    env,
    vsync(t: number) {
      time = t;
      const pending = [...rafs.values()];
      rafs.clear();
      for (const cb of pending) cb(t);
    },
    pending: () => rafs.size,
  };
}

describe("Compositor loop & lifecycle", () => {
  it("start() renders on the ticker, reports drops, stop() halts", () => {
    const scene = createScene("s", [layerOf("webcam", "a", { mirror: false })]);
    const main = recordingCanvas();
    const fake = fakeTickerEnv();
    const comp = new Compositor(
      main.canvas,
      hooksFor({ a: frame("A") }).hooks,
      {
        width: 1920,
        height: 1080,
        fps: 60,
        tickerEnv: fake.env,
      },
    );
    comp.setScene(scene);
    const stamps: number[] = [];
    comp.onFrame((t) => stamps.push(t));
    comp.start();
    comp.start(); // idempotent
    expect(comp.running).toBe(true);
    fake.vsync(100);
    fake.vsync(100 + 16.67);
    fake.vsync(100 + 16.67 * 5); // 3 slots missed
    expect(stamps).toHaveLength(3);
    expect(comp.getStats().droppedFrames).toBe(3);
    comp.stop();
    expect(comp.running).toBe(false);
    fake.vsync(500);
    expect(stamps).toHaveLength(3);
    expect(fake.pending()).toBe(0);
  });

  it("a frame that throws does not stop the loop", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let failing = true;
    const main = recordingCanvas({
      shouldThrow: (m) => failing && m === "fillRect",
    });
    const fake = fakeTickerEnv();
    const comp = new Compositor(main.canvas, hooksFor({}).hooks, {
      width: 1920,
      height: 1080,
      fps: 60,
      tickerEnv: fake.env,
    });
    let calls = 0;
    comp.onFrame(() => {
      calls++;
    });
    comp.start();
    fake.vsync(0);
    fake.vsync(17);
    expect(calls).toBe(0); // frames aborted, but the loop kept running
    expect(comp.running).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    failing = false;
    fake.vsync(34);
    expect(calls).toBe(1); // recovered on its own
    comp.stop();
  });

  it("onFrame listeners can unsubscribe and a throwing listener does not break others", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { comp } = setup(null);
    const a = vi.fn(() => {
      throw new Error("listener");
    });
    const b = vi.fn();
    comp.onFrame(a);
    const off = comp.onFrame(b);
    comp.renderOnce(1);
    off();
    comp.renderOnce(2);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith(1);
    expect(err).toHaveBeenCalled();
  });

  it("getStats reports fps, smoothed frame time and starts at zero", () => {
    const { comp } = setup(null);
    expect(comp.getStats()).toEqual({ fps: 0, frameMs: 0, droppedFrames: 0 });
    for (let i = 0; i <= 60; i++) comp.renderOnce(i * (1000 / 60));
    const stats = comp.getStats();
    expect(stats.fps).toBeGreaterThan(55);
    expect(stats.fps).toBeLessThan(65);
    expect(stats.frameMs).toBeGreaterThanOrEqual(0);
    expect(stats.droppedFrames).toBe(0);
  });

  it("resize updates the canvas and the scaling, and ignores invalid sizes", () => {
    const scene = createScene("s", [
      layerOf("webcam", "a", {
        transform: tf(0, 0, 1920, 1080),
        mirror: false,
      }),
    ]);
    const { comp, rec, main } = setup(scene, { a: frame("A") });
    comp.resize(1280, 720);
    expect(main.raw.width).toBe(1280);
    expect(main.raw.height).toBe(720);
    expect(comp.width).toBe(1280);
    comp.renderOnce(0);
    expect(rec.named("drawImage")[0]?.args.slice(5)).toEqual([0, 0, 1280, 720]);
    comp.resize(Number.NaN, 100);
    comp.resize(Number.POSITIVE_INFINITY, Number.NaN);
    expect(comp.width).toBe(1280);
    expect(comp.height).toBe(720);
    comp.resize(1, 1e9);
    expect(comp.width).toBe(16);
    expect(comp.height).toBe(7680);
  });

  it("resize also resizes an existing fade buffer", () => {
    const { comp, buffers } = setup(
      createScene("A", [layerOf("webcam", "a")]),
      { a: frame("A") },
    );
    comp.transitionTo(createScene("B", [layerOf("webcam", "b")]), {
      type: "fade",
      ms: 1000,
    });
    comp.renderOnce(0);
    comp.renderOnce(500);
    expect(buffers).toHaveLength(1);
    comp.resize(1280, 720);
    expect(buffers[0]?.raw.width).toBe(1280);
    expect(buffers[0]?.raw.height).toBe(720);
  });

  it("re-applies image smoothing after a resize (resizing a canvas resets its context)", () => {
    const { comp, rec } = setup(null);
    expect(
      rec.sets.some(
        (s) => s.prop === "imageSmoothingEnabled" && s.value === true,
      ),
    ).toBe(true);
    rec.clear();
    comp.resize(1280, 720);
    expect(
      rec.sets.some(
        (s) => s.prop === "imageSmoothingEnabled" && s.value === true,
      ),
    ).toBe(true);
    expect(rec.sets.some((s) => s.prop === "imageSmoothingQuality")).toBe(true);
  });

  it("dispose stops the loop, drops listeners and ignores later start()", () => {
    const main = recordingCanvas();
    const fake = fakeTickerEnv();
    const comp = new Compositor(main.canvas, hooksFor({}).hooks, {
      width: 1920,
      height: 1080,
      fps: 60,
      tickerEnv: fake.env,
    });
    const cb = vi.fn();
    comp.onFrame(cb);
    comp.start();
    comp.dispose();
    expect(comp.running).toBe(false);
    comp.start();
    expect(comp.running).toBe(false);
    fake.vsync(0);
    expect(cb).not.toHaveBeenCalled();
  });

  it("setFps clamps and applies to a running loop", () => {
    const main = recordingCanvas();
    const fake = fakeTickerEnv();
    const comp = new Compositor(main.canvas, hooksFor({}).hooks, {
      width: 1920,
      height: 1080,
      fps: Number.NaN,
      tickerEnv: fake.env,
    });
    const stamps: number[] = [];
    comp.onFrame((t) => stamps.push(t));
    comp.start();
    comp.setFps(30);
    let n = 0;
    for (let t = 0; t < 1000; t += 1000 / 120) {
      fake.vsync(t);
      n++;
    }
    expect(n).toBeGreaterThan(100);
    expect(stamps.length).toBeGreaterThanOrEqual(28);
    expect(stamps.length).toBeLessThanOrEqual(32);
    comp.stop();
  });
});
