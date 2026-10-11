// src/studio/engine/chapters.ts
// Pure helpers: recording markers -> YouTube chapters (chapters.txt) and SubRip (.srt).
// No browser APIs, safe for SSR and unit tests.
import type { Marker } from "../types";

/** Label of the chapter that is auto-inserted at 0:00 when the first marker is later. */
export const CHAPTER_INTRO_LABEL = "Başlangıç";
/** YouTube needs at least three timestamps for chapters to be recognised. */
export const YOUTUBE_MIN_CHAPTERS = 3;
/** YouTube needs every chapter to be at least 10 seconds long. */
export const YOUTUBE_MIN_CHAPTER_MS = 10_000;
/** Markers closer than this to their predecessor are the same second for YouTube: dropped. */
export const MARKER_DEDUPE_MS = 1_000;
/** Hard bound on the number of chapters we emit. */
export const MAX_CHAPTER_MARKERS = 500;
/** Hard bound on raw input entries inspected (malformed / hostile input). */
export const MAX_INPUT_MARKERS = 10_000;
/** Maximum label length in characters (code points). */
export const MAX_LABEL_LENGTH = 100;

export interface ChapterOptions {
  /** Label for the auto-inserted 0:00 chapter. Default {@link CHAPTER_INTRO_LABEL}. */
  introLabel?: string;
  /** Minimum chapter length in ms used for flagging / merging. Default 10 000. */
  minChapterMs?: number;
  /**
   * Merge chapters shorter than `minChapterMs` into their neighbour (the earlier marker wins).
   * Default: false for normalizeMarkers / buildSrt / chapterWarnings, true for buildChaptersTxt.
   */
  mergeShort?: boolean;
}

export interface SrtOptions extends ChapterOptions {
  /** Line terminator. Default CRLF (the SubRip convention); LF is accepted by every player. */
  newline?: "\r\n" | "\n";
}

export type ChapterWarningCode =
  /** the input had no valid user markers at all (only the auto intro remains) */
  | "no-markers"
  /** entries without a finite timestamp were dropped (count) */
  | "invalid-marker"
  /** timestamps outside [0, duration] were clamped (count) */
  | "marker-clamped"
  /** markers within 1 s of the previous one were dropped (count) */
  | "markers-deduped"
  /** more than MAX_CHAPTER_MARKERS: the tail was dropped (count) */
  | "marker-limit"
  /** empty labels were replaced by "Bölüm N" (count) */
  | "label-empty"
  /** a 0:00 chapter was inserted because the first marker was later (count = 1) */
  | "intro-inserted"
  /** chapters shorter than the minimum; `indices` point into the normalized (unmerged) list */
  | "chapter-too-short"
  /** short chapters were merged away (count) */
  | "chapters-merged"
  /** fewer than YOUTUBE_MIN_CHAPTERS chapters in the final list (count = how many exist) */
  | "too-few-chapters";

export interface ChapterWarning {
  code: ChapterWarningCode;
  /** number of affected items */
  count: number;
  /** 0-based indices of affected chapters when meaningful, otherwise empty */
  indices: number[];
}

/* ------------------------------------------------------------------ */
/* Formatting primitives                                               */
/* ------------------------------------------------------------------ */

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function wholeSeconds(ms: number): number {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0
    ? Math.floor(ms / 1000)
    : 0;
}

/**
 * YouTube chapter timestamp: `M:SS` below one hour, `H:MM:SS` from one hour (or when
 * `forceHours` is set). Sub-second parts are floored (a chapter never starts early);
 * negative / non-finite input becomes `0:00`.
 */
export function formatChapterTime(ms: number, forceHours = false): string {
  const total = wholeSeconds(ms);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0 || forceHours) return `${h}:${pad(m, 2)}:${pad(s, 2)}`;
  return `${m}:${pad(s, 2)}`;
}

