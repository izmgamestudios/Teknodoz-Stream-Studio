// src/studio/ui/watch/player.tsx
// Floating player: small (mini, page stays usable) / large / theater / fullscreen, volume + mute
// (YouTube, Vimeo, files, audio), a "up next" queue with autoplay, captions, podcast mode.
// Rooms cannot be embedded (live P2P): they open the join page instead.
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "../../i18n/use-t";
import type { WatchItem } from "../../watch/filter";
import {
  embedUrl,
  fileSrc,
  isAudioSource,
  sourceLink,
  type MediaSource,
} from "../../watch/media-url";
import { nextInQueue } from "../../watch/sections";
import {
  clearProgress,
  getProgress,
  RESUME_END_S,
  RESUME_MIN_S,
  saveProgress,
} from "../../watch/progress";
import { BTN, BTN_ACCENT, Check } from "../fields";
import { AudioPlayer } from "./audio-player";
import { coverOf } from "./stories";

type Size = "small" | "large" | "theater";

function nearest(rate: number): (typeof SPEEDS)[number] {
  return SPEEDS.reduce((a, b) =>
    Math.abs(b - rate) < Math.abs(a - rate) ? b : a,
  );
}

const BOX: Record<Size, string> = {
  small:
    "fixed bottom-3 right-3 z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border bg-card shadow-2xl",
  large:
    "fixed left-1/2 top-1/2 z-40 max-h-[94dvh] w-[min(72rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card shadow-2xl",
  // cinema: the whole width, the picture as tall as the screen allows
  theater:
    "fixed inset-x-0 top-1/2 z-40 max-h-[100dvh] -translate-y-1/2 overflow-y-auto border-y bg-card shadow-2xl",
};

/** Real fullscreen (or the CSS fallback on browsers without element fullscreen, e.g. iPhone). */
const FULLSCREEN =
  "fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col overflow-hidden bg-black text-white";

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const AUTONEXT_KEY = "studio.player.autonext";

function readAutonext(): boolean {
  try {
    return localStorage.getItem(AUTONEXT_KEY) !== "0";
  } catch {
    return true;
  }
}

function post(
  frame: HTMLIFrameElement | null,
  s: MediaSource,
  msg: { volume?: number; muted?: boolean; rate?: number },
): void {
  const win = frame?.contentWindow;
  if (!win) return;
  if (s.kind === "youtube" || s.kind === "youtube-live") {
    const origin = "https://www.youtube-nocookie.com";
    const send = (func: string, args: unknown[] = []) =>
      win.postMessage(JSON.stringify({ event: "command", func, args }), origin);
    if (msg.volume !== undefined) send("setVolume", [msg.volume]);
    if (msg.muted !== undefined) send(msg.muted ? "mute" : "unMute");
    if (msg.rate !== undefined) send("setPlaybackRate", [msg.rate]);
  } else if (s.kind === "vimeo") {
    const origin = "https://player.vimeo.com";
    if (msg.volume !== undefined)
      win.postMessage(
        JSON.stringify({ method: "setVolume", value: msg.volume / 100 }),
        origin,
      );
    if (msg.muted !== undefined)
      win.postMessage(
        JSON.stringify({ method: "setMuted", value: msg.muted }),
        origin,
      );
    if (msg.rate !== undefined)
      win.postMessage(
        JSON.stringify({ method: "setPlaybackRate", value: msg.rate }),
        origin,
      );
  }
}

