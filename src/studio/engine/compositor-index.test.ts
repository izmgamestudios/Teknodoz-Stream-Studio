import { describe, expect, it } from "vitest";
import * as api from "./compositor-index";

describe("compositor-index", () => {
  it("re-exports the public API of every module", () => {
    // compositor.ts
    expect(typeof api.Compositor).toBe("function");
    expect(typeof api.CompositorError).toBe("function");
    expect(typeof api.easeInOut).toBe("function");
    expect(typeof api.slideOffset).toBe("function");
    expect(typeof api.transitionAlpha).toBe("function");
    expect(typeof api.wrapText).toBe("function");
    // transform.ts
    for (const name of [
      "rotatePoint",
      "layerCorners",
      "hitTestLayer",
      "handlePositions",
      "hitTestHandle",
      "resizeFromHandle",
      "rotateFromPointer",
      "snapToGuides",
      "clampToStage",
      "moveLayer",
    ] as const) {
      expect(typeof api[name]).toBe("function");
    }
    // chroma.ts
    expect(typeof api.chromaKeyPixels).toBe("function");
    expect(typeof api.parseKeyColor).toBe("function");
    expect(typeof api.ChromaProcessor).toBe("function");
    // blend.ts
    expect(typeof api.isBlendSupported).toBe("function");
    expect(typeof api.resolveBlend).toBe("function");
    expect(api.BLEND_MODES).toContain("multiply");
    // ticker.ts
    expect(typeof api.createTicker).toBe("function");
    expect(typeof api.advancePacer).toBe("function");
    expect(typeof api.FrameStats).toBe("function");
  });
});