/** SubRip timestamp `HH:MM:SS,mmm` (hours padded to at least two digits). */
export function formatSrtTime(ms: number): string {
  const total =
    typeof ms === "number" && Number.isFinite(ms) && ms > 0
      ? Math.round(ms)
      : 0;
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(milli, 3)}`;
}

function isControlCode(c: number): boolean {
  return (
    c <= 0x1f || // C0 controls (includes TAB, CR, LF)
    (c >= 0x7f && c <= 0x9f) || // DEL and C1 controls
    c === 0x2028 || // line separator
    c === 0x2029 || // paragraph separator
    (c >= 0x200b && c <= 0x200f) || // zero-width and directional marks
    (c >= 0x202a && c <= 0x202e) || // bidi embeddings / overrides
    (c >= 0x2066 && c <= 0x2069) || // bidi isolates
    c === 0xfeff // BOM / zero-width no-break space
  );
}

/**
 * Replace every control, line-separator, zero-width and bidi-formatting character with
 * `replacement` (default a space). Implemented on char codes so no control-character regex is
 * needed.
 */
export function replaceControlChars(text: string, replacement = " "): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    out += isControlCode(text.charCodeAt(i)) ? replacement : text.charAt(i);
  }
  return out;
}

/**
 * Turn arbitrary input into a single-line, bounded label. Returns `fallback` when nothing
 * printable remains. Control characters and line breaks collapse to single spaces. The result
 * is at most `maxLength` code points (the last one is an ellipsis when text was cut).
 */
export function sanitizeLabel(
  raw: unknown,
  fallback = "",
  maxLength = MAX_LABEL_LENGTH,
): string {
  if (typeof raw !== "string") return fallback;
  const cleaned = replaceControlChars(raw).replace(/\s+/g, " ").trim();
  if (cleaned === "") return fallback;
  const chars = Array.from(cleaned);
  if (chars.length <= maxLength) return cleaned;
  return `${chars
    .slice(0, Math.max(0, maxLength - 1))
    .join("")
    .trimEnd()}…`;
}

/**
 * Make text safe for a SubRip cue: normalises every newline flavour, drops blank lines (a
 * blank line would terminate the cue), and neutralises markup that players interpret
 * (`<i>`, `<font>`, `{\an8}`). Lines are joined with `newline`.
 */
export function escapeSrtText(
  text: string,
  newline: "\r\n" | "\n" = "\r\n",
): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/\r\n|\r/g, "\n")
    .replaceAll(String.fromCharCode(0x2028), "\n")
    .replaceAll(String.fromCharCode(0x2029), "\n")
    .split("\n")
    .map((line) =>
      replaceControlChars(line)
        .replace(/</g, "‹")
        .replace(/>/g, "›")
        .replace(/\{/g, "(")
        .replace(/\}/g, ")")
        .trim(),
    )
    .filter((line) => line !== "")
    .join(newline);
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

interface Analysis {
  /** final chapter list (after optional merge) */
  chapters: Marker[];
  /** normalized list before merging short chapters */
  unmerged: Marker[];
  userMarkers: number;
  invalid: number;
  clamped: number;
  deduped: number;
  truncated: number;
  emptyLabels: number;
  introInserted: boolean;
  shortIndices: number[];
  mergedCount: number;
}

function sanitizeDuration(durationMs: number): number {
  return typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs > 0
    ? Math.floor(durationMs)
    : 0;
}

function sanitizeMinLength(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
    ? v
    : YOUTUBE_MIN_CHAPTER_MS;
}

function analyze(
  markers: readonly Marker[],
  durationMs: number,
  opts: ChapterOptions,
  mergeDefault: boolean,
): Analysis {
  const dur = sanitizeDuration(durationMs);
  const minMs = sanitizeMinLength(opts.minChapterMs);
  const introLabel = sanitizeLabel(opts.introLabel, CHAPTER_INTRO_LABEL);
  const mergeShort = opts.mergeShort ?? mergeDefault;

  const raw: readonly unknown[] = Array.isArray(markers) ? markers : [];
  const limit = Math.min(raw.length, MAX_INPUT_MARKERS);

  let invalid = raw.length - limit;
  let clamped = 0;
  const items: { t: number; label: string }[] = [];
  for (let i = 0; i < limit; i++) {
    const m = raw[i] as { t?: unknown; label?: unknown } | null | undefined;
    if (
      m === null ||
      typeof m !== "object" ||
      typeof m.t !== "number" ||
      !Number.isFinite(m.t)
    ) {
      invalid++;
      continue;
    }
    let t = Math.round(m.t);
    if (t < 0) {
      t = 0;
      clamped++;
    } else if (t > dur) {
      t = dur;
      clamped++;
    }
    items.push({ t, label: sanitizeLabel(m.label, "") });
  }
  const userMarkers = items.length;

  // Array.prototype.sort is stable: equal timestamps keep their input order.
  items.sort((a, b) => a.t - b.t);

  // A first marker within the first second IS the 0:00 chapter.
  const first = items[0];
  if (first && first.t < MARKER_DEDUPE_MS) first.t = 0;

  const kept: { t: number; label: string }[] = [];
  let deduped = 0;
  for (const it of items) {
    const last = kept[kept.length - 1];
    if (last && it.t - last.t < MARKER_DEDUPE_MS) {
      deduped++;
      continue;
    }
    kept.push(it);
  }

  let introInserted = false;
  const head = kept[0];
  if (!head || head.t > 0) {
    kept.unshift({ t: 0, label: introLabel });
    introInserted = true;
  }

  let truncated = 0;
  if (kept.length > MAX_CHAPTER_MARKERS) {
    truncated = kept.length - MAX_CHAPTER_MARKERS;
    kept.length = MAX_CHAPTER_MARKERS;
  }

  let emptyLabels = 0;
  const unmerged: Marker[] = kept.map((k, i) => {
    if (k.label === "") {
      emptyLabels++;
      return { t: k.t, label: `Bölüm ${i + 1}` };
    }
    return { t: k.t, label: k.label };
  });

  const endOf = (list: readonly Marker[], i: number): number =>
    list[i + 1]?.t ?? dur;

  const shortIndices: number[] = [];
  for (let i = 0; i < unmerged.length; i++) {
    const cur = unmerged[i];
    if (cur && endOf(unmerged, i) - cur.t < minMs) shortIndices.push(i);
  }

  let chapters = unmerged;
  if (mergeShort && shortIndices.length > 0) {
    const out = unmerged.slice();
    let i = 0;
    while (i < out.length) {
      const cur = out[i];
      if (!cur) break;
      if (endOf(out, i) - cur.t >= minMs) {
        i++;
        continue;
      }
      if (i + 1 < out.length) {
        out.splice(i + 1, 1); // absorb the next chapter, then re-check this one
        continue;
      }
      if (i > 0) out.splice(i, 1); // short tail: absorb into the previous chapter
      break;
    }
    chapters = out;
  }

  return {
    chapters,
    unmerged,
    userMarkers,
    invalid,
    clamped,
    deduped,
    truncated,
    emptyLabels,
    introInserted,
    shortIndices,
    mergedCount: unmerged.length - chapters.length,
  };
}

/**
 * Sort, clamp to [0, duration], drop markers within 1 s of their predecessor, make sure a
 * chapter exists at 0:00 (inserting "Başlangıç" when needed), sanitise labels. Never mutates the
 * input and never throws on malformed entries. Short chapters are only merged when
 * `opts.mergeShort` is true.
 */
export function normalizeMarkers(
  markers: readonly Marker[],
  durationMs: number,
  opts: ChapterOptions = {},
): Marker[] {
  return analyze(markers, durationMs, opts, false).chapters;
}

/** Machine-readable problems with the chapter list a given export would produce. */
export function chapterWarnings(
  markers: readonly Marker[],
  durationMs: number,
  opts: ChapterOptions = {},
): ChapterWarning[] {
  const a = analyze(markers, durationMs, opts, false);
  const out: ChapterWarning[] = [];
  const push = (
    code: ChapterWarningCode,
    count: number,
    indices: number[] = [],
  ): void => {
    if (count > 0) out.push({ code, count, indices });
  };
  if (a.userMarkers === 0)
    out.push({ code: "no-markers", count: 0, indices: [] });
  push("invalid-marker", a.invalid);
  push("marker-clamped", a.clamped);
  push("markers-deduped", a.deduped);
  push("marker-limit", a.truncated);
  push("label-empty", a.emptyLabels);
  push("intro-inserted", a.introInserted ? 1 : 0);
  push("chapter-too-short", a.shortIndices.length, a.shortIndices);
  push("chapters-merged", a.mergedCount);
  if (a.chapters.length < YOUTUBE_MIN_CHAPTERS) {
    out.push({
      code: "too-few-chapters",
      count: a.chapters.length,
      indices: [],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Exporters                                                           */
/* ------------------------------------------------------------------ */

/**
 * YouTube description block, one `M:SS Label` line per chapter, LF separated with a trailing
 * newline. Always starts with `0:00`. Short chapters are merged (YouTube would otherwise ignore
 * the whole list) unless `opts.mergeShort === false`; use {@link chapterWarnings} to tell the
 * user what happened.
 */
export function buildChaptersTxt(
  markers: readonly Marker[],
  durationMs: number,
  opts: ChapterOptions = {},
): string {
  const { chapters } = analyze(markers, durationMs, opts, true);
  return `${chapters.map((c) => `${formatChapterTime(c.t)} ${c.label}`).join("\n")}\n`;
}

/**
 * SubRip subtitles: each chapter label is shown from its marker until the next marker; the last
 * one until `durationMs`. Zero-length cues are skipped. Returns "" when no cue is possible
 * (e.g. zero duration). CRLF line endings by default.
 */
export function buildSrt(
  markers: readonly Marker[],
  durationMs: number,
  opts: SrtOptions = {},
): string {
  const nl = opts.newline === "\n" ? "\n" : "\r\n";
  const dur = sanitizeDuration(durationMs);
  const { chapters } = analyze(markers, durationMs, opts, false);
  const blocks: string[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const cur = chapters[i];
    if (!cur) continue;
    const end = chapters[i + 1]?.t ?? dur;
    if (end <= cur.t) continue;
    const text = escapeSrtText(cur.label, nl);
    if (text === "") continue;
    blocks.push(
      [
        String(blocks.length + 1),
        `${formatSrtTime(cur.t)} --> ${formatSrtTime(end)}`,
        text,
      ].join(nl),
    );
  }
  return blocks.length === 0 ? "" : `${blocks.join(nl + nl)}${nl}`;
}
