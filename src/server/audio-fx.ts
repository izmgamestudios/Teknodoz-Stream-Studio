// src/server/audio-fx.ts
// Audio treatment for the library editor, as pure ffmpeg filter-graph builders: voice clean-up
// (rumble / hum removal, noise reduction, gate, compressor), gain, and a small mixer that lays
// extra library tracks (music, voice-over) under or over the main audio, optionally ducked
// while the main audio speaks. Everything here is string building, so it is unit tested without
// ffmpeg; the end-to-end test runs the real filters.
import { z } from "zod";

const hex16 = z.string().regex(/^[a-f0-9]{16}$/);

export const trackSchema = z.object({
  /** library video or audio whose sound is mixed in */
  mediaId: hex16,
  startMs: z.number().int().min(0).max(86_400_000).default(0),
  volumeDb: z.number().min(-40).max(10).default(-12),
  loop: z.boolean().default(false),
  /** lower this track while the main audio is loud (music under speech) */
  duck: z.boolean().default(false),
  fadeMs: z.number().int().min(0).max(5000).default(0),
});
export type TrackSpec = z.infer<typeof trackSchema>;

export const audioSchema = z.object({
  /** one-click speech clean-up: rumble filter, mild denoise, presence, gentle compression */
  voice: z.boolean().default(false),
  /** 0 off · 1 light · 2 medium · 3 strong spectral noise reduction */
  denoise: z.number().int().min(0).max(3).default(0),
  /** remove everything below this frequency (0 = off) */
  highpassHz: z
    .number()
    .int()
    .refine((n) => n === 0 || (n >= 40 && n <= 400), "range")
    .default(0),
  /** mains hum: notch at the frequency and its first harmonics */
  humHz: z
    .number()
    .int()
    .refine((n) => n === 0 || n === 50 || n === 60, "hum")
    .default(0),
  /** mute the low-level background between words */
  gate: z.boolean().default(false),
  compress: z.boolean().default(false),
  volumeDb: z.number().min(-30).max(20).default(0),
  tracks: z.array(trackSchema).max(4).default([]),
});
export type AudioSpec = z.infer<typeof audioSchema>;

const DENOISE_NR = [0, 10, 18, 28] as const;
const db = (n: number): string => `${Math.round(n * 10) / 10}dB`;
const sec = (ms: number): string => (ms / 1000).toFixed(3);

/** True when the spec changes the sound at all. */
export function hasAudioWork(a: AudioSpec | undefined): a is AudioSpec {
  return (
    !!a &&
    (a.voice ||
      a.denoise > 0 ||
      a.highpassHz > 0 ||
      a.humHz > 0 ||
      a.gate ||
      a.compress ||
      a.volumeDb !== 0 ||
      a.tracks.length > 0)
  );
}

/** Serial clean-up filters for the main audio, in the order that works best. */
export function cleanupChain(a: AudioSpec): string[] {
  const f: string[] = [];
  const hp = a.highpassHz > 0 ? a.highpassHz : a.voice ? 80 : 0;
  if (hp > 0) f.push(`highpass=f=${hp}`);
  if (a.humHz > 0)
    for (const n of [1, 2, 3])
      f.push(`bandreject=f=${a.humHz * n}:width_type=q:w=30`);
  const nr = Math.max(DENOISE_NR[a.denoise] ?? 0, a.voice ? 14 : 0);
  if (nr > 0) f.push(`afftdn=nr=${nr}:nf=-40:tn=1`);
  if (a.gate) f.push("agate=threshold=0.02:ratio=3:attack=10:release=250");
  if (a.voice) f.push("equalizer=f=3000:width_type=q:w=1:g=2.5");
  if (a.voice || a.compress)
    f.push(
      "acompressor=threshold=0.125:ratio=3:attack=15:release=200:makeup=2",
    );
  if (a.volumeDb !== 0) f.push(`volume=${db(a.volumeDb)}`);
  return f;
}

export interface AudioGraphInput {
  /** label of the main audio entering the graph, e.g. "[ac]" */
  inLabel: string;
  audio: AudioSpec | undefined;
  /** ffmpeg input index of each `audio.tracks[k]`, same order */
  trackInputs: readonly number[];
  /** fades + loudness applied to the final mix */
  post: readonly string[];
  /** label of the result */
  outLabel: string;
  /** input chain for each track before it is mixed (format normalisation) */
  fmt: string;
}

/** The audio half of a filter_complex: clean-up, mix tracks, then fades / loudness. */
export function audioGraph(g: AudioGraphInput): string[] {
  const out: string[] = [];
  const a = g.audio;
  const chain = a && hasAudioWork(a) ? cleanupChain(a) : [];
  const tracks = a?.tracks ?? [];
  const ducked = tracks.filter((t) => t.duck).length;
  const tail = g.post.length ? g.post.join(",") : "anull";

  if (tracks.length === 0) {
    out.push(
      `${g.inLabel}${[...chain, ...g.post].join(",") || "anull"}${g.outLabel}`,
    );
    return out;
  }

  // main (+ one sidechain copy per ducked track)
  const copies = 1 + ducked;
  const main = chain.length ? chain.join(",") : "anull";
  if (ducked > 0) {
    const labels = Array.from({ length: copies }, (_, k) => `[mx${k}]`).join(
      "",
    );
    out.push(`${g.inLabel}${main},asplit=${copies}${labels}`);
  } else {
    out.push(`${g.inLabel}${main}[mx0]`);
  }

  let sc = 1;
  const mixed: string[] = ["[mx0]"];
  tracks.forEach((t, k) => {
    const input = g.trackInputs[k] ?? 0;
    const f: string[] = [g.fmt];
    if (t.fadeMs > 0) f.push(`afade=t=in:st=0:d=${sec(t.fadeMs)}`);
    f.push(`volume=${db(t.volumeDb)}`);
    if (t.startMs > 0) f.push(`adelay=${Math.round(t.startMs)}:all=1`);
    const dry = `[tk${k}]`;
    out.push(`[${input}:a:0]${f.join(",")}${dry}`);
    if (t.duck) {
      const wet = `[td${k}]`;
      out.push(
        `${dry}[mx${sc++}]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=500${wet}`,
      );
      mixed.push(wet);
    } else mixed.push(dry);
  });
  out.push(
    `${mixed.join("")}amix=inputs=${mixed.length}:duration=first:normalize=0:dropout_transition=0,${tail}${g.outLabel}`,
  );
  return out;
}
