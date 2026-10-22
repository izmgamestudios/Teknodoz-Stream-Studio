// src/studio/ui/watch/audio-player.tsx
// Podcast / music player: cover, native controls, speed, ±15 s skip. Keeps playing in the mini
// player while the viewer browses.
import { useEffect, useRef, useState } from "react";

import { useT } from "../../i18n/use-t";
import type { WatchItem } from "../../watch/filter";
import { BTN } from "../fields";
import { coverOf } from "./stories";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function AudioPlayer({
  item,
  src,
  volume,
  muted,
  onEnded,
  compact = false,
}: {
  item: WatchItem;
  src: string;
  volume: number;
  muted: boolean;
  onEnded: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const audio = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState<number>(1);
  const cover = coverOf(item);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    a.volume = volume / 100;
    a.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
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
        onEnded={onEnded}
        onLoadedMetadata={(e) => {
          e.currentTarget.playbackRate = speed;
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
        <label className="flex items-center gap-1">
          {t("player.speed")}
          <select
            className="rounded-md border bg-background px-1 py-1"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
