// src/studio/ui/actions.ts
// UI-level helpers that combine the asset store, project store and runtime.
import { createLayer } from "../defaults";
import { getActiveScene } from "../project/store";
import type { StudioRuntime } from "../runtime/runtime";
import type { AssetType, Layer } from "../types";

export type NewLayerKind =
  "webcam" | "screen" | "web" | "shape" | "text" | "prompter" | "chat";

export const LAYER_KIND_LABEL: Record<Layer["kind"], string> = {
  webcam: "Kamera",
  screen: "Ekran paylaşımı",
  web: "Web prototip",
  guest: "Konuk",
  image: "Görsel / logo",
  video: "Video",
  shape: "Şekil / banner",
  text: "Yazı",
  prompter: "Prompter (burn-in)",
  chat: "Sohbet (oda)",
};

export const LAYER_ICON: Record<Layer["kind"], string> = {
  webcam: "📷",
  screen: "🖥",
  web: "📱",
  guest: "👤",
  image: "🖼",
  video: "🎞",
  shape: "▭",
  text: "T",
  prompter: "📜",
  chat: "💬",
};

export function classifyFile(file: File): AssetType | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

function activeSceneId(rt: StudioRuntime): string {
  return getActiveScene(rt.project.getState()).id;
}

/** Add a source/shape/text layer to the active scene. Returns the new layer id. */
export function addLayerOfKind(rt: StudioRuntime, kind: NewLayerKind): string {
  const layer = createLayer(kind);
  rt.project.addLayer(activeSceneId(rt), layer);
  return layer.id;
}

export function addAssetLayer(
  rt: StudioRuntime,
  assetId: string,
  type: "image" | "video",
  name: string,
  dims?: { w: number; h: number },
): string {
  const label =
    name.replace(/\.[^.]+$/, "").slice(0, 60) ||
    (type === "image" ? "Görsel" : "Video");
  let layer: Layer;
  if (type === "image") {
    let w = 480;
    let h = 270;
    if (dims && dims.w > 0 && dims.h > 0) {
      const k = Math.min(640 / dims.w, 360 / dims.h, 1);
      w = Math.max(16, dims.w * k);
      h = Math.max(16, dims.h * k);
    }
    layer = createLayer("image", {
      name: label,
      assetId,
      transform: { x: (1920 - w) / 2, y: (1080 - h) / 2, w, h, rotation: 0 },
    });
  } else {
    layer = createLayer("video", { name: label, assetId });
  }
  rt.project.addLayer(activeSceneId(rt), layer);
  return layer.id;
}

async function imageSize(
  file: File,
): Promise<{ w: number; h: number } | undefined> {
  try {
    if (typeof createImageBitmap !== "function") return undefined;
    const bmp = await createImageBitmap(file);
    const d = { w: bmp.width, h: bmp.height };
    bmp.close();
    return d;
  } catch {
    return undefined;
  }
}

export interface ImportResult {
  /** layer id created for the last image/video file (to select it) */
  lastLayerId: string | null;
  added: number;
  rejected: string[];
}

/**
 * Store files in IndexedDB. With `asLayers`, images/videos are also added to the active scene.
 * Audio files only go to the library (use them as music / effects from there).
 */
export async function importFiles(
  rt: StudioRuntime,
  files: Iterable<File>,
  asLayers: boolean,
): Promise<ImportResult> {
  const out: ImportResult = { lastLayerId: null, added: 0, rejected: [] };
  for (const file of files) {
    const type = classifyFile(file);
    if (!type) {
      out.rejected.push(file.name);
      continue;
    }
    try {
      const meta = await rt.assets.put(file, { name: file.name, type });
      out.added++;
      if (asLayers && type !== "audio") {
        const dims = type === "image" ? await imageSize(file) : undefined;
        out.lastLayerId = addAssetLayer(rt, meta.id, type, file.name, dims);
      }
    } catch {
      out.rejected.push(file.name);
    }
  }
  return out;
}
