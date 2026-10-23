// src/server/media-edit.ts
// Server-side editing of library media with ffmpeg + automatic subtitles with Whisper.
//
//   GET    /api/media/capabilities          what this server can do (ffmpeg filters, whisper)
//   POST   /api/media/asset                 PNG title card / image (<= 2 MB) -> hidden image record
//   POST   /api/media/:id/edit              { spec } trim, intro / outro (title card or library video),
//                                           fade, loudness normalisation, burned-in captions -> job
//   POST   /api/media/:id/subtitles         { lang } transcribe with Whisper -> job -> <id>.<lang>.vtt
//   PUT    /api/media/:id/captions/:lang    WebVTT / SRT text (manual edit or upload)
//   DELETE /api/media/:id/captions/:lang
//   GET    /api/media/jobs/:jobId           { status, progress, resultId?, error? }
//   DELETE /api/media/jobs/:jobId           cancel
//
// Everything runs as an argument list (no shell); file names are always <16 hex>.<ext> built by the
// server; title cards are rendered by the browser (canvas) so no text ever reaches an ffmpeg filter.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { StoreUnavailableError } from "./catalog";
import {
  buildAnalysis,
  MIN_SILENCE_MS,
  SILENCE_DB,
} from "../shared/media-analysis";
import { audioGraph, audioSchema, hasAudioWork } from "./audio-fx";
import { ffmpegCapabilities, ffmpegPoster, type FfmpegCaps } from "./ffmpeg";
import {
  downloadDisposition,
  mediaIdOk,
  mediaTokenOk,
  MEDIA_API_PREFIX,
  type Chapter,
  type MediaApi,
  type MediaRecord,
  type Prober,
} from "./media";
import { normalizeVtt } from "./vtt";
import { runWhisper, whisperAvailable, type WhisperConfig } from "./whisper";

/* ------------------------------ edit spec ------------------------------ */

const hex16 = z.string().regex(/^[a-f0-9]{16}$/);
const segmentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("card"),
    assetId: hex16,
    seconds: z.number().min(1).max(10),
  }),
  z.object({ kind: z.literal("media"), mediaId: hex16 }),
]);

export const editSpecSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  trim: z
    .object({
      startMs: z.number().int().min(0).max(86_400_000),
      endMs: z.number().int().min(1).max(86_400_000),
    })
    .refine((t) => t.endMs - t.startMs >= 500, "too-short")
    .optional(),
  /** cut-and-join: ordered clips (from this or other library videos); supersedes `trim` */
  clips: z
    .array(
      z
        .object({
          mediaId: hex16.optional(),
          startMs: z.number().int().min(0).max(86_400_000),
          endMs: z.number().int().min(1).max(86_400_000),
        })
        .refine((c) => c.endMs - c.startMs >= 40, "too-short"),
    )
    .min(1)
    .max(120)
    .optional(),
  intro: segmentSchema.optional(),
  outro: segmentSchema.optional(),
  /** voice clean-up, gain and extra tracks (see audio-fx.ts) */
  audio: audioSchema.optional(),
  /** render only a short stretch to listen to the effects; the result is temporary */
  preview: z
    .object({
      startMs: z.number().int().min(0).max(86_400_000),
      lengthMs: z.number().int().min(1000).max(30_000),
    })
    .optional(),
  fadeMs: z.number().int().min(0).max(3000).default(0),
  normalize: z.boolean().default(false),
  /** burn the captions of this language into the picture */
  burnLang: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/)
    .optional(),
});
export type EditSpec = z.infer<typeof editSpecSchema>;

export interface ResolvedSegment {
  kind: "card" | "media";
  /** file name inside the media dir */
  file: string;
  /** known length in ms (cards: seconds * 1000) */
  durationMs: number | null;
  hasAudio: boolean;
}

export interface ResolvedClip {
  file: string;
  startMs: number;
  endMs: number;
  hasAudio: boolean;
}

export interface ResolvedTrack {
  file: string;
  loop: boolean;
}

export interface PlanInput {
  main: MediaRecord;
  spec: EditSpec;
  /** resolved `spec.clips` (same order) */
  clips?: ResolvedClip[];
  /** resolved `spec.audio.tracks` (same order) */
  tracks?: ResolvedTrack[];
  intro?: ResolvedSegment;
  outro?: ResolvedSegment;
  /** file name (relative to the media dir) of the VTT to burn in, when requested */
  burnFile?: string;
  caps: Pick<FfmpegCaps, "subtitles" | "loudnorm">;
  /** output path written by ffmpeg */
  out: string;
}

