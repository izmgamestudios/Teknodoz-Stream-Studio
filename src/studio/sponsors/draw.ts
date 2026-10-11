// src/studio/sponsors/draw.ts
// Draws the on-air sponsor layer (SponsorLayer). The runtime hands in the sponsors that are
// currently on air with their decoded logos; the function returns the ids it actually showed
// so the caller can account exposure time.
import { wrapText } from "../room/chat-draw";
import type { SponsorLayer, SponsorTier, SupporterKind, Rect } from "../types";

export interface SponsorLogo {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export interface SponsorItem {
  id: string;
  name: string;
  tagline: string;
  kind: SupporterKind;
  tier: SponsorTier;
  logo: SponsorLogo | null;
}

/** Rotation weight: a title sponsor stays on screen three times as long as a supporter. */
export const TIER_WEIGHT: Record<SponsorTier, number> = {
  title: 3,
  gold: 2,
  silver: 1,
  supporter: 1,
};

export const TIER_COLOR: Record<SponsorTier, string> = {
  title: "#e11d2e",
  gold: "#e5b80b",
  silver: "#b6bfcc",
  supporter: "#38bdf8",
};

export const KIND_LABEL: Record<SupporterKind, string> = {
  sponsor: "Sponsor",
  partner: "İş ortağı",
  collaborator: "İş birlikçi",
  investor: "Yatırımcı",
};

/** Highest tier first; ties keep their order. */
export function sortForAir<T extends { tier: SponsorTier }>(
  items: readonly T[],
): T[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort(
      (a, b) => TIER_WEIGHT[b.it.tier] - TIER_WEIGHT[a.it.tier] || a.i - b.i,
    )
    .map((x) => x.it);
}

/**
 * Which item is on screen at `nowMs`, and how far (0..1) into its slot. Deterministic in time:
 * no timers, so the compositor stays the only clock.
 */
export function pickRotation(
  weights: readonly number[],
  nowMs: number,
  dwellMs: number,
): { index: number; progress: number } | null {
  if (weights.length === 0 || !(dwellMs > 0)) return null;
  const slots = weights.map((w) => Math.max(1, w) * dwellMs);
  const total = slots.reduce((a, b) => a + b, 0);
  let pos = ((nowMs % total) + total) % total;
  for (const [index, len] of slots.entries()) {
    if (pos < len) return { index, progress: pos / len };
    pos -= len;
  }
  return { index: slots.length - 1, progress: 1 };
}

const FONT = '"Space Grotesk", sans-serif';
const CARD = "rgba(10,14,30,0.9)";

function containBox(w: number, h: number, box: Rect): Rect {
  const k = Math.min(box.w / w, box.h / h);
  const dw = w * k;
  const dh = h * k;
  return {
    x: box.x + (box.w - dw) / 2,
    y: box.y + (box.h - dh) / 2,
    w: dw,
    h: dh,
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** Returns the ids of the sponsors that were drawn this frame. */
export function drawSponsors(
  ctx: CanvasRenderingContext2D,
  layer: SponsorLayer,
  box: Rect,
  nowMs: number,
  items: readonly SponsorItem[],
): string[] {
  if (!(box.w > 0) || !(box.h > 0) || items.length === 0) return [];
  const k = layer.transform.w > 0 ? box.w / layer.transform.w : 1;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    return layer.mode === "strip"
      ? strip(ctx, layer, box, items, k)
      : rotate(ctx, layer, box, nowMs, items, k);
  } finally {
    ctx.restore();
  }
}

function rotate(
  ctx: CanvasRenderingContext2D,
  layer: SponsorLayer,
  box: Rect,
  nowMs: number,
  items: readonly SponsorItem[],
  k: number,
): string[] {
  const pick = pickRotation(
    items.map((i) => TIER_WEIGHT[i.tier]),
    nowMs,
    layer.dwellMs,
  );
  const it = pick ? items[pick.index] : undefined;
  if (!pick || !it) return [];
  // fade in / out over the first and last 12 % of the slot
  const fade = Math.min(1, pick.progress / 0.12, (1 - pick.progress) / 0.12);
  ctx.globalAlpha *= Math.max(0, fade);

  const color = TIER_COLOR[it.tier];
  const pad = box.h * 0.1;
  roundRect(ctx, box.x, box.y, box.w, box.h, 14 * k);
  ctx.fillStyle = CARD;
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(box.x, box.y + box.h * 0.12, Math.max(4, 6 * k), box.h * 0.76);

  const headH = layer.heading ? box.h * 0.2 : 0;
  if (layer.heading) {
    ctx.font = `700 ${headH * 0.62}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.fillText(
      `${layer.heading.toUpperCase()} · ${KIND_LABEL[it.kind].toUpperCase()}`,
      box.x + pad * 1.4,
      box.y + pad + headH / 2,
      box.w - pad * 2.4,
    );
  }
  const body: Rect = {
    x: box.x + pad * 1.4,
    y: box.y + pad + headH,
    w: box.w - pad * 2.4,
    h: box.h - pad * 2 - headH,
  };
  const logoW = it.logo ? Math.min(body.h * 1.7, body.w * 0.42) : 0;
  if (it.logo) {
    const r = containBox(it.logo.width, it.logo.height, {
      x: body.x,
      y: body.y,
      w: logoW,
      h: body.h,
    });
    ctx.drawImage(it.logo.source, r.x, r.y, r.w, r.h);
  }
  const tx = body.x + (it.logo ? logoW + pad : 0);
  const tw = body.x + body.w - tx;
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${body.h * 0.34}px ${FONT}`;
  const hasTag = layer.showTagline && it.tagline.trim() !== "";
  ctx.fillText(it.name, tx, body.y + body.h * (hasTag ? 0.28 : 0.5), tw);
  if (hasTag) {
    const size = body.h * 0.22;
    ctx.font = `500 ${size}px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    const lines = wrapText((s) => ctx.measureText(s).width, it.tagline, tw, 2);
    lines.forEach((line, i) =>
      ctx.fillText(line, tx, body.y + body.h * 0.62 + size * 1.15 * i, tw),
    );
  }
  return [it.id];
}

function strip(
  ctx: CanvasRenderingContext2D,
  layer: SponsorLayer,
  box: Rect,
  items: readonly SponsorItem[],
  k: number,
): string[] {
  const pad = box.h * 0.1;
  roundRect(ctx, box.x, box.y, box.w, box.h, 14 * k);
  ctx.fillStyle = CARD;
  ctx.fill();
  const headH = layer.heading ? box.h * 0.2 : 0;
  if (layer.heading) {
    ctx.font = `700 ${headH * 0.62}px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(
      layer.heading.toUpperCase(),
      box.x + pad,
      box.y + pad + headH / 2,
      box.w - pad * 2,
    );
  }
  const row: Rect = {
    x: box.x + pad,
    y: box.y + pad + headH,
    w: box.w - pad * 2,
    h: box.h - pad * 2 - headH,
  };
  const weights = items.map((i) => (TIER_WEIGHT[i.tier] + 1) / 2);
  const gap = pad * 0.6;
  const sum = weights.reduce((a, b) => a + b, 0);
  const free = row.w - gap * (items.length - 1);
  let x = row.x;
  for (const [i, it] of items.entries()) {
    const w = (free * (weights[i] as number)) / sum;
    const cell: Rect = { x, y: row.y, w, h: row.h };
    if (it.logo) {
      const r = containBox(it.logo.width, it.logo.height, cell);
      ctx.drawImage(it.logo.source, r.x, r.y, r.w, r.h);
    } else {
      ctx.font = `700 ${row.h * 0.3}px ${FONT}`;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText(it.name, cell.x + cell.w / 2, cell.y + cell.h / 2, cell.w);
      ctx.textAlign = "left";
    }
    x += w + gap;
  }
  return items.map((i) => i.id);
}