/** Subscribes to the embed's "ended" event; returns an unsubscribe function. */
function listenEnded(
  frame: HTMLIFrameElement,
  s: MediaSource,
  onEnded: () => void,
): () => void {
  const win = frame.contentWindow;
  if (!win) return () => undefined;
  const yt = s.kind === "youtube";
  const vimeo = s.kind === "vimeo";
  if (!yt && !vimeo) return () => undefined;
  const origin = yt
    ? "https://www.youtube-nocookie.com"
    : "https://player.vimeo.com";
  const hello = () => {
    if (yt)
      win.postMessage(
        JSON.stringify({ event: "listening", id: 1, channel: "widget" }),
        origin,
      );
    else
      win.postMessage(
        JSON.stringify({ method: "addEventListener", value: "finish" }),
        origin,
      );
  };
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== origin || e.source !== win) return;
    let data: unknown = e.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    const d = data as {
      event?: string;
      info?: number | { playerState?: number };
    };
    if (yt) {
      const state =
        d.event === "onStateChange"
          ? d.info
          : d.event === "infoDelivery" && typeof d.info === "object"
            ? d.info?.playerState
            : undefined;
      if (state === 0) onEnded();
    } else if (d.event === "finish") onEnded();
  };
  window.addEventListener("message", onMessage);
  frame.addEventListener("load", hello);
  // the iframe may already be loaded by the time we subscribe
  hello();
  return () => {
    window.removeEventListener("message", onMessage);
    frame.removeEventListener("load", hello);
  };
}