export interface EditPlan {
  args: string[];
  /** length of the result, for progress (null = unknown) */
  expectedMs: number | null;
  ext: "mp4" | "m4a";
  mime: "video/mp4" | "audio/mp4";
}

export class PlanError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);
const sec = (ms: number): string => (ms / 1000).toFixed(3);
const AFMT = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";

/** Input arguments + indices for the mixer tracks, numbered from `first`. */
function trackInputs(
  i: PlanInput,
  first: number,
): { args: string[]; indices: number[] } {
  const want = i.spec.audio?.tracks.length ?? 0;
  if (want === 0) return { args: [], indices: [] };
  if (!i.tracks || i.tracks.length !== want)
    throw new PlanError("tracks-invalid");
  const args: string[] = [];
  const indices: number[] = [];
  i.tracks.forEach((t, k) => {
    if (t.loop) args.push("-stream_loop", "-1");
    args.push("-i", t.file);
    indices.push(first + k);
  });
  return { args, indices };
}

/** Pure: builds the ffmpeg argument list for an edit. */
export function planEdit(i: PlanInput): EditPlan {
  const { main, spec, caps } = i;
  if (spec.clips) {
    if (!i.clips || i.clips.length !== spec.clips.length)
      throw new PlanError("clips-invalid");
    if (spec.burnLang) throw new PlanError("clips-burn");
  }
  const clipMs = i.clips
    ? i.clips.reduce((n, c) => n + (c.endMs - c.startMs), 0)
    : null;
  const start = spec.trim?.startMs ?? 0;
  const known = main.durationMs;
  const end = spec.trim?.endMs ?? known;
  if (!spec.clips && known !== null && start >= known)
    throw new PlanError("trim-out-of-range");
  const mainMs =
    clipMs ?? (end !== null ? Math.min(end, known ?? end) - start : null);

  if (spec.normalize && !caps.loudnorm)
    throw new PlanError("loudnorm-unavailable");
  if (spec.burnLang && (!caps.subtitles || !i.burnFile))
    throw new PlanError("burn-unavailable");

  /* ------------------------------ audio only ------------------------------ */
  if (main.kind === "audio") {
    if (spec.intro || spec.outro || spec.burnLang)
      throw new PlanError("audio-only-trim");
    const f = spec.fadeMs;
    const post: string[] = [];
    if (f > 0 && mainMs !== null) {
      post.push(
        `afade=t=in:st=0:d=${sec(f)}`,
        `afade=t=out:st=${sec(Math.max(0, mainMs - f))}:d=${sec(f)}`,
      );
    }
    if (spec.normalize) post.push("loudnorm=I=-16:TP=-1.5:LRA=11");
    // cut-and-join (podcast: pauses removed, several recordings joined): one input per distinct
    // file, atrim per clip, concat; the main audio then enters the usual clean-up graph
    const clipFiles = i.clips ? [...new Set(i.clips.map((c) => c.file))] : [];
    const clipArgs = clipFiles.flatMap((f) => ["-i", f]);
    const tracks = trackInputs(i, i.clips ? clipFiles.length : 1);
    const work = hasAudioWork(spec.audio);
    const head = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostats",
      "-progress",
      "pipe:1",
      ...(i.clips ? [] : start > 0 ? ["-ss", sec(start)] : []),
      ...(i.clips
        ? []
        : mainMs !== null && spec.trim
          ? ["-t", sec(mainMs)]
          : []),
      ...(i.clips ? clipArgs : ["-i", main.file]),
      ...tracks.args,
    ];
    const tail = [
      "-vn",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-ar",
      "48000",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      i.out,
    ];
    const joined = i.clips
      ? [
          ...i.clips.map(
            (c, n) =>
              `[${clipFiles.indexOf(c.file)}:a:0]atrim=start=${sec(c.startMs)}:end=${sec(c.endMs)},asetpts=PTS-STARTPTS,${AFMT}[c${n}]`,
          ),
          `${i.clips.map((_, n) => `[c${n}]`).join("")}concat=n=${i.clips.length}:v=0:a=1[ac]`,
        ]
      : null;
    const graph =
      work || joined
        ? [
            ...(joined ?? [`[0:a:0]${AFMT}[ac]`]),
            ...audioGraph({
              inLabel: "[ac]",
              audio: spec.audio,
              trackInputs: tracks.indices,
              post,
              outLabel: "[af]",
              fmt: AFMT,
            }),
          ]
        : null;
    return {
      args: graph
        ? [...head, "-filter_complex", graph.join(";"), "-map", "[af]", ...tail]
        : [...head, ...(post.length ? ["-af", post.join(",")] : []), ...tail],
      expectedMs: mainMs,
      ext: "m4a",
      mime: "audio/mp4",
    };
  }

  /* -------------------------------- video -------------------------------- */
  const W = even(main.width ?? 1280);
  const H = even(main.height ?? 720);
  const burn = !!spec.burnLang;
  const trimmed = start > 0 || spec.trim !== undefined;
  const args: string[] = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostats",
    "-progress",
    "pipe:1",
  ];
  const filters: string[] = [];
  const labels: string[] = [];
  let idx = 0;
  let totalMs: number | null = mainMs;

  const vNorm = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p`;

  const silence = (ms: number | null): number => {
    if (ms === null) throw new PlanError("duration-unknown");
    args.push("-f", "lavfi", "-t", sec(ms), "-i", "anullsrc=r=48000:cl=stereo");
    return idx++;
  };

  const addSegment = (seg: ResolvedSegment): void => {
    const n = labels.length;
    if (seg.kind === "card") {
      args.push(
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        sec(seg.durationMs ?? 3000),
        "-i",
        seg.file,
      );
    } else {
      args.push("-i", seg.file);
    }
    const vi = idx++;
    filters.push(`[${vi}:v:0]${vNorm}[v${n}]`);
    if (seg.kind === "media" && seg.hasAudio) {
      filters.push(`[${vi}:a:0]${AFMT}[a${n}]`);
    } else {
      const ai = silence(seg.durationMs);
      filters.push(`[${ai}:a:0]${AFMT}[a${n}]`);
    }
    labels.push(`[v${n}][a${n}]`);
    if (totalMs !== null) totalMs += seg.durationMs ?? 0;
  };

  // intro first (inputs are numbered in the order they are added)
  if (i.intro) {
    if (totalMs !== null && i.intro.durationMs === null) totalMs = null;
    addSegment(i.intro);
  }

  // main (one segment, or one per clip)
  const addClip = (
    file: string,
    from: number,
    to: number | null,
    hasAudio: boolean,
    cut: boolean,
  ) => {
    const n = labels.length;
    const len = to !== null ? to - from : null;
    if (cut) {
      args.push("-ss", sec(from));
      if (len !== null) args.push("-t", sec(len));
    }
    args.push("-i", file);
    const vi = idx++;
    const pre = burn
      ? `subtitles=${i.burnFile}${trimmed ? `,trim=start=${sec(start)}${end !== null ? `:end=${sec(end)}` : ""},setpts=PTS-STARTPTS` : ""},`
      : "";
    filters.push(`[${vi}:v:0]${pre}${vNorm}[v${n}]`);
    if (!hasAudio) {
      // a silent file gets silence of the same length so the concat has an audio track
      const ai = silence(len);
      filters.push(`[${ai}:a:0]${AFMT}[a${n}]`);
    } else {
      filters.push(
        `[${vi}:a:0]${burn && trimmed ? `atrim=start=${sec(start)}${end !== null ? `:end=${sec(end)}` : ""},asetpts=PTS-STARTPTS,` : ""}${AFMT}[a${n}]`,
      );
    }
    labels.push(`[v${n}][a${n}]`);
  };
  if (i.clips) {
    for (const c of i.clips)
      addClip(c.file, c.startMs, c.endMs, c.hasAudio, true);
  } else {
    addClip(
      main.file,
      start,
      mainMs !== null ? start + mainMs : null,
      main.hasAudio !== false,
      trimmed && !burn,
    );
  }

  if (i.outro) {
    if (totalMs !== null && i.outro.durationMs === null) totalMs = null;
    addSegment(i.outro);
  }

  filters.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=1[vc][ac]`);

  const f = spec.fadeMs;
  const vPost: string[] = [];
  const aPost: string[] = [];
  const tr = trackInputs(i, idx);
  args.push(...tr.args);
  idx += tr.indices.length;
  if (f > 0 && totalMs !== null) {
    vPost.push(
      `fade=t=in:st=0:d=${sec(f)}`,
      `fade=t=out:st=${sec(Math.max(0, totalMs - f))}:d=${sec(f)}`,
    );
    aPost.push(
      `afade=t=in:st=0:d=${sec(f)}`,
      `afade=t=out:st=${sec(Math.max(0, totalMs - f))}:d=${sec(f)}`,
    );
  }
  if (spec.normalize) aPost.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  filters.push(`[vc]${vPost.length ? vPost.join(",") : "null"}[vf]`);
  filters.push(
    ...audioGraph({
      inLabel: "[ac]",
      audio: spec.audio,
      trackInputs: tr.indices,
      post: aPost,
      outLabel: "[af]",
      fmt: AFMT,
    }),
  );

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vf]",
    "-map",
    "[af]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    i.out,
  );
  return { args, expectedMs: totalMs, ext: "mp4", mime: "video/mp4" };
}

