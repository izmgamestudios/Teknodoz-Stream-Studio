// src/studio/project/store.ts
// Immutable project store with undo/redo. useSyncExternalStore-compatible:
//   const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
import { createScene, defaultProject, uid } from "../defaults";
import type {
  AppSettings,
  BlendMode,
  ChromaKey,
  Layer,
  PrompterSettings,
  ProjectState,
  Scene,
  Transform,
  Transition,
  Sponsor,
} from "../types";
import { layerSchema, LIMITS, MAX_SPONSORS, sponsorSchema } from "./schema";

/** Patch for a layer: `id`/`kind` are never patchable; transform/chroma merge one level deep. */
type PatchOf<L> = L extends Layer
  ? Partial<Omit<L, "id" | "kind" | "transform" | "chroma">> & {
      transform?: Partial<Transform>;
      chroma?: Partial<ChromaKey>;
    }
  : never;
export type LayerPatch = PatchOf<Layer>;

export interface ProjectStoreOptions {
  /** max undo entries (default 100) */
  historyLimit?: number;
  /** rapid same-key updates inside this window merge into one history entry (default 500) */
  coalesceMs?: number;
  now?: () => number;
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

function move<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = arr.slice();
  if (from < 0 || from >= out.length) return out;
  const t = clamp(to, 0, out.length - 1);
  const [item] = out.splice(from, 1);
  out.splice(t, 0, item as T);
  return out;
}

function cloneLayerFresh(l: Layer): Layer {
  return { ...structuredClone(l), id: uid("ly") };
}

