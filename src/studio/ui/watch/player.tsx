// src/studio/ui/watch/player.tsx
// Floating video player: small (mini, page stays usable) / large / theater / fullscreen, with
// volume + mute for YouTube, Vimeo and plain files. Rooms cannot be embedded (live P2P), they
// open the join page instead.
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useT } from "../../i18n/use-t";
import { embedUrl, sourceLink, type MediaSource } from "../../watch/media-url";
import type { WatchItem } from "../../watch/filter";
import { BTN, BTN_ACCENT } from "../fields";

type Size = "small" | "large" | "theater";

const BOX: Record<Size, string> = {
  small:
    "fixed bottom-3 right-3 z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border bg-card shadow-2xl",
  large:
    "fixed left-1/2 top-1/2 z-40 w-[min(56rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card shadow-2xl",
  theater:
    "fixed inset-x-2 top-1/2 z-40 -translate-y-1/2 rounded-xl border bg-card shadow-2xl md:inset-x-6",
};

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

export function WatchPlayer({
  item,
  onClose,
}: {
  item: WatchItem;
  onClose: () => void;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState<Size>("large");
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const source = item.source;

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
  }, [volume, muted]);

  if (!source) return null;
  const src = embedUrl(source, true);
  const apply = (v: number, m: boolean) => {
    setVolume(v);
    setMuted(m);
    post(frame.current, source, { volume: v, muted: m });
  };

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

        <div className="aspect-video w-full bg-black">
          {source.kind === "file" ? (
            <video
              ref={video}
              src={source.url}
              controls
              autoPlay
              playsInline
              className="h-full w-full"
            />
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
              {muted ? `🔇 ${t("player.unmute")}` : `🔊 ${t("player.mute")}`}
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
              {source.kind !== "room" && (
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
            {source.kind !== "file" && source.kind !== "room" && (
              <p className="w-full text-muted-foreground">
                {t("player.volume.note")}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
