// src/shared/auto-chapters.ts
// Automatic chapters for a spoken recording (podcast): a new chapter starts at a natural pause in
// the speech, never closer than `minLenMs` to the previous one, and is named after the first
// words that are said there. Works on the subtitle cues (gaps between cues are the pauses), so it
// needs no audio analysis. Pure: shared by the browser and tests.

export interface CueLike {
  startMs: number;
  endMs: number;
  text: string;
}

export interface AutoChapter {
  t: number;
  label: string;
}

export interface ChapterOptions {
  /** shortest chapter, ms (default 2.5 min) */
  minLenMs?: number;
  /** a chapter is cut at the best pause once it grows past this (default 8 min) */
  maxLenMs?: number;
  /** a gap between cues this long (ms) counts as a pause (default 1.2 s) */
  pauseMs?: number;
  /** words used for the title (default 7) */
  words?: number;
  /** title of the first chapter */
  firstLabel?: string;
}

const clean = (s: string): string =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "merhaba arkadaşlar bugün çok önemli bir konuyu" -> "Merhaba arkadaşlar bugün çok önemli bir…" */
export function titleFrom(text: string, words = 7): string {
  const w = clean(text).split(" ").filter(Boolean);
  if (w.length === 0) return "";
  const head = w
    .slice(0, words)
    .join(" ")
    .replace(/[,.;:!?-]+$/, "");
  const t = head.charAt(0).toLocaleUpperCase("tr") + head.slice(1);
  return w.length > words ? `${t}…` : t;
}

export function chaptersFromCues(
  cues: readonly CueLike[],
  durationMs: number,
  opts: ChapterOptions = {},
): AutoChapter[] {
  const minLen = opts.minLenMs ?? 150_000;
  const maxLen = opts.maxLenMs ?? 480_000;
  const pause = opts.pauseMs ?? 1200;
  const words = opts.words ?? 7;
  const sorted = [...cues]
    .filter((c) => clean(c.text) !== "")
    .sort((a, b) => a.startMs - b.startMs);
  if (sorted.length === 0) return [];

  // candidate boundaries: the cue that follows a pause, with the size of that pause
  const cand: { at: number; idx: number; gap: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap =
      (sorted[i] as CueLike).startMs - (sorted[i - 1] as CueLike).endMs;
    if (gap >= pause)
      cand.push({ at: (sorted[i] as CueLike).startMs, idx: i, gap });
  }

  const first = sorted[0] as CueLike;
  const out: AutoChapter[] = [
    {
      t: 0,
      label: opts.firstLabel ?? (titleFrom(first.text, words) || "Başlangıç"),
    },
  ];
  let last = 0;
  let pool: typeof cand = [];
  const flush = (cut: (typeof cand)[number]) => {
    out.push({
      t: cut.at,
      label: titleFrom((sorted[cut.idx] as CueLike).text, words),
    });
    last = cut.at;
    pool = [];
  };
  for (const c of cand) {
    if (c.at - last < minLen) continue;
    pool.push(c);
    // far enough from the last chapter: cut at the longest pause seen since minLen
    if (c.at - last >= maxLen) {
      const best = pool.reduce((a, b) => (b.gap > a.gap ? b : a));
      flush(best);
    }
  }
  // a final pass: pauses that never reached maxLen still split long stretches
  while (pool.length > 0 && (durationMs || Infinity) - last >= minLen * 2) {
    const best = pool.reduce((a, b) => (b.gap > a.gap ? b : a));
    if (best.at - last < minLen || durationMs - best.at < minLen) break;
    flush(best);
  }
  return out.filter((c, i) => i === 0 || c.label !== "");
}

/** Merge generated chapters with the ones the director set by hand (hand-made keep their place). */
export function mergeChapters(
  manual: readonly AutoChapter[],
  auto: readonly AutoChapter[],
  nearMs = 20_000,
): AutoChapter[] {
  const out = [...manual];
  for (const a of auto)
    if (!manual.some((m) => Math.abs(m.t - a.t) < nearMs)) out.push(a);
  return out.sort((x, y) => x.t - y.t).slice(0, 200);
}
