import { beforeEach, describe, expect, it } from "vitest";

import { createLayer, createScene } from "../defaults";
import {
  instantiateMyTemplate,
  loadMyTemplates,
  makeMyTemplate,
  MAX_MY_TEMPLATES,
  MY_TEMPLATES_KEY,
  parseMyTemplates,
  saveMyTemplates,
} from "./mine";

const L = { w: 1920, h: 1080 };
const P = { w: 1080, h: 1920 };
const scene = () =>
  createScene("Sahne", [
    createLayer("webcam"),
    createLayer("guest", { peerId: "peer-123" }),
    createLayer("text", {
      text: "Merhaba",
      transform: { x: 100, y: 900, w: 800, h: 120, rotation: 0 },
    }),
  ]);

beforeEach(() => localStorage.clear());

describe("my templates", () => {
  it("clears guest peers and rejects empty names", () => {
    const t = makeMyTemplate("  Röportaj   düzeni ", scene(), L)!;
    expect(t.name).toBe("Röportaj düzeni");
    expect(
      t.scene.layers.find((l) => l.kind === "guest" && l.peerId !== ""),
    ).toBeUndefined();
    expect(makeMyTemplate("   ", scene(), L)).toBeNull();
  });
  it("round-trips through storage", () => {
    const a = makeMyTemplate("A", scene(), L, 1)!;
    const b = makeMyTemplate("B", scene(), P, 2)!;
    expect(saveMyTemplates([a, b])).toBe(true);
    const back = loadMyTemplates();
    expect(back.map((t) => t.name)).toEqual(["B", "A"]); // newest first
    expect(back[0]!.stage).toEqual(P);
    expect(back[1]!.scene.layers).toHaveLength(3);
  });
  it("drops corrupt entries and caps the list", () => {
    expect(parseMyTemplates("nope")).toEqual([]);
    expect(
      parseMyTemplates(
        JSON.stringify([
          { id: 1 },
          null,
          { id: "x", name: "ok", stage: { w: 5, h: 5 }, scene: {} },
        ]),
      ),
    ).toEqual([]);
    const many = Array.from({ length: MAX_MY_TEMPLATES + 10 }, (_, i) =>
      makeMyTemplate(`T${i}`, scene(), L, i)!,
    );
    saveMyTemplates(many);
    expect(JSON.parse(localStorage.getItem(MY_TEMPLATES_KEY)!)).toHaveLength(
      MAX_MY_TEMPLATES,
    );
  });
  it("fits to another stage and keeps ids unique per instantiation", () => {
    const t = makeMyTemplate("Dikeye", scene(), L)!;
    const v = instantiateMyTemplate(t, P);
    for (const l of v.layers) {
      expect(l.transform.x + l.transform.w).toBeLessThanOrEqual(P.w + 2);
      expect(l.transform.y + l.transform.h).toBeLessThanOrEqual(P.h + 2);
    }
    expect(v.name).toBe("Dikeye");
    const same = instantiateMyTemplate(t, L);
    expect(same.layers[0]!.transform).toEqual(t.scene.layers[0]!.transform);
  });
});
