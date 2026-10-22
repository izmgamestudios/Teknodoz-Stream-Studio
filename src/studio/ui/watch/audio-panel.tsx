// src/studio/ui/watch/audio-panel.tsx
// Audio tools of the library editor: voice clean-up, noise / hum / background removal, gain, a
// small mixer for extra library tracks, and a short preview render to listen before committing.
import { useState, type RefObject } from "react";

import { useT } from "../../i18n/use-t";
import {
  AUDIO_PRESETS,
  DEFAULT_AUDIO,
  MAX_TRACKS,
  newTrack,
  type AudioState,
  type TrackState,
} from "../../watch/audio-state";
import { mediaUrl, type MediaRecord } from "../../watch/media-client";
import { BTN, Check, formatMs, INPUT_AUTO } from "../fields";

const Slider = ({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) => (
  <label className="flex items-center gap-2">
    <span className="w-24 shrink-0">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      className="min-w-0 flex-1"
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
    />
    <span className="w-16 text-right font-mono">
      {value > 0 && unit === "dB" ? "+" : ""}
      {value} {unit}
    </span>
  </label>
);

export function AudioPanel({
  media,
  library,
  videoRef,
  value,
  onChange,
  previewId,
  previewBusy,
  onPreview,
}: {
  media: MediaRecord;
  library: readonly MediaRecord[];
  videoRef: RefObject<HTMLVideoElement | null>;
  value: AudioState;
  onChange: (a: AudioState) => void;
  previewId: string | null;
  previewBusy: boolean;
  onPreview: (startMs: number) => void;
}) {
  const t = useT();
  const [pick, setPick] = useState("");
  const set = (p: Partial<AudioState>) => onChange({ ...value, ...p });
  const sources = library.filter(
    (m) => m.id !== media.id && m.kind !== "image" && m.hasAudio !== false,
  );
  const byId = (id: string) => library.find((m) => m.id === id);
  const setTrack = (key: number, p: Partial<TrackState>) =>
    set({
      tracks: value.tracks.map((x) => (x.key === key ? { ...x, ...p } : x)),
    });
  const now = () => Math.round((videoRef.current?.currentTime ?? 0) * 1000);

  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 font-bold">🎚 {t("edit.audio")}</legend>
      <p className="text-muted-foreground">{t("edit.audio.hint")}</p>

      <div className="flex flex-wrap gap-1.5">
        {(["speech", "noisy", "hum"] as const).map((k) => (
          <button
            key={k}
            className={BTN}
            onClick={() =>
              set({
                ...DEFAULT_AUDIO,
                tracks: value.tracks,
                ...AUDIO_PRESETS[k],
              })
            }
          >
            {t(`edit.audio.preset.${k}`)}
          </button>
        ))}
        <button
          className={BTN}
          onClick={() => set({ ...DEFAULT_AUDIO, tracks: value.tracks })}
        >
          {t("common.reset")}
        </button>
      </div>

      <Check checked={value.voice} onChange={(v) => set({ voice: v })}>
        {t("edit.audio.voice")}
      </Check>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          {t("edit.audio.denoise")}
          <select
            className={INPUT_AUTO}
            value={value.denoise}
            onChange={(e) =>
              set({ denoise: Number(e.target.value) as AudioState["denoise"] })
            }
          >
            <option value={0}>{t("common.off")}</option>
            <option value={1}>{t("edit.audio.level.1")}</option>
            <option value={2}>{t("edit.audio.level.2")}</option>
            <option value={3}>{t("edit.audio.level.3")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {t("edit.audio.rumble")}
          <select
            className={INPUT_AUTO}
            value={value.highpassHz}
            onChange={(e) => set({ highpassHz: Number(e.target.value) })}
          >
            <option value={0}>{t("common.off")}</option>
            {[60, 80, 100, 150, 200].map((hz) => (
              <option key={hz} value={hz}>
                &lt; {hz} Hz
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {t("edit.audio.hum")}
          <select
            className={INPUT_AUTO}
            value={value.humHz}
            onChange={(e) =>
              set({ humHz: Number(e.target.value) as AudioState["humHz"] })
            }
          >
            <option value={0}>{t("common.off")}</option>
            <option value={50}>50 Hz (TR / EU)</option>
            <option value={60}>60 Hz (US)</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Check checked={value.gate} onChange={(v) => set({ gate: v })}>
          {t("edit.audio.gate")}
        </Check>
        <Check checked={value.compress} onChange={(v) => set({ compress: v })}>
          {t("edit.audio.compress")}
        </Check>
      </div>
      <Slider
        label={t("edit.audio.volume")}
        value={value.volumeDb}
        min={-20}
        max={12}
        step={0.5}
        unit="dB"
        onChange={(v) => set({ volumeDb: v })}
      />

      <div className="space-y-2 border-t pt-3">
        <p className="font-bold">{t("edit.audio.mixer")}</p>
        {value.tracks.map((tk) => {
          const src = byId(tk.mediaId);
          return (
            <div
              key={tk.key}
              className="space-y-1.5 rounded-md bg-secondary/60 p-2"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {src?.kind === "video" ? "🎬" : "🎵"}{" "}
                  {src?.title ?? tk.mediaId}
                </span>
                <button
                  className={BTN}
                  aria-label={t("edit.clips.remove")}
                  onClick={() =>
                    set({
                      tracks: value.tracks.filter((x) => x.key !== tk.key),
                    })
                  }
                >
                  🗑
                </button>
              </div>
              <Slider
                label={t("edit.audio.volume")}
                value={tk.volumeDb}
                min={-40}
                max={10}
                step={1}
                unit="dB"
                onChange={(v) => setTrack(tk.key, { volumeDb: v })}
              />
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  {t("edit.audio.startAt")}:{" "}
                  <b className="font-mono">{formatMs(tk.startMs)}</b>
                </span>
                <button
                  className={BTN}
                  onClick={() => setTrack(tk.key, { startMs: now() })}
                >
                  ⏱ {t("edit.setNow")}
                </button>
                <Check
                  checked={tk.loop}
                  onChange={(v) => setTrack(tk.key, { loop: v })}
                >
                  {t("edit.audio.loop")}
                </Check>
                <Check
                  checked={tk.duck}
                  onChange={(v) => setTrack(tk.key, { duck: v })}
                >
                  {t("edit.audio.duck")}
                </Check>
                <label className="flex items-center gap-1">
                  {t("edit.fade")}
                  <select
                    className={INPUT_AUTO}
                    value={tk.fadeMs}
                    onChange={(e) =>
                      setTrack(tk.key, { fadeMs: Number(e.target.value) })
                    }
                  >
                    <option value={0}>{t("common.off")}</option>
                    <option value={500}>0,5 s</option>
                    <option value={1000}>1 s</option>
                    <option value={3000}>3 s</option>
                  </select>
                </label>
              </div>
            </div>
          );
        })}
        {value.tracks.length < MAX_TRACKS && (
          <div className="flex items-center gap-1.5">
            <select
              className={`${INPUT_AUTO} min-w-0 flex-1`}
              value={pick}
              aria-label={t("edit.audio.addTrack")}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">{t("edit.audio.addTrack")}</option>
              {sources.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.kind === "video" ? "🎬" : "🎵"} {m.title}
                </option>
              ))}
            </select>
            <button
              className={BTN}
              disabled={!pick}
              onClick={() => {
                set({ tracks: [...value.tracks, newTrack(pick, now())] });
                setPick("");
              }}
            >
              ＋
            </button>
          </div>
        )}
        {sources.length === 0 && value.tracks.length === 0 && (
          <p className="text-muted-foreground">{t("edit.audio.noSources")}</p>
        )}
      </div>

      <div className="space-y-2 border-t pt-3">
        <button
          className={BTN}
          disabled={previewBusy}
          onClick={() => onPreview(now())}
        >
          🎧 {t("edit.audio.preview")}
        </button>
        {previewId &&
          (media.kind === "video" ? (
            <video
              key={previewId}
              src={mediaUrl(previewId)}
              controls
              autoPlay
              className="w-full max-w-md rounded-md bg-black"
            />
          ) : (
            <audio
              key={previewId}
              src={mediaUrl(previewId)}
              controls
              autoPlay
              className="w-full"
            />
          ))}
      </div>
    </fieldset>
  );
}
