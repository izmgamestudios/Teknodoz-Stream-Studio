// src/studio/format.ts
// Output formats (landscape, vertical, square) and the logical stage that goes with them.
// Pure: everything is unit-tested. The logical stage keeps the short side at 1080 so layouts,
// fonts and templates feel the same in every orientation.
import {
  LOGICAL_H,
  LOGICAL_W,
  type Layer,
  type Scene,
  type Transform,
} from "./types";

export interface StageSize {
  w: number;
  h: number;
}

export type Orientation = "landscape" | "portrait" | "square";

export interface OutputFormat {
  id: string;
  label: string;
  short: string;
  width: number;
  height: number;
  orientation: Orientation;
  hint: string;
}

export const FORMATS: readonly OutputFormat[] = [
  {
    id: "16:9",
    label: "Yatay 16:9",
    short: "16:9",
    width: 1920,
    height: 1080,
    orientation: "landscape",
    hint: "YouTube, Twitch, toplantı, TV",
  },
  {
    id: "9:16",
    label: "Dikey 9:16",
    short: "9:16",
    width: 1080,
    height: 1920,
    orientation: "portrait",
    hint: "Reels, Shorts, TikTok, telefon canlı yayını",
  },
  {
    id: "4:5",
    label: "Portre 4:5",
    short: "4:5",
    width: 1080,
    height: 1350,
    orientation: "portrait",
    hint: "Instagram / Facebook akış videosu",
  },
  {
    id: "1:1",
    label: "Kare 1:1",
    short: "1:1",
    width: 1080,
    height: 1080,
    orientation: "square",
    hint: "Instagram, LinkedIn, Twitter/X",
  },
  {
    id: "4:3",
    label: "Klasik 4:3",
    short: "4:3",
    width: 1440,
    height: 1080,
    orientation: "landscape",
    hint: "Sunum, eski ekranlar",
  },
];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Logical stage for an output size: the short side is 1080; 16:9 stays exactly 1920x1080. */
export function stageFor(width: number, height: number): StageSize {
  if (!(width > 0) || !(height > 0)) return { w: LOGICAL_W, h: LOGICAL_H };
  if (Math.abs(width / height - 16 / 9) < 0.01)
    return { w: LOGICAL_W, h: LOGICAL_H };
  if (height >= width)
    return { w: 1080, h: Math.round((1080 * height) / width) };
  return { w: Math.round((1080 * width) / height), h: 1080 };
}

export function orientationOf(width: number, height: number): Orientation {
  const r = width / height;
  if (!(r > 0)) return "landscape";
  if (Math.abs(r - 1) < 0.02) return "square";
  return r < 1 ? "portrait" : "landscape";
}

export function formatOf(
  width: number,
  height: number,
): OutputFormat | undefined {
  return FORMATS.find((f) => f.width === width && f.height === height);
}

const sameStage = (a: StageSize, b: StageSize) => a.w === b.w && a.h === b.h;

function fullFrame(t: Transform, s: StageSize): boolean {
  return (
    Math.abs(t.x) < 2 &&
    Math.abs(t.y) < 2 &&
    t.rotation === 0 &&
    (Math.abs(t.w - s.w) < 4 || Math.abs(t.h - s.h) < 4) &&
    t.w >= s.w - 4 &&
    t.h >= s.h - 4
  );
}

/**
 * Re-lays one layer out for another stage. Full-frame layers stay full-frame; everything else
 * keeps its centre (as a fraction of the stage) and is scaled uniformly by the factor that
 * makes it fit, so aspect ratios (cameras, logos, banners) are preserved.
 */
export function fitTransform(
  t: Transform,
  from: StageSize,
  to: StageSize,
): Transform {
  if (sameStage(from, to)) return t;
  if (fullFrame(t, from)) return { x: 0, y: 0, w: to.w, h: to.h, rotation: 0 };
  const s = Math.min(to.w / from.w, to.h / from.h);
  const cx = ((t.x + t.w / 2) / from.w) * to.w;
  const cy = ((t.y + t.h / 2) / from.h) * to.h;
  // wide strips (banners, tickers) keep their relative width instead of shrinking with the height
  const wide = t.w >= from.w * 0.9;
  const w = wide ? to.w * (t.w / from.w) : t.w * s;
  const h = t.h * (wide ? Math.max(s, to.w / from.w) : s);
  return {
    x: Math.round(Math.min(Math.max(0, cx - w / 2), Math.max(0, to.w - w))),
    y: Math.round(Math.min(Math.max(0, cy - h / 2), Math.max(0, to.h - h))),
    w: Math.round(w),
    h: Math.round(h),
    rotation: t.rotation,
  };
}

export function fitLayer<L extends Layer>(
  layer: L,
  from: StageSize,
  to: StageSize,
): L {
  return { ...layer, transform: fitTransform(layer.transform, from, to) };
}

export function fitScene(scene: Scene, from: StageSize, to: StageSize): Scene {
  return { ...scene, layers: scene.layers.map((l) => fitLayer(l, from, to)) };
}

export const fitScenes = (
  scenes: readonly Scene[],
  from: StageSize,
  to: StageSize,
): Scene[] => scenes.map((s) => fitScene(s, from, to));

/** Live-stream quality for an output aspect: keeps the pixel budget, follows the orientation. */
export function orientedSize(
  q: { width: number; height: number },
  outW: number,
  outH: number,
) {
  const short = Math.min(q.width, q.height);
  if (!(outW > 0) || !(outH > 0)) return { width: q.width, height: q.height };
  const ratio = outW / outH;
  if (ratio >= 1) return { width: even(short * ratio), height: even(short) };
  return { width: even(short), height: even(short / ratio) };
}

export interface SafeZone {
  /** the area where text and faces are safe from platform UI / cropping */
  safe: { x: number; y: number; w: number; h: number };
  /** regions typically covered by platform UI (shaded in the editor) */
  unsafe: { x: number; y: number; w: number; h: number }[];
  label: string;
}

/**
 * Safe areas per stage. Vertical video (Reels / Shorts / TikTok) loses the top ~13% to the
 * profile bar and the bottom ~22% (+ the right edge) to caption and action buttons; wide video
 * uses the classic 90% title-safe area.
 */
export function safeZoneFor(stage: StageSize): SafeZone {
  const { w, h } = stage;
  const r = (x: number, y: number, rw: number, rh: number) => ({
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(rw),
    h: Math.round(rh),
  });
  if (h > w * 1.5) {
    const top = h * 0.13;
    const bottom = h * 0.22;
    const side = w * 0.04;
    const right = w * 0.14;
    return {
      safe: r(side, top, w - side - right, h - top - bottom),
      unsafe: [
        r(0, 0, w, top),
        r(0, h - bottom, w, bottom),
        r(w - right, top, right, h - top - bottom),
      ],
      label: "Reels / Shorts / TikTok güvenli bölgesi",
    };
  }
  const m = w >= h * 1.5 ? 0.05 : 0.06;
  const mx = w * m;
  const my = h * m;
  return {
    safe: r(mx, my, w - mx * 2, h - my * 2),
    unsafe: [
      r(0, 0, w, my),
      r(0, h - my, w, my),
      r(0, my, mx, h - my * 2),
      r(w - mx, my, mx, h - my * 2),
    ],
    label: w >= h * 1.5 ? "Başlık güvenli bölgesi (%90)" : "Güvenli bölge",
  };
}
