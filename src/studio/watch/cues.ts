// src/studio/watch/cues.ts
// Subtitle cues: parse WebVTT (or SRT) into editable cues, edit them (split, merge, shift,
// replace) and write clean WebVTT back. Pure, so it is unit tested without a browser.
import { formatClock, parseClock } from "./timecode";

export interface Cue {
  /** stable key for React lists */
  id: number;
  startMs: number;
  endMs: number;
  /** may contain several lines separated by "\n" */
  text: string;
}

let nextId = 1;
const newId = () => nextId++;

const TIMING =
  /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3})/;

export function parseCues(input: string): Cue[] {
  const lines = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const cues: Cue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = TIMING.exec(lines[i] as string);
    if (!m) continue;
    const start = parseClock(m[1] as string);
    const end = parseClock(m[2] as string);
    if (start === null || end === null) continue;
    const text: string[] = [];
    for (i++; i < lines.length && (lines[i] as string).trim() !== ""; i++) {
      if (TIMING.test(lines[i] as string)) {
        i--; // a cue without a blank line before the next one
        break;
      }
      text.push(lines[i] as string);
    }
    // a numeric SRT id may have been captured as the last text line of the previous cue
    const prev = cues[cues.length - 1];
    if (prev && /\n\d+$/.test(prev.text) && text.length >= 0)
      prev.text = prev.text.replace(/\n\d+$/, "");
    cues.push({
      id: newId(),
      startMs: start,
      endMs: end,
      text: text.join("\n"),
    });
  }
  return cues;
}

export function serializeCues(cues: readonly Cue[]): string {
  const body = [...cues]
    .sort((a, b) => a.startMs - b.startMs)
    .filter((c) => c.text.trim() !== "")
    .map(
      (c) =>
        `${formatClock(c.startMs, true)} --> ${formatClock(c.endMs, true)}\n${c.text.trim()}`,
    )
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

/** Splits a cue at `atMs`; the text is divided at the word nearest to the proportional position. */
export function splitCue(
  cues: readonly Cue[],
  id: number,
  atMs: number,
): Cue[] {
  const c = cues.find((x) => x.id === id);
  if (!c || atMs <= c.startMs + 100 || atMs >= c.endMs - 100) return [...cues];
  const words = c.text.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
  const ratio = (atMs - c.startMs) / (c.endMs - c.startMs);
  const cut = Math.min(
    words.length,
    Math.max(words.length > 1 ? 1 : 0, Math.round(words.length * ratio)),
  );
  const a: Cue = {
    id: newId(),
    startMs: c.startMs,
    endMs: atMs,
    text: words.slice(0, cut).join(" "),
  };
  const b: Cue = {
    id: newId(),
    startMs: atMs,
    endMs: c.endMs,
    text: words.slice(cut).join(" "),
  };
  return cues.flatMap((x) => (x.id === id ? [a, b] : [x]));
}

/** Joins a cue with the next one (text on two lines when it fits, else one line). */
export function mergeWithNext(cues: readonly Cue[], id: number): Cue[] {
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
  const i = sorted.findIndex((c) => c.id === id);
  const a = sorted[i];
  const b = sorted[i + 1];
  if (!a || !b) return sorted;
  const merged: Cue = {
    id: newId(),
    startMs: a.startMs,
    endMs: Math.max(a.endMs, b.endMs),
    text: `${a.text.trim()} ${b.text.trim()}`.trim(),
  };
  return [...sorted.slice(0, i), merged, ...sorted.slice(i + 2)];
}

export function addCue(
  cues: readonly Cue[],
  atMs: number,
  lengthMs = 2000,
): Cue[] {
  return [
    ...cues,
    {
      id: newId(),
      startMs: Math.max(0, atMs),
      endMs: Math.max(0, atMs) + lengthMs,
      text: "",
    },
  ].sort((a, b) => a.startMs - b.startMs);
}

/** Shifts every cue (or only those starting at/after `fromMs`); cues pushed below 0 are clamped. */
export function shiftCues(
  cues: readonly Cue[],
  offsetMs: number,
  fromMs = 0,
): Cue[] {
  return cues.map((c) =>
    c.startMs >= fromMs
      ? {
          ...c,
          startMs: Math.max(0, c.startMs + offsetMs),
          endMs: Math.max(0, c.endMs + offsetMs),
        }
      : c,
  );
}

export function replaceInCues(
  cues: readonly Cue[],
  find: string,
  replacement: string,
  caseSensitive = false,
): { cues: Cue[]; count: number } {
  if (find === "") return { cues: [...cues], count: 0 };
  let count = 0;
  const esc = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(esc, caseSensitive ? "g" : "gi");
  const out = cues.map((c) => {
    const text = c.text.replace(re, () => {
      count++;
      return replacement;
    });
    return text === c.text ? c : { ...c, text };
  });
  return { cues: out, count };
}

export type CueIssue =
  | "overlap"
  | "too-short"
  | "too-long"
  | "reading-speed"
  | "line-length"
  | "empty"
  | "reversed";

export const LIMITS = {
  minMs: 500,
  maxMs: 7000,
  maxCps: 20,
  maxLine: 42,
} as const;

/** Reading-speed and layout problems per cue id (what subtitle style guides check). */
export function checkCues(cues: readonly Cue[]): Map<number, CueIssue[]> {
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
  const out = new Map<number, CueIssue[]>();
  const add = (id: number, issue: CueIssue) =>
    out.set(id, [...(out.get(id) ?? []), issue]);
  sorted.forEach((c, i) => {
    const dur = c.endMs - c.startMs;
    if (dur <= 0) add(c.id, "reversed");
    else {
      if (dur < LIMITS.minMs) add(c.id, "too-short");
      if (dur > LIMITS.maxMs) add(c.id, "too-long");
      const chars = c.text.replace(/\s+/g, " ").trim().length;
      if (chars / (dur / 1000) > LIMITS.maxCps) add(c.id, "reading-speed");
    }
    if (c.text.trim() === "") add(c.id, "empty");
    if (c.text.split("\n").some((l) => l.length > LIMITS.maxLine))
      add(c.id, "line-length");
    const next = sorted[i + 1];
    if (next && c.endMs > next.startMs) {
      add(c.id, "overlap");
    }
  });
  return out;
}

/** Index of the cue showing at `ms`, or -1. */
export function activeCue(cues: readonly Cue[], ms: number): number {
  return cues.findIndex((c) => ms >= c.startMs && ms < c.endMs);
}
