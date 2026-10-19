import { beforeEach, describe, expect, it } from "vitest";

import { toMainScene } from "@/classic/sync";
import { TEMPLATES } from "@/classic/studio/templates";
import { emptyScene, type Scene } from "@/classic/studio/types";
import { parseProject } from "@/studio/project/schema";
import { defaultProject } from "@/studio/defaults";
import {
  HANDOFF_KEY,
  parseHandoff,
  parseScriptMessage,
  publishScript,
  readSharedScript,
  sendHandoff,
  SCRIPT_KEY,
  takeHandoff,
} from "@/studio/sync/shared";

beforeEach(() => localStorage.clear());

describe("shared script", () => {
  it("round-trips and rejects malformed messages", () => {
    expect(publishScript("A: Merhaba", "classic", 123)).toBe(true);
    expect(readSharedScript()).toEqual({ text: "A: Merhaba", at: 123, from: "classic" });
    for (const bad of [null, "", "{", "[]", '{"text":1,"at":1,"from":"main"}', '{"text":"x","at":1,"from":"evil"}'])
      expect(parseScriptMessage(bad)).toBeNull();
  });
  it("caps very long scripts", () => {
    publishScript("x".repeat(300_000), "main");
    expect(readSharedScript()?.text.length).toBe(200_000);
    expect(localStorage.getItem(SCRIPT_KEY)).not.toBeNull();
  });
});

describe("handoff inbox", () => {
  it("is consumed exactly once", () => {
    expect(sendHandoff([{ id: "a" }])).toBe(true);
    expect(takeHandoff()?.scenes).toHaveLength(1);
    expect(takeHandoff()).toBeNull();
    expect(localStorage.getItem(HANDOFF_KEY)).toBeNull();
  });
  it("refuses empty or corrupt payloads", () => {
    expect(sendHandoff([])).toBe(false);
    expect(parseHandoff('{"id":"x","scenes":"no"}')).toBeNull();
    expect(parseHandoff("nope")).toBeNull();
  });
});

describe("classic -> main scene conversion", () => {
  it("converts every template into a scene the project schema accepts", () => {
    for (const t of TEMPLATES) {
      const { scene } = toMainScene(t.build(), t.name);
      expect(scene.layers.length).toBeGreaterThan(0);
      const parsed = parseProject({ ...defaultProject(), scenes: [scene], activeSceneId: scene.id });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.project.scenes[0]?.layers).toHaveLength(scene.layers.length);
    }
  });
  it("maps layout and items", () => {
    const sc: Scene = {
      ...emptyScene(),
      base: "screen",
      layout: "pip",
      corner: "bl",
      frame: "#38bdf8",
      items: [
        { id: "1", kind: "lower", text: "Ad", sub: "Unvan", x: 30, y: 84, w: 44, color: "#f5c04a", size: 34 },
        { id: "2", kind: "image", src: "blob:x", x: 10, y: 10, w: 10 },
      ],
    };
    const { scene, skipped } = toMainScene(sc, "Test");
    const kinds = scene.layers.map((l) => l.kind);
    expect(kinds.slice(0, 2)).toEqual(["screen", "webcam"]);
    expect(kinds).toContain("shape");
    expect(scene.layers.filter((l) => l.kind === "text")).toHaveLength(2);
    expect(skipped.join(" ")).toMatch(/Logo/);
    const pip = scene.layers[1]!;
    expect(pip.transform.x).toBeLessThan(100); // bottom-left corner
  });
  it("skips video bases with a note", () => {
    const { skipped } = toMainScene({ ...emptyScene(), base: "video" }, "V");
    expect(skipped.join(" ")).toMatch(/video/i);
  });
});
