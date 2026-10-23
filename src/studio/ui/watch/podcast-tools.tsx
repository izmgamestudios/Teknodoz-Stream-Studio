// src/studio/ui/watch/podcast-tools.tsx
// Library: the kind badge + audio analysis of an item, and the podcast editing helpers
// (one-click preset, shorten long pauses) that feed the editor's state.
import { useState } from "react";

import { chaptersFromCues, mergeChapters } from "../../../shared/auto-chapters";
import { adviceFor, shortenPauses } from "../../../shared/media-analysis";
import { parseCues } from "../../watch/cues";
import type { MessageKey } from "../../i18n/messages";
import { useT } from "../../i18n/use-t";
import { makeClip, totalMs, type Clip } from "../../watch/clips";
import type { AudioState } from "../../watch/audio-state";
import {
  analyzeMedia,
  fetchCaptionsText,
  getCapabilities,
  getJob,
  setChapters,
  startSubtitles,
  type MediaRecord,
} from "../../watch/media-client";
import { BTN, BTN_ACCENT } from "../fields";

const fmtDb = (n: number | null, unit: string): string =>
  n === null ? "—" : `${n.toFixed(1).replace(".", ",")} ${unit}`;
const fmtSec = (ms: number): string =>
  `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

export function AnalysisPanel({
  media,
  token,
  onChanged,
}: {
  media: MediaRecord;
  token: string;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<MessageKey | null>(null);
  if (media.kind === "image") return null;
  const a = media.analysis;

  async function run() {
    setBusy(true);
    setErr(null);
    const r = await analyzeMedia(token, media.id);
    setBusy(false);
    if (r.ok) await onChanged();
    else setErr(r.error === "no-audio" ? "an.noaudio" : "an.err");
  }

  return (
    <section
      className="space-y-2 rounded-lg border p-3"
      aria-label={t("an.title")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold">{t("an.title")}</h3>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">
          {media.kind === "video" ? t("an.kind.video") : t("an.kind.audio")}
        </span>
        <button
          className={a ? BTN : BTN_ACCENT}
          disabled={busy || media.hasAudio === false}
          onClick={() => void run()}
        >
          {busy ? t("an.working") : a ? t("an.rerun") : t("an.run")}
        </button>
      </div>
      {media.hasAudio === false && (
        <p className="text-xs text-muted-foreground">{t("an.noaudio")}</p>
      )}
      {a && (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t("an.lufs")}</dt>
              <dd className="font-mono">{fmtDb(a.integratedLufs, "LUFS")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("an.peak")}</dt>
              <dd className="font-mono">{fmtDb(a.truePeakDb, "dBFS")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("an.range")}</dt>
              <dd className="font-mono">{fmtDb(a.loudnessRangeLu, "LU")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("an.pauses")}</dt>
              <dd className="font-mono">
                {a.silences.length} · {fmtSec(a.silenceMs)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("an.speech")}</dt>
              <dd className="font-mono">{Math.round(a.speechRatio * 100)}%</dd>
            </div>
          </dl>
          <ul className="list-disc space-y-0.5 pl-4 text-xs">
            {adviceFor(a).map((k) => (
              <li key={k}>{t(`an.advice.${k}` as MessageKey)}</li>
            ))}
          </ul>
        </>
      )}
      {err && (
        <p role="alert" className="text-xs text-destructive">
          {t(err)}
        </p>
      )}
    </section>
  );
}

/** The one-click settings that suit a spoken-word recording. */
export const PODCAST_AUDIO: AudioState = {
  voice: true,
  denoise: 2,
  highpassHz: 0,
  humHz: 0,
  gate: false,
  compress: true,
  volumeDb: 0,
  tracks: [],
};

export function PodcastTools({
  media,
  token,
  audio,
  clips,
  setAudio,
  setNormalize,
  setFade,
  setClips,
  onAnalyzed,
}: {
  media: MediaRecord;
  token: string;
  audio: AudioState;
  clips: readonly Clip[];
  setAudio: (a: AudioState) => void;
  setNormalize: (v: boolean) => void;
  setFade: (ms: number) => void;
  setClips: (c: Clip[]) => void;
  /** the record with a fresh analysis (so the library list can refresh) */
  onAnalyzed: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (media.hasAudio === false) return null;
  const dur = media.durationMs ?? 0;

  async function shorten() {
    setBusy(true);
    setNote(null);
    let a = media.analysis;
    if (!a) {
      const r = await analyzeMedia(token, media.id);
      if (r.ok) {
        a = r.media.analysis;
        await onAnalyzed();
      }
    }
    setBusy(false);
    const cut = a ? shortenPauses(a.silences, dur) : null;
    if (!cut) return setNote(t("pe.shorten.none"));
    const next = cut.map((c) => makeClip(media.id, c.startMs, c.endMs));
    setClips(next);
    setNote(
      t("pe.shorten.done", {
        n: next.length,
        s: Math.round((dur - totalMs(next)) / 1000),
      }),
    );
  }

  return (
    <fieldset className="space-y-2 rounded-lg border p-3">
      <legend className="px-1 font-bold">🎙️ {t("pe.title")}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BTN}
          onClick={() => {
            setAudio({ ...PODCAST_AUDIO, tracks: audio.tracks });
            setNormalize(true);
            setFade(1000);
          }}
        >
          {t("pe.preset")}
        </button>
        <button
          type="button"
          className={BTN}
          disabled={busy || dur === 0}
          onClick={() => void shorten()}
        >
          {busy ? t("an.working") : t("pe.shorten")}
        </button>
        {clips.length > 0 && (
          <button type="button" className={BTN} onClick={() => setClips([])}>
            {t("pe.shorten.undo")}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("pe.preset.hint")}</p>
      {note && (
        <p role="status" className="text-xs">
          {note}
        </p>
      )}
    </fieldset>
  );
}

/**
 * Chapters from the speech itself: new chapter at a natural pause, named after the first words
 * said there. Uses the subtitles (made with Whisper when there are none); hand-made markers stay.
 */
export function AutoChaptersPanel({
  media,
  token,
  onChanged,
}: {
  media: MediaRecord;
  token: string;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (media.kind === "image" || media.hasAudio === false) return null;

  async function fromLang(lang: string): Promise<void> {
    const text = await fetchCaptionsText(media.id, lang);
    const cues = text ? parseCues(text) : [];
    const auto = chaptersFromCues(cues, media.durationMs ?? 0);
    if (auto.length === 0) return setMsg(t("ac.none"));
    const merged = mergeChapters(media.chapters, auto);
    if (!(await setChapters(token, media.id, merged)))
      return setMsg(t("ac.err"));
    setMsg(t("ac.done", { n: merged.length }));
    await onChanged();
  }

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      let lang = media.captions[0]?.lang;
      if (!lang) {
        const caps = await getCapabilities(token);
        if (!caps?.whisper?.available) return setMsg(t("ac.needWhisper"));
        const start = await startSubtitles(token, media.id, "tr");
        if (!start.ok) return setMsg(t("ac.err"));
        let job = start.job;
        for (
          let i = 0;
          i < 3600 && job.status !== "done" && job.status !== "error";
          i++
        ) {
          await new Promise((r) => setTimeout(r, 1500));
          const next = await getJob(token, job.id);
          if (next) job = next;
        }
        if (job.status !== "done") return setMsg(t("ac.err"));
        lang = "tr";
      }
      await fromLang(lang);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="space-y-2 rounded-lg border p-3"
      aria-label={t("ac.title")}
    >
      <h3 className="text-sm font-bold">{t("ac.title")}</h3>
      <button className={BTN} disabled={busy} onClick={() => void run()}>
        {busy
          ? t("ac.working")
          : media.captions.length > 0
            ? t("ac.run")
            : t("ac.runAll")}
      </button>
      {msg && (
        <p role="status" className="text-xs">
          {msg}
        </p>
      )}
    </section>
  );
}