/** Chapters follow the cut: shifted by (intro length - trim start), dropped when outside it. */
export function remapChapters(
  chapters: readonly Chapter[],
  trimStartMs: number,
  trimEndMs: number | null,
  introMs: number,
): Chapter[] {
  return chapters
    .filter(
      (c) => c.t >= trimStartMs && (trimEndMs === null || c.t < trimEndMs),
    )
    .map((c) => ({ t: c.t - trimStartMs + introMs, label: c.label }));
}

/** Chapters of the main video that fall inside its clips, placed on the joined timeline. */
export function remapClipChapters(
  main: Pick<MediaRecord, "id" | "chapters">,
  specClips: readonly { mediaId?: string | undefined }[],
  clips: readonly { startMs: number; endMs: number }[],
  introMs: number,
): Chapter[] {
  const out: Chapter[] = [];
  let at = introMs;
  clips.forEach((c, k) => {
    const own =
      specClips[k]?.mediaId === undefined || specClips[k]?.mediaId === main.id;
    if (own)
      for (const ch of main.chapters)
        if (ch.t >= c.startMs && ch.t < c.endMs)
          out.push({ t: ch.t - c.startMs + at, label: ch.label });
    at += c.endMs - c.startMs;
  });
  return out;
}

/* ------------------------------- job runner ------------------------------- */

