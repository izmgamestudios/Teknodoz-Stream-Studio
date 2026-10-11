import { describe, expect, it } from "vitest";
import {
  ChromaProcessor,
  chromaDistance,
  chromaKeyPixels,
  chromaParamsFromLayer,
  fitRaster,
  normalizeChromaParams,
  parseKeyColor,
  rgbToCbCr,
  type ChromaKeyParams,
  type ScratchCanvas,
} from "./chroma";

const GREEN_KEY: ChromaKeyParams = {
  key: [0, 255, 0],
  similarity: 0.4,
  smoothness: 0.08,
  spill: 0.1,
};

function px(r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, a]);
}

function keyed(
  rgba: [number, number, number, number?],
  params: ChromaKeyParams = GREEN_KEY,
) {
  const data = px(rgba[0], rgba[1], rgba[2], rgba[3] ?? 255);
  chromaKeyPixels(data, params);
  return Array.from(data) as [number, number, number, number];
}

describe("parseKeyColor", () => {
  it("handles the named keys", () => {
    expect(parseKeyColor("green")).toEqual([0, 255, 0]);
    expect(parseKeyColor("blue")).toEqual([0, 0, 255]);
    expect(parseKeyColor("  GREEN ")).toEqual([0, 255, 0]);
  });

  it("parses #rrggbb, #rgb and #rrggbbaa", () => {
    expect(parseKeyColor("#00b140")).toEqual([0, 177, 64]);
    expect(parseKeyColor("#0F0")).toEqual([0, 255, 0]);
    expect(parseKeyColor("#ff8800cc")).toEqual([255, 136, 0]);
  });

  it("falls back to green for malformed input", () => {
    for (const bad of [
      "",
      "red",
      "#12",
      "#12345",
      "#gggggg",
      "00ff00",
      "rgb(0,255,0)",
    ]) {
      expect(parseKeyColor(bad)).toEqual([0, 255, 0]);
    }
    expect(parseKeyColor(undefined as unknown as string)).toEqual([0, 255, 0]);
    expect(parseKeyColor(42 as unknown as string)).toEqual([0, 255, 0]);
  });
});

describe("params", () => {
  it("normalizeChromaParams clamps ranges and replaces NaN", () => {
    const p = normalizeChromaParams({
      key: [-5, 300, Number.NaN],
      similarity: 2,
      smoothness: -1,
      spill: Number.NaN,
    });
    expect(p.key).toEqual([0, 255, 0]);
    expect(p.similarity).toBe(1);
    expect(p.smoothness).toBe(0);
    expect(p.spill).toBe(0.1);
  });

  it("chromaParamsFromLayer maps a ChromaKey", () => {
    const p = chromaParamsFromLayer({
      enabled: true,
      key: "#0000ff",
      similarity: 0.3,
      smoothness: 0.05,
      spill: 0.2,
    });
    expect(p).toEqual({
      key: [0, 0, 255],
      similarity: 0.3,
      smoothness: 0.05,
      spill: 0.2,
    });
  });

  it("rgbToCbCr is neutral for greys and symmetric-ish for primaries", () => {
    const [cb, cr] = rgbToCbCr(128, 128, 128);
    expect(cb).toBeCloseTo(0, 3);
    expect(cr).toBeCloseTo(0, 3);
    const [gcb, gcr] = rgbToCbCr(0, 255, 0);
    expect(gcb).toBeCloseTo(-0.3313, 3);
    expect(gcr).toBeCloseTo(-0.4187, 3);
    expect(chromaDistance([0, 255, 0], [0, 255, 0])).toBe(0);
  });
});

