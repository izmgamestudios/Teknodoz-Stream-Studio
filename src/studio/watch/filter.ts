// src/studio/watch/filter.ts
// Pure search / category / time filtering and sorting for the viewer gallery.
import type { MediaSource } from "./media-url";

export interface WatchItem {
  id: string;
  origin: "catalog" | "room";
  title: string;
  description: string;
  category: string;
  tags: string[];
  source: MediaSource | null;
  locked: boolean;
  needsPassword: boolean;
  live: boolean;
  /** ISO; future = upcoming */
  startsAt: string | null;
  createdAt: string;
  viewers?: number;
  story: boolean;
  playlist: string;
  episode: number | null;
  poster: string;
  captions: { lang: string; label: string; url: string }[];
}

export type TimeFilter =
  "all" | "live" | "upcoming" | "today" | "week" | "month";
export type SortKey = "smart" | "newest" | "oldest" | "title";

export interface WatchQuery {
  text: string;
  category: string;
  /** playlist / series name ("" = any) */
  playlist: string;
  time: TimeFilter;
  sort: SortKey;
}

export const DEFAULT_QUERY: WatchQuery = {
  text: "",
  category: "",
  playlist: "",
  time: "all",
  sort: "smart",
};

const DAY = 86_400_000;

/** Lowercase + strip diacritics so "sarki" finds "şarkı" and "uber" finds "Über". */
export function fold(s: string): string {
  return s
    .toLocaleLowerCase("en")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/ß/g, "ss");
}

function when(i: WatchItem): number {
  const t = Date.parse(i.startsAt ?? i.createdAt);
  return Number.isNaN(t) ? 0 : t;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function matchesTime(i: WatchItem, time: TimeFilter, now: number): boolean {
  const w = when(i);
  switch (time) {
    case "all":
      return true;
    case "live":
      return i.live || i.origin === "room";
    case "upcoming":
      return i.startsAt !== null && w > now;
    case "today":
      return w >= startOfDay(now) && w < startOfDay(now) + DAY;
    case "week":
      return w >= startOfDay(now) - 6 * DAY && w < startOfDay(now) + DAY;
    case "month":
      return w >= startOfDay(now) - 29 * DAY && w < startOfDay(now) + DAY;
  }
}

function rank(i: WatchItem, now: number): number {
  if (i.live || i.origin === "room") return 0;
  if (i.startsAt !== null && when(i) > now) return 1;
  return 2;
}

export function filterItems(
  items: readonly WatchItem[],
  q: WatchQuery,
  now = Date.now(),
): WatchItem[] {
  const terms = fold(q.text).split(/\s+/).filter(Boolean);
  const out = items.filter((i) => {
    if (q.category && i.category !== q.category) return false;
    if (q.playlist && i.playlist !== q.playlist) return false;
    if (!matchesTime(i, q.time, now)) return false;
    if (terms.length === 0) return true;
    const hay = fold(
      `${i.title} ${i.description} ${i.category} ${i.playlist} ${i.tags.join(" ")}`,
    );
    return terms.every((t) => hay.includes(t));
  });
  const cmp: Record<SortKey, (a: WatchItem, b: WatchItem) => number> = {
    smart: (a, b) => {
      const ra = rank(a, now);
      const rb = rank(b, now);
      if (ra !== rb) return ra - rb;
      // upcoming: soonest first; everything else: newest first
      return ra === 1 ? when(a) - when(b) : when(b) - when(a);
    },
    newest: (a, b) => when(b) - when(a),
    oldest: (a, b) => when(a) - when(b),
    title: (a, b) => a.title.localeCompare(b.title),
  };
  return out.sort(cmp[q.sort]);
}

export function categoriesOf(items: readonly WatchItem[]): string[] {
  return [...new Set(items.map((i) => i.category).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
}
