import { describe, expect, it, vi } from "vitest";
import {
  BLEND_MODES,
  isBlendMode,
  isBlendSupported,
  parseBlendMode,
  resetBlendSupportCache,
  resolveBlend,
  sanitizeCssFilter,
  toCompositeOperation,
} from "./blend";

/** A context that accepts every composite operation except the ones in `rejected`. */
function fakeCtx(rejected: string[] = []) {
  let current = "source-over";
  return {
    get globalCompositeOperation(): string {
      return current;
    },
    set globalCompositeOperation(v: string) {
      if (!rejected.includes(v)) current = v;
    },
  };
}

describe("blend mode validation", () => {
  it("knows all 16 modes and starts with source-over", () => {
    expect(BLEND_MODES).toHaveLength(16);
    expect(BLEND_MODES[0]).toBe("source-over");
    expect(new Set(BLEND_MODES).size).toBe(16);
  });

  it("isBlendMode accepts only known strings", () => {
    for (const m of BLEND_MODES) expect(isBlendMode(m)).toBe(true);
    expect(isBlendMode("xor")).toBe(false);
    expect(isBlendMode("")).toBe(false);
    expect(isBlendMode(null)).toBe(false);
    expect(isBlendMode(undefined)).toBe(false);
    expect(isBlendMode(5)).toBe(false);
    expect(isBlendMode({})).toBe(false);
  });

  it("parseBlendMode falls back for junk", () => {
    expect(parseBlendMode("multiply")).toBe("multiply");
    expect(parseBlendMode("bogus")).toBe("source-over");
    expect(parseBlendMode(undefined, "screen")).toBe("screen");
  });

  it("toCompositeOperation is the identity for valid modes and source-over otherwise", () => {
    for (const m of BLEND_MODES) expect(toCompositeOperation(m)).toBe(m);
    expect(toCompositeOperation("nope")).toBe("source-over");
  });
});

describe("blend support probe", () => {
  it("source-over is always supported", () => {
    expect(isBlendSupported("source-over", fakeCtx(["source-over"]))).toBe(
      true,
    );
  });

  it("reports unsupported modes when the context ignores them", () => {
    const ctx = fakeCtx(["hue", "luminosity"]);
    expect(isBlendSupported("multiply", ctx)).toBe(true);
    expect(isBlendSupported("hue", ctx)).toBe(false);
    expect(isBlendSupported("luminosity", ctx)).toBe(false);
  });

  it("restores the previous operation after probing", () => {
    const ctx = fakeCtx();
    ctx.globalCompositeOperation = "lighten";
    isBlendSupported("multiply", ctx);
    expect(ctx.globalCompositeOperation).toBe("lighten");
  });

  it("caches per context", () => {
    const ctx = fakeCtx(["hue"]);
    expect(isBlendSupported("hue", ctx)).toBe(false);
    // A different context is probed independently.
    expect(isBlendSupported("hue", fakeCtx())).toBe(true);
  });

  it("rejects non-modes and survives a throwing context", () => {
    expect(isBlendSupported("xor" as never, fakeCtx())).toBe(false);
    const throwing = {
      get globalCompositeOperation(): string {
        return "source-over";
      },
      set globalCompositeOperation(_v: string) {
        throw new Error("boom");
      },
    };
    expect(isBlendSupported("multiply", throwing)).toBe(false);
  });

  it("resolveBlend validates, probes and falls back to source-over", () => {
    const ctx = fakeCtx(["soft-light"]);
    expect(resolveBlend("screen", ctx)).toBe("screen");
    expect(resolveBlend("soft-light", ctx)).toBe("source-over");
    expect(resolveBlend("garbage", ctx)).toBe("source-over");
    expect(resolveBlend(undefined, ctx)).toBe("source-over");
  });

  it("without any canvas only source-over is considered supported", () => {
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    try {
      expect(isBlendSupported("source-over")).toBe(true);
      expect(isBlendSupported("multiply")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("probes a scratch canvas once and caches the answer", () => {
    resetBlendSupportCache();
    const ctx = fakeCtx(["hue"]);
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    try {
      expect(isBlendSupported("multiply")).toBe(true);
      expect(isBlendSupported("hue")).toBe(false);
      expect(isBlendSupported("hue")).toBe(false);
      expect(spy).toHaveBeenCalledTimes(2); // multiply + hue; the second hue is cached
    } finally {
      spy.mockRestore();
      resetBlendSupportCache();
    }
  });
});

describe("sanitizeCssFilter", () => {
  it("passes standard filter chains through", () => {
    expect(sanitizeCssFilter("blur(4px)")).toBe("blur(4px)");
    expect(
      sanitizeCssFilter("brightness(1.2) contrast(110%) saturate(0.8)"),
    ).toBe("brightness(1.2) contrast(110%) saturate(0.8)");
    expect(sanitizeCssFilter("hue-rotate(90deg)")).toBe("hue-rotate(90deg)");
    expect(sanitizeCssFilter("drop-shadow(0 2px 4px rgba(0,0,0,0.5))")).toBe(
      "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
    );
  });

  it("maps empty/none/non-strings to none", () => {
    expect(sanitizeCssFilter("none")).toBe("none");
    expect(sanitizeCssFilter("   ")).toBe("none");
    expect(sanitizeCssFilter(undefined)).toBe("none");
    expect(sanitizeCssFilter(42)).toBe("none");
  });

  it("rejects url() references and unknown functions", () => {
    expect(sanitizeCssFilter("url(#f)")).toBe("none");
    expect(sanitizeCssFilter("url(https://evil.example/x.svg#f)")).toBe("none");
    expect(sanitizeCssFilter('url("data:image/svg+xml,<svg/>")')).toBe("none");
    expect(sanitizeCssFilter("blur(2px) url(#f)")).toBe("none");
    expect(sanitizeCssFilter("evil(3)")).toBe("none");
  });

  it("rejects malformed, unbalanced, too long or too deep input", () => {
    expect(sanitizeCssFilter("blur(2px")).toBe("none");
    expect(sanitizeCssFilter("blur 2px")).toBe("none");
    expect(sanitizeCssFilter("blur(2px); x")).toBe("none");
    expect(sanitizeCssFilter(`blur(${"1".repeat(300)}px)`)).toBe("none");
    expect(sanitizeCssFilter("blur(1px) ".repeat(9))).toBe("none");
  });
});
