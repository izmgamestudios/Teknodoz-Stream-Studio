// src/studio/watch/admin-filter.ts
// Filtering, sorting and story-expiry helpers for the watch management page.
import type { AdminItem } from "./catalog-client";
import { fold } from "./filter";

export type AdminStatus =
  | ""
  | "published"
  | "archived"
  | "story"
  | "story-expired"
  | "featured"
  | "private"
  | "live"
  | "upcoming";

export type AdminSort = "newest" | "oldest" | "title" | "story";

export interface AdminQuery {
  text: string;
  status: AdminStatus;
  category: string;
  sort: AdminSort;
}

export const DEFAULT_ADMIN_QUERY: AdminQuery = {
  text: "",
  status: "",
  category: "",
  sort: "newest",
};

export type StoryState = "off" | "active" | "expired";

export function storyState(item: AdminItem, nowMs: number): StoryState {
  if (!item.story) return "off";
  if (!item.storyUntil) return "active";
  const until = Date.parse(item.storyUntil);
  return !Number.isNaN(until) && until <= nowMs ? "expired" : "active";
}

/** ms until the story ends (null = no expiry), negative once expired. */
export function storyRemainingMs(
  item: AdminItem,
  nowMs: number,
): number | null {
  if (!item.story || !item.storyUntil) return null;
  const until = Date.parse(item.storyUntil);
  return Number.isNaN(until) ? null : until - nowMs;
}

/** "in 5 hours" / "2 days ago" in the viewer's language, using the largest sensible unit. */
export function relativeTime(ms: number, lang: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const abs = Math.abs(ms);
  const sign = ms < 0 ? -1 : 1;
  if (abs < 3_600_000)
    return rtf.format(sign * Math.max(1, Math.round(abs / 60_000)), "minute");
  if (abs < 86_400_000)
    return rtf.format(sign * Math.round(abs / 3_600_000), "hour");
  return rtf.format(sign * Math.round(abs / 86_400_000), "day");
}

export function matchesStatus(
  item: AdminItem,
  status: AdminStatus,
  nowMs: number,
): boolean {
  switch (status) {
    case "":
      return true;
    case "published":
      return !item.archived;
    case "archived":
      return item.archived;
    case "story":
      return !item.archived && storyState(item, nowMs) === "active";
    case "story-expired":
      return storyState(item, nowMs) === "expired";
    case "featured":
      return item.featured && !item.archived;
    case "private":
      return item.visibility === "private";
    case "live":
      return item.live;
    case "upcoming":
      return !!item.startsAt && Date.parse(item.startsAt) > nowMs;
  }
}

export function filterAdminItems(
  items: readonly AdminItem[],
  q: AdminQuery,
  nowMs: number,
): AdminItem[] {
  const terms = fold(q.text).split(/\s+/).filter(Boolean);
  const out = items.filter((i) => {
    if (q.category && i.category !== q.category) return false;
    if (!matchesStatus(i, q.status, nowMs)) return false;
    if (terms.length === 0) return true;
    const hay = fold(
      `${i.title} ${i.description} ${i.category} ${i.playlist} ${i.tags.join(" ")}`,
    );
    return terms.every((t) => hay.includes(t));
  });
  const cmp: Record<AdminSort, (a: AdminItem, b: AdminItem) => number> = {
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
    title: (a, b) => a.title.localeCompare(b.title),
    // stories ending soonest first; stories without expiry, then everything else
    story: (a, b) => {
      const ra = storyRemainingMs(a, nowMs);
      const rb = storyRemainingMs(b, nowMs);
      const ka = a.story
        ? (ra ?? Number.MAX_SAFE_INTEGER - 1)
        : Number.MAX_SAFE_INTEGER;
      const kb = b.story
        ? (rb ?? Number.MAX_SAFE_INTEGER - 1)
        : Number.MAX_SAFE_INTEGER;
      return ka - kb;
    },
  };
  return out.sort(cmp[q.sort]);
}

export interface AdminCounts {
  total: number;
  published: number;
  archived: number;
  storyActive: number;
  storyExpired: number;
  featured: number;
}

export function countAdmin(
  items: readonly AdminItem[],
  nowMs: number,
): AdminCounts {
  return {
    total: items.length,
    published: items.filter((i) => !i.archived).length,
    archived: items.filter((i) => i.archived).length,
    storyActive: items.filter(
      (i) => !i.archived && storyState(i, nowMs) === "active",
    ).length,
    storyExpired: items.filter((i) => storyState(i, nowMs) === "expired")
      .length,
    featured: items.filter((i) => i.featured && !i.archived).length,
  };
}

/** Story expiry presets, in hours (null = until archived). */
export const STORY_PRESETS: readonly {
  id: "24h" | "3d" | "7d" | "30d" | "none";
  hours: number | null;
}[] = [
  { id: "24h", hours: 24 },
  { id: "3d", hours: 72 },
  { id: "7d", hours: 168 },
  { id: "30d", hours: 720 },
  { id: "none", hours: null },
];

export function untilFromPreset(
  hours: number | null,
  nowMs: number,
): string | null {
  return hours === null
    ? null
    : new Date(nowMs + hours * 3_600_000).toISOString();
}
