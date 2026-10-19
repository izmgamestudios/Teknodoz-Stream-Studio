// src/studio/prompter/script.ts
// Script parsing + word normalisation + scroll-speed <-> WPM conversions.
// Pure, DOM-free, SSR-safe. Everything else in the prompter module builds on `ScriptModel`.

/** Dialogue speaker. Plain single-speaker scripts have no speaker at all. */
export type Speaker = "A" | "B";

export interface ScriptWord {
  /** The word exactly as written (whitespace-delimited token, punctuation kept). */
  w: string;
  /** Lower-cased, punctuation-stripped form used for speech matching. May be "" (e.g. "—"). */
  norm: string;
  /** Stable index of this word across the whole script (0-based, in reading order). */
  globalIndex: number;
}

export interface ScriptLine {
  /** 0-based index in `ScriptModel.lines`. */
  index: number;
  /** Display text (speaker prefix removed, inner whitespace collapsed to single spaces). */
  text: string;
  /** Only set for dialogue scripts (see `ParseScriptOptions.speakers`). */
  speaker?: Speaker;
  words: ScriptWord[];
  /** globalIndex of the first word of this line. */
  firstWord: number;
  /** globalIndex of the last word of this line. */
  lastWord: number;
  /** 0-based paragraph number (paragraphs are separated by blank lines). */
  paragraph: number;
  /** True for the first line of each paragraph. */
  paragraphStart: boolean;
}

export interface ScriptModel {
  lines: ScriptLine[];
  /** Flat list of every word; `words[i].globalIndex === i`. Shares objects with `lines[].words`. */
  words: ScriptWord[];
  wordCount: number;
  /** BCP-47 tag the `norm` fields were computed with. */
  lang: string;
  /** True when at least one line carries a speaker. */
  dialogue: boolean;
  /** True when the input exceeded the size limits and was cut. */
  truncated: boolean;
}

/** Hard limits that keep a pasted novel from blowing up memory. */
export const MAX_SCRIPT_CHARS = 1_000_000;
export const MAX_SCRIPT_WORDS = 150_000;

