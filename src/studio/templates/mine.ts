// src/studio/templates/mine.ts
// "My templates": the active scene saved in this browser, reusable in any project and any output
// format (layers are fitted to the target stage). Layers keep their asset ids, which live in this
// browser's media library. Pure helpers + a thin localStorage layer; everything is validated through
// the project schema on the way in.
import { defaultProject, uid } from "../defaults";
import { fitScene, type StageSize } from "../format";
import { parseProject } from "../project/schema";
import type { Scene } from "../types";

export interface MyTemplate {
  id: string;
  name: string;
  at: number;
  /** stage the layers were written for */
  stage: StageSize;
  scene: Scene;
}

export const MY_TEMPLATES_KEY = "studio.myTemplates.v1";
export const MAX_MY_TEMPLATES = 30;
const MAX_BYTES = 1_500_000;
const cleanName = (n: string) => n.replace(/\s+/g, " ").trim().slice(0, 60);

/** Repairs one scene through the project schema (drops invalid layers, clamps numbers). */
function repairScene(scene: unknown): Scene | null {
  const parsed = parseProject({
    ...defaultProject(),
    scenes: [scene],
    activeSceneId: "",
  });
  return parsed.ok ? (parsed.project.scenes[0] ?? null) : null;
}

export function makeMyTemplate(
  name: string,
  scene: Scene,
  stage: StageSize,
  now = Date.now(),
): MyTemplate | null {
  const n = cleanName(name);
  if (!n) return null;
  const copy = structuredClone(scene);
  // a template must not point at somebody's live peer
  copy.layers = copy.layers.map((l) =>
    l.kind === "guest" ? { ...l, peerId: "" } : l,
  );
  const repaired = repairScene(copy);
  if (!repaired) return null;
  return {
    id: uid("mt"),
    name: n,
    at: now,
    stage: { w: stage.w, h: stage.h },
    scene: repaired,
  };
}

export function parseMyTemplates(raw: string | null): MyTemplate[] {
  if (!raw || raw.length > MAX_BYTES) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: MyTemplate[] = [];
  for (const item of v.slice(0, MAX_MY_TEMPLATES)) {
    const o = item as Partial<MyTemplate> | null;
    if (!o || typeof o.id !== "string" || typeof o.name !== "string") continue;
    const stage = o.stage;
    if (
      !stage ||
      !(stage.w >= 200 && stage.w <= 8000 && stage.h >= 200 && stage.h <= 8000)
    )
      continue;
    const scene = repairScene(o.scene);
    const name = cleanName(o.name);
    if (!scene || !name) continue;
    out.push({
      id: o.id.slice(0, 64),
      name,
      at: typeof o.at === "number" ? o.at : 0,
      stage: { w: stage.w, h: stage.h },
      scene,
    });
  }
  return out;
}

export function loadMyTemplates(): MyTemplate[] {
  try {
    return parseMyTemplates(localStorage.getItem(MY_TEMPLATES_KEY));
  } catch {
    return [];
  }
}

/** Newest first, capped; returns false when the browser refused to store it. */
export function saveMyTemplates(list: readonly MyTemplate[]): boolean {
  try {
    const json = JSON.stringify(
      [...list].sort((a, b) => b.at - a.at).slice(0, MAX_MY_TEMPLATES),
    );
    if (json.length > MAX_BYTES) return false;
    localStorage.setItem(MY_TEMPLATES_KEY, json);
    return true;
  } catch {
    return false;
  }
}

/** A fresh scene for `to`, fitted when the template was made for another stage. */
export function instantiateMyTemplate(t: MyTemplate, to: StageSize): Scene {
  const base =
    t.stage.w === to.w && t.stage.h === to.h
      ? t.scene
      : fitScene(t.scene, t.stage, to);
  return structuredClone({ ...base, name: t.name });
}
