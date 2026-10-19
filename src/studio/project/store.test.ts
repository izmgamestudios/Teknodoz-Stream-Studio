import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLayer, createScene, defaultProject } from "../defaults";
import {
  assetIdsInProject,
  createProjectStore,
  findLayer,
  getActiveScene,
} from "./store";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const store = createProjectStore(defaultProject());
  const scene = store.getState().scenes[0]!;
  return { store, sceneId: scene.id, layer: scene.layers[0]! };
}

describe("scenes", () => {
  it("adds, renames, reorders and removes (never the last)", () => {
    const { store } = setup();
    const id = store.addScene("Yeni")!;
    expect(store.getState().activeSceneId).toBe(id);
    store.renameScene(id, "Ad");
    expect(store.getState().scenes.at(-1)?.name).toBe("Ad");
    store.reorderScene(3, 0);
    expect(store.getState().scenes[0]?.id).toBe(id);
    while (store.getState().scenes.length > 1) {
      store.removeScene(store.getState().scenes[0]!.id);
    }
    expect(store.removeScene(store.getState().scenes[0]!.id)).toBe(false);
    expect(store.getState().scenes).toHaveLength(1);
  });

  it("fixes activeSceneId when the active scene is removed", () => {
    const { store } = setup();
    const [a, b] = store.getState().scenes;
    store.setActiveScene(a!.id);
    store.removeScene(a!.id);
    expect(store.getState().activeSceneId).toBe(b!.id);
  });

  it("duplicateScene assigns fresh ids and drops the hotkey", () => {
    const { store, sceneId } = setup();
    const copyId = store.duplicateScene(sceneId)!;
    const s = store.getState();
    const orig = s.scenes.find((x) => x.id === sceneId)!;
    const copy = s.scenes.find((x) => x.id === copyId)!;
    expect(copy.hotkey).toBeUndefined();
    expect(copy.layers.map((l) => l.id)).not.toEqual(
      orig.layers.map((l) => l.id),
    );
    expect(copy.layers).toHaveLength(orig.layers.length);
    // deep copy: mutating-by-update on the copy must not touch the original
    store.updateLayer(copyId, copy.layers[0]!.id, { opacity: 10 });
    expect(
      store.getState().scenes.find((x) => x.id === sceneId)!.layers[0]!.opacity,
    ).toBe(100);
  });

  it("hotkeys are unique: assigning a taken key moves it", () => {
    const { store } = setup();
    const [a, b] = store.getState().scenes;
    store.setSceneHotkey(b!.id, a!.hotkey);
    const s = store.getState();
    expect(s.scenes.find((x) => x.id === b!.id)!.hotkey).toBe(a!.hotkey);
    expect(s.scenes.find((x) => x.id === a!.id)!.hotkey).toBeUndefined();
  });

  it("setActiveScene ignores unknown ids and does not enter undo history", () => {
    const { store } = setup();
    expect(store.setActiveScene("nope")).toBe(false);
    const before = store.canUndo();
    store.setActiveScene(store.getState().scenes[1]!.id);
    expect(store.canUndo()).toBe(before);
  });
});

