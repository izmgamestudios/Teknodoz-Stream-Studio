// src/classic/studio/saved-templates.ts
// User templates of the Classic Studio: pure list operations (the page persists the result).
import { uid, type Scene } from "./types";

export const TPL_KEY = "studio.templates.v1";

export type SavedTemplate = { id: string; name: string; scene: Scene };

/** A scene as stored in a template: logos (object URLs of local files) are not kept. */
export function templateScene(draft: Scene): Scene {
  return {
    ...structuredClone(draft),
    items: draft.items
      .filter((i) => i.kind !== "image")
      .map((i) => ({ ...i, id: uid() })),
  };
}

const clean = (name: string): string => name.trim().slice(0, 40);

export function addTemplate(
  list: readonly SavedTemplate[],
  name: string,
  scene: Scene,
): { list: SavedTemplate[]; id: string } {
  const id = uid();
  return {
    list: [
      ...list,
      { id, name: clean(name) || "Şablon", scene: templateScene(scene) },
    ],
    id,
  };
}

export function renameTemplate(
  list: readonly SavedTemplate[],
  id: string,
  name: string,
): SavedTemplate[] {
  const n = clean(name);
  return n ? list.map((t) => (t.id === id ? { ...t, name: n } : t)) : [...list];
}

/** Replaces the scene of a template with the current draft. */
export function updateTemplate(
  list: readonly SavedTemplate[],
  id: string,
  draft: Scene,
): SavedTemplate[] {
  return list.map((t) =>
    t.id === id ? { ...t, scene: templateScene(draft) } : t,
  );
}

export function duplicateTemplate(
  list: readonly SavedTemplate[],
  id: string,
): { list: SavedTemplate[]; id: string | null } {
  const src = list.find((t) => t.id === id);
  if (!src) return { list: [...list], id: null };
  const copy: SavedTemplate = {
    id: uid(),
    name: clean(`${src.name} (kopya)`),
    scene: templateScene(src.scene),
  };
  const i = list.indexOf(src);
  return {
    list: [...list.slice(0, i + 1), copy, ...list.slice(i + 1)],
    id: copy.id,
  };
}

export function moveTemplate(
  list: readonly SavedTemplate[],
  id: string,
  by: -1 | 1,
): SavedTemplate[] {
  const i = list.findIndex((t) => t.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j] as SavedTemplate, out[i] as SavedTemplate];
  return out;
}

export function removeTemplate(
  list: readonly SavedTemplate[],
  id: string,
): SavedTemplate[] {
  return list.filter((t) => t.id !== id);
}

/** Reads the stored list defensively: bad rows are dropped, never thrown on. */
export function parseSavedTemplates(raw: string | null): SavedTemplate[] {
  if (!raw || raw.length > 2_000_000) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: SavedTemplate[] = [];
    for (const o of v.slice(0, 100) as Partial<SavedTemplate>[]) {
      const sc = o?.scene as Partial<Scene> | undefined;
      if (
        typeof o?.id === "string" &&
        typeof o.name === "string" &&
        sc &&
        Array.isArray(sc.items) &&
        typeof sc.layout === "string"
      )
        out.push({
          id: o.id.slice(0, 40),
          name: clean(o.name) || "Şablon",
          scene: o.scene as Scene,
        });
    }
    return out;
  } catch {
    return [];
  }
}
