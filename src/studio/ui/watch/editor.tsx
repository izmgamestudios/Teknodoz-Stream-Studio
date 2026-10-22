// src/studio/ui/watch/editor.tsx
// Library editor panels: video / audio editing (trim, intro + outro, fade, loudness, burned-in
// captions) and subtitles (Whisper generation, manual edit, upload). Heavy work runs on the
// server as jobs; these panels start them and poll the progress.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { useT } from "../../i18n/use-t";
import {
  cancelJob,
  deleteCaptions,
  fetchCaptionsText,
  getCapabilities,
  getJob,
  putCaptions,
  startEdit,
  startSubtitles,
  uploadAsset,
  type Capabilities,
  type EditSpec,
  type Job,
  type MediaRecord,
  type Segment,
  type StartResult,
} from "../../watch/media-client";
import {
  appendClip,
  clipLength,
  layout,
  makeClip,
  MIN_CLIP_MS,
  moveClip,
  removeClip,
  splitClipAt,
  toSpecClips,
  totalMs,
  trimClip,
  type Clip,
} from "../../watch/clips";
import { AudioPanel } from "./audio-panel";
import {
  DEFAULT_AUDIO,
  toAudioSpec,
  type AudioState,
} from "../../watch/audio-state";
import { formatClock, formatFrames, frameAt } from "../../watch/timecode";
import {
  DEFAULT_CARD,
  drawTitleCard,
  renderTitleCard,
  type TitleCard,
} from "../../watch/title-card";
import { BTN, BTN_ACCENT, Check, formatMs, INPUT, INPUT_AUTO } from "../fields";

/** Polls a job until it finishes. */
function useJob(token: string, onDone: (job: Job) => void) {
  const [job, setJob] = useState<Job | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;
    const id = window.setInterval(async () => {
      const next = await getJob(token, job.id);
      if (!next) return;
      setJob(next);
      if (next.status === "done" || next.status === "error") {
        window.clearInterval(id);
        if (next.status === "done") done.current(next);
      }
    }, 800);
    return () => window.clearInterval(id);
  }, [job, token]);
  return {
    job,
    begin: (r: StartResult) => r.ok && setJob(r.job),
    clear: () => setJob(null),
  };
}

function JobStatus({
  job,
  token,
  errKey,
}: {
  job: Job | null;
  token: string;
  errKey: (code: string) => string;
}) {
  const t = useT();
  if (!job) return null;
  if (job.status === "error")
    return (
      <p role="alert" className="text-xs text-destructive">
        {errKey(job.error ?? "failed")}
      </p>
    );
  if (job.status === "done") return null;
  return (
    <div className="space-y-1 text-xs" role="status">
      <progress
        className="w-full"
        value={job.status === "queued" ? 0 : job.progress}
        max={1}
      />
      <div className="flex items-center gap-2">
        <span>
          {job.status === "queued"
            ? t("edit.queued")
            : `${Math.round(job.progress * 100)} %`}
        </span>
        <button className={BTN} onClick={() => void cancelJob(token, job.id)}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

const sec = (ms: number) => Math.round(ms) / 1000;

/** Frame-accurate transport for the preview video: ±1 frame, ±1 s, timecode with frame count. */
function FrameBar({
  videoRef,
  fps,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  fps: number;
}) {
  const t = useT();
  const [ms, setMs] = useState(0);
  const frame = 1000 / fps;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const upd = () => setMs(Math.round(v.currentTime * 1000));
    upd();
    v.addEventListener("timeupdate", upd);
    v.addEventListener("seeked", upd);
    // per-frame updates while playing, where the browser can report them
    let handle = 0;
    const loop = () => {
      upd();
      handle = v.requestVideoFrameCallback(loop);
    };
    if (typeof v.requestVideoFrameCallback === "function")
      handle = v.requestVideoFrameCallback(loop);
    return () => {
      v.removeEventListener("timeupdate", upd);
      v.removeEventListener("seeked", upd);
      if (handle && typeof v.cancelVideoFrameCallback === "function")
        v.cancelVideoFrameCallback(handle);
    };
  }, [videoRef]);

  const step = (deltaMs: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    // land in the middle of the target frame so the decoder shows it, not its neighbour
    const frames =
      Math.round(v.currentTime * fps) + Math.round(deltaMs / frame);
    const max = Number.isFinite(v.duration) ? v.duration : Infinity;
    v.currentTime = Math.min(max, Math.max(0, (frames + 0.5) / fps));
    setMs(Math.round(v.currentTime * 1000));
  };

  const onKey = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const big = e.shiftKey ? 10 : 1;
    if (e.key === "," || e.key === "ArrowLeft") step(-frame * big);
    else if (e.key === "." || e.key === "ArrowRight") step(frame * big);
    else if (e.key === " ") {
      const v = videoRef.current;
      if (v) void (v.paused ? v.play() : v.pause());
    } else return;
    e.preventDefault();
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-lg border p-2"
      role="group"
      aria-label={t("edit.frames")}
      tabIndex={0}
      onKeyDown={onKey}
    >
      <button className={BTN} onClick={() => step(-1000)} title="−1 s">
        ⏪ 1 s
      </button>
      <button className={BTN} onClick={() => step(-frame)} title="−1 frame (,)">
        ◀ 1f
      </button>
      <button
        className={BTN}
        onClick={() => {
          const v = videoRef.current;
          if (v) void (v.paused ? v.play() : v.pause());
        }}
        title="Space"
      >
        ⏯
      </button>
      <button className={BTN} onClick={() => step(frame)} title="+1 frame (.)">
        1f ▶
      </button>
      <button className={BTN} onClick={() => step(1000)} title="+1 s">
        1 s ⏩
      </button>
      <span className="ml-auto font-mono tabular-nums" aria-live="off">
        {formatFrames(ms, fps)} · {formatClock(ms)} · #{frameAt(ms, fps)}
      </span>
      <span className="basis-full text-[11px] text-muted-foreground">
        {t("edit.frames.hint", { fps: String(Math.round(fps * 100) / 100) })}
      </span>
    </div>
  );
}

