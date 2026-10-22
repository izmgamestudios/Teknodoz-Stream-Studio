// src/studio/ui/watch/card.tsx
// YouTube-style video card: thumbnail, badges, title and meta. On hover-capable devices a muted
// inline preview starts after a short delay (one card at a time).
import { useEffect, useRef, useState } from "react";

import { useLang, useT } from "../../i18n/use-t";
import type { Lang } from "../../i18n/messages";
import type { WatchItem } from "../../watch/filter";
import { thumbnailUrl } from "../../watch/media-url";

const LOCALE: Record<Lang, string> = {
  tr: "tr-TR",
  en: "en-GB",
  de: "de-DE",
  es: "es-ES",
};

export function formatWhen(iso: string | null, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE[lang], {
    dateStyle: "medium",
    timeStyle:
      iso.includes("T") && d.getHours() + d.getMinutes() > 0
        ? "short"
        : undefined,
  }).format(d);
}

export function WatchCard({
  item,
  onOpen,
}: {
  item: WatchItem;
  onOpen: (item: WatchItem) => void;
}) {
  const t = useT();
  const lang = useLang();
  const [preview, setPreview] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const thumb = item.source ? thumbnailUrl(item.source) : null;
  const canPreview =
    !item.locked && item.source?.kind === "youtube" && !item.live;
  const upcoming =
    item.startsAt !== null && Date.parse(item.startsAt) > Date.now();
  const when = formatWhen(item.startsAt ?? item.createdAt, lang);

  const startPreview = () => {
    if (!canPreview || !window.matchMedia("(hover: hover)").matches) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPreview(true), 700);
  };
  const stopPreview = () => {
    window.clearTimeout(timer.current);
    setPreview(false);
  };

  return (
    <article
      className="group flex flex-col gap-2"
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
    >
      <button
        type="button"
        onClick={() => onOpen(item)}
        onFocus={undefined}
        className="relative block aspect-video w-full overflow-hidden rounded-xl bg-secondary text-left outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`${t("watch.open")}: ${item.title}`}
      >
        {thumb && !item.locked && !thumbFailed ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            onError={() => setThumbFailed(true)}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted text-5xl"
          >
            {item.locked ? "🔒" : item.origin === "room" ? "🚪" : "▶"}
          </span>
        )}
        {preview && item.source?.kind === "youtube" && (
          <iframe
            title=""
            aria-hidden="true"
            tabIndex={-1}
            src={`https://www.youtube-nocookie.com/embed/${item.source.id}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0`}
            className="pointer-events-none absolute inset-0 h-full w-full"
            allow="autoplay"
            sandbox="allow-scripts allow-same-origin"
          />
        )}
        <span className="absolute left-2 top-2 flex gap-1 text-[10px] font-bold uppercase">
          {(item.live || item.origin === "room") && (
            <span className="rounded bg-destructive px-1.5 py-0.5 text-primary-foreground">
              ● {t("watch.live")}
            </span>
          )}
          {upcoming && (
            <span className="rounded bg-speaker-b px-1.5 py-0.5 text-background">
              {t("watch.upcoming")}
            </span>
          )}
          {item.locked && (
            <span className="rounded bg-background/90 px-1.5 py-0.5 text-foreground">
              {t("watch.private")}
            </span>
          )}
        </span>
      </button>
      <div className="min-w-0">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug">
          {item.title}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {[
            item.category,
            item.origin === "room" && item.viewers !== undefined
              ? t("watch.room.viewers", { n: item.viewers })
              : when,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {item.tags.length > 0 && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {item.tags.map((x) => `#${x}`).join(" ")}
          </p>
        )}
      </div>
    </article>
  );
}
