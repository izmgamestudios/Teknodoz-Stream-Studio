// src/studio/room/chat-draw.ts
// Draws the room-chat overlay (ChatLayer) on the program canvas.
// Pure canvas code: the runtime hands in the already-filtered messages.
import type { ChatLayer, Rect } from "../types";

export interface ChatLine {
  author: string;
  text: string;
}

export interface ChatDrawModel {
  /** the message the director put on air, if any */
  spotlight: ChatLine | null;
  /** latest approved messages, oldest first */
  feed: readonly ChatLine[];
}

const FONT = '"Space Grotesk", sans-serif';
const CARD = "rgba(10,14,30,0.9)";
const ROW = "rgba(10,14,30,0.82)";
const ELLIPSIS = "…";

type Measure = (s: string) => number;

/**
 * Greedy word wrap. Words wider than `maxW` are split by characters. When the text needs
 * more than `maxLines` lines the last one is cut with an ellipsis.
 */
export function wrapText(
  measure: Measure,
  text: string,
  maxW: number,
  maxLines: number,
): string[] {
  const limit = Math.max(1, Math.floor(maxLines));
  const lines: string[] = [];
  let cur = "";
  const push = () => {
    if (cur) lines.push(cur);
    cur = "";
  };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (measure(w) > maxW && w.length > 1) {
      // split an over-long word
      let n = w.length - 1;
      while (n > 1 && measure(w.slice(0, n)) > maxW) n--;
      if (cur) push();
      lines.push(w.slice(0, n));
      w = w.slice(n);
    }
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= maxW || !cur) cur = next;
    else {
      push();
      cur = w;
    }
  }
  push();
  if (lines.length <= limit) return lines;
  const kept = lines.slice(0, limit);
  let last = kept[limit - 1] ?? "";
  while (last.length > 1 && measure(last + ELLIPSIS) > maxW)
    last = last.slice(0, -1);
  kept[limit - 1] = last + ELLIPSIS;
  return kept;
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

export function drawChat(
  ctx: CanvasRenderingContext2D,
  layer: ChatLayer,
  box: Rect,
  model: ChatDrawModel,
): void {
  if (!(box.w > 0) || !(box.h > 0)) return;
  const lw = layer.transform.w;
  const k = lw > 0 ? box.w / lw : 1;
  const fs = Math.max(6, layer.fontSize * k);
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    if (layer.mode === "spotlight") spotlight(ctx, layer, box, fs, model);
    else feed(ctx, layer, box, fs, model);
  } finally {
    ctx.restore();
  }
}

function spotlight(
  ctx: CanvasRenderingContext2D,
  layer: ChatLayer,
  box: Rect,
  fs: number,
  model: ChatDrawModel,
): void {
  const msg = model.spotlight;
  if (!msg) return;
  const pad = fs * 0.6;
  const bar = Math.max(4, fs * 0.16);
  const lh = fs * 1.25;
  const tagH = fs * 0.95;
  const cardY = box.y + tagH;
  const cardH = box.h - tagH;
  if (cardH <= lh) return;

  // author tag
  ctx.font = `700 ${fs * 0.55}px ${FONT}`;
  const name = msg.author.toUpperCase();
  const tagW = Math.min(box.w, ctx.measureText(name).width + pad * 1.4);
  ctx.fillStyle = layer.accent;
  ctx.fillRect(box.x, box.y, tagW, tagH);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name, box.x + pad * 0.7, box.y + tagH / 2, tagW - pad);

  // message card
  ctx.fillStyle = CARD;
  ctx.fillRect(box.x, cardY, box.w, cardH);
  ctx.fillStyle = layer.accent;
  ctx.fillRect(box.x, cardY, bar, cardH);
  ctx.font = `600 ${fs}px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  const maxLines = Math.max(1, Math.floor((cardH - pad) / lh));
  const lines = wrapText(
    (s) => ctx.measureText(s).width,
    msg.text,
    box.w - pad * 2 - bar,
    maxLines,
  );
  const top = cardY + (cardH - lines.length * lh) / 2;
  lines.forEach((line, i) =>
    ctx.fillText(line, box.x + bar + pad, top + lh * (i + 0.5)),
  );
}

function feed(
  ctx: CanvasRenderingContext2D,
  layer: ChatLayer,
  box: Rect,
  fs: number,
  model: ChatDrawModel,
): void {
  const items = model.feed.slice(-Math.max(1, layer.maxMessages));
  if (items.length === 0) return;
  const pad = fs * 0.45;
  const gap = fs * 0.25;
  const lh = fs * 1.2;
  let bottom = box.y + box.h;
  // newest at the bottom, walk upwards until the box is full
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i] as ChatLine;
    ctx.font = `700 ${fs}px ${FONT}`;
    const author = `${it.author}  `;
    const authorW = ctx.measureText(author).width;
    ctx.font = `500 ${fs}px ${FONT}`;
    const maxW = box.w - pad * 2;
    const lines = wrapText(
      (s) => ctx.measureText(s).width,
      it.text,
      maxW - authorW,
      2,
    );
    const h = Math.max(1, lines.length) * lh + pad * 2;
    const y = bottom - h;
    if (y < box.y) break;
    ctx.fillStyle = ROW;
    roundRect(ctx, box.x, y, box.w, h, fs * 0.3);
    ctx.fill();
    ctx.fillStyle = layer.accent;
    ctx.fillRect(box.x, y + h * 0.15, Math.max(3, fs * 0.12), h * 0.7);
    ctx.font = `700 ${fs}px ${FONT}`;
    ctx.fillText(author, box.x + pad, y + pad + lh / 2);
    ctx.font = `500 ${fs}px ${FONT}`;
    ctx.fillStyle = "#ffffff";
    lines.forEach((line, n) =>
      ctx.fillText(line, box.x + pad + authorW, y + pad + lh * (n + 0.5)),
    );
    bottom = y - gap;
  }
}