/** Cut-and-join: ordered clips of this (or other) library videos, joined into one video. */
function ClipTimeline({
  media,
  library,
  videoRef,
  fps,
  start,
  end,
  clips,
  onChange,
}: {
  media: MediaRecord;
  library: readonly MediaRecord[];
  videoRef: RefObject<HTMLVideoElement | null>;
  fps: number;
  start: number;
  end: number;
  clips: Clip[];
  onChange: (c: Clip[]) => void;
}) {
  const t = useT();
  const [other, setOther] = useState("");
  const videos = library.filter((m) => m.kind === "video" && m.id !== media.id);
  const byId = (id: string) =>
    id === media.id ? media : library.find((m) => m.id === id);
  const frameMs = 1000 / fps;
  const now = () => Math.round((videoRef.current?.currentTime ?? 0) * 1000);
  const snap = (ms: number) =>
    Math.round(Math.round((ms / 1000) * fps) * frameMs);
  const rows = layout(clips);

  return (
    <fieldset className="space-y-2 rounded-lg border p-3">
      <legend className="px-1 font-bold">✂ {t("edit.clips")}</legend>
      <p className="text-muted-foreground">{t("edit.clips.hint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={BTN}
          disabled={end - start < MIN_CLIP_MS}
          onClick={() =>
            onChange(
              appendClip(clips, makeClip(media.id, snap(start), snap(end))),
            )
          }
        >
          ＋ {t("edit.clips.addRange")} ({formatMs(Math.max(0, end - start))})
        </button>
        {videos.length > 0 && (
          <span className="flex items-center gap-1">
            <select
              className={INPUT_AUTO}
              value={other}
              aria-label={t("edit.clips.other")}
              onChange={(e) => setOther(e.target.value)}
            >
              <option value="">{t("edit.clips.other")}</option>
              {videos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                </option>
              ))}
            </select>
            <button
              className={BTN}
              disabled={!other}
              onClick={() => {
                const v = byId(other);
                if (v?.durationMs)
                  onChange(appendClip(clips, makeClip(v.id, 0, v.durationMs)));
              }}
            >
              ＋
            </button>
          </span>
        )}
      </div>
      {clips.length > 0 && (
        <>
          <ol className="space-y-1.5">
            {rows.map(({ clip: c, atMs }, i) => {
              const src = byId(c.mediaId);
              const own = c.mediaId === media.id;
              return (
                <li
                  key={c.key}
                  className="flex flex-wrap items-center gap-1.5 rounded-md bg-secondary/60 p-1.5"
                >
                  <span className="w-5 text-center font-bold">{i + 1}</span>
                  <span
                    className="min-w-0 flex-1 basis-32 truncate"
                    title={src?.title}
                  >
                    {src?.title ?? c.mediaId}
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatFrames(c.startMs, fps)} →{" "}
                    {formatFrames(c.endMs, fps)} · {formatMs(clipLength(c))}
                  </span>
                  <span className="text-muted-foreground">
                    @{formatMs(atMs)}
                  </span>
                  {own && (
                    <>
                      <button
                        className={BTN}
                        title={t("edit.clips.inNow")}
                        onClick={() =>
                          onChange(
                            trimClip(
                              clips,
                              c.key,
                              "start",
                              snap(now()),
                              media.durationMs,
                            ),
                          )
                        }
                      >
                        [⏱
                      </button>
                      <button
                        className={BTN}
                        title={t("edit.clips.outNow")}
                        onClick={() =>
                          onChange(
                            trimClip(
                              clips,
                              c.key,
                              "end",
                              snap(now()),
                              media.durationMs,
                            ),
                          )
                        }
                      >
                        ⏱]
                      </button>
                      <button
                        className={BTN}
                        title={t("edit.clips.split")}
                        onClick={() =>
                          onChange(splitClipAt(clips, c.key, snap(now())))
                        }
                      >
                        ✂
                      </button>
                      <button
                        className={BTN}
                        title={t("edit.clips.go")}
                        onClick={() => {
                          if (videoRef.current)
                            videoRef.current.currentTime = c.startMs / 1000;
                        }}
                      >
                        ▶|
                      </button>
                    </>
                  )}
                  <button
                    className={BTN}
                    aria-label={t("edit.clips.up")}
                    disabled={i === 0}
                    onClick={() => onChange(moveClip(clips, c.key, -1))}
                  >
                    ↑
                  </button>
                  <button
                    className={BTN}
                    aria-label={t("edit.clips.down")}
                    disabled={i === clips.length - 1}
                    onClick={() => onChange(moveClip(clips, c.key, 1))}
                  >
                    ↓
                  </button>
                  <button
                    className={BTN}
                    aria-label={t("edit.clips.remove")}
                    onClick={() => onChange(removeClip(clips, c.key))}
                  >
                    🗑
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="text-muted-foreground">
            {t("edit.clips.total", {
              t: formatMs(totalMs(clips)),
              n: String(clips.length),
            })}
            <button className="ml-2 underline" onClick={() => onChange([])}>
              {t("common.reset")}
            </button>
          </p>
        </>
      )}
    </fieldset>
  );
}

/* ------------------------------------------------------------------ */
/* Edit                                                                 */
/* ------------------------------------------------------------------ */

type SegmentChoice =
  | { type: "none" }
  | { type: "card"; seconds: number; card: Omit<TitleCard, "width" | "height"> }
  | { type: "media"; mediaId: string };

export function EditPanel({
  media,
  token,
  library,
  videoRef,
  onResult,
}: {
  media: MediaRecord;
  token: string;
  library: readonly MediaRecord[];
  videoRef: RefObject<HTMLVideoElement | null>;
  onResult: (id: string) => void;
}) {
  const t = useT();
  const dur = media.durationMs ?? 0;
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(dur);
  const [intro, setIntro] = useState<SegmentChoice>({ type: "none" });
  const [outro, setOutro] = useState<SegmentChoice>({ type: "none" });
  const [clips, setClips] = useState<Clip[]>([]);
  const [audio, setAudio] = useState<AudioState>(DEFAULT_AUDIO);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [fade, setFade] = useState(0);
  const [normalize, setNormalize] = useState(false);
  const [burn, setBurn] = useState("");
  const [title, setTitle] = useState(`${media.title} (${t("edit.suffix")})`);
  const [error, setError] = useState<string | null>(null);
  const isVideo = media.kind === "video";
  const { job, begin } = useJob(
    token,
    (j) => j.resultId && onResult(j.resultId),
  );

  const preview = useJob(token, (j) => j.resultId && setPreviewId(j.resultId));
  const previewBusy =
    preview.job?.status === "queued" || preview.job?.status === "running";

  useEffect(() => {
    void getCapabilities(token).then(setCaps);
  }, [token]);
  useEffect(() => {
    setEnd(media.durationMs ?? 0);
    setStart(0);
    setClips([]);
    setAudio(DEFAULT_AUDIO);
    setPreviewId(null);
  }, [media.id, media.durationMs]);

  const busy = job?.status === "queued" || job?.status === "running";
  const trimmed = start > 0 || (dur > 0 && end < dur);
  const videos = library.filter((m) => m.kind === "video" && m.id !== media.id);
  const available =
    caps?.ffmpeg.available && (isVideo ? caps.ffmpeg.libx264 : true);

  const now = () => Math.round((videoRef.current?.currentTime ?? 0) * 1000);

  const segment = async (
    c: SegmentChoice,
  ): Promise<Segment | undefined | null> => {
    if (c.type === "none") return undefined;
    if (c.type === "media")
      return c.mediaId ? { kind: "media", mediaId: c.mediaId } : undefined;
    if (!c.card.title.trim()) return undefined;
    const blob = await renderTitleCard({
      ...c.card,
      width: Math.max(2, Math.round((media.width ?? 1280) / 2) * 2),
      height: Math.max(2, Math.round((media.height ?? 720) / 2) * 2),
    });
    const assetId = blob ? await uploadAsset(token, blob) : null;
    return assetId ? { kind: "card", assetId, seconds: c.seconds } : null;
  };

  const run = async () => {
    setError(null);
    const i = await segment(intro);
    const o = await segment(outro);
    if (i === null || o === null) return setError(t("edit.err.card"));
    const spec: EditSpec = {
      title: title.trim() || `${media.title} (${t("edit.suffix")})`,
      ...(clips.length > 0
        ? { clips: toSpecClips(clips, media.id) }
        : trimmed
          ? { trim: { startMs: start, endMs: end } }
          : {}),
      ...(i ? { intro: i } : {}),
      ...(o ? { outro: o } : {}),
      ...(toAudioSpec(audio) ? { audio: toAudioSpec(audio)! } : {}),
      fadeMs: fade,
      normalize,
      ...(burn && clips.length === 0 ? { burnLang: burn } : {}),
    };
    const r = await startEdit(token, media.id, spec);
    if (r.ok) begin(r);
    else setError(errText(r.error));
  };

  const runPreview = async (startMs: number) => {
    setError(null);
    const a = toAudioSpec(audio);
    const from = Math.max(0, Math.min(startMs, Math.max(0, dur - 1000)));
    const r = await startEdit(token, media.id, {
      ...(a ? { audio: a } : {}),
      preview: { startMs: from, lengthMs: 10_000 },
      fadeMs: 0,
      normalize,
    });
    if (r.ok) {
      setPreviewId(null);
      preview.begin(r);
    } else setError(errText(r.error));
  };

  const errText = (code: string): string => {
    const known: Record<string, string> = {
      "ffmpeg-unavailable": "edit.err.ffmpeg",
      "trim-out-of-range": "edit.err.trim",
      "bad-spec": "edit.err.spec",
      "asset-missing": "edit.err.card",
      "segment-missing": "edit.err.segment",
      "loudnorm-unavailable": "edit.err.filter",
      "burn-unavailable": "edit.err.filter",
      "captions-missing": "edit.err.captions",
      "duration-unknown": "edit.err.duration",
      "clips-invalid": "edit.err.spec",
      "clips-burn": "edit.err.clipsBurn",
      "tracks-invalid": "edit.err.spec",
    };
    return t((known[code] ?? "edit.err.generic") as "edit.err.generic");
  };

  if (caps && !available)
    return (
      <p className="text-sm text-muted-foreground">{t("edit.err.ffmpeg")}</p>
    );

  const noIntro = !isVideo;

  const fps = media.fps && media.fps > 0 ? media.fps : 30;
  const frameStep = Math.max(1, Math.round(1000 / fps));

  return (
    <div className="space-y-4 text-xs">
      {isVideo && dur > 0 && <FrameBar videoRef={videoRef} fps={fps} />}
      <fieldset className="space-y-2 rounded-lg border p-3">
        <legend className="px-1 font-bold">{t("edit.trim")}</legend>
        {dur > 0 ? (
          <>
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0">{t("edit.start")}</span>
              <input
                type="range"
                min={0}
                max={dur}
                step={frameStep}
                value={start}
                className="min-w-0 flex-1"
                aria-label={t("edit.start")}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setStart(Math.min(v, end - 500));
                  if (videoRef.current) videoRef.current.currentTime = v / 1000;
                }}
              />
              <span className="w-14 text-right font-mono">
                {formatMs(start)}
              </span>
              <button
                className={BTN}
                onClick={() => setStart(Math.min(now(), end - 500))}
              >
                ⏱ {t("edit.setNow")}
              </button>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0">{t("edit.end")}</span>
              <input
                type="range"
                min={0}
                max={dur}
                step={frameStep}
                value={end}
                className="min-w-0 flex-1"
                aria-label={t("edit.end")}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setEnd(Math.max(v, start + 500));
                  if (videoRef.current) videoRef.current.currentTime = v / 1000;
                }}
              />
              <span className="w-14 text-right font-mono">{formatMs(end)}</span>
              <button
                className={BTN}
                onClick={() => setEnd(Math.max(now(), start + 500))}
              >
                ⏱ {t("edit.setNow")}
              </button>
            </label>
            <p className="text-muted-foreground">
              {t("edit.result", { t: formatMs(Math.max(0, end - start)) })}
              {trimmed && (
                <button
                  className="ml-2 underline"
                  onClick={() => {
                    setStart(0);
                    setEnd(dur);
                  }}
                >
                  {t("common.reset")}
                </button>
              )}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">{t("edit.err.duration")}</p>
        )}
      </fieldset>

      {isVideo && dur > 0 && (
        <ClipTimeline
          media={media}
          library={library}
          videoRef={videoRef}
          fps={fps}
          start={start}
          end={end}
          clips={clips}
          onChange={setClips}
        />
      )}

      {!noIntro && (
        <>
          <SegmentEditor
            label={t("edit.intro")}
            value={intro}
            onChange={setIntro}
            videos={videos}
            media={media}
          />
          <SegmentEditor
            label={t("edit.outro")}
            value={outro}
            onChange={setOutro}
            videos={videos}
            media={media}
          />
        </>
      )}

      {dur > 0 && (
        <>
          <AudioPanel
            media={media}
            library={library}
            videoRef={videoRef}
            value={audio}
            onChange={setAudio}
            previewId={previewId}
            previewBusy={previewBusy}
            onPreview={(ms) => void runPreview(ms)}
          />
          <JobStatus job={preview.job} token={token} errKey={errText} />
        </>
      )}

      <fieldset className="space-y-2 rounded-lg border p-3">
        <legend className="px-1 font-bold">{t("edit.polish")}</legend>
        <label className="flex items-center gap-2">
          {t("edit.fade")}
          <select
            className={INPUT_AUTO}
            value={fade}
            onChange={(e) => setFade(Number(e.target.value))}
          >
            <option value={0}>{t("common.off")}</option>
            <option value={500}>0,5 s</option>
            <option value={1000}>1 s</option>
            <option value={2000}>2 s</option>
          </select>
        </label>
        <Check checked={normalize} onChange={setNormalize}>
          {t("edit.normalize")}{" "}
          {caps && !caps.ffmpeg.loudnorm && `(${t("edit.unavailable")})`}
        </Check>
        {isVideo && media.captions.length > 0 && clips.length === 0 && (
          <label className="flex items-center gap-2">
            {t("edit.burn")}
            <select
              className={INPUT_AUTO}
              value={burn}
              onChange={(e) => setBurn(e.target.value)}
              disabled={caps ? !caps.ffmpeg.subtitles : false}
            >
              <option value="">{t("common.off")}</option>
              {media.captions.map((c) => (
                <option key={c.lang} value={c.lang}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <label className="block">
        {t("edit.name")}
        <input
          className={`${INPUT} mt-1`}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <div className="space-y-2">
        <button
          className={BTN_ACCENT}
          disabled={busy || !caps || dur === 0}
          onClick={() => void run()}
        >
          ✂ {t("edit.run")}
        </button>
        <p className="text-muted-foreground">{t("edit.note")}</p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <JobStatus job={job} token={token} errKey={errText} />
        {job?.status === "done" && <p role="status">✓ {t("edit.done")}</p>}
      </div>
    </div>
  );
}

function SegmentEditor({
  label,
  value,
  onChange,
  videos,
  media,
}: {
  label: string;
  value: SegmentChoice;
  onChange: (v: SegmentChoice) => void;
  videos: readonly MediaRecord[];
  media: MediaRecord;
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const card = value.type === "card" ? value.card : null;
  const W = media.width ?? 1280;
  const H = media.height ?? 720;

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !card) return;
    c.width = 320;
    c.height = Math.max(2, Math.round((320 * H) / W));
    // preview at 1/4 scale of a 1280-wide card so the proportions match the real render
    drawTitleCard(ctx, { ...card, width: c.width, height: c.height });
  }, [card, W, H]);

  return (
    <fieldset className="space-y-2 rounded-lg border p-3">
      <legend className="px-1 font-bold">{label}</legend>
      <select
        className={INPUT_AUTO}
        aria-label={label}
        value={value.type}
        onChange={(e) => {
          const type = e.target.value;
          onChange(
            type === "card"
              ? {
                  type: "card",
                  seconds: 3,
                  card: { ...DEFAULT_CARD, title: media.title },
                }
              : type === "media"
                ? { type: "media", mediaId: videos[0]?.id ?? "" }
                : { type: "none" },
          );
        }}
      >
        <option value="none">{t("edit.seg.none")}</option>
        <option value="card">{t("edit.seg.card")}</option>
        <option value="media" disabled={videos.length === 0}>
          {t("edit.seg.media")}
        </option>
      </select>

      {value.type === "media" && (
        <select
          className={INPUT_AUTO}
          aria-label={t("edit.seg.media")}
          value={value.mediaId}
          onChange={(e) => onChange({ type: "media", mediaId: e.target.value })}
        >
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title} {v.durationMs ? `(${formatMs(v.durationMs)})` : ""}
            </option>
          ))}
        </select>
      )}

      {value.type === "card" && card && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <input
              className={INPUT}
              maxLength={80}
              placeholder={t("edit.card.title")}
              aria-label={t("edit.card.title")}
              value={card.title}
              onChange={(e) =>
                onChange({ ...value, card: { ...card, title: e.target.value } })
              }
            />
            <input
              className={INPUT}
              maxLength={120}
              placeholder={t("edit.card.subtitle")}
              aria-label={t("edit.card.subtitle")}
              value={card.subtitle}
              onChange={(e) =>
                onChange({
                  ...value,
                  card: { ...card, subtitle: e.target.value },
                })
              }
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1">
                {t("edit.card.bg")}
                <input
                  type="color"
                  value={card.background}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      card: { ...card, background: e.target.value },
                    })
                  }
                />
              </label>
              <label className="flex items-center gap-1">
                {t("edit.card.fg")}
                <input
                  type="color"
                  value={card.foreground}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      card: { ...card, foreground: e.target.value },
                    })
                  }
                />
              </label>
              <label className="flex items-center gap-1">
                {t("edit.card.seconds")}
                <select
                  className={INPUT_AUTO}
                  value={value.seconds}
                  onChange={(e) =>
                    onChange({ ...value, seconds: Number(e.target.value) })
                  }
                >
                  {[2, 3, 4, 5, 6, 8].map((s) => (
                    <option key={s} value={s}>
                      {s} s
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <canvas
            ref={canvas}
            className="w-40 max-w-full rounded border"
            aria-hidden="true"
          />
        </div>
      )}
    </fieldset>
  );
}

