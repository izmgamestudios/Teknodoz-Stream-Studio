// src/studio/branding/logo-file.ts
// Turns a picked image file into a small data: URL for the local logo override (browser only).
import { MAX_DATA_URL } from "./brand";

const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const LOGO_FILE_TYPES: readonly string[] = TYPES;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_SIDE = 512;

export type LogoErrorCode = "type" | "size" | "decode";

export class LogoFileError extends Error {
  readonly code: LogoErrorCode;
  constructor(code: LogoErrorCode) {
    super(code);
    this.name = "LogoFileError";
    this.code = code;
  }
}

/** Longest side ≤ 512 px, PNG when it fits, otherwise WebP; always ≤ MAX_DATA_URL characters. */
export async function logoDataUrl(file: File): Promise<string> {
  if (!LOGO_FILE_TYPES.includes(file.type)) throw new LogoFileError("type");
  if (file.size > MAX_FILE) throw new LogoFileError("size");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new LogoFileError("decode");
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new LogoFileError("decode");
    ctx.drawImage(bmp, 0, 0, w, h);
    for (const [type, q] of [
      ["image/png", undefined],
      ["image/webp", 0.9],
      ["image/webp", 0.7],
    ] as const) {
      const url = canvas.toDataURL(type, q);
      if (url.startsWith(`data:${type};`) && url.length <= MAX_DATA_URL)
        return url;
    }
    throw new LogoFileError("size");
  } finally {
    bmp.close();
  }
}
