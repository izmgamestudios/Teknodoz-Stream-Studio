import { describe, expect, it } from "vitest";

import { GL_TRANSITIONS, glName, isGlTransition } from "./gl-transitions";
import { TRACKS } from "./music";
import { SFX_PRESETS } from "./sfx-presets";
import { parseProject } from "../project/schema";
import { defaultProject } from "../defaults";

describe("gl transition ids", () => {
  it("accepts curated names and rejects anything else", () => {
    for (const [id] of GL_TRANSITIONS)
      expect(isGlTransition(`gl:${id}`)).toBe(true);
    for (const bad of [
      "fade",
      "gl:",
      "gl:../x",
      "gl:a b",
      `gl:${"x".repeat(41)}`,
      "GL:fade",
    ])
      expect(isGlTransition(bad)).toBe(false);
    expect(glName("gl:CrossZoom")).toBe("CrossZoom");
  });
  it("curated list has unique ids", () => {
    const ids = GL_TRANSITIONS.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("projects keep a gl transition through the schema and drop invalid ones", () => {
    const base = defaultProject();
    const withType = (type: string) => ({
      ...base,
      scenes: base.scenes.map((s, i) =>
        i === 0 ? { ...s, transition: { type, ms: 500 } } : s,
      ),
    });
    const typeOf = (type: string) => {
      const r = parseProject(withType(type));
      return r.ok ? r.project.scenes[0]?.transition.type : undefined;
    };
    expect(typeOf("gl:CrossZoom")).toBe("gl:CrossZoom");
    expect(typeOf("gl:../evil")).not.toBe("gl:../evil");
  });
});

describe("built-in sound library", () => {
  it("has unique ids and 4-note chords", () => {
    for (const list of [TRACKS, SFX_PRESETS]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    for (const t of TRACKS) {
      expect(t.bpm).toBeGreaterThan(40);
      for (const c of t.chords) expect(c).toHaveLength(4);
    }
  });
});
