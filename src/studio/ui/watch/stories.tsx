// src/studio/ui/watch/stories.tsx
// Stories: a row of round covers and a full-screen, tap-through viewer (progress bars, 9:16
// stage, keyboard + touch zones, hold to pause). Files play natively with real progress; embeds
// (YouTube / Vimeo / live) run on a fixed timer because their position is not readable.
import { useCallback, useEffect, useRef, useState } from "react";

import { useLang, useT } from "../../i18n/use-t";
import { relativeTime } from "../../watch/admin-filter";
import type { WatchItem } from "../../watch/filter";
import { embedUrl, fileSrc, thumbnailUrl } from "../../watch/media-url";

const SEEN_KEY = "studio.stories.seen.v1";
const EMBED_MS = 15_000;

function loadSeen(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return new Set(
      Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function saveSeen(s: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200)));
  } catch {
    /* private mode: seen state just won't persist */
  }
}

export function coverOf(i: WatchItem): string | null {
  if (i.poster) return i.poster;
  return i.source ? thumbnailUrl(i.source) : null;
}

export function StoryBar({
  items,
  onOpen,
}: {
  items: readonly WatchItem[];
  onOpen: (index: number) => void;
}) {
  const t = useT();
  const [seen, setSeen] = useState<Set<string>>(new Set());
  useEffect(() => setSeen(loadSeen()), []);
  // refresh the ring state when the viewer closes (storage changes in the same tab)
  useEffect(() => {
    const on = () => setSeen(loadSeen());
    window.addEventListener("studio-stories-seen", on);
    return () => window.removeEventListener("studio-stories-seen", on);
  }, []);
  if (items.length === 0) return null;
  return (
    <section aria-label={t("story.title")} className="mx-auto mb-5 max-w-7xl">
      <ul className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {items.map((i, idx) => {
          const cover = coverOf(i);
          const done = seen.has(i.id);
          return (
            <li key={i.id} className="w-20 shrink-0 text-center">
              <button
                type="button"
                onClick={() => onOpen(idx)}
                className="group block w-full outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={t("story.open", { title: i.title })}
              >
                <span
                  className={`mx-auto flex size-[4.5rem] items-center justify-center rounded-full p-[3px] ${
                    done
                      ? "bg-border"
                      : "bg-gradient-to-tr from-speaker-a via-primary-solid to-speaker-b"
                  }`}
                >
                  <span className="flex size-full items-center justify-center overflow-hidden rounded-full border-2 border-background bg-secondary text-xl">
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
                      <span aria-hidden="true">▶</span>
                    )}
                  </span>
                </span>
                <span className="mt-1 line-clamp-2 block text-[11px] leading-tight">
                  {i.title}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function StoryViewer({
  items,
  start,
  onClose,
}: {
  items: readonly WatchItem[];
  start: number;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const [index, setIndex] = useState(
    Math.min(Math.max(start, 0), items.length - 1),
  );
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const item = items[index];
  const src = item?.source ? fileSrc(item.source) : null;
  const isFile = src !== null;

  const markSeen = useCallback((id: string) => {
    const s = loadSeen();
    s.add(id);
    saveSeen(s);
    window.dispatchEvent(new Event("studio-stories-seen"));
  }, []);

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0) return setProgress(0);
      if (next >= items.length) return onClose();
      setIndex(next);
      setProgress(0);
    },
    [index, items.length, onClose],
  );

  useEffect(() => {
    if (item) markSeen(item.id);
  }, [item, markSeen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  // embeds: timer-driven progress
  useEffect(() => {
    if (isFile || paused || !item) return;
    const startedAt = performance.now() - progress * EMBED_MS;
    const id = window.setInterval(() => {
      const p = (performance.now() - startedAt) / EMBED_MS;
      if (p >= 1) {
        window.clearInterval(id);
        go(1);
      } else setProgress(p);
    }, 100);
    return () => window.clearInterval(id);
    // progress is read once when (re)starting; it must not restart the timer every tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused, isFile, item]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (paused) v.pause();
    else void v.play().catch(() => undefined);
  }, [paused, index]);

  if (!item) return null;
  const embed = item.source ? embedUrl(item.source, true) : null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
    >
      <div className="relative aspect-[9/16] h-full max-h-[100dvh] max-w-full overflow-hidden bg-black">
        {isFile && src ? (
          <video
            key={item.id}
            ref={video}
            src={src}
            autoPlay
            playsInline
            muted={muted}
            className="size-full object-contain"
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration > 0) setProgress(v.currentTime / v.duration);
            }}
            onEnded={() => go(1)}
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
        ) : embed ? (
          <iframe
            key={item.id}
            src={embed}
            title={item.title}
            className="size-full"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation"
          />
        ) : (
          <p className="flex size-full items-center justify-center p-6 text-center text-white">
            {item.title}
          </p>
        )}

        {/* tap zones */}
        <button
          type="button"
          className="absolute inset-y-14 left-0 w-1/3"
          aria-label={t("story.prev")}
          onClick={() => go(-1)}
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
        />
        <button
          type="button"
          className="absolute inset-y-14 right-0 w-1/3"
          aria-label={t("story.next")}
          onClick={() => go(1)}
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-3 text-white">
          <div className="flex gap-1" aria-hidden="true">
            {items.map((s, i) => (
              <span
                key={s.id}
                className="h-0.5 flex-1 overflow-hidden rounded bg-white/30"
              >
                <span
                  className="block h-full bg-white"
                  style={{
                    width: `${i < index ? 100 : i === index ? progress * 100 : 0}%`,
                  }}
                />
              </span>
            ))}
          </div>
          <p className="mt-2 truncate text-sm font-semibold">{item.title}</p>
          {item.storyUntil && (
            <p className="text-[11px] opacity-80">
              {t("story.ends", {
                t: relativeTime(Date.parse(item.storyUntil) - Date.now(), lang),
              })}
            </p>
          )}
        </div>
        <div className="absolute right-2 top-9 flex gap-1">
          {isFile && (
            <button
              type="button"
              className="rounded-full bg-black/50 px-2 py-1 text-xs text-white"
              onClick={() => setMuted((m) => !m)}
              aria-pressed={muted}
              aria-label={muted ? t("story.unmute") : t("story.mute")}
            >
              {muted ? "🔇" : "🔊"}
            </button>
          )}
          <button
            type="button"
            className="rounded-full bg-black/50 px-2 py-1 text-xs text-white"
            onClick={onClose}
            aria-label={t("story.close")}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
