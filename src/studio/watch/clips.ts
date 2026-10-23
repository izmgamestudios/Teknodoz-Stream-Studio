// src/studio/watch/clips.ts
// Cut-and-join timeline: an ordered list of clips (ranges of library videos). Pure helpers so the
// editor UI stays thin and the rules are unit tested.
export interface Clip {
  /** stable key for React lists */
  key: number;
  mediaId: string;
  startMs: number;
  endMs: number;
}

export const MIN_CLIP_MS = 40;
export const MAX_CLIPS = 120;

let nextKey = 1;

export function makeClip(
  mediaId: string,
  startMs: number,
  endMs: number,
): Clip {
  return { key: nextKey++, mediaId, startMs, endMs };
}

export const clipLength = (c: Clip): number => c.endMs - c.startMs;

export const totalMs = (clips: readonly Clip[]): number =>
  clips.reduce((n, c) => n + clipLength(c), 0);

/** Adds a clip at the end; ignored when it is too short or the list is full. */
export function appendClip(clips: readonly Clip[], clip: Clip): Clip[] {
  if (clipLength(clip) < MIN_CLIP_MS || clips.length >= MAX_CLIPS)
    return [...clips];
  return [...clips, clip];
}

export function removeClip(clips: readonly Clip[], key: number): Clip[] {
  return clips.filter((c) => c.key !== key);
}

export function moveClip(
  clips: readonly Clip[],
  key: number,
  by: -1 | 1,
): Clip[] {
  const i = clips.findIndex((c) => c.key === key);
  const j = i + by;
  if (i < 0 || j < 0 || j >= clips.length) return [...clips];
  const out = [...clips];
  [out[i], out[j]] = [out[j] as Clip, out[i] as Clip];
  return out;
}

/** Changes one end of a clip, keeping at least MIN_CLIP_MS and the source bounds. */
export function trimClip(
  clips: readonly Clip[],
  key: number,
  edge: "start" | "end",
  ms: number,
  sourceMs: number | null,
): Clip[] {
  return clips.map((c) => {
    if (c.key !== key) return c;
    if (edge === "start")
      return {
        ...c,
        startMs: Math.max(0, Math.min(Math.round(ms), c.endMs - MIN_CLIP_MS)),
      };
    const cap = sourceMs ?? Number.POSITIVE_INFINITY;
    return {
      ...c,
      endMs: Math.min(cap, Math.max(Math.round(ms), c.startMs + MIN_CLIP_MS)),
    };
  });
}

/** Splits the clip that contains `ms` of its own source at that point (a razor cut). */
export function splitClipAt(
  clips: readonly Clip[],
  key: number,
  ms: number,
): Clip[] {
  const c = clips.find((x) => x.key === key);
  if (
    !c ||
    ms - c.startMs < MIN_CLIP_MS ||
    c.endMs - ms < MIN_CLIP_MS ||
    clips.length >= MAX_CLIPS
  )
    return [...clips];
  const a = makeClip(c.mediaId, c.startMs, ms);
  const b = makeClip(c.mediaId, ms, c.endMs);
  return clips.flatMap((x) => (x.key === key ? [a, b] : [x]));
}

/** Position of each clip on the joined timeline. */
export function layout(clips: readonly Clip[]): { clip: Clip; atMs: number }[] {
  let at = 0;
  return clips.map((clip) => {
    const row = { clip, atMs: at };
    at += clipLength(clip);
    return row;
  });
}

/** Wire format for the edit API. */
export function toSpecClips(
  clips: readonly Clip[],
  mainId: string,
): { mediaId?: string; startMs: number; endMs: number }[] {
  return clips.map((c) => ({
    ...(c.mediaId === mainId ? {} : { mediaId: c.mediaId }),
    startMs: Math.round(c.startMs),
    endMs: Math.round(c.endMs),
  }));
}
