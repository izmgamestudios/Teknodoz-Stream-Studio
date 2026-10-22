// src/studio/watch/progress.ts
// "Continue watching": where this device stopped in each video / podcast (localStorage only, the
// server never sees it).
const KEY = "studio.watch.progress.v1";
const MAX_ENTRIES = 100;
/** Under this many seconds in, or within this many seconds of the end, there is nothing to resume. */
export const RESUME_MIN_S = 5;
export const RESUME_END_S = 10;

export interface Progress {
  /** seconds watched */
  t: number;
  /** total seconds */
  d: number;
  /** when it was saved (ms) */
  at: number;
}

export type ProgressMap = Record<string, Progress>;

function read(): ProgressMap {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    const out: ProgressMap = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      const p = v as Partial<Progress> | null;
      if (
        p &&
        Number.isFinite(p.t) &&
        Number.isFinite(p.d) &&
        Number.isFinite(p.at)
      )
        out[id] = { t: p.t as number, d: p.d as number, at: p.at as number };
    }
    return out;
  } catch {
    return {};
  }
}

function write(map: ProgressMap): void {
  const entries = Object.entries(map)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
    window.dispatchEvent(new Event("studio-watch-progress"));
  } catch {
    /* private mode: progress just is not remembered */
  }
}

export function allProgress(): ProgressMap {
  return read();
}

export function getProgress(id: string): Progress | null {
  return read()[id] ?? null;
}

export function saveProgress(
  id: string,
  t: number,
  d: number,
  now = Date.now(),
): void {
  if (!Number.isFinite(t) || !Number.isFinite(d) || d <= 0) return;
  const map = read();
  // finished (or hardly started): forget it instead of offering to resume
  if (t < RESUME_MIN_S || t > d - RESUME_END_S) delete map[id];
  else map[id] = { t: Math.floor(t), d: Math.floor(d), at: now };
  write(map);
}

export function clearProgress(id: string): void {
  const map = read();
  if (id in map) {
    delete map[id];
    write(map);
  }
}

/** Fraction 0..1 watched, or null when there is nothing to resume. */
export function fractionOf(p: Progress | null | undefined): number | null {
  return p && p.d > 0 ? Math.min(1, p.t / p.d) : null;
}
