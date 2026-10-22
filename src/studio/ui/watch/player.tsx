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
import { BTN, BTN_ACCENT, Check } from "../fields";
import { AudioPlayer } from "./audio-player";
import { coverOf } from "./stories";

type Size = "small" | "large" | "theater";

const BOX: Record<Size, string> = {
  small:
    "fixed bottom-3 right-3 z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border bg-card shadow-2xl",
  large:
    "fixed left-1/2 top-1/2 z-40 max-h-[94dvh] w-[min(72rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card shadow-2xl",
  theater:
    "fixed inset-x-2 top-1/2 z-40 max-h-[94dvh] -translate-y-1/2 overflow-y-auto rounded-xl border bg-card shadow-2xl md:inset-x-6",
};

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
  msg: { volume?: number; muted?: boolean },
): void {
  const win = frame?.contentWindow;
  if (!win) return;
  if (s.kind === "youtube" || s.kind === "youtube-live") {
    const origin = "https://www.youtube-nocookie.com";
    const send = (func: string, args: unknown[] = []) =>
      win.postMessage(JSON.stringify({ event: "command", func, args }), origin);
    if (msg.volume !== undefined) send("setVolume", [msg.volume]);
    if (msg.muted !== undefined) send(msg.muted ? "mute" : "unMute");
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
  useEffect(() => setAutonext(readAutonext()), []);
  const source = item.source;
  const audio = isAudioSource(source);

  const playNext = useCallback(() => {
    if (!autonext) return;
    const next = nextInQueue(queue, item.id);
    if (next) onSelect(next);
  }, [autonext, queue, item.id, onSelect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
  const showQueue = size !== "small" && queue.length > 1;

  return (
    <>
      {size !== "small" && (
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
        className={BOX[size]}
      >
        <div className="flex items-center gap-2 p-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">
            {item.title}
          </p>
          {size === "small" ? (
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
          <button
            className={BTN}
            onClick={onClose}
            aria-label={t("player.close")}
            title={t("player.close")}
          >
            ✕
          </button>
        </div>

        <div
          className={
            showQueue ? "lg:grid lg:grid-cols-[minmax(0,1fr)_20rem]" : ""
          }
        >
          <div className="min-w-0">
            <div
              className={`${audio ? "min-h-56" : "aspect-video"} w-full bg-black`}
            >
              {audio && direct ? (
                <AudioPlayer
                  item={item}
                  src={direct}
                  volume={volume}
                  muted={muted}
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
                  className="h-full w-full"
                  onEnded={playNext}
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
                />
              )}
            </div>

            {size !== "small" && (
              <div className="flex flex-wrap items-center gap-2 p-2 text-xs">
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
                <span className="ml-auto flex flex-wrap gap-1">
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
                  >
                    {t("player.size.theater")}
                  </button>
                  <button
                    className={BTN}
                    onClick={() => void box.current?.requestFullscreen?.()}
                  >
                    ⛶ {t("player.fullscreen")}
                  </button>
                  {source.kind !== "room" && source.kind !== "upload" && (
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
                {(source.kind === "youtube" ||
                  source.kind === "youtube-live" ||
                  source.kind === "vimeo") && (
                  <p className="w-full text-muted-foreground">
                    {t("player.volume.note")}
                  </p>
                )}
                {item.description && (
                  <p className="w-full whitespace-pre-line text-sm text-foreground">
                    {item.description}
                  </p>
                )}
              </div>
            )}
          </div>

          {showQueue && (
            <aside
              aria-label={t("player.queue")}
              className="border-t p-2 lg:max-h-[70dvh] lg:overflow-y-auto lg:border-l lg:border-t-0"
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
                              onError={(e) =>
                                (e.currentTarget.style.display = "none")
                              }
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
          )}
        </div>
      </div>
    </>
  );
}
