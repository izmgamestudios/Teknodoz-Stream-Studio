import { describe, expect, it } from "vitest";

import { createLayer, defaultProject } from "../defaults";
import { parseProject } from "./schema";

describe("parseProject", () => {
  it("round-trips a valid default project unchanged", () => {
    const p = defaultProject();
    const r = parseProject(JSON.parse(JSON.stringify(p)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.project.scenes).toEqual(p.scenes);
      expect(r.warnings).toEqual([]);
    }
  });

  it("rejects non-objects and unknown versions with clear codes", () => {
    const a = parseProject("x");
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error.code).toBe("not-an-object");
    const b = parseProject({ version: 99 });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error.code).toBe("unsupported-version");
  });

  it("repairs: drops invalid layers/scenes, dedupes ids, fixes activeSceneId", () => {
    const p = defaultProject();
    const good = p.scenes[0]!;
    const raw = JSON.parse(JSON.stringify(p));
    raw.scenes[0].layers.push({ kind: "webcam", id: "x" }); // incomplete
    raw.scenes[0].layers.push({ ...createLayer("text"), filter: "url(x)" }); // unsafe
    raw.scenes.push(JSON.parse(JSON.stringify(good))); // duplicate ids
    raw.scenes.push({ junk: true });
    raw.activeSceneId = "missing";
    const r = parseProject(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.project.scenes.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.project.scenes).toHaveLength(4);
    expect(r.project.scenes[0]!.layers).toHaveLength(good.layers.length);
    expect(ids).toContain(r.project.activeSceneId);
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
    const hk = r.project.scenes.map((s) => s.hotkey).filter(Boolean);
    expect(new Set(hk).size).toBe(hk.length);
  });

  it("always yields at least one scene", () => {
    const r = parseProject({ version: 1, scenes: [] });
    expect(r.ok && r.project.scenes.length).toBe(1);
  });

  it("falls back to defaults for broken prompter/settings fields", () => {
    const r = parseProject({
      version: 1,
      scenes: [],
      prompter: { script: 5, settings: { speedPx: "fast", fontSize: 50 } },
      settings: { output: { fps: 9999 } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.prompter.script).toBe("");
    expect(r.project.prompter.settings.speedPx).toBe(60);
    expect(r.project.prompter.settings.fontSize).toBe(50);
    expect(r.project.settings.output.fps).toBeLessThanOrEqual(120);
  });

  it("caps scene count and script size", () => {
    const base = defaultProject();
    const many = Array.from({ length: 150 }, (_, i) => ({
      ...base.scenes[0]!,
      id: `s${i}`,
    }));
    const r = parseProject({
      version: 1,
      scenes: many,
      prompter: { script: "a".repeat(2_100_000), settings: {} },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.scenes).toHaveLength(100);
    expect(r.project.prompter.script).toHaveLength(2_000_000);
  });
});
