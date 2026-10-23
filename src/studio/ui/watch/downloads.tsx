// src/studio/ui/watch/downloads.tsx
// Library item downloads: the raw recording, the clean (no burned subtitles) version, the
// subtitled version (made on demand by ffmpeg), subtitle files as SRT / VTT, and the audio as WAV.
import { useEffect, useState } from "react";

import { useT } from "../../i18n/use-t";
import {
  captionDownloadUrl,
  cleanOf,
  downloadName,
  fileDownloadUrl,
  rawOf,
  subtitledOf,
  wavUrl,
} from "../../watch/downloads";
import {
  getCapabilities,
  getJob,
  startEdit,
  type Capabilities,
  type Job,
  type MediaRecord,
} from "../../watch/media-client";
import { BTN } from "../fields";

export function DownloadsPanel({
  media,
  library,
  token,
  onChanged,
}: {
  media: MediaRecord;
  library: readonly MediaRecord[];
  token: string;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let off = false;
    void getCapabilities(token).then((c) => !off && setCaps(c));
    return () => {
      off = true;
    };
  }, [token]);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;
    const id = window.setInterval(async () => {
      const next = await getJob(token, job.id);
      if (!next) return;
      setJob(next);
      if (next.status === "done") {
        window.clearInterval(id);
        await onChanged();
      }
      if (next.status === "error") {
        window.clearInterval(id);
        setFailed(true);
      }
    }, 800);
    return () => window.clearInterval(id);
  }, [job, token, onChanged]);

  if (media.kind === "image") return null;
  const raw = rawOf(media, library);
  const clean = cleanOf(media, library);
  const isVideo = media.kind === "video";
  const link = (id: string, name: string, label: string, note?: string) => (
    <a className={BTN} href={fileDownloadUrl(id, name)}>
      ⬇ {label}
      {note ? <span className="ml-1 opacity-60">({note})</span> : null}
    </a>
  );
  const burnSupported = caps?.ffmpeg.available && caps.ffmpeg.subtitles;
  const working = job && (job.status === "queued" || job.status === "running");

  return (
    <section
      className="space-y-2 rounded-lg border p-3"
      aria-label={t("dl.title")}
    >
      <h3 className="text-sm font-bold">{t("dl.title")}</h3>
      <div className="flex flex-wrap gap-2">
        {link(raw.id, downloadName(raw.title, "raw"), t("dl.raw"))}
        {isVideo &&
          link(
            clean.id,
            downloadName(media.title, "clean"),
            t("dl.clean"),
            clean.id === raw.id ? t("dl.same") : undefined,
          )}
        {media.hasAudio !== false && (
          <a className={BTN} href={wavUrl(media.id)}>
            ⬇ {t("dl.wav")}
          </a>
        )}
      </div>

      {media.captions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("dl.captions")}</p>
          <div className="flex flex-wrap gap-2">
            {media.captions.map((c) =>
              (["srt", "vtt"] as const).map((f) => (
                <a
                  key={`${c.lang}-${f}`}
                  className={BTN}
                  href={captionDownloadUrl(
                    media.id,
                    c.lang,
                    f,
                    downloadName(media.title, undefined, c.lang),
                  )}
                >
                  ⬇ {c.label || c.lang} .{f}
                </a>
              )),
            )}
          </div>
        </div>
      )}

      {isVideo && media.captions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("dl.subtitled")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {media.captions.map((c) => {
              const have = subtitledOf(clean, library, c.lang);
              if (have)
                return (
                  <span key={c.lang}>
                    {link(
                      have.id,
                      downloadName(media.title, "subtitled", c.lang),
                      `${c.label || c.lang}`,
                    )}
                  </span>
                );
              return (
                <button
                  key={c.lang}
                  className={BTN}
                  disabled={!burnSupported || Boolean(working)}
                  onClick={async () => {
                    setFailed(false);
                    const r = await startEdit(token, clean.id, {
                      title: `${downloadName(media.title)} (altyazılı)`,
                      fadeMs: 0,
                      normalize: false,
                      burnLang: c.lang,
                    });
                    if (r.ok) setJob(r.job);
                    else setFailed(true);
                  }}
                >
                  {t("dl.subtitled.make")} · {c.label || c.lang}
                </button>
              );
            })}
          </div>
          {caps && !burnSupported && (
            <p className="text-xs text-muted-foreground">
              {t("dl.subtitled.unavailable")}
            </p>
          )}
          {working && (
            <div role="status" className="text-xs">
              <progress
                className="w-full"
                value={job.status === "queued" ? 0 : job.progress}
                max={1}
              />
              {t("dl.subtitled.working")}
            </div>
          )}
          {failed && (
            <p role="alert" className="text-xs text-destructive">
              {t("dl.subtitled.error")}
            </p>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">{t("dl.hint")}</p>
    </section>
  );
}