export interface ParseScriptOptions {
  /** BCP-47 language used for normalisation. Default "tr-TR". */
  lang?: string | undefined;
  /**
   * - "auto" (default): if any line has an explicit `A:`/`B)`/`A-` prefix the script is a dialogue
   *   (unprefixed lines alternate, exactly like the original prompter); otherwise it is a plain
   *   single-speaker script and no line has a speaker.
   * - "alternate": always a dialogue; unprefixed lines alternate A, B, A, B...
   * - "none": never interpret prefixes; every line is plain text.
   */
  speakers?: "auto" | "alternate" | "none" | undefined;
  maxChars?: number | undefined;
  maxWords?: number | undefined;
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

const DEFAULT_LANG = "tr-TR";

function isTurkic(lang: string): boolean {
  const base = lang.toLowerCase().split(/[-_]/)[0];
  return base === "tr" || base === "az";
}

const FOLD_MAP: Record<string, string> = {
  ı: "i",
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ł: "l",
};

/**
 * Normalise one word for speech matching.
 *
 * 1. Locale-aware lower-casing (Turkish: `I -> ı`, `İ -> i`; every other language uses the root
 *    locale). The Turkic dotted/dotless I is handled explicitly so the result does not depend on the
 *    ICU data the runtime ships with.
 * 2. Strips everything that is not a letter, number or combining mark (punctuation, quotes,
 *    apostrophes: "Türkiye'nin" -> "türkiyenin", "don't" -> "dont").
 * 3. With `fold = true` also folds diacritics (`ç ğ ı ö ş ü é ...` -> ASCII) so that ASR output that
 *    drops them still matches. Folding is lossy; use it for matching only, not for display.
 *
 * @param lang BCP-47 tag or bare language ("tr", "tr-TR", "en-US"). Default "tr-TR".
 */
export function normalizeWord(
  w: string,
  lang: string = DEFAULT_LANG,
  fold = false,
): string {
  if (!w) return "";
  let s = w.normalize("NFC");
  s = isTurkic(lang)
    ? s.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr")
    : s.toLowerCase();
  // "İ".toLowerCase() in non-Turkic locales yields "i" + U+0307; drop the stray dot.
  s = s.replace(/i\u0307/g, "i");
  s = s.replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
  if (fold) {
    s = s
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .normalize("NFC");
    s = s.replace(/[ıßæœøđł]/g, (c) => FOLD_MAP[c] ?? c);
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

// Control chars (except \t \n \r) and invisible zero-width chars that break word matching.
const JUNK_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u2060\uFEFF]/g;
const LINE_BREAKS = /\r\n|\r|\n|\u2028|\u2029/;

// "A: text", "A : text", "a) text", "B- text", "A – text". Colon may touch the text, the other
// delimiters need whitespace (or end of line) after them so "A-ha" or "B)" mid-word are plain text.
const PREFIX_COLON = /^([AaBb])\s*:\s*(.*)$/;
const PREFIX_OTHER = /^([AaBb])\s*[-–—)](?:\s+(.*)|)$/;

function matchSpeakerPrefix(
  line: string,
): { speaker: Speaker; rest: string } | null {
  const m = PREFIX_COLON.exec(line) ?? PREFIX_OTHER.exec(line);
  if (!m) return null;
  const speaker: Speaker = (m[1] ?? "A").toUpperCase() === "B" ? "B" : "A";
  return { speaker, rest: (m[2] ?? "").trim() };
}

interface RawEntry {
  text: string;
  explicit: Speaker | null;
  breakBefore: boolean;
}

/**
 * Parse a raw script into a `ScriptModel`.
 *
 * - Handles `\n`, `\r\n`, `\r` newlines; blank lines mark paragraph breaks.
 * - Speaker prefixes: `A:`, `B:`, `A)`, `B-` (case-insensitive). A prefix with no text on its line
 *   ("A:") assigns the speaker of the next unprefixed line.
 * - Every word gets a stable `globalIndex` (whitespace-delimited tokens, in reading order).
 * - Input is bounded by `maxChars` / `maxWords`; `truncated` tells the UI when it was cut.
 */
export function parseScript(
  raw: string,
  options: ParseScriptOptions = {},
): ScriptModel {
  const lang = options.lang ?? DEFAULT_LANG;
  const mode = options.speakers ?? "auto";
  const maxChars = Math.max(0, options.maxChars ?? MAX_SCRIPT_CHARS);
  const maxWords = Math.max(0, options.maxWords ?? MAX_SCRIPT_WORDS);

  let truncated = false;
  let input = typeof raw === "string" ? raw : "";
  if (input.length > maxChars) {
    input = input.slice(0, maxChars);
    truncated = true;
  }
  input = input.replace(JUNK_CHARS, "");

  // Pass 1: split into non-empty entries, detect explicit speakers and paragraph breaks.
  const entries: RawEntry[] = [];
  let pendingBreak = false;
  let pendingSpeaker: Speaker | null = null;
  let sawExplicit = false;
  for (const rawLine of input.split(LINE_BREAKS)) {
    const t = rawLine.trim();
    if (!t) {
      pendingBreak = true;
      continue;
    }
    const prefix = mode === "none" ? null : matchSpeakerPrefix(t);
    if (prefix) {
      sawExplicit = true;
      if (!prefix.rest) {
        // Label-only line ("A:"): applies to the next unprefixed line.
        pendingSpeaker = prefix.speaker;
        pendingBreak = true;
        continue;
      }
      entries.push({
        text: prefix.rest,
        explicit: prefix.speaker,
        breakBefore: pendingBreak,
      });
    } else {
      entries.push({
        text: t,
        explicit: pendingSpeaker,
        breakBefore: pendingBreak,
      });
    }
    pendingSpeaker = null;
    pendingBreak = false;
  }

  const dialogue = mode === "alternate" || (mode === "auto" && sawExplicit);

  // Pass 2: assign speakers, tokenise.
  const lines: ScriptLine[] = [];
  const words: ScriptWord[] = [];
  let next: Speaker = "A";
  let paragraph = -1;
  for (const entry of entries) {
    if (words.length >= maxWords) {
      truncated = true;
      break;
    }
    let tokens = entry.text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const room = maxWords - words.length;
    if (tokens.length > room) {
      tokens = tokens.slice(0, room);
      truncated = true;
    }

    const startsParagraph = paragraph < 0 || entry.breakBefore;
    if (startsParagraph) paragraph++;

    let speaker: Speaker | undefined;
    if (dialogue) {
      speaker = entry.explicit ?? next;
      next = speaker === "A" ? "B" : "A";
    }

    const first = words.length;
    const lineWords: ScriptWord[] = tokens.map((w, i) => ({
      w,
      norm: normalizeWord(w, lang),
      globalIndex: first + i,
    }));
    for (const word of lineWords) words.push(word);

    const line: ScriptLine = {
      index: lines.length,
      text: tokens.join(" "),
      words: lineWords,
      firstWord: first,
      lastWord: first + lineWords.length - 1,
      paragraph,
      paragraphStart: startsParagraph,
    };
    if (speaker !== undefined) line.speaker = speaker;
    lines.push(line);

    if (truncated && words.length >= maxWords) break;
  }

  return {
    lines,
    words,
    wordCount: words.length,
    lang,
    dialogue: dialogue && lines.length > 0,
    truncated,
  };
}

/** Index in `model.lines` of the line that contains `wordIndex` (clamped); -1 for empty scripts. */
export function lineIndexForWord(
  model: ScriptModel,
  wordIndex: number,
): number {
  const n = model.lines.length;
  if (n === 0) return -1;
  if (!Number.isFinite(wordIndex) || wordIndex <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const line = model.lines[mid];
    if (line && line.firstWord <= wordIndex) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Overall reading progress 0..1 for a word index (0 for empty/one-word scripts). */
export function scriptProgress(model: ScriptModel, wordIndex: number): number {
  if (model.wordCount <= 1 || !Number.isFinite(wordIndex)) return 0;
  return Math.min(1, Math.max(0, wordIndex / (model.wordCount - 1)));
}

/* ------------------------------------------------------------------ */
/* Speed <-> WPM                                                       */
/* ------------------------------------------------------------------ */

/** Average glyph advance of proportional prose text, in em (typical sans-serif: 0.5-0.55). */
export const AVG_CHAR_WIDTH_EM = 0.52;
/** Average characters per word including the trailing space (Turkish ~6.8, English ~5.9). */
export const AVG_CHARS_PER_WORD = 6.4;

function positive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/**
 * Estimated number of words that fit on one prompter line.
 * `fontSize` and `containerWidth` must be in the same unit (CSS px). Never below 1.
 */
export function estimateWordsPerLine(
  fontSize: number,
  containerWidth: number,
): number {
  if (!positive(fontSize) || !positive(containerWidth)) return 0;
  const charsPerLine = containerWidth / (fontSize * AVG_CHAR_WIDTH_EM);
  return Math.max(1, charsPerLine / AVG_CHARS_PER_WORD);
}

function resolveWordsPerLine(
  fontSize: number,
  containerWidth: number,
  avgWordsPerLine?: number,
): number {
  if (avgWordsPerLine !== undefined && positive(avgWordsPerLine))
    return avgWordsPerLine;
  return estimateWordsPerLine(fontSize, containerWidth);
}

/**
 * Convert a scroll speed to an approximate reading speed in words per minute.
 *
 *   linesPerSecond = speedPx / (fontSize * lineHeight)
 *   WPM            = linesPerSecond * wordsPerLine * 60
 *
 * `wordsPerLine` is `avgWordsPerLine` when given (measure it from the real script for accuracy),
 * otherwise estimated from `fontSize` and `containerWidth` (see `estimateWordsPerLine`).
 * Returns 0 for any non-finite / non-positive input.
 *
 * @param speedPx scroll speed in px per second
 * @param lineHeight unitless multiplier (1.4 = 140% of fontSize)
 */
export function estimateWpm(
  speedPx: number,
  fontSize: number,
  lineHeight: number,
  containerWidth: number,
  avgWordsPerLine?: number,
): number {
  if (!positive(speedPx) || !positive(fontSize) || !positive(lineHeight))
    return 0;
  const wpl = resolveWordsPerLine(fontSize, containerWidth, avgWordsPerLine);
  if (wpl <= 0) return 0;
  return (speedPx / (fontSize * lineHeight)) * wpl * 60;
}

/**
 * Inverse of `estimateWpm`: the scroll speed (px/s) that yields `wpm` words per minute.
 * Not clamped; `PrompterEngine.setSpeed` clamps to its own 0..600 range.
 */
export function speedForWpm(
  wpm: number,
  fontSize: number,
  lineHeight: number,
  containerWidth: number,
  avgWordsPerLine?: number,
): number {
  if (!positive(wpm) || !positive(fontSize) || !positive(lineHeight)) return 0;
  const wpl = resolveWordsPerLine(fontSize, containerWidth, avgWordsPerLine);
  if (wpl <= 0) return 0;
  return (wpm / 60 / wpl) * fontSize * lineHeight;
}
