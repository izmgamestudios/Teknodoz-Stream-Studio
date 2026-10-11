// src/studio/prompter/burn-in.ts
// Burn-in prompter: draws the script text onto the program canvas so it ends up in the recording.
// Split into pure helpers (chunking, wrapping, layout: unit-tested without a canvas) and
// `drawBurnIn` (Canvas 2D). Coordinates are OUTPUT pixels; `drawBurnIn` restores any ctx state it
// changes, as required by the compositor hook contract.

import type { BurnInMode, Rect } from "../types";
import { lineIndexForWord, scriptProgress, type ScriptModel } from "./script";

/* ------------------------------------------------------------------ */
/* Text wrapping                                                       */
/* ------------------------------------------------------------------ */

/** Returns the rendered width of a string in px (e.g. `(s) => ctx.measureText(s).width`). */
export type MeasureFn = (text: string) => number;

/** Longest text `wrapText` will process; protects against pathological input. */
const MAX_WRAP_CHARS = 20_000;

/**
 * Greedy word wrap. Explicit "\n" always breaks, runs of whitespace collapse, and a single word
 * wider than `maxWidth` is hard-broken by code point (never inside a surrogate pair). Always makes
 * progress, even when `maxWidth` is tiny or not finite (then every word gets its own line).
 *
 * @param maxLines optional cap on the returned lines (the last line is NOT ellipsised)
 */
export function wrapText(
  measure: MeasureFn,
  text: string,
  maxWidth: number,
  maxLines = Number.POSITIVE_INFINITY,
): string[] {
  const out: string[] = [];
  const limit = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : 0;
  const source =
    text.length > MAX_WRAP_CHARS ? text.slice(0, MAX_WRAP_CHARS) : text;

  for (const paragraph of source.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    const flush = (): void => {
      if (line) out.push(line);
      line = "";
    };
    for (const word of words) {
      if (out.length >= maxLines) return out.slice(0, maxLines);
      const candidate = line ? `${line} ${word}` : word;
      if (limit === 0 ? line === "" : measure(candidate) <= limit) {
        line = candidate;
        continue;
      }
      flush();
      if (limit > 0 && measure(word) > limit) {
        // Hard-break an over-long word.
        let piece = "";
        for (const ch of word) {
          if (piece && measure(piece + ch) > limit) {
            out.push(piece);
            piece = "";
            if (out.length >= maxLines) return out.slice(0, maxLines);
          }
          piece += ch;
        }
        line = piece;
      } else {
        line = word;
      }
    }
    flush();
    if (out.length >= maxLines) return out.slice(0, maxLines);
  }
  return out.slice(0, maxLines);
}

/* ------------------------------------------------------------------ */
/* View model                                                          */
/* ------------------------------------------------------------------ */

export interface BurnInView {
  /** Text lines to show. subtitle/notch: 1-2 display chunks; ticker: one long line. */
  lines: string[];
  /** Index in `lines` of the chunk that contains the current word. */
  activeLine: number;
  /** Overall script progress 0..1. */
  progress: number;
  /** Progress 0..1 of the current word inside the active line. */
  lineProgress: number;
}

export interface BurnInViewOptions {
  /** Max characters per display chunk (subtitle/notch) or of upcoming text (ticker). */
  maxChars?: number | undefined;
}

/** Default chunk sizes (characters) per mode. */
export const DEFAULT_BURNIN_CHARS: Readonly<Record<BurnInMode, number>> = {
  subtitle: 46,
  notch: 38,
  ticker: 200,
};

/** Chunk size for ticker re-anchoring: the ticker text only changes when the chunk changes. */
const TICKER_ANCHOR_CHARS = 60;

export interface BurnInChunk {
  text: string;
  firstWord: number;
  lastWord: number;
}