export function WatchPlayer({
  item,
  queue,
  queueTitle,
  onSelect,
  onClose,
}: {
  item: WatchItem;
  queue: readonly WatchItem[];
  queueTitle: string;
  onSelect: (item: WatchItem) => void;
  onClose: () => void;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState<Size>("large");
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [autonext, setAutonext] = useState(true);
  const [speed, setSpeed] = useState<number>(1);
  const lastSave = useRef(0);
  const [nativeFs, setNativeFs] = useState(false);
  const [cssFs, setCssFs] = useState(false);
  const isFs = nativeFs || cssFs;
  useEffect(() => setAutonext(readAutonext()), []);
  const source = item.source;
  const audio = isAudioSource(source);

  const playNext = useCallback(() => {
    if (!autonext) return;
    const next = nextInQueue(queue, item.id);
    if (next) onSelect(next);
  }, [autonext, queue, item.id, onSelect]);

  useEffect(() => {
    const onFs = () => setNativeFs(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (cssFs) return setCssFs(false);
    try {
      await box.current?.requestFullscreen();
    } catch {
      setCssFs(true); // no element fullscreen (iOS Safari, blocked): fill the page instead
    }
  }, [cssFs]);

  const changeSpeed = useCallback((next: number) => {
    const clamped = Math.min(2, Math.max(0.25, next));
    setSpeed(clamped);
  }, []);

  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (cssFs) setCssFs(false);
        else if (!document.fullscreenElement) onClose();
        return;
      }
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "f") void toggleFullscreen();
      else if (k === "t")
        setSize((s) => (s === "theater" ? "large" : "theater"));
      else if (k === "m") setMuted((m) => !m);
      else if (e.key === "<" || (e.shiftKey && e.key === ","))
        changeSpeed(
          SPEEDS[Math.max(0, SPEEDS.indexOf(nearest(speed)) - 1)] ?? 0.25,
        );
      else if (e.key === ">" || (e.shiftKey && e.key === "."))
        changeSpeed(
          SPEEDS[
            Math.min(SPEEDS.length - 1, SPEEDS.indexOf(nearest(speed)) + 1)
          ] ?? 2,
        );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, cssFs, speed, toggleFullscreen, changeSpeed]);

  // playback speed: files and audio directly, YouTube / Vimeo through their player API
  useEffect(() => {
    const v = video.current;
    if (v) {
      v.defaultPlaybackRate = speed;
      v.playbackRate = speed;
    }
    post(frame.current, source ?? { kind: "room", code: "AAAAAA" }, {
      rate: speed,
    });
  }, [speed, item.id, source]);

  useEffect(() => {
    if (video.current) {
      video.current.volume = volume / 100;
      video.current.muted = muted;
    }
  }, [volume, muted, item.id]);

  // embeds: end-of-video -> next in queue
  useEffect(() => {
    const f = frame.current;
    if (!f || !source) return;
    return listenEnded(f, source, playNext);
  }, [source, playNext]);

  if (!source) return null;
  const src = embedUrl(source, true);
  const direct = fileSrc(source);
  const apply = (v: number, m: boolean) => {
    setVolume(v);
    setMuted(m);
    post(frame.current, source, { volume: v, muted: m });
  };
  const showQueue = size !== "small" && !isFs && queue.length > 1;
  const sideQueue = showQueue && size === "large";
  const mediaBox = isFs
    ? "min-h-0 flex-1 bg-black"
    : audio
      ? "min-h-56 w-full bg-black"
      : size === "theater"
        ? "mx-auto aspect-video max-h-[calc(100dvh-9rem)] w-full bg-black"
        : "aspect-video w-full bg-black";
  const showControls = size !== "small";

  const queueList = (
    <aside
      aria-label={t("player.queue")}
      className={
        sideQueue
          ? "border-t p-2 lg:max-h-[70dvh] lg:overflow-y-auto lg:border-l lg:border-t-0"
          : "max-h-56 overflow-y-auto border-t p-2"
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold">{queueTitle}</h3>
        <span className="ml-auto text-xs">
          <Check
            checked={autonext}
            onChange={(v) => {
              setAutonext(v);
              try {
                localStorage.setItem(AUTONEXT_KEY, v ? "1" : "0");
              } catch {
                /* not persisted */
              }
            }}
          >
            {t("player.autoplay")}
          </Check>
        </span>
      </div>
      <ol className="space-y-1">
        {queue.map((q, idx) => {
          const current = q.id === item.id;
          const cover = coverOf(q);
          return (
            <li key={q.id}>
              <button
                className={`flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-accent ${current ? "bg-secondary" : ""}`}
                aria-current={current ? "true" : undefined}
                onClick={() => onSelect(q)}
              >
                <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">
                  {current ? "▶" : (q.episode ?? idx + 1)}
                </span>
                <span className="relative flex aspect-video w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-muted text-lg">
                  {cover ? (
                    <img
                      src={cover}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="size-full object-cover"
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                  ) : (
                    <span aria-hidden="true">
                      {isAudioSource(q.source) ? "🎧" : "▶"}
                    </span>
                  )}
                </span>
                <span className="min-w-0 text-xs font-medium leading-snug">
                  <span className="line-clamp-2">{q.title}</span>
                  {q.category && (
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {q.category}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );

  return (
    <>
      {size !== "small" && !isFs && (
        <div
          className="fixed inset-0 z-30 bg-overlay"
          onClick={() => setSize("small")}
          aria-hidden="true"
        />
      )}
      <div
        ref={box}
        role="dialog"
        aria-label={item.title}
        className={isFs ? FULLSCREEN : BOX[size]}
      >
        <div className="flex items-center gap-2 p-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">
            {item.title}
          </p>
          {isFs ? (
            <button
              className={BTN}
              onClick={() => void toggleFullscreen()}
              aria-label={t("player.fullscreen.exit")}
              title={t("player.fullscreen.exit")}
            >
              ⤓
            </button>
          ) : size === "small" ? (
            <button
              className={BTN}
              onClick={() => setSize("large")}
              aria-label={t("player.expand")}
              title={t("player.expand")}
            >
              ⤢
            </button>
          ) : (
            <button
              className={BTN}
              onClick={() => setSize("small")}
              aria-label={t("player.mini")}
              title={t("player.mini")}
            >
              ▭
            </button>
          )}
          {!isFs && (
            <button
              className={BTN}
              onClick={onClose}
              aria-label={t("player.close")}
              title={t("player.close")}
            >
              ✕
            </button>
          )}
        </div>

        <div
          className={`${sideQueue ? "lg:grid lg:grid-cols-[minmax(0,1fr)_20rem]" : ""} ${isFs ? "flex min-h-0 flex-1 flex-col" : ""}`}
        >
          <div
            className={`min-w-0 ${isFs ? "flex min-h-0 flex-1 flex-col" : ""}`}
          >
            <div className={mediaBox}>
              {audio && direct ? (
                <AudioPlayer
                  item={item}
                  src={direct}
                  volume={volume}
                  muted={muted}
                  speed={speed}
                  onEnded={playNext}
                  compact={size === "small"}
                />
              ) : direct ? (
                <video
                  key={item.id}
                  ref={video}
                  src={direct}
                  poster={item.poster || undefined}
                  controls
                  autoPlay
                  playsInline
                  className="h-full w-full object-contain"
                  onEnded={() => {
                    clearProgress(item.id);
                    playNext();
                  }}
                  onTimeUpdate={(e) => {
                    const v = e.currentTarget;
                    const nowMs = Date.now();
                    if (nowMs - lastSave.current > 4000) {
                      lastSave.current = nowMs;
                      saveProgress(item.id, v.currentTime, v.duration);
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
                    const v = e.currentTarget;
                    v.playbackRate = speed;
                    // pick up where this device left off
                    const saved = getProgress(item.id);
                    if (
                      saved &&
                      saved.t >= RESUME_MIN_S &&
                      saved.t < v.duration - RESUME_END_S
                    )
                      v.currentTime = saved.t;
                  }}
                >
                  {item.captions.map((c) => (
                    <track
                      key={c.lang}
                      kind="subtitles"
                      srcLang={c.lang}
                      label={c.label}
                      src={c.url}
                    />
                  ))}
                </video>
              ) : source.kind === "room" ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-white">
                  <p className="text-sm">{item.title}</p>
                  <Link
                    to="/r/$code"
                    params={{ code: source.code }}
                    search={{ as: "viewer" }}
                    className={BTN_ACCENT}
                  >
                    {t("watch.openRoom")}
                  </Link>
                </div>
              ) : (
                <iframe
                  key={item.id}
                  ref={frame}
                  src={src ?? undefined}
                  title={item.title}
                  className="h-full w-full"
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                  onLoad={() =>
                    post(frame.current, source, { volume, muted, rate: speed })
                  }
                />
              )}
            </div>

            {showControls && (
              <div
                className={`flex flex-wrap items-center gap-2 p-2 text-xs ${isFs ? "bg-black/80" : ""}`}
              >
                <button
                  className={BTN}
                  onClick={() => apply(volume, !muted)}
                  aria-pressed={muted}
                >
                  {muted
                    ? `🔇 ${t("player.unmute")}`
                    : `🔊 ${t("player.mute")}`}
                </button>
                <label className="flex items-center gap-2">
                  <span className="sr-only">{t("player.volume")}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={muted ? 0 : volume}
                    aria-label={t("player.volume")}
                    onChange={(e) => apply(Number(e.target.value), false)}
                    className="w-28"
                  />
                </label>
                {source.kind !== "room" && (
                  <label className="flex items-center gap-1">
                    {t("player.speed")}
                    <select
                      className="rounded-md border bg-background px-1 py-1 text-foreground"
                      value={nearest(speed)}
                      aria-label={t("player.speed")}
                      onChange={(e) => changeSpeed(Number(e.target.value))}
                    >
                      {SPEEDS.map((r) => (
                        <option key={r} value={r}>
                          {r === 1 ? t("player.speed.normal") : `${r}×`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <span className="ml-auto flex flex-wrap gap-1">
                  {!isFs && (
                    <>
                      <button
                        className={BTN}
                        aria-pressed={size === "large"}
                        onClick={() => setSize("large")}
                      >
                        {t("player.size.large")}
                      </button>
                      <button
                        className={BTN}
                        aria-pressed={size === "theater"}
                        onClick={() => setSize("theater")}
                        title="T"
                      >
                        {t("player.size.theater")}
                      </button>
                    </>
                  )}
                  <button
                    className={BTN}
                    onClick={() => void toggleFullscreen()}
                    aria-pressed={isFs}
                    title="F"
                  >
                    {isFs ? "⤓" : "⛶"} {t("player.fullscreen")}
                  </button>
                  {!isFs &&
                    source.kind !== "room" &&
                    source.kind !== "upload" && (
                      <a
                        className={BTN}
                        href={sourceLink(source)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        ↗ {t("watch.openSource")}
                      </a>
                    )}
                </span>
                {!isFs &&
                  (source.kind === "youtube" ||
                    source.kind === "youtube-live" ||
                    source.kind === "vimeo") && (
                    <p className="w-full text-muted-foreground">
                      {t("player.volume.note")}
                    </p>
                  )}
                {!isFs && item.description && (
                  <p className="w-full whitespace-pre-line text-sm text-foreground">
                    {item.description}
                  </p>
                )}
              </div>
            )}
          </div>

          {showQueue && queueList}
        </div>
      </div>
    </>
  );
}
