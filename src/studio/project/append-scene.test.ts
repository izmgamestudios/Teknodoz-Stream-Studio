import { describe, expect, it } from "vitest";

import { createLayer, createScene, defaultProject } from "../defaults";
import { createProjectStore } from "./store";

describe("appendScene", () => {
  it("adds at the end with a fresh id and keeps the live scene", () => {
    const store = createProjectStore(defaultProject());
    const before = store.getState();
    const scene = createScene("Import", [createLayer("webcam")]);
    scene.hotkey = "9";
    const id = store.appendScene(scene);
    const after = store.getState();
    expect(id).toBeDefined();
    expect(id).not.toBe(scene.id);
    expect(after.activeSceneId).toBe(before.activeSceneId);
    expect(after.scenes.at(-1)?.id).toBe(id);
    expect(after.scenes.at(-1)?.hotkey).toBeUndefined();
    expect(after.scenes.at(-1)?.layers[0]?.id).not.toBe(scene.layers[0]?.id);
    expect(after.scenes).toHaveLength(before.scenes.length + 1);
  });
  it("can be undone", () => {
    const store = createProjectStore(defaultProject());
    const n = store.getState().scenes.length;
    store.appendScene(createScene("X"));
    store.undo();
    expect(store.getState().scenes).toHaveLength(n);
  });
});