export type JobStatus = "queued" | "running" | "done" | "error";

export interface Job {
  id: string;
  type: "edit" | "subtitles";
  mediaId: string;
  status: JobStatus;
  progress: number;
  resultId: string | null;
  error: string | null;
  createdAt: number;
}

export interface EditApiOptions {
  token: string | null;
  media: MediaApi;
  ffmpegBin: string;
  probe?: Prober;
  whisper: WhisperConfig | null;
  now?: () => number;
  /** injected in tests to avoid spawning real processes */
  spawnImpl?: typeof spawn;
  caps?: FfmpegCaps;
}

const LANG_LABEL: Record<string, string> = {
  tr: "Türkçe",
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  pt: "Português",
  ru: "Русский",
  ar: "العربية",
  nl: "Nederlands",
  pl: "Polski",
  ja: "日本語",
  ko: "한국어",
  zh: "中文",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

export function createMediaEditApi(opts: EditApiOptions) {
  const now = opts.now ?? Date.now;
  const spawnFn = opts.spawnImpl ?? spawn;
  const jobs = new Map<string, Job>();
  const procs = new Map<string, { kill: () => void }>();
  const queue: (() => Promise<void>)[] = [];
  let running = false;
  let capsPromise: Promise<FfmpegCaps> | null = null;
  let whisperOk: Promise<boolean> | null = null;
  const caps = (): Promise<FfmpegCaps> =>
    opts.caps
      ? Promise.resolve(opts.caps)
      : (capsPromise ??= ffmpegCapabilities(opts.ffmpegBin));
  const whisperReady = (): Promise<boolean> =>
    opts.whisper
      ? (whisperOk ??= whisperAvailable(opts.whisper))
      : Promise.resolve(false);

  function newJob(type: Job["type"], mediaId: string): Job {
    const job: Job = {
      id: randomBytes(6).toString("hex"),
      type,
      mediaId,
      status: "queued",
      progress: 0,
      resultId: null,
      error: null,
      createdAt: now(),
    };
    jobs.set(job.id, job);
    // keep the list small: drop the oldest finished jobs
    if (jobs.size > 60)
      for (const [id, j] of jobs)
        if (j.status === "done" || j.status === "error") {
          jobs.delete(id);
          if (jobs.size <= 40) break;
        }
    return job;
  }

  function enqueue(job: Job, work: () => Promise<void>): void {
    queue.push(async () => {
      if (job.status === "error") return; // cancelled while queued
      job.status = "running";
      try {
        await work();
        job.status = "done";
        job.progress = 1;
      } catch (e) {
        job.status = "error";
        job.error =
          e instanceof PlanError
            ? e.code
            : e instanceof Error
              ? e.message.slice(0, 300)
              : "failed";
      } finally {
        procs.delete(job.id);
      }
    });
    void pump();
  }

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) await next();
    } finally {
      running = false;
    }
  }

  /** Runs ffmpeg with progress parsing; rejects with the stderr tail on failure. */
  function runFfmpeg(
    job: Job,
    args: string[],
    expectedMs: number | null,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child: ChildProcess = spawnFn(opts.ffmpegBin, args, {
        cwd: opts.media.dir,
        stdio: ["ignore", "pipe", "pipe"],
      });
      procs.set(job.id, { kill: () => child.kill("SIGKILL") });
      let err = "";
      child.stderr?.on(
        "data",
        (c: Buffer) => (err = (err + c.toString()).slice(-1500)),
      );
      child.stdout?.on("data", (c: Buffer) => {
        const m = [...c.toString().matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop();
        if (m && expectedMs)
          job.progress = Math.min(0.99, Number(m[1]) / 1000 / expectedMs);
      });
      child.on("error", (e) => reject(e));
      child.on("close", (code) => {
        if (job.status === "error") return reject(new Error("cancelled"));
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `ffmpeg failed: ${err.trim().split("\n").slice(-2).join(" ")}`,
            ),
          );
      });
    });
  }

  async function resolveSegment(
    seg: z.infer<typeof segmentSchema> | undefined,
  ): Promise<ResolvedSegment | undefined> {
    if (!seg) return undefined;
    if (seg.kind === "card") {
      const rec = await opts.media.find(seg.assetId);
      if (!rec || rec.kind !== "image") throw new PlanError("asset-missing");
      return {
        kind: "card",
        file: rec.file,
        durationMs: seg.seconds * 1000,
        hasAudio: false,
      };
    }
    const rec = await opts.media.find(seg.mediaId);
    if (!rec || rec.kind !== "video") throw new PlanError("segment-missing");
    return {
      kind: "media",
      file: rec.file,
      durationMs: rec.durationMs,
      hasAudio: true,
    };
  }

  /* ------------------------------ edit job ------------------------------ */

  function startEdit(main: MediaRecord, specIn: EditSpec): Job {
    // a preview is the audio treatment on a short stretch: no cards, joins or burn-in
    const spec: EditSpec = specIn.preview
      ? {
          ...specIn,
          trim: {
            startMs: specIn.preview.startMs,
            endMs: specIn.preview.startMs + specIn.preview.lengthMs,
          },
          fadeMs: 0,
          intro: undefined,
          outro: undefined,
          clips: undefined,
          burnLang: undefined,
        }
      : specIn;
    const job = newJob("edit", main.id);
    enqueue(job, async () => {
      const c = await caps();
      if (!c.available || !c.libx264) throw new PlanError("ffmpeg-unavailable");
      const intro = await resolveSegment(spec.intro);
      const outro = await resolveSegment(spec.outro);
      const clips: ResolvedClip[] | undefined = spec.clips
        ? await Promise.all(
            spec.clips.map(async (cl) => {
              const rec = cl.mediaId ? await opts.media.find(cl.mediaId) : main;
              const ok =
                rec &&
                (main.kind === "audio"
                  ? rec.kind !== "image" && rec.hasAudio !== false
                  : rec.kind === "video");
              if (!rec || !ok) throw new PlanError("segment-missing");
              if (rec.durationMs !== null && cl.startMs >= rec.durationMs)
                throw new PlanError("trim-out-of-range");
              return {
                file: rec.file,
                startMs: cl.startMs,
                endMs:
                  rec.durationMs !== null
                    ? Math.min(cl.endMs, rec.durationMs)
                    : cl.endMs,
                hasAudio: rec.hasAudio !== false,
              };
            }),
          )
        : undefined;
      const tracks: ResolvedTrack[] | undefined = spec.audio?.tracks.length
        ? await Promise.all(
            spec.audio.tracks.map(async (tk) => {
              const rec = await opts.media.find(tk.mediaId);
              if (!rec || rec.kind === "image" || rec.hasAudio === false)
                throw new PlanError("segment-missing");
              return { file: rec.file, loop: tk.loop };
            }),
          )
        : undefined;
      const burnFile = spec.burnLang
        ? `${main.id}.${spec.burnLang}.vtt`
        : undefined;
      if (spec.burnLang && !main.captions.some((x) => x.lang === spec.burnLang))
        throw new PlanError("captions-missing");

      const id = randomBytes(8).toString("hex");
      const plan0 = planEdit({
        main,
        spec,
        ...(intro ? { intro } : {}),
        ...(outro ? { outro } : {}),
        ...(clips ? { clips } : {}),
        ...(tracks ? { tracks } : {}),
        ...(burnFile ? { burnFile } : {}),
        caps: c,
        out: `${id}.part`,
      });
      const file = `${id}.${plan0.ext}`;
      const part = `${id}.${plan0.ext}.part`;
      const plan = { ...plan0, args: [...plan0.args.slice(0, -1), part] };
      await runFfmpeg(job, plan.args, plan.expectedMs);
      const finalPath = join(opts.media.dir, file);
      await rename(join(opts.media.dir, part), finalPath);

      const info = opts.probe ? await opts.probe(finalPath) : null;
      const size = (await stat(finalPath)).size;
      const trimStart = spec.trim?.startMs ?? 0;
      const record: MediaRecord = {
        id,
        kind: main.kind,
        mime: plan.mime,
        file,
        size,
        title: spec.title ?? `${main.title} (düzenlendi)`,
        ...(specIn.preview ? { temporary: true } : {}),
        filename: file,
        durationMs: info?.durationMs ?? plan.expectedMs,
        width: info?.width ?? main.width,
        height: info?.height ?? main.height,
        hasAudio: true,
        fps: info?.fps ?? null,
        chapters: spec.clips
          ? remapClipChapters(
              main,
              spec.clips,
              clips ?? [],
              intro?.durationMs ?? 0,
            )
          : remapChapters(
              main.chapters,
              trimStart,
              spec.trim?.endMs ?? null,
              intro?.durationMs ?? 0,
            ),
        captions: [],
        hasPoster: false,
        origin: "edit",
        parentId: main.id,
        ...(spec.burnLang ? { burnedLang: spec.burnLang } : {}),
        createdAt: new Date(now()).toISOString(),
      };
      if (record.kind === "video")
        record.hasPoster = await ffmpegPoster(
          opts.ffmpegBin,
          finalPath,
          join(opts.media.dir, `${id}.jpg`),
        );
      await opts.media.store.upsert(record);
      job.resultId = id;
    });
    return job;
  }

  /* ------------------------------- analysis ------------------------------- */

  /** Loudness (EBU R128 + true peak) and pauses of the audio track, stored on the record. */
  async function analyze(main: MediaRecord): Promise<Response> {
    if (main.kind === "image") return json({ error: "bad-request" }, 400);
    if (main.hasAudio === false) return json({ error: "no-audio" }, 422);
    if (!(await caps()).available)
      return json({ error: "ffmpeg-unavailable" }, 503);
    if ((main.durationMs ?? 0) > 6 * 3_600_000)
      return json({ error: "too-long" }, 413);
    let report: string;
    try {
      report = await new Promise<string>((resolve, reject) => {
        const child: ChildProcess = spawnFn(
          opts.ffmpegBin,
          [
            "-hide_banner",
            "-nostdin",
            "-nostats",
            "-i",
            join(opts.media.dir, main.file),
            "-vn",
            "-map",
            "0:a:0",
            "-af",
            `ebur128=peak=true:framelog=quiet,silencedetect=noise=${SILENCE_DB}dB:d=${MIN_SILENCE_MS / 1000}`,
            "-f",
            "null",
            "-",
          ],
          { stdio: ["ignore", "ignore", "pipe"] },
        );
        let out = "";
        child.stderr?.on("data", (c: Buffer) => {
          // keep the head (silence lines are spread out) bounded: only the last 400 KB matter
          out = (out + c.toString()).slice(-400_000);
        });
        const timer = setTimeout(() => child.kill("SIGKILL"), 10 * 60_000);
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve(out);
          else reject(new Error("ffmpeg failed"));
        });
      });
    } catch {
      return json({ error: "analyze-failed" }, 500);
    }
    const duration =
      main.durationMs ??
      Math.round(
        1000 *
          Number(
            [...report.matchAll(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/g)]
              .map(
                (m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]),
              )
              .pop() ?? 0,
          ),
      );
    const next: MediaRecord = {
      ...main,
      analysis: buildAnalysis(report, duration, new Date(now()).toISOString()),
    };
    await opts.media.store.upsert(next);
    return json({ media: next });
  }

  /* ------------------------------ WAV export ------------------------------ */

  /**
   * The audio track as 48 kHz 16-bit stereo WAV (for mastering / podcast hosts). Rendered to a
   * temp file first (a pipe cannot give a proper WAV header), streamed, then removed.
   */
  async function exportWav(main: MediaRecord): Promise<Response> {
    if (main.hasAudio === false) return json({ error: "no-audio" }, 422);
    if (!(await caps()).available)
      return json({ error: "ffmpeg-unavailable" }, 503);
    const dir = await mkdtemp(join(tmpdir(), "tkz-wav-"));
    const out = join(dir, "audio.wav");
    const cleanup = () => void rm(dir, { recursive: true, force: true });
    try {
      await new Promise<void>((resolve, reject) => {
        const child: ChildProcess = spawnFn(
          opts.ffmpegBin,
          [
            "-hide_banner",
            "-nostdin",
            "-y",
            "-i",
            join(opts.media.dir, main.file),
            "-vn",
            "-map",
            "0:a:0",
            "-c:a",
            "pcm_s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
            out,
          ],
          { stdio: ["ignore", "ignore", "pipe"] },
        );
        const timer = setTimeout(() => child.kill("SIGKILL"), 20 * 60_000);
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error("ffmpeg failed"));
        });
      });
    } catch {
      cleanup();
      return json({ error: "export-failed" }, 500);
    }
    const st = await stat(out);
    const stream = createReadStream(out);
    stream.on("close", cleanup);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "content-type": "audio/wav",
        "content-length": String(st.size),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": downloadDisposition(main.title, "wav"),
      },
    });
  }

  /* --------------------------- subtitles job --------------------------- */

  function startSubtitles(main: MediaRecord, lang: string): Job {
    const job = newJob("subtitles", main.id);
    enqueue(job, async () => {
      const cfg = opts.whisper;
      if (!cfg || !(await whisperReady()))
        throw new PlanError("whisper-unavailable");
      const c = await caps();
      if (!c.available) throw new PlanError("ffmpeg-unavailable");
      const tmp = await mkdtemp(join(tmpdir(), "subs-"));
      try {
        const wav = join(tmp, "audio.wav");
        // 16 kHz mono PCM is what every Whisper build wants
        await runFfmpeg(
          job,
          [
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostats",
            "-i",
            main.file,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            wav,
          ],
          null,
        );
        job.progress = 0.05;
        const ac = new AbortController();
        procs.set(job.id, { kill: () => ac.abort() });
        const raw = await runWhisper(
          cfg,
          wav,
          lang,
          (p) => (job.progress = Math.max(job.progress, 0.05 + p * 0.9)),
          ac.signal,
        );
        const vtt = normalizeVtt(raw);
        if (!vtt) throw new PlanError("no-speech");
        await installCaptions(main.id, lang, vtt);
        job.resultId = main.id;
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    });
    return job;
  }

  async function installCaptions(
    id: string,
    lang: string,
    vtt: string,
  ): Promise<MediaRecord> {
    const rec = await opts.media.find(id);
    if (!rec) throw new PlanError("not-found");
    const tmp = join(opts.media.dir, `${id}.${lang}.vtt.part`);
    await writeFile(tmp, vtt, { mode: 0o640 });
    await rename(tmp, join(opts.media.dir, `${id}.${lang}.vtt`));
    const captions = [
      ...rec.captions.filter((c) => c.lang !== lang),
      {
        lang,
        label: LANG_LABEL[lang.split("-")[0] ?? ""] ?? lang.toUpperCase(),
      },
    ];
    const next = { ...rec, captions };
    await opts.media.store.upsert(next);
    return next;
  }

  /* --------------------------------- http --------------------------------- */

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(`${MEDIA_API_PREFIX}/`)) return null;
    const rest = url.pathname
      .slice(MEDIA_API_PREFIX.length)
      .split("/")
      .filter(Boolean);
    const method = req.method.toUpperCase();
    const first = rest[0] ?? "";
    const mine =
      first === "capabilities" ||
      first === "asset" ||
      first === "jobs" ||
      (mediaIdOk(first) &&
        ["edit", "subtitles", "captions", "export.wav", "analyze"].includes(
          rest[1] ?? "",
        ));
    if (!mine) return null;
    if (!opts.token) return json({ error: "admin-disabled" }, 503);
    if (!mediaTokenOk(req, opts.token))
      return json({ error: "unauthorized" }, 401);

    try {
      if (first === "capabilities" && method === "GET") {
        const c = await caps();
        const w = opts.whisper;
        return json({
          ffmpeg: c,
          whisper: w
            ? {
                backend: w.backend,
                model: w.model,
                available: await whisperReady(),
              }
            : null,
        });
      }

      if (first === "asset" && method === "POST") return await uploadAsset(req);

      if (first === "jobs" && rest.length === 2) {
        const job = jobs.get(rest[1] as string);
        if (!job) return json({ error: "not-found" }, 404);
        if (method === "GET") return json({ job });
        if (method === "DELETE") {
          if (job.status === "queued" || job.status === "running") {
            job.status = "error";
            job.error = "cancelled";
            procs.get(job.id)?.kill();
          }
          return json({ ok: true });
        }
      }

      if (mediaIdOk(first)) {
        const main = await opts.media.find(first);
        if (!main) return json({ error: "not-found" }, 404);

        if (rest[1] === "edit" && method === "POST" && rest.length === 2) {
          if (main.kind === "image") return json({ error: "bad-request" }, 400);
          const body = z
            .object({ spec: editSpecSchema })
            .safeParse(JSON.parse(await req.text()));
          if (!body.success) return json({ error: "bad-spec" }, 400);
          if (!(await caps()).available)
            return json({ error: "ffmpeg-unavailable" }, 503);
          return json({ job: startEdit(main, body.data.spec) }, 202);
        }

        if (rest[1] === "export.wav" && method === "GET" && rest.length === 2)
          return await exportWav(main);

        if (rest[1] === "analyze" && method === "POST" && rest.length === 2)
          return await analyze(main);

        if (rest[1] === "subtitles" && method === "POST" && rest.length === 2) {
          if (main.kind === "image") return json({ error: "bad-request" }, 400);
          const body = z
            .object({ lang: z.string().regex(/^[a-z]{2,3}$/) })
            .safeParse(JSON.parse(await req.text()));
          if (!body.success) return json({ error: "bad-request" }, 400);
          if (!opts.whisper || !(await whisperReady()))
            return json({ error: "whisper-unavailable" }, 503);
          return json({ job: startSubtitles(main, body.data.lang) }, 202);
        }

        if (rest[1] === "captions" && rest.length === 3) {
          const lang = rest[2] as string;
          if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(lang))
            return json({ error: "bad-request" }, 400);
          if (method === "PUT") {
            const vtt = normalizeVtt(await req.text());
            if (!vtt) return json({ error: "bad-captions" }, 400);
            return json({ media: await installCaptions(main.id, lang, vtt) });
          }
          if (method === "DELETE") {
            await rm(join(opts.media.dir, `${main.id}.${lang}.vtt`), {
              force: true,
            });
            const next = {
              ...main,
              captions: main.captions.filter((c) => c.lang !== lang),
            };
            await opts.media.store.upsert(next);
            return json({ media: next });
          }
        }
      }
      return json({ error: "not-found" }, 404);
    } catch (e) {
      if (e instanceof StoreUnavailableError)
        return json({ error: "store-unavailable" }, 503);
      if (e instanceof SyntaxError) return json({ error: "bad-request" }, 400);
      if (e instanceof PlanError) return json({ error: e.code }, 400);
      console.error("[media-edit]", e);
      return json({ error: "internal" }, 500);
    }
  }

  /** PNG only (title cards, covers): small, checked by its signature, stored as a hidden record. */
  async function uploadAsset(req: Request): Promise<Response> {
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.length === 0 || buf.length > 2 * 1024 * 1024)
      return json({ error: "too-large" }, 413);
    const isPng =
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    if (!isPng) return json({ error: "unsupported-type" }, 415);
    const id = randomBytes(8).toString("hex");
    const file = `${id}.png`;
    await writeFile(join(opts.media.dir, file), buf, { mode: 0o640 });
    const record: MediaRecord = {
      id,
      kind: "image",
      mime: "image/png",
      file,
      size: buf.length,
      title: "card",
      filename: file,
      durationMs: null,
      width: null,
      height: null,
      chapters: [],
      captions: [],
      hasPoster: false,
      origin: "upload",
      parentId: null,
      createdAt: new Date(now()).toISOString(),
    };
    await opts.media.store.upsert(record);
    return json({ media: record }, 201);
  }

  return { handle, jobs };
}

export type MediaEditApi = ReturnType<typeof createMediaEditApi>;
