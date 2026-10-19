import { describe, expect, it } from "vitest";

import { createScene, defaultProject } from "../defaults";
import { parseProject } from "../project/schema";
import { createProjectStore } from "../project/store";
import type { Scene } from "../types";
import { planAutoAdvance, secondsLeft } from "./auto-advance";

const sc = (id: string, sec?: number): Scene => ({
  ...createScene(id),
  id,
  ...(sec !== undefined ? { autoAdvanceSec: sec } : {}),
});

describe("planAutoAdvance", () => {
  const scenes = [sc("a", 10), sc("b"), sc("c", 5)];
  it("returns the time and the next scene", () => {
    expect(planAutoAdvance(scenes, "a")).toEqual({ seconds: 10, nextId: "b" });
  });
  it("is null for manual scenes and unknown ids", () => {
    expect(planAutoAdvance(scenes, "b")).toBeNull();
    expect(planAutoAdvance(scenes, "zzz")).toBeNull();
    expect(planAutoAdvance([sc("x", 0)], "x")).toBeNull();
  });
  it("has no next scene after the last one and caps absurd times", () => {
    expect(planAutoAdvance(scenes, "c")).toEqual({ seconds: 5, nextId: null });
    expect(planAutoAdvance([sc("x", 99999)], "x")?.seconds).toBe(3600);
  });
  it("counts down in whole seconds", () => {
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 12_000)).toBe(0);
  });
});

describe("setSceneAutoAdvance", () => {
  it("stores, clamps and clears the value", () => {
    const store = createProjectStore(defaultProject());
    const id = store.getState().scenes[0]!.id;
    store.setSceneAutoAdvance(id, 30);
    expect(store.getState().scenes[0]!.autoAdvanceSec).toBe(30);
    store.setSceneAutoAdvance(id, 99999);
    expect(store.getState().scenes[0]!.autoAdvanceSec).toBe(3600);
    store.setSceneAutoAdvance(id, 0);
    expect("autoAdvanceSec" in store.getState().scenes[0]!).toBe(false);
    // rapid edits of the same field are one undo step (coalesced)
    store.undo();
    expect(store.getState().scenes[0]!.autoAdvanceSec).toBeUndefined();
  });
  it("survives the project schema", () => {
    const p = defaultProject();
    p.scenes[0] = { ...p.scenes[0]!, autoAdvanceSec: 45 };
    const r = parseProject(p);
    expect(r.ok && r.project.scenes[0]!.autoAdvanceSec).toBe(45);
  });
});
