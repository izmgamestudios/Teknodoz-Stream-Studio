// src/studio/ui/watch/rail.tsx
// Horizontal "rail" (Netflix / YouTube style): a titled row that scrolls sideways with snap and
// arrow buttons on devices with a pointer.
import { useRef, type ReactNode } from "react";

import { useT } from "../../i18n/use-t";

export function Rail({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const row = useRef<HTMLUListElement>(null);
  const scroll = (dir: -1 | 1) =>
    row.current?.scrollBy({
      left: dir * Math.max(240, row.current.clientWidth * 0.8),
      behavior: "smooth",
    });
  const arrow =
    "hidden size-8 items-center justify-center rounded-full bg-secondary text-sm hover:bg-accent md:inline-flex";
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        {count !== undefined && (
          <span className="text-xs text-muted-foreground">{count}</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {action}
          <button
            type="button"
            className={arrow}
            onClick={() => scroll(-1)}
            aria-label={t("watch.rail.left")}
          >
            ‹
          </button>
          <button
            type="button"
            className={arrow}
            onClick={() => scroll(1)}
            aria-label={t("watch.rail.right")}
          >
            ›
          </button>
        </span>
      </div>
      <ul
        ref={row}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]"
      >
        {children}
      </ul>
    </section>
  );
}

export function RailItem({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <li
      className={`shrink-0 snap-start ${wide ? "w-72 sm:w-80" : "w-56 sm:w-64"}`}
    >
      {children}
    </li>
  );
}