describe("layers", () => {
  it("adds on top by default and reorders correctly", () => {
    const { store, sceneId } = setup();
    const n = createLayer("text");
    store.addLayer(sceneId, n);
    const layers = () => store.getState().scenes[0]!.layers;
    expect(layers().at(-1)?.id).toBe(n.id);
    store.sendToBack(sceneId, n.id);
    expect(layers()[0]?.id).toBe(n.id);
    store.bringToFront(sceneId, n.id);
    expect(layers().at(-1)?.id).toBe(n.id);
    store.moveDown(sceneId, n.id);
    expect(layers().at(-2)?.id).toBe(n.id);
    store.moveUp(sceneId, n.id);
    expect(layers().at(-1)?.id).toBe(n.id);
  });

  it("updateLayer ignores id/kind, clamps opacity, merges transform", () => {
    const { store, sceneId, layer } = setup();
    expect(
      store.updateLayer(sceneId, layer.id, {
        opacity: 500,
        transform: { x: 10 },
        ...({ id: "evil", kind: "text" } as object),
      }),
    ).toBe(true);
    const l = findLayer(store.getState(), layer.id)!.layer;
    expect(l.id).toBe(layer.id);
    expect(l.kind).toBe("webcam");
    expect(l.opacity).toBe(100);
    expect(l.transform.x).toBe(10);
    expect(l.transform.w).toBe(layer.transform.w);
  });

  it("rejects patches that break the schema (NaN, unsafe filter)", () => {
    const { store, sceneId, layer } = setup();
    const before = store.getState();
    expect(
      store.updateLayer(sceneId, layer.id, { transform: { x: NaN } }),
    ).toBe(false);
    expect(
      store.updateLayer(sceneId, layer.id, { filter: "url(http://x)" }),
    ).toBe(false);
    expect(
      store.updateLayer(sceneId, layer.id, { filter: "blur(2px); x" }),
    ).toBe(false);
    expect(store.getState()).toBe(before);
  });

  it("duplicateLayer inserts above with a fresh id", () => {
    const { store, sceneId, layer } = setup();
    const id = store.duplicateLayer(sceneId, layer.id)!;
    expect(id).not.toBe(layer.id);
    expect(store.getState().scenes[0]!.layers[1]!.id).toBe(id);
  });

  it("assetIdsInProject collects unique non-empty ids", () => {
    const { store, sceneId } = setup();
    store.addLayer(sceneId, createLayer("image", { assetId: "a1" }));
    store.addLayer(sceneId, createLayer("video", { assetId: "a1" }));
    store.addLayer(sceneId, createLayer("image", { assetId: "" }));
    expect(assetIdsInProject(store.getState())).toEqual(["a1"]);
  });
});

describe("undo / redo", () => {
  it("undoes and redoes, and a new edit clears redo", () => {
    const { store } = setup();
    store.setProjectName("A");
    vi.advanceTimersByTime(1000);
    store.setProjectName("B");
    expect(store.undo()).toBe(true);
    expect(store.getState().name).toBe("A");
    expect(store.canRedo()).toBe(true);
    expect(store.redo()).toBe(true);
    expect(store.getState().name).toBe("B");
    store.undo();
    store.addScene("X");
    expect(store.canRedo()).toBe(false);
  });

  it("coalesces rapid same-target updates into one history entry", () => {
    const { store, sceneId, layer } = setup();
    for (let x = 1; x <= 20; x++) {
      store.updateLayerTransform(sceneId, layer.id, { x });
      vi.advanceTimersByTime(16);
    }
    expect(findLayer(store.getState(), layer.id)!.layer.transform.x).toBe(20);
    store.undo();
    expect(findLayer(store.getState(), layer.id)!.layer.transform.x).toBe(
      layer.transform.x,
    );
    expect(store.canUndo()).toBe(false);
  });

  it("does not coalesce once the window has passed", () => {
    const { store, sceneId, layer } = setup();
    store.updateLayerTransform(sceneId, layer.id, { x: 1 });
    vi.advanceTimersByTime(2000);
    store.updateLayerTransform(sceneId, layer.id, { x: 2 });
    store.undo();
    expect(findLayer(store.getState(), layer.id)!.layer.transform.x).toBe(1);
  });

  it("caps history length", () => {
    const store = createProjectStore(defaultProject(), { historyLimit: 3 });
    for (let i = 0; i < 10; i++) store.addScene(`S${i}`);
    let n = 0;
    while (store.undo()) n++;
    expect(n).toBe(3);
  });

  it("replaceProject clears history; subscribers are notified", () => {
    const { store } = setup();
    const cb = vi.fn();
    const off = store.subscribe(cb);
    store.setProjectName("Z");
    store.replaceProject(defaultProject());
    expect(cb).toHaveBeenCalledTimes(2);
    expect(store.canUndo()).toBe(false);
    off();
    store.setProjectName("Q");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("selectors", () => {
    const { store } = setup();
    expect(getActiveScene(store.getState()).id).toBe(
      store.getState().activeSceneId,
    );
    const s = createScene("tmp");
    expect(store.getState().scenes.some((x) => x.id === s.id)).toBe(false);
  });
});
