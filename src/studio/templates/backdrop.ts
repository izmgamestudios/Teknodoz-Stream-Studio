// src/studio/templates/backdrop.ts
// Generates the dark "dotted gradient" background of the broadcast templates on a canvas
// and stores it as an ordinary image asset (so .pptdz export carries it along).
// Browser only: every entry point returns undefined when canvas is unavailable.
import type { AssetStore } from "../types";
import { LOGICAL_H, LOGICAL_W } from "../types";

const STEP = 30;

export interface StageDims {
  w: number;
  h: number;
}

/** Landscape ids stay `tpl-bg-<hex>` (existing projects keep working); other stages add the size. */
export function backdropAssetId(accent: string, stage?: StageDims): string {
  const base = `tpl-bg-${accent.replace("#", "").toLowerCase()}`;
  return stage && (stage.w !== LOGICAL_W || stage.h !== LOGICAL_H)
    ? `${base}-${stage.w}x${stage.h}`
    : base;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 0..1 glow strength used for both the soft light and the dot brightness. */
export function glowAt(x: number, y: number, w: number, h: number): number {
  const a = Math.max(0, 1 - Math.hypot(x - w * 0.88, y - h * 0.1) / (w * 0.6));
  const b = Math.max(0, 1 - Math.hypot(x - w * 0.08, y - h * 0.95) / (w * 0.5));
  return Math.min(1, a + b * 0.7);
}

function makeCanvas(
  w: number,
  h: number,
): HTMLCanvasElement | OffscreenCanvas | undefined {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  return undefined;
}

async function toBlob(
  c: HTMLCanvasElement | OffscreenCanvas,
): Promise<Blob | undefined> {
  if ("convertToBlob" in c) return c.convertToBlob({ type: "image/png" });
  return new Promise((resolve) =>
    c.toBlob((b) => resolve(b ?? undefined), "image/png"),
  );
}

export async function renderBackdrop(
  accent: string,
  stage?: StageDims,
): Promise<Blob | undefined> {
  const w = stage?.w ?? LOGICAL_W;
  const h = stage?.h ?? LOGICAL_H;
  const canvas = makeCanvas(w, h);
  const ctx = canvas?.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
    | undefined;
  if (!canvas || !ctx) return undefined;
  const [r, g, b] = rgb(accent);

  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, "#050813");
  base.addColorStop(1, "#0b1430");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const glow = (cx: number, cy: number, radius: number, alpha: number) => {
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gr.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, w, h);
  };
  glow(w * 0.88, h * 0.1, w * 0.6, 0.5);
  glow(w * 0.08, h * 0.95, w * 0.5, 0.32);

  for (let y = STEP / 2; y < h; y += STEP) {
    for (let x = STEP / 2; x < w; x += STEP) {
      const k = glowAt(x, y, w, h);
      ctx.fillStyle = `rgba(255,255,255,${(0.05 + 0.4 * k).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.5 + 1.2 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return toBlob(canvas);
}

/**
 * Make sure the backdrop asset for `accent` exists. Returns its id, or undefined when the
 * environment cannot render it (callers then fall back to a flat panel).
 */
export async function ensureBackdrop(
  assets: AssetStore,
  accent: string,
  stage?: StageDims,
): Promise<string | undefined> {
  const id = backdropAssetId(accent, stage);
  try {
    if (await assets.get(id)) return id;
    const blob = await renderBackdrop(accent, stage);
    if (!blob) return undefined;
    await assets.put(
      blob,
      { name: `Şablon arka planı ${accent}`, type: "image" },
      id,
    );
    return id;
  } catch {
    return undefined;
  }
}