/* ------------------------------------------------------------------ */
/* Subtitles                                                            */
/* ------------------------------------------------------------------ */

const WHISPER_LANGS = [
  "tr",
  "en",
  "de",
  "es",
  "fr",
  "it",
  "pt",
  "ru",
  "ar",
  "nl",
  "pl",
  "ja",
  "ko",
  "zh",
] as const;

export function SubtitlesPanel({
  media,
  token,
  onChanged,
}: {
  media: MediaRecord;
  token: string;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [lang, setLang] = useState<string>("tr");
  const [editing, setEditing] = useState<{ lang: string; text: string } | null>(
    null,
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const { job, begin } = useJob(token, () => void onChanged());

  useEffect(() => {
    void getCapabilities(token).then(setCaps);
  }, [token]);

  const generate = async () => {
    setMsg(null);
    const r = await startSubtitles(token, media.id, lang);
    if (r.ok) begin(r);
    else
      setMsg({
        ok: false,
        text: t(
          r.error === "whisper-unavailable"
            ? "sub.err.whisper"
            : "edit.err.generic",
        ),
      });
  };

  const subErr = useCallback(
    (code: string): string =>
      t(
        code === "whisper-unavailable"
          ? "sub.err.whisper"
          : code === "no-speech"
            ? "sub.err.nospeech"
            : "edit.err.generic",
      ),
    [t],
  );

  const open = async (l: string) => {
    const text = await fetchCaptionsText(media.id, l);
    setEditing({ lang: l, text: text ?? "" });
  };

  const save = async () => {
    if (!editing) return;
    const r = await putCaptions(token, media.id, editing.lang, editing.text);
    setMsg({ ok: !!r, text: r ? t("sub.saved") : t("sub.err.invalid") });
    if (r) {
      setEditing(null);
      await onChanged();
    }
  };

  const onUpload = async (f: File) => {
    const r = await putCaptions(token, media.id, lang, await f.text());
    setMsg({ ok: !!r, text: r ? t("sub.saved") : t("sub.err.invalid") });
    if (r) await onChanged();
  };

  const busy = job?.status === "queued" || job?.status === "running";

  return (
    <div className="space-y-4 text-xs">
      <fieldset className="space-y-2 rounded-lg border p-3">
        <legend className="px-1 font-bold">{t("sub.generate")}</legend>
        <p className="text-muted-foreground">{t("sub.generate.body")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            {t("sub.lang")}
            <select
              className={INPUT_AUTO}
              value={lang}
              onChange={(e) => setLang(e.target.value)}
            >
              {WHISPER_LANGS.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <button
            className={BTN_ACCENT}
            disabled={busy || !caps?.whisper?.available}
            onClick={() => void generate()}
          >
            🎙 {t("sub.run")}
          </button>
          {caps?.whisper?.available && (
            <span className="text-muted-foreground">
              Whisper · {caps.whisper.backend}
            </span>
          )}
        </div>
        {caps && !caps.whisper?.available && (
          <p role="note" className="text-muted-foreground">
            {t("sub.err.whisper")}
          </p>
        )}
        <JobStatus job={job} token={token} errKey={subErr} />
      </fieldset>

      <fieldset className="space-y-2 rounded-lg border p-3">
        <legend className="px-1 font-bold">{t("sub.tracks")}</legend>
        {media.captions.length === 0 && (
          <p className="text-muted-foreground">{t("sub.none")}</p>
        )}
        <ul className="space-y-1">
          {media.captions.map((c) => (
            <li key={c.lang} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{c.label}</span>
              <button className={BTN} onClick={() => void open(c.lang)}>
                {t("catalog.edit")}
              </button>
              <a
                className={BTN}
                href={`/media/${media.id}/captions/${c.lang}.vtt`}
                download={`${media.title}.${c.lang}.vtt`}
              >
                ⬇ .vtt
              </a>
              <button
                className={BTN}
                onClick={async () => {
                  await deleteCaptions(token, media.id, c.lang);
                  if (editing?.lang === c.lang) setEditing(null);
                  await onChanged();
                }}
              >
                {t("catalog.delete")}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <button className={BTN} onClick={() => file.current?.click()}>
            ⬆ {t("sub.upload")} ({lang.toUpperCase()})
          </button>
          <input
            ref={file}
            type="file"
            accept=".vtt,.srt,text/vtt,application/x-subrip,text/plain"
            className="sr-only"
            aria-label={t("sub.upload")}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onUpload(f);
            }}
          />
        </div>
        {editing && (
          <div className="space-y-2">
            <textarea
              className={`${INPUT} font-mono`}
              rows={12}
              spellCheck
              aria-label={t("sub.editor")}
              lang={editing.lang}
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            />
            <div className="flex gap-2">
              <button className={BTN_ACCENT} onClick={() => void save()}>
                {t("catalog.save")}
              </button>
              <button className={BTN} onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}
        {msg && (
          <p
            role={msg.ok ? "status" : "alert"}
            className={msg.ok ? "text-muted-foreground" : "text-destructive"}
          >
            {msg.text}
          </p>
        )}
      </fieldset>
    </div>
  );
}
