// src/studio/templates/uploads.ts
// Logo / background images for the broadcast templates: validation, storage as ordinary image
// assets (so .pptdz export carries them) and a tiny "remember my logo" convenience.
import type { AssetStore } from "../types";

/** Raster formats only: an SVG without intrinsic size would draw nothing on the canvas. */
export const TEMPLATE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;
export const TEMPLATE_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
export const TEMPLATE_IMAGE_MAX_SIDE = 8192;

export type UploadErrorCode = "type" | "size" | "decode" | "store";

export class TemplateUploadError extends Error {
  constructor(readonly code: UploadErrorCode) {
    super(code);
  }
}

export function checkTemplateImage(file: {
  type: string;
  size: number;
}): UploadErrorCode | null {
  if (!(TEMPLATE_IMAGE_TYPES as readonly string[]).includes(file.type))
    return "type";
  if (file.size <= 0 || file.size > TEMPLATE_IMAGE_MAX_BYTES) return "size";
  return null;
}

export interface UploadedImage {
  id: string;
  url: string;
}

/** Validate, decode-check and store a template image. Throws `TemplateUploadError`. */
export async function importTemplateImage(
  assets: AssetStore,
  file: File,
  kind: "logo" | "background",
): Promise<UploadedImage> {
  const bad = checkTemplateImage(file);
  if (bad) throw new TemplateUploadError(bad);
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      const ok =
        bmp.width >= 16 &&
        bmp.height >= 16 &&
        bmp.width <= TEMPLATE_IMAGE_MAX_SIDE &&
        bmp.height <= TEMPLATE_IMAGE_MAX_SIDE;
      bmp.close();
      if (!ok) throw new TemplateUploadError("size");
    } catch (e) {
      throw e instanceof TemplateUploadError
        ? e
        : new TemplateUploadError("decode");
    }
  }
  try {
    const name =
      `${kind === "logo" ? "Logo" : "Arka plan"} – ${file.name}`.slice(0, 120);
    const meta = await assets.put(file, { name, type: "image" });
    const url = await assets.getUrl(meta.id);
    if (!url) throw new Error("no-url");
    return { id: meta.id, url };
  } catch {
    throw new TemplateUploadError("store");
  }
}

/* ---------------- remembered selection (ids only, no image data) ---------------- */

export interface RememberedImages {
  logoAssetId?: string;
  backgroundAssetId?: string;
}

const KEY = "tkz.templates.images.v1";
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function local(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadRemembered(
  storage: StorageLike | null = local(),
): RememberedImages {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, unknown>;
    const out: RememberedImages = {};
    if (typeof p["logoAssetId"] === "string" && ID.test(p["logoAssetId"]))
      out.logoAssetId = p["logoAssetId"];
    if (
      typeof p["backgroundAssetId"] === "string" &&
      ID.test(p["backgroundAssetId"])
    )
      out.backgroundAssetId = p["backgroundAssetId"];
    return out;
  } catch {
    return {};
  }
}

export function saveRemembered(
  r: RememberedImages,
  storage: StorageLike | null = local(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(r));
  } catch {
    // blocked storage: the selection just is not remembered
  }
}