export function createProjectStore(
  initial: ProjectState = defaultProject(),
  options: ProjectStoreOptions = {},
) {
  const historyLimit = options.historyLimit ?? 100;
  const coalesceMs = options.coalesceMs ?? 500;
  const now = options.now ?? (() => Date.now());

  let state = initial;
  let past: ProjectState[] = [];
  let future: ProjectState[] = [];
  let lastKey: string | undefined;
  let lastAt = 0;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const l of [...listeners]) l();
  };

  function commit(next: ProjectState, coalesceKey?: string): boolean {
    if (next === state) return false;
    const t = now();
    const merge =
      coalesceKey !== undefined &&
      coalesceKey === lastKey &&
      t - lastAt < coalesceMs &&
      past.length > 0;
    if (!merge) {
      past.push(state);
      if (past.length > historyLimit)
        past = past.slice(past.length - historyLimit);
    }
    future = [];
    lastKey = coalesceKey;
    lastAt = t;
    state = next;
    emit();
    return true;
  }

  const mapScene = (id: string, fn: (s: Scene) => Scene): ProjectState => {
    let changed = false;
    const scenes = state.scenes.map((s) => {
      if (s.id !== id) return s;
      const n = fn(s);
      if (n !== s) changed = true;
      return n;
    });
    return changed ? { ...state, scenes } : state;
  };

  const store = {
    getState: (): ProjectState => state,
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    /* ---- history ---- */
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    undo(): boolean {
      const prev = past.pop();
      if (!prev) return false;
      future.push(state);
      state = prev;
      lastKey = undefined;
      emit();
      return true;
    },
    redo(): boolean {
      const nxt = future.pop();
      if (!nxt) return false;
      past.push(state);
      state = nxt;
      lastKey = undefined;
      emit();
      return true;
    },
    clearHistory() {
      past = [];
      future = [];
      lastKey = undefined;
      emit();
    },

    /* ---- project ---- */
    setProjectName(name: string) {
      commit(
        { ...state, name: name.slice(0, LIMITS.nameChars) },
        "project-name",
      );
    },
    /** Replace everything (import / load). History is cleared. */
    replaceProject(p: ProjectState) {
      state = p;
      past = [];
      future = [];
      lastKey = undefined;
      emit();
    },
    resetProject() {
      store.replaceProject(defaultProject());
    },

    /* ---- scenes ---- */
    addScene(name = `Sahne ${state.scenes.length + 1}`): string | undefined {
      if (state.scenes.length >= LIMITS.scenes) return undefined;
      const s = createScene(name);
      commit({ ...state, scenes: [...state.scenes, s], activeSceneId: s.id });
      return s.id;
    },
    /** Insert a fully built scene (e.g. from a template) after the active one and activate it. */
    insertScene(scene: Scene): string | undefined {
      if (
        state.scenes.length >= LIMITS.scenes ||
        scene.layers.length > LIMITS.layersPerScene
      )
        return undefined;
      const fresh: Scene = {
        ...scene,
        id: uid("sc"),
        name: scene.name.slice(0, LIMITS.nameChars),
        layers: scene.layers.map(cloneLayerFresh),
      };
      delete fresh.hotkey;
      const at = state.scenes.findIndex((s) => s.id === state.activeSceneId);
      const scenes = [...state.scenes];
      scenes.splice(at < 0 ? scenes.length : at + 1, 0, fresh);
      commit({ ...state, scenes, activeSceneId: fresh.id });
      return fresh.id;
    },
    /** Replace the layers (and optionally the name) of a scene, keeping its id/hotkey/transition. */
    replaceSceneLayers(id: string, layers: Layer[], name?: string): boolean {
      if (layers.length > LIMITS.layersPerScene) return false;
      return commit(
        mapScene(id, (s) => ({
          ...s,
          name: name ? name.slice(0, LIMITS.nameChars) : s.name,
          layers: layers.map(cloneLayerFresh),
        })),
      );
    },
    duplicateScene(id: string): string | undefined {
      const src = state.scenes.find((s) => s.id === id);
      if (!src || state.scenes.length >= LIMITS.scenes) return undefined;
      const copy: Scene = {
        ...structuredClone(src),
        id: uid("sc"),
        name: `${src.name} (kopya)`,
        layers: src.layers.map(cloneLayerFresh),
      };
      delete copy.hotkey;
      const idx = state.scenes.indexOf(src);
      const scenes = [...state.scenes];
      scenes.splice(idx + 1, 0, copy);
      commit({ ...state, scenes });
      return copy.id;
    },
    removeScene(id: string): boolean {
      if (state.scenes.length <= 1) return false;
      const idx = state.scenes.findIndex((s) => s.id === id);
      if (idx < 0) return false;
      const scenes = state.scenes.filter((s) => s.id !== id);
      const activeSceneId =
        state.activeSceneId === id
          ? (scenes[Math.min(idx, scenes.length - 1)] as Scene).id
          : state.activeSceneId;
      return commit({ ...state, scenes, activeSceneId });
    },
    renameScene(id: string, name: string) {
      commit(
        mapScene(id, (s) =>
          s.name === name ? s : { ...s, name: name.slice(0, LIMITS.nameChars) },
        ),
        `scene-name:${id}`,
      );
    },
    reorderScene(from: number, to: number) {
      commit({ ...state, scenes: move(state.scenes, from, to) });
    },
    setActiveScene(id: string): boolean {
      if (!state.scenes.some((s) => s.id === id) || state.activeSceneId === id)
        return false;
      // Switching the live scene is not an editing step: do not pollute undo history.
      state = { ...state, activeSceneId: id };
      emit();
      return true;
    },
    /** Assigning a key that another scene owns moves it (hotkeys are unique). */
    setSceneHotkey(id: string, key: string | undefined) {
      const scenes = state.scenes.map((s) => {
        if (s.id === id) {
          const n = { ...s };
          if (key) n.hotkey = key;
          else delete n.hotkey;
          return n;
        }
        if (key && s.hotkey === key) {
          const n = { ...s };
          delete n.hotkey;
          return n;
        }
        return s;
      });
      commit({ ...state, scenes });
    },
    setSceneTransition(id: string, t: Transition) {
      const safe: Transition = {
        type: t.type,
        ms: clamp(Number(t.ms) || 0, 0, 10_000),
      };
      commit(
        mapScene(id, (s) => ({ ...s, transition: safe })),
        `scene-transition:${id}`,
      );
    },

    /* ---- layers ---- */
    addLayer(sceneId: string, layer: Layer, index?: number): boolean {
      return commit(
        mapScene(sceneId, (s) => {
          if (s.layers.length >= LIMITS.layersPerScene) return s;
          const layers = [...s.layers];
          layers.splice(
            index === undefined
              ? layers.length
              : clamp(index, 0, layers.length),
            0,
            layer,
          );
          return { ...s, layers };
        }),
      );
    },
    removeLayer(sceneId: string, layerId: string): boolean {
      return commit(
        mapScene(sceneId, (s) =>
          s.layers.some((l) => l.id === layerId)
            ? { ...s, layers: s.layers.filter((l) => l.id !== layerId) }
            : s,
        ),
      );
    },
    duplicateLayer(sceneId: string, layerId: string): string | undefined {
      let newId: string | undefined;
      commit(
        mapScene(sceneId, (s) => {
          const i = s.layers.findIndex((l) => l.id === layerId);
          const src = s.layers[i];
          if (!src || s.layers.length >= LIMITS.layersPerScene) return s;
          const copy = cloneLayerFresh(src);
          copy.name = `${src.name} (kopya)`;
          newId = copy.id;
          const layers = [...s.layers];
          layers.splice(i + 1, 0, copy);
          return { ...s, layers };
        }),
      );
      return newId;
    },
    /**
     * Patch a layer. `id`/`kind` in the patch are ignored; numbers are clamped; the merged
     * layer must still satisfy the schema, otherwise the patch is rejected (returns false).
     */
    updateLayer(
      sceneId: string,
      layerId: string,
      patch: LayerPatch,
      coalesceKey?: string,
    ): boolean {
      const { transform, chroma, ...rest } = patch as Record<
        string,
        unknown
      > & {
        transform?: Partial<Transform>;
        chroma?: Partial<ChromaKey>;
      };
      delete rest["id"];
      delete rest["kind"];
      if (typeof rest["opacity"] === "number")
        rest["opacity"] = clamp(rest["opacity"], 0, 100);
      let applied = false;
      const next = mapScene(sceneId, (s) => {
        const i = s.layers.findIndex((l) => l.id === layerId);
        const cur = s.layers[i];
        if (!cur) return s;
        const merged = {
          ...cur,
          ...rest,
          transform: { ...cur.transform, ...(transform ?? {}) },
          chroma: { ...cur.chroma, ...(chroma ?? {}) },
        };
        const ok = layerSchema.safeParse(merged);
        if (!ok.success) return s;
        applied = true;
        const layers = [...s.layers];
        layers[i] = ok.data as Layer;
        return { ...s, layers };
      });
      if (!applied) return false;
      return commit(next, coalesceKey ?? `layer:${layerId}`);
    },
    updateLayerTransform(
      sceneId: string,
      layerId: string,
      t: Partial<Transform>,
    ) {
      return store.updateLayer(sceneId, layerId, { transform: t });
    },
    setLayerVisible(sceneId: string, layerId: string, visible: boolean) {
      return store.updateLayer(sceneId, layerId, { visible }, `vis:${layerId}`);
    },
    setLayerLocked(sceneId: string, layerId: string, locked: boolean) {
      return store.updateLayer(sceneId, layerId, { locked }, `lock:${layerId}`);
    },
    setLayerOpacity(sceneId: string, layerId: string, opacity: number) {
      return store.updateLayer(sceneId, layerId, { opacity });
    },
    setLayerBlend(sceneId: string, layerId: string, blend: BlendMode) {
      return store.updateLayer(sceneId, layerId, { blend });
    },
    reorderLayer(sceneId: string, from: number, to: number) {
      return commit(
        mapScene(sceneId, (s) => {
          const layers = move(s.layers, from, to);
          return layers.every((l, i) => l === s.layers[i])
            ? s
            : { ...s, layers };
        }),
      );
    },
    /** Index 0 is the bottom. "Front" = last. */
    bringToFront(sceneId: string, layerId: string) {
      const s = state.scenes.find((x) => x.id === sceneId);
      const i = s?.layers.findIndex((l) => l.id === layerId) ?? -1;
      if (s && i >= 0) store.reorderLayer(sceneId, i, s.layers.length - 1);
    },
    sendToBack(sceneId: string, layerId: string) {
      const i =
        state.scenes
          .find((x) => x.id === sceneId)
          ?.layers.findIndex((l) => l.id === layerId) ?? -1;
      if (i >= 0) store.reorderLayer(sceneId, i, 0);
    },
    moveUp(sceneId: string, layerId: string) {
      const i =
        state.scenes
          .find((x) => x.id === sceneId)
          ?.layers.findIndex((l) => l.id === layerId) ?? -1;
      if (i >= 0) store.reorderLayer(sceneId, i, i + 1);
    },
    moveDown(sceneId: string, layerId: string) {
      const i =
        state.scenes
          .find((x) => x.id === sceneId)
          ?.layers.findIndex((l) => l.id === layerId) ?? -1;
      if (i >= 0) store.reorderLayer(sceneId, i, i - 1);
    },

    /* ---- prompter / settings ---- */
    setPrompterScript(script: string) {
      commit(
        {
          ...state,
          prompter: {
            ...state.prompter,
            script: script.slice(0, LIMITS.scriptChars),
          },
        },
        "prompter-script",
      );
    },
    updatePrompterSettings(patch: Partial<PrompterSettings>) {
      commit(
        {
          ...state,
          prompter: {
            ...state.prompter,
            settings: { ...state.prompter.settings, ...patch },
          },
        },
        "prompter-settings",
      );
    },
    /* ---- sponsors / partners ---- */
    addSponsor(input: Omit<Sponsor, "id">): string | undefined {
      if (state.sponsors.length >= MAX_SPONSORS) return undefined;
      const sp: Sponsor = { ...input, id: uid("sp") };
      if (!sponsorSchema.safeParse(sp).success) return undefined;
      commit({ ...state, sponsors: [...state.sponsors, sp] });
      return sp.id;
    },
    /** Merge a patch into a sponsor; rejected (false) when the result would be invalid. */
    updateSponsor(id: string, patch: Partial<Omit<Sponsor, "id">>): boolean {
      const cur = state.sponsors.find((s) => s.id === id);
      if (!cur) return false;
      const next = { ...cur, ...patch, id };
      const ok = sponsorSchema.safeParse(next);
      if (!ok.success) return false;
      return commit(
        {
          ...state,
          sponsors: state.sponsors.map((s) => (s.id === id ? next : s)),
        },
        `sponsor:${id}`,
      );
    },
    removeSponsor(id: string): boolean {
      if (!state.sponsors.some((s) => s.id === id)) return false;
      return commit({
        ...state,
        sponsors: state.sponsors.filter((s) => s.id !== id),
      });
    },
    moveSponsor(from: number, to: number): void {
      commit({ ...state, sponsors: move(state.sponsors, from, to) });
    },
    updateSettings(patch: Partial<AppSettings>) {
      commit(
        { ...state, settings: { ...state.settings, ...patch } },
        "settings",
      );
    },
  };
  return store;
}

export type ProjectStore = ReturnType<typeof createProjectStore>;

/* ---- selectors ---- */
export function getActiveScene(state: ProjectState): Scene {
  return (state.scenes.find((s) => s.id === state.activeSceneId) ??
    state.scenes[0]) as Scene;
}

export function findLayer(
  state: ProjectState,
  layerId: string,
): { scene: Scene; layer: Layer } | undefined {
  for (const scene of state.scenes) {
    const layer = scene.layers.find((l) => l.id === layerId);
    if (layer) return { scene, layer };
  }
  return undefined;
}

/**
 * All asset ids the project references: image/video layers and sponsor logos
 * (deduplicated, empty ids skipped).
 */
export function assetIdsInProject(state: ProjectState): string[] {
  const ids = new Set<string>();
  for (const s of state.scenes)
    for (const l of s.layers)
      if ((l.kind === "image" || l.kind === "video") && l.assetId)
        ids.add(l.assetId);
  for (const sp of state.sponsors ?? [])
    if (sp.logoAssetId) ids.add(sp.logoAssetId);
  return [...ids];
}
