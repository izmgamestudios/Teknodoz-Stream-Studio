// src/shared/media-analysis.ts
// Audio analysis of a library item: loudness (EBU R128), peak, and the pauses. The server
// measures with ffmpeg (`ebur128` + `silencedetect`) and stores the result on the record; this
// module parses ffmpeg's report, turns the numbers into plain advice, and builds the "cut the
// long pauses" clip list used by the podcast editing tools. Pure, shared by server and browser.

export interface Silence {
  startMs: number;
  endMs: number;
}

export interface MediaAnalysis {
  measuredAt: string;
  /** integrated loudness, LUFS (null when the file has no measurable audio) */
  integratedLufs: number | null;
  /** loudness range, LU */
  loudnessRangeLu: number | null;
  /** true peak, dBFS */
  truePeakDb: number | null;
  /** pauses at least `MIN_SILENCE_MS` long, quieter than `SILENCE_DB` */
  silences: Silence[];
  silenceMs: number;
  longestSilenceMs: number;
  /** share of the duration that is not a pause, 0..1 */
  speechRatio: number;
  durationMs: number;
}

export const SILENCE_DB = -45;
export const MIN_SILENCE_MS = 800;
export const MAX_SILENCES = 400;

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** The last summary block of `ebur128` (earlier lines are per-frame logs). */
export function parseLoudness(report: string): {
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDb: number | null;
} {
  const last = (re: RegExp): string | undefined => {
    let m: RegExpExecArray | null;
    let v: string | undefined;
    const g = new RegExp(re.source, "g");
    while ((m = g.exec(report))) v = m[1];
    return v;
  };
  const lufs = num(last(/\bI:\s+(-?\d+(?:\.\d+)?)\s+LUFS/));
  return {
    // ffmpeg prints -70.0 for "nothing measurable"
    integratedLufs: lufs !== null && lufs > -69.9 ? lufs : null,
    loudnessRangeLu: num(last(/\bLRA:\s+(-?\d+(?:\.\d+)?)\s+LU\b/)),
    truePeakDb: ((): number | null => {
      const v = num(last(/\bPeak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/));
      return v !== null && v > -120 ? v : null;
    })(),
  };
}

/** `silencedetect` lines -> pauses (a pause still open at the end runs to the end). */
export function parseSilences(report: string, durationMs: number): Silence[] {
  const out: Silence[] = [];
  let open: number | null = null;
  for (const line of report.split("\n")) {
    const s = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (s) {
      open = Math.max(0, Math.round((num(s[1]) ?? 0) * 1000));
      continue;
    }
    const e = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (e && open !== null) {
      const end = Math.round((num(e[1]) ?? 0) * 1000);
      if (end - open >= MIN_SILENCE_MS) out.push({ startMs: open, endMs: end });
      open = null;
    }
  }
  if (open !== null && durationMs - open >= MIN_SILENCE_MS)
    out.push({ startMs: open, endMs: durationMs });
  return out.slice(0, MAX_SILENCES);
}

export function buildAnalysis(
  report: string,
  durationMs: number,
  now: string,
): MediaAnalysis {
  const silences = parseSilences(report, durationMs);
  const silenceMs = silences.reduce((a, s) => a + (s.endMs - s.startMs), 0);
  return {
    measuredAt: now,
    ...parseLoudness(report),
    silences,
    silenceMs,
    longestSilenceMs: silences.reduce(
      (a, s) => Math.max(a, s.endMs - s.startMs),
      0,
    ),
    speechRatio: durationMs > 0 ? Math.max(0, 1 - silenceMs / durationMs) : 0,
    durationMs,
  };
}

export type Advice =
  "silent" | "quiet" | "loud" | "clipping" | "wide-range" | "pauses" | "ok";

/** Podcast target is about -16 LUFS with peaks below -1 dBFS. */
export function adviceFor(a: MediaAnalysis): Advice[] {
  if (a.integratedLufs === null) return ["silent"];
  const out: Advice[] = [];
  if (a.integratedLufs < -20) out.push("quiet");
  if (a.integratedLufs > -12) out.push("loud");
  if (a.truePeakDb !== null && a.truePeakDb > -1) out.push("clipping");
  if (a.loudnessRangeLu !== null && a.loudnessRangeLu > 14)
    out.push("wide-range");
  if (
    a.durationMs > 0 &&
    (a.silenceMs / a.durationMs > 0.12 || a.longestSilenceMs > 3000)
  )
    out.push("pauses");
  return out.length ? out : ["ok"];
}

/**
 * Clips that keep everything except the inside of long pauses: each pause of at least
 * `minSilenceMs` is shortened to `keepMs` (half before, half after the cut). Returns null when
 * nothing would be cut or the clip count would be unreasonable.
 */
export function shortenPauses(
  silences: readonly Silence[],
  durationMs: number,
  opts: { minSilenceMs?: number; keepMs?: number; maxClips?: number } = {},
): { startMs: number; endMs: number }[] | null {
  const min = opts.minSilenceMs ?? 1200;
  const keep = opts.keepMs ?? 400;
  const maxClips = opts.maxClips ?? 120;
  const cuts = silences
    .filter((s) => s.endMs - s.startMs >= Math.max(min, keep + 200))
    .map((s) => ({ from: s.startMs + keep / 2, to: s.endMs - keep / 2 }));
  if (cuts.length === 0 || cuts.length + 1 > maxClips) return null;
  const clips: { startMs: number; endMs: number }[] = [];
  let at = 0;
  for (const c of cuts) {
    if (c.from - at >= 40)
      clips.push({ startMs: Math.round(at), endMs: Math.round(c.from) });
    at = c.to;
  }
  if (durationMs - at >= 40)
    clips.push({ startMs: Math.round(at), endMs: durationMs });
  return clips.length ? clips : null;
}