describe("chromaKeyPixels", () => {
  it("makes pure green fully transparent", () => {
    expect(keyed([0, 255, 0])[3]).toBe(0);
  });

  it("is brightness independent: dark green keys out as well", () => {
    expect(keyed([0, 90, 0])[3]).toBe(0);
    expect(keyed([20, 140, 30])[3]).toBe(0);
  });

  it("leaves a skin tone completely untouched", () => {
    expect(keyed([224, 172, 105])).toEqual([224, 172, 105, 255]);
    expect(keyed([141, 85, 36])).toEqual([141, 85, 36, 255]);
  });

  it("leaves white, black, red and blue untouched for a green key", () => {
    expect(keyed([255, 255, 255])).toEqual([255, 255, 255, 255]);
    expect(keyed([0, 0, 0])).toEqual([0, 0, 0, 255]);
    expect(keyed([255, 0, 0])).toEqual([255, 0, 0, 255]);
    expect(keyed([0, 0, 255])).toEqual([0, 0, 255, 255]);
  });

  it("keys out blue for a blue key but keeps green", () => {
    const blue: ChromaKeyParams = { ...GREEN_KEY, key: [0, 0, 255] };
    expect(keyed([0, 0, 255], blue)[3]).toBe(0);
    expect(keyed([0, 255, 0], blue)[3]).toBe(255);
  });

  it("supports arbitrary key colours", () => {
    const magenta: ChromaKeyParams = { ...GREEN_KEY, key: [255, 0, 255] };
    expect(keyed([255, 0, 255], magenta)[3]).toBe(0);
    expect(keyed([0, 255, 0], magenta)[3]).toBe(255);
  });

  it("edge alpha is monotonic in distance from the key colour", () => {
    // Walk from pure green to pure red through the chroma plane.
    const params: ChromaKeyParams = { ...GREEN_KEY, spill: 0 };
    let previous = -1;
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const a = keyed(
        [Math.round(255 * t), Math.round(255 * (1 - t)), 0],
        params,
      )[3];
      expect(a).toBeGreaterThanOrEqual(previous);
      previous = a;
    }
    expect(previous).toBe(255);
  });

  it("the soft edge is partially transparent between similarity and similarity + smoothness", () => {
    const params: ChromaKeyParams = {
      key: [0, 255, 0],
      similarity: 0.3,
      smoothness: 0.3,
      spill: 0,
    };
    const samples: number[] = [];
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      samples.push(
        keyed([Math.round(255 * t), Math.round(255 * (1 - t)), 0], params)[3],
      );
    }
    expect(samples.some((a) => a > 0 && a < 255)).toBe(true);
    expect(samples[0]).toBe(0);
    expect(samples[100]).toBe(255);
  });

  it("a larger smoothness yields a wider (never narrower) transparent zone", () => {
    const at = (smoothness: number): number => {
      const params: ChromaKeyParams = {
        key: [0, 255, 0],
        similarity: 0.35,
        smoothness,
        spill: 0,
      };
      return keyed([100, 180, 40], params)[3];
    };
    expect(at(0.0)).toBeGreaterThanOrEqual(at(0.1));
    expect(at(0.1)).toBeGreaterThanOrEqual(at(0.3));
  });

  it("smoothness 0 gives a hard edge", () => {
    const hard: ChromaKeyParams = {
      key: [0, 255, 0],
      similarity: 0.5,
      smoothness: 0,
      spill: 0,
    };
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      const a = keyed(
        [Math.round(255 * t), Math.round(255 * (1 - t)), 0],
        hard,
      )[3];
      expect(a === 0 || a === 255).toBe(true);
    }
  });

  it("raising similarity keys out more pixels", () => {
    const count = (similarity: number): number => {
      let n = 0;
      for (let i = 0; i <= 50; i++) {
        const t = i / 50;
        const params: ChromaKeyParams = {
          key: [0, 255, 0],
          similarity,
          smoothness: 0.02,
          spill: 0,
        };
        if (
          keyed(
            [Math.round(255 * t), Math.round(255 * (1 - t)), 0],
            params,
          )[3] === 0
        )
          n++;
      }
      return n;
    };
    expect(count(0.2)).toBeLessThan(count(0.5));
    expect(count(0.5)).toBeLessThanOrEqual(count(0.9));
  });

  it("spill suppression reduces green dominance near the key and is off at spill 0", () => {
    // A greenish edge pixel just outside the fully-keyed zone.
    const pixel: [number, number, number] = [100, 200, 100];
    const off = keyed(pixel, {
      key: [0, 255, 0],
      similarity: 0.2,
      smoothness: 0.1,
      spill: 0,
    });
    const on = keyed(pixel, {
      key: [0, 255, 0],
      similarity: 0.2,
      smoothness: 0.1,
      spill: 0.3,
    });
    expect(off.slice(0, 3)).toEqual(pixel);
    const dominanceOff = off[1] - Math.max(off[0], off[2]);
    const dominanceOn = on[1] - Math.max(on[0], on[2]);
    expect(dominanceOn).toBeLessThan(dominanceOff);
    expect(on[1]).toBeLessThan(off[1]);
    expect(on[3]).toBe(255); // spill never touches alpha
  });

  it("more spill means less green dominance", () => {
    const pixel: [number, number, number] = [100, 200, 100];
    const g = (spill: number): number =>
      keyed(pixel, {
        key: [0, 255, 0],
        similarity: 0.2,
        smoothness: 0.1,
        spill,
      })[1];
    expect(g(0.1)).toBeGreaterThanOrEqual(g(0.3));
    expect(g(0.3)).toBeGreaterThanOrEqual(g(0.6));
  });

  it("leaves skin untouched with the default spill range", () => {
    expect(keyed([224, 172, 105], { ...GREEN_KEY, spill: 0.1 })).toEqual([
      224, 172, 105, 255,
    ]);
  });

  it("preserves the existing alpha scale of semi-transparent pixels", () => {
    expect(keyed([224, 172, 105, 128])[3]).toBe(128);
    expect(keyed([0, 255, 0, 128])[3]).toBe(0);
  });

  it("processes many pixels and ignores a trailing partial pixel", () => {
    const data = new Uint8ClampedArray([
      0, 255, 0, 255, 224, 172, 105, 255, 0, 255, 0,
    ]);
    chromaKeyPixels(data, GREEN_KEY);
    expect(Array.from(data)).toEqual([
      0, 255, 0, 0, 224, 172, 105, 255, 0, 255, 0,
    ]);
  });

  it("is a no-op on empty data and survives NaN params", () => {
    expect(() =>
      chromaKeyPixels(new Uint8ClampedArray(0), GREEN_KEY),
    ).not.toThrow();
    const out = keyed([0, 255, 0], {
      key: [0, 255, 0],
      similarity: Number.NaN,
      smoothness: Number.NaN,
      spill: Number.NaN,
    });
    expect(out[3]).toBe(0);
  });
});

