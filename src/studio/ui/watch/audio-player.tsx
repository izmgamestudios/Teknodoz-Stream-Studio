// src/studio/ui/watch/audio-player.tsx
// Podcast / music player: cover, native controls, speed, ±15 s skip. Keeps playing in the mini
// player while the viewer browses.
import { useEffect, useRef, useState } from "react";

import { useT } from "../../i18n/use-t";
import type { WatchItem } from "../../watch/filter";
import { BTN } from "../fields";
import {
  clearProgress,
  getProgress,
  RESUME_END_S,
  RESUME_MIN_S,
  saveProgress,
} from "../../watch/progress";
import { coverOf } from "./stories";

export function AudioPlayer({
  item,
  src,
  volume,
  muted,
  speed,
  onEnded,
  compact = false,
}: {
  item: WatchItem;
  src: string;
  volume: number;
  muted: boolean;
  speed: number;
  onEnded: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const audio = useRef<HTMLAudioElement>(null);
  const cover = coverOf(item);
  const lastSave = useRef(0);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    a.volume = volume / 100;
    a.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    const a = audio.current;
    if (a) {
      a.defaultPlaybackRate = speed;
      a.playbackRate = speed;
    }
  }, [speed, src]);

  const skip = (s: number) => {
    const a = audio.current;
    if (a)
      a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + s));
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-secondary to-muted p-4 text-foreground">
      {!compact && (
        <div className="flex size-32 items-center justify-center overflow-hidden rounded-xl bg-background text-5xl shadow sm:size-40">
          {cover ? (
            <img
              src={cover}
              alt=""
              referrerPolicy="no-referrer"
              className="size-full object-cover"
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
          ) : (
            <span aria-hidden="true">🎧</span>
          )}
        </div>
      )}
      <audio
        key={src}
        ref={audio}
        src={src}
        controls
        autoPlay
        preload="metadata"
        className="w-full max-w-md"
        onEnded={() => {
          clearProgress(item.id);
          onEnded();
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          const nowMs = Date.now();
          if (nowMs - lastSave.current > 4000) {
            lastSave.current = nowMs;
            saveProgress(item.id, a.currentTime, a.duration);
          }
        }}
        onPause={(e) =>
          saveProgress(
            item.id,
            e.currentTarget.currentTime,
            e.currentTarget.duration,
          )
        }
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          a.playbackRate = speed;
          const saved = getProgress(item.id);
          if (
            saved &&
            saved.t >= RESUME_MIN_S &&
            saved.t < a.duration - RESUME_END_S
          )
            a.currentTime = saved.t;
        }}
      >
        {item.captions.map((c) => (
          <track
            key={c.lang}
            kind="captions"
            srcLang={c.lang}
            label={c.label}
            src={c.url}
          />
        ))}
      </audio>
      <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
        <button className={BTN} onClick={() => skip(-15)}>
          ⏪ {t("player.back15")}
        </button>
        <button className={BTN} onClick={() => skip(15)}>
          {t("player.fwd15")} ⏩
        </button>
      </div>
    </div>
  );
}