const chunkCache = new WeakMap<ScriptModel, Map<number, BurnInChunk[]>>();
const SENTENCE_END = /[.!?…:;]["')\]»”’]*$/u;

/**
 * Split the script into display chunks of at most `maxChars` characters (an over-long single word
 * gets a chunk of its own). Chunks never span script lines; sentence ends close a chunk early once
 * it is at least 40% full. Cached per model.
 */
export function chunkScript(
  model: ScriptModel,
  maxChars: number,
): BurnInChunk[] {
  const limit = Math.max(
    8,
    Math.floor(Number.isFinite(maxChars) ? maxChars : 46),
  );
  let perModel = chunkCache.get(model);
  if (!perModel) {
    perModel = new Map();
    chunkCache.set(model, perModel);
  }
  const cached = perModel.get(limit);
  if (cached) return cached;

  const chunks: BurnInChunk[] = [];
  for (const line of model.lines) {
    let text = "";
    let first = line.firstWord;
    let last = line.firstWord - 1;
    const close = (): void => {
      if (text) chunks.push({ text, firstWord: first, lastWord: last });
      text = "";
    };
    for (const word of line.words) {
      if (text && text.length + 1 + word.w.length > limit) close();
      if (!text) first = word.globalIndex;
      text = text ? `${text} ${word.w}` : word.w;
      last = word.globalIndex;
      if (text.length >= limit * 0.4 && SENTENCE_END.test(word.w)) close();
    }
    close();
  }
  perModel.set(limit, chunks);
  return chunks;
}

function chunkIndexForWord(chunks: BurnInChunk[], wordIndex: number): number {
  let lo = 0;
  let hi = chunks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const c = chunks[mid];
    if (c && c.firstWord <= wordIndex) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function progressInChunk(chunk: BurnInChunk | undefined, word: number): number {
  if (!chunk) return 0;
  const count = chunk.lastWord - chunk.firstWord + 1;
  if (count <= 1) return 0;
  return Math.min(1, Math.max(0, (word - chunk.firstWord) / (count - 1)));
}

function clampWord(model: ScriptModel, wordIndex: number): number {
  if (!Number.isFinite(wordIndex)) return 0;
  return Math.min(
    Math.max(0, Math.floor(wordIndex)),
    Math.max(0, model.wordCount - 1),
  );
}

/**
 * Pure: what to draw for the current spoken position.
 *
 * - "subtitle" / "notch": two-line paging. Chunks are paired (0+1, 2+3, ...); both are shown and
 *   `activeLine` says which one is being read. When the second chunk is finished the page flips, so
 *   the text is stable while being read.
 * - "ticker": one line with the upcoming ~200 characters, starting at the beginning of the current
 *   chunk (so it only changes every few words and the marquee does not jitter).
 *
 * Out-of-range / non-finite `wordIndex` is clamped; an empty script yields no lines.
 */
export function getBurnInView(
  model: ScriptModel,
  wordIndex: number,
  mode: BurnInMode,
  options: BurnInViewOptions = {},
): BurnInView {
  if (model.wordCount === 0 || model.lines.length === 0) {
    return { lines: [], activeLine: 0, progress: 0, lineProgress: 0 };
  }
  const word = clampWord(model, wordIndex);
  const progress = scriptProgress(model, word);
  const maxChars = options.maxChars ?? DEFAULT_BURNIN_CHARS[mode];

  if (mode === "ticker") {
    const anchor = chunkScript(model, TICKER_ANCHOR_CHARS);
    const anchorChunk = anchor[chunkIndexForWord(anchor, word)];
    const start = anchorChunk?.firstWord ?? word;
    let text = "";
    let newLine = false;
    for (
      let li = lineIndexForWord(model, start);
      li < model.lines.length;
      li++
    ) {
      const line = model.lines[li];
      if (!line) break;
      for (const w of line.words) {
        if (w.globalIndex < start) continue;
        if (text) text += newLine ? "  \u2022  " : " ";
        newLine = false;
        text += w.w;
        if (text.length >= maxChars) break;
      }
      if (text.length >= maxChars) break;
      newLine = true;
    }
    return {
      lines: [text],
      activeLine: 0,
      progress,
      lineProgress: progressInChunk(anchorChunk, word),
    };
  }

  const chunks = chunkScript(model, maxChars);
  const idx = chunkIndexForWord(chunks, word);
  const page = idx - (idx % 2);
  const lines: string[] = [];
  const first = chunks[page];
  const second = chunks[page + 1];
  if (first) lines.push(first.text);
  if (second) lines.push(second.text);
  return {
    lines,
    activeLine: idx - page,
    progress,
    lineProgress: progressInChunk(chunks[idx], word),
  };
}

export interface VisualLine {
  text: string;
  active: boolean;
}

/**
 * Pure: wrap the view's lines to `maxWidth` and fit them into `maxLines` visual lines. When they do
 * not fit, keep the active line (paged by `lineProgress` if it alone is too tall) and add whole
 * neighbouring lines while they still fit.
 */
export function layoutBurnInLines(
  measure: MeasureFn,
  view: Pick<BurnInView, "lines" | "activeLine" | "lineProgress">,
  maxWidth: number,
  maxLines: number,
): VisualLine[] {
  const cap = Math.max(1, Math.floor(maxLines));
  const groups: VisualLine[][] = view.lines.map((text, i) =>
    wrapText(measure, text, maxWidth).map((t) => ({
      text: t,
      active: i === view.activeLine,
    })),
  );
  const total = groups.reduce((n, g) => n + g.length, 0);
  if (total <= cap) return groups.flat();

  const activeIdx = Math.min(Math.max(0, view.activeLine), groups.length - 1);
  const active = groups[activeIdx] ?? [];
  if (active.length >= cap) {
    const n = active.length;
    const cur = Math.min(
      n - 1,
      Math.floor(Math.min(1, Math.max(0, view.lineProgress)) * n),
    );
    const start = Math.min(n - cap, Math.floor(cur / cap) * cap);
    return active.slice(start, start + cap);
  }
  let before: VisualLine[] = [];
  let after: VisualLine[] = [];
  let room = cap - active.length;
  for (let i = activeIdx + 1; i < groups.length; i++) {
    const g = groups[i] ?? [];
    if (g.length <= room) {
      after = after.concat(g);
      room -= g.length;
    } else break;
  }
  for (let i = activeIdx - 1; i >= 0; i--) {
    const g = groups[i] ?? [];
    if (g.length <= room) {
      before = g.concat(before);
      room -= g.length;
    } else break;
  }
  return [...before, ...active, ...after];
}

/** Rough number of characters that fit on one line; use it for `BurnInViewOptions.maxChars`. */
export function suggestBurnInChars(
  mode: BurnInMode,
  box: Rect,
  fontSize: number,
): number {
  if (!(fontSize > 0) || !(box.w > 0)) return DEFAULT_BURNIN_CHARS[mode];
  const perLine = Math.floor((box.w * 0.9) / (fontSize * 0.52));
  if (mode === "ticker") return Math.max(60, Math.min(400, perLine * 3));
  return Math.max(12, perLine);
}

/* ------------------------------------------------------------------ */
/* Canvas drawing                                                      */
/* ------------------------------------------------------------------ */

export interface BurnInStyle {
  fontFamily: string;
  /** In output px. */
  fontSize: number;
  /** CSS color of the text. */
  color: string;
  /** 0..1 (PrompterSettings.contrast): text opacity and background strength. */
  contrast: number;
  /** CSS color of the panel behind the text (box / pill / strip). Default black. */
  background?: string | undefined;
  /** Ticker marquee speed in px/s. Default fontSize * 5. */
  tickerSpeedPx?: number | undefined;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draw the burn-in prompter into `box` (output px).
 *
 * - "subtitle": 1-2 centered wrapped lines on a translucent rounded box at the bottom of `box`.
 * - "notch": compact translucent pill (1-2 lines) centered at the top of `box`, near the camera.
 * - "ticker": single-line marquee strip scrolling right to left, looping forever; its phase comes
 *   from `nowMs`.
 *
 * Invalid input (empty view, non-positive size) draws nothing. All ctx state is restored.
 */
export function drawBurnIn(
  ctx: CanvasRenderingContext2D,
  mode: BurnInMode,
  box: Rect,
  view: BurnInView,
  style: BurnInStyle,
  nowMs = 0,
): void {
  const fs = style.fontSize;
  if (!(fs > 0) || !(box.w > 0) || !(box.h > 0) || view.lines.length === 0)
    return;
  const contrast = clamp01(style.contrast);
  const textAlpha = 0.45 + 0.55 * contrast;
  const bgAlpha = 0.4 + 0.35 * contrast;
  const bg = style.background ?? "#000000";

  ctx.save();
  try {
    ctx.font = `600 ${fs}px ${style.fontFamily}`;
    ctx.textBaseline = "middle";
    const measure: MeasureFn = (s) => ctx.measureText(s).width;
    const baseAlpha = Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1;

    if (mode === "ticker") {
      drawTicker(
        ctx,
        box,
        view,
        style,
        measure,
        nowMs,
        baseAlpha,
        textAlpha,
        bgAlpha,
        bg,
      );
      return;
    }

    const padX = fs * (mode === "notch" ? 0.5 : 0.6);
    const padY = fs * (mode === "notch" ? 0.25 : 0.35);
    const lineH = fs * (mode === "notch" ? 1.2 : 1.25);
    const maxTextW = Math.max(fs, box.w * 0.96 - 2 * padX);
    const visual = layoutBurnInLines(measure, view, maxTextW, 2);
    if (visual.length === 0) return;

    let widest = 0;
    for (const l of visual) widest = Math.max(widest, measure(l.text));
    const boxW = Math.min(box.w, widest + 2 * padX);
    const boxH = visual.length * lineH + 2 * padY;
    const x = box.x + (box.w - boxW) / 2;
    const margin = fs * 0.3;
    const y = mode === "notch" ? box.y + margin : box.y + box.h - boxH - margin;

    ctx.globalAlpha = baseAlpha * bgAlpha;
    ctx.fillStyle = bg;
    roundedRectPath(
      ctx,
      x,
      y,
      boxW,
      boxH,
      mode === "notch" ? Math.min(boxH / 2, fs) : fs * 0.5,
    );
    ctx.fill();

    ctx.textAlign = "center";
    ctx.fillStyle = style.color;
    visual.forEach((l, i) => {
      ctx.globalAlpha = baseAlpha * textAlpha * (l.active ? 1 : 0.6);
      ctx.fillText(l.text, x + boxW / 2, y + padY + lineH * (i + 0.5));
    });
  } finally {
    ctx.restore();
  }
}

function drawTicker(
  ctx: CanvasRenderingContext2D,
  box: Rect,
  view: BurnInView,
  style: BurnInStyle,
  measure: MeasureFn,
  nowMs: number,
  baseAlpha: number,
  textAlpha: number,
  bgAlpha: number,
  bg: string,
): void {
  const fs = style.fontSize;
  const text = view.lines.join("  •  ").replace(/\s+/g, " ").trim();
  if (!text) return;
  const stripH = Math.min(box.h, fs * 1.7);
  const y = box.y + box.h - stripH;

  ctx.globalAlpha = baseAlpha * bgAlpha;
  ctx.fillStyle = bg;
  ctx.fillRect(box.x, y, box.w, stripH);

  const textW = measure(text);
  if (!(textW > 0)) return;
  const loop = textW + fs * 3;
  const speed =
    style.tickerSpeedPx !== undefined && style.tickerSpeedPx > 0
      ? style.tickerSpeedPx
      : fs * 5;
  const t = Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0;
  const offset = ((t / 1000) * speed) % loop;

  ctx.beginPath();
  ctx.rect(box.x, y, box.w, stripH);
  ctx.clip();
  ctx.globalAlpha = baseAlpha * textAlpha;
  ctx.fillStyle = style.color;
  ctx.textAlign = "left";
  const copies = Math.min(64, Math.ceil(box.w / loop) + 2);
  for (let n = 0; n < copies; n++) {
    ctx.fillText(text, box.x - offset + n * loop, y + stripH / 2);
  }
}