describe("fitRaster", () => {
  it("returns the requested size when within budget", () => {
    expect(fitRaster(640, 360, 1_000_000, 2048)).toEqual({ w: 640, h: 360 });
  });

  it("shrinks to the pixel budget keeping the aspect ratio", () => {
    const r = fitRaster(1920, 1080, 960 * 540, 4096);
    expect(r.w * r.h).toBeLessThanOrEqual(960 * 540);
    expect(r.w / r.h).toBeCloseTo(16 / 9, 1);
  });

  it("clamps the longest edge", () => {
    const r = fitRaster(8000, 1000, Infinity, 2048);
    expect(r.w).toBe(2048);
    expect(r.h).toBe(256);
  });

  it("never returns less than 1x1 and tolerates junk", () => {
    expect(fitRaster(0, 0, 100, 100)).toEqual({ w: 1, h: 1 });
    expect(fitRaster(Number.NaN, 5, 100, 100).w).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* ChromaProcessor with fakes                                          */
/* ------------------------------------------------------------------ */

interface FakeCanvas {
  width: number;
  height: number;
  puts: { data: Uint8ClampedArray }[];
  draws: unknown[][];
  getContext(type: string): unknown;
  addEventListener(): void;
}

function fakeCanvasFactory(opts: {
  fill: [number, number, number, number];
  gl?: unknown;
  created?: FakeCanvas[];
}) {
  const created = opts.created ?? [];
  const factory = (w: number, h: number): ScratchCanvas => {
    const canvas: FakeCanvas = {
      width: w,
      height: h,
      puts: [],
      draws: [],
      addEventListener: () => {},
      getContext(type: string): unknown {
        if (type === "webgl2") return opts.gl ?? null;
        return {
          clearRect: () => {},
          drawImage: (...a: unknown[]) => canvas.draws.push(a),
          getImageData: (_x: number, _y: number, cw: number, ch: number) => {
            const data = new Uint8ClampedArray(cw * ch * 4);
            for (let i = 0; i < data.length; i += 4) data.set(opts.fill, i);
            return { data, width: cw, height: ch };
          },
          putImageData: (img: { data: Uint8ClampedArray }) =>
            canvas.puts.push(img),
        };
      },
    };
    created.push(canvas);
    return canvas as unknown as ScratchCanvas;
  };
  return { factory, created };
}

function fakeGl(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const target: Record<string, unknown> = {
    isContextLost: () => false,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
    ...overrides,
  };
  const gl = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      return (...args: unknown[]) => {
        calls.push(prop);
        void args;
        return {};
      };
    },
  });
  return { gl, calls };
}

const SRC = {} as CanvasImageSource;
const CROP = { x: 0, y: 0, w: 1920, h: 1080 };

describe("ChromaProcessor (CPU backend)", () => {
  it("keys through the CPU path when GPU is disabled", () => {
    const { factory, created } = fakeCanvasFactory({ fill: [0, 255, 0, 255] });
    const proc = new ChromaProcessor({
      preferGpu: false,
      createCanvas: factory,
    });
    expect(proc.backend).toBe("cpu");
    const res = proc.process("a", SRC, 1920, 1080, CROP, 640, 360, GREEN_KEY);
    expect(res).not.toBeNull();
    expect(res?.width).toBe(640);
    expect(res?.height).toBe(360);
    const canvas = created[0];
    expect(canvas?.puts).toHaveLength(1);
    const data = canvas?.puts[0]?.data;
    expect(data?.[3]).toBe(0); // green keyed to transparent
    expect(canvas?.draws[0]).toEqual([SRC, 0, 0, 1920, 1080, 0, 0, 640, 360]);
  });

  it("reuses the same scratch canvas and result object per layer across frames", () => {
    const { factory, created } = fakeCanvasFactory({
      fill: [224, 172, 105, 255],
    });
    const proc = new ChromaProcessor({
      preferGpu: false,
      createCanvas: factory,
    });
    const a1 = proc.process("a", SRC, 100, 100, CROP, 64, 64, GREEN_KEY);
    const a2 = proc.process("a", SRC, 100, 100, CROP, 64, 64, GREEN_KEY);
    proc.process("b", SRC, 100, 100, CROP, 64, 64, GREEN_KEY);
    expect(created).toHaveLength(2); // one canvas per layer id, no per-frame canvases
    expect(a1).toBe(a2);
    expect(a1?.image).toBe(created[0]);
  });

  it("caps the CPU raster to the pixel budget", () => {
    const { factory } = fakeCanvasFactory({ fill: [0, 255, 0, 255] });
    const proc = new ChromaProcessor({
      preferGpu: false,
      createCanvas: factory,
      maxCpuPixels: 10_000,
    });
    const res = proc.process("a", SRC, 1920, 1080, CROP, 1920, 1080, GREEN_KEY);
    expect((res?.width ?? 0) * (res?.height ?? 0)).toBeLessThanOrEqual(10_000);
  });

  it("prune and release free per-layer scratch state", () => {
    const { factory, created } = fakeCanvasFactory({ fill: [0, 255, 0, 255] });
    const proc = new ChromaProcessor({
      preferGpu: false,
      createCanvas: factory,
    });
    proc.process("a", SRC, 10, 10, CROP, 10, 10, GREEN_KEY);
    proc.process("b", SRC, 10, 10, CROP, 10, 10, GREEN_KEY);
    proc.prune(new Set(["a"]));
    expect(created[1]?.width).toBe(1); // b shrunk
    expect(created[0]?.width).toBe(10); // a kept
    proc.process("b", SRC, 10, 10, CROP, 10, 10, GREEN_KEY);
    expect(created).toHaveLength(3); // b was recreated
  });

  it("bounds the number of cached layers", () => {
    const { factory, created } = fakeCanvasFactory({ fill: [0, 255, 0, 255] });
    const proc = new ChromaProcessor({
      preferGpu: false,
      createCanvas: factory,
      maxEntries: 2,
    });
    for (const id of ["a", "b", "c", "d"])
      proc.process(id, SRC, 10, 10, CROP, 10, 10, GREEN_KEY);
    const alive = created.filter((c) => c.width > 1).length;
    expect(alive).toBeLessThanOrEqual(2);
  });

  it("returns null for degenerate sizes and after dispose", () => {
    const { factory } = fakeCanvasFactory({ fill: [0, 255, 0, 255] });
    const proc = new ChromaProcessor({
      preferGpu: false,
      createCanvas: factory,
    });
    expect(proc.process("a", SRC, 0, 10, CROP, 10, 10, GREEN_KEY)).toBeNull();
    expect(proc.process("a", SRC, 10, 10, CROP, 0, 10, GREEN_KEY)).toBeNull();
    proc.dispose();
    expect(proc.process("a", SRC, 10, 10, CROP, 10, 10, GREEN_KEY)).toBeNull();
  });

  it("sanitizes a bad crop rect to the whole source", () => {
    const { factory, created } = fakeCanvasFactory({ fill: [0, 255, 0, 255] });
    const proc = new ChromaProcessor({
      preferGpu: false,
      createCanvas: factory,
    });
    proc.process(
      "a",
      SRC,
      200,
      100,
      { x: Number.NaN, y: 0, w: -5, h: 10 },
      20,
      10,
      GREEN_KEY,
    );
    expect(created[0]?.draws[0]).toEqual([SRC, 0, 0, 200, 100, 0, 0, 20, 10]);
  });

  it("reports a typed error and degrades to null when no canvas can be created", () => {
    const proc = new ChromaProcessor({
      preferGpu: false,
      createCanvas: () => {
        throw new Error("nope");
      },
    });
    expect(proc.process("a", SRC, 10, 10, CROP, 10, 10, GREEN_KEY)).toBeNull();
    expect(proc.lastError?.code).toBe("chroma-no-canvas");
  });

  it("returns null when pixel readback throws (tainted canvas)", () => {
    const canvas = {
      width: 1,
      height: 1,
      addEventListener: () => {},
      getContext: () => ({
        clearRect: () => {},
        drawImage: () => {},
        getImageData: () => {
          throw new Error("SecurityError");
        },
        putImageData: () => {},
      }),
    };
    const proc = new ChromaProcessor({
      preferGpu: false,
      createCanvas: () => canvas as unknown as ScratchCanvas,
    });
    expect(proc.process("a", SRC, 10, 10, CROP, 10, 10, GREEN_KEY)).toBeNull();
    expect(proc.lastError?.code).toBe("chroma-cpu-failed");
  });
});

describe("ChromaProcessor (backend selection)", () => {
  it("falls back to CPU when WebGL2 is unavailable", () => {
    const { factory } = fakeCanvasFactory({ fill: [0, 255, 0, 255], gl: null });
    const proc = new ChromaProcessor({ createCanvas: factory });
    expect(proc.backend).toBe("cpu");
    expect(proc.lastError?.code).toBe("chroma-gl-unavailable");
    expect(
      proc.process("a", SRC, 10, 10, CROP, 10, 10, GREEN_KEY),
    ).not.toBeNull();
  });

  it("falls back to CPU when the shader fails to compile", () => {
    const { gl } = fakeGl({ getShaderParameter: () => false });
    const { factory } = fakeCanvasFactory({ fill: [0, 255, 0, 255], gl });
    const proc = new ChromaProcessor({ createCanvas: factory });
    expect(proc.backend).toBe("cpu");
    expect(proc.lastError?.code).toBe("chroma-gl-failed");
  });

  it("selects WebGL2 when available and renders with a single draw call", () => {
    const { gl, calls } = fakeGl();
    const { factory, created } = fakeCanvasFactory({
      fill: [0, 255, 0, 255],
      gl,
    });
    const proc = new ChromaProcessor({ createCanvas: factory });
    expect(proc.backend).toBe("webgl2");
    const res = proc.process("a", SRC, 1920, 1080, CROP, 800, 450, GREEN_KEY);
    expect(res).not.toBeNull();
    expect(res?.width).toBe(800);
    expect(res?.height).toBe(450);
    expect(res?.image).toBe(created[0]); // the GL canvas itself
    expect(calls.filter((c) => c === "drawArrays")).toHaveLength(1);
    expect(calls.filter((c) => c === "texImage2D")).toHaveLength(1);
    // Second layer reuses the same GL canvas: no extra canvas, still one draw per process().
    proc.process("b", SRC, 1920, 1080, CROP, 800, 450, GREEN_KEY);
    expect(created).toHaveLength(1);
    expect(calls.filter((c) => c === "drawArrays")).toHaveLength(2);
  });

  it("uses mipmaps only for strong downscales", () => {
    const { gl, calls } = fakeGl();
    const { factory } = fakeCanvasFactory({ fill: [0, 255, 0, 255], gl });
    const proc = new ChromaProcessor({ createCanvas: factory });
    proc.process("a", SRC, 1920, 1080, CROP, 1920, 1080, GREEN_KEY); // 1:1
    expect(calls).not.toContain("generateMipmap");
    proc.process("a", SRC, 1920, 1080, CROP, 480, 270, GREEN_KEY); // 4x down
    expect(calls.filter((c) => c === "generateMipmap")).toHaveLength(1);
    proc.process("a", SRC, 1920, 1080, CROP, 480, 270, GREEN_KEY);
    expect(calls.filter((c) => c === "generateMipmap")).toHaveLength(2); // regenerated per upload
    proc.process("a", SRC, 1920, 1080, CROP, 1920, 1080, GREEN_KEY);
    expect(calls.filter((c) => c === "generateMipmap")).toHaveLength(2);
  });

  it("falls back to the CPU for the failing frame, then permanently after repeated failures", () => {
    const { gl } = fakeGl({
      texImage2D: () => {
        throw new Error("unsupported source");
      },
    });
    const { factory } = fakeCanvasFactory({ fill: [0, 255, 0, 255], gl });
    const proc = new ChromaProcessor({ createCanvas: factory });
    expect(proc.backend).toBe("webgl2");
    for (let i = 0; i < 3; i++) {
      expect(
        proc.process("a", SRC, 10, 10, CROP, 10, 10, GREEN_KEY),
      ).not.toBeNull();
    }
    expect(proc.backend).toBe("cpu");
  });

  it("does not touch any canvas until first use", () => {
    let made = 0;
    const proc = new ChromaProcessor({
      createCanvas: () => {
        made++;
        throw new Error("should be lazy");
      },
    });
    expect(made).toBe(0);
    proc.dispose();
  });
});
