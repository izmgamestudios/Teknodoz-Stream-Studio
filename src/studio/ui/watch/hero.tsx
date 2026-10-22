// src/studio/ui/watch/hero.tsx
// Featured banner at the top of the watch page: large cover, title, description, play. Rotates
// every few seconds (paused on hover / focus, and for people who prefer reduced motion).
import { useEffect, useState } from "react";

import { useT } from "../../i18n/use-t";
import type { WatchItem } from "../../watch/filter";
import { BTN } from "../fields";
import { coverOf } from "./stories";

const ROTATE_MS = 7000;

export function Hero({
  items,
  onPlay,
}: {
  items: readonly WatchItem[];
  onPlay: (item: WatchItem) => void;
}) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = items.length;

  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [index, count]);

  useEffect(() => {
    if (count < 2 || paused) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % count),
      ROTATE_MS,
    );
    return () => window.clearInterval(id);
  }, [count, paused]);

  const item = items[Math.min(index, count - 1)];
  if (!item) return null;
  const cover = coverOf(item);

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t("watch.hero")}
      className="relative mx-auto mb-6 max-w-7xl overflow-hidden rounded-2xl border bg-secondary"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="relative aspect-[21/9] min-h-52 w-full sm:min-h-64">
        {cover ? (
          <img
            src={cover}
            alt=""
            referrerPolicy="no-referrer"
            className="absolute inset-0 size-full object-cover"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-secondary via-muted to-secondary" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 space-y-2 p-4 text-white sm:p-6">
          <p className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
            {item.live && (
              <span className="rounded bg-destructive px-1.5 py-0.5">
                ● {t("watch.live")}
              </span>
            )}
            {item.category && (
              <span className="opacity-90">{item.category}</span>
            )}
            {item.playlist && (
              <span className="opacity-90">
                {item.playlist}
                {item.episode !== null
                  ? ` · ${t("watch.episode", { n: item.episode })}`
                  : ""}
              </span>
            )}
          </p>
          <h2 className="max-w-3xl text-2xl font-bold leading-tight sm:text-4xl">
            {item.title}
          </h2>
          {item.description && (
            <p className="line-clamp-2 max-w-2xl text-sm opacity-90">
              {item.description}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-bold text-black hover:bg-white/90"
              onClick={() => onPlay(item)}
            >
              ▶ {t("watch.open")}
            </button>
            {count > 1 && (
              <span
                className="ml-auto flex items-center gap-1"
                role="group"
                aria-label={t("watch.hero")}
              >
                <button
                  className={BTN}
                  onClick={() => setIndex((index - 1 + count) % count)}
                  aria-label={t("watch.rail.left")}
                >
                  ‹
                </button>
                {items.map((it, i) => (
                  <button
                    key={it.id}
                    aria-label={`${i + 1} / ${count}`}
                    aria-current={i === index ? "true" : undefined}
                    className={`size-2.5 rounded-full ${i === index ? "bg-white" : "bg-white/40"}`}
                    onClick={() => setIndex(i)}
                  />
                ))}
                <button
                  className={BTN}
                  onClick={() => setIndex((index + 1) % count)}
                  aria-label={t("watch.rail.right")}
                >
                  ›
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
