// src/studio/watch/sections.ts
// Pure grouping used by the watch home: stories, playlists (series), live TV lane, podcast lane,
// category rails and the "up next" queue.
import { compareCategories } from "./categories";
import { isAudioSource } from "./media-url";
import type { WatchItem } from "./filter";

const when = (i: WatchItem): number => {
  const t = Date.parse(i.startsAt ?? i.createdAt);
  return Number.isNaN(t) ? 0 : t;
};

export const isAudioItem = (i: WatchItem): boolean => isAudioSource(i.source);

/** Stories: marked items that are playable right now (not locked, not audio-only). */
export function storiesOf(items: readonly WatchItem[]): WatchItem[] {
  return items
    .filter((i) => i.story && !i.locked && i.source && !isAudioItem(i))
    .sort((a, b) => when(b) - when(a));
}

/** Episodes of one playlist in watching order: episode number first, then oldest first. */
export function playlistOrder(items: readonly WatchItem[]): WatchItem[] {
  return [...items].sort((a, b) => {
    if (a.episode !== null && b.episode !== null && a.episode !== b.episode)
      return a.episode - b.episode;
    if (a.episode !== null && b.episode === null) return -1;
    if (a.episode === null && b.episode !== null) return 1;
    return when(a) - when(b);
  });
}

export interface Playlist {
  name: string;
  items: WatchItem[];
}

/** All playlists with at least one playable (unlocked) episode. */
export function playlistsOf(items: readonly WatchItem[]): Playlist[] {
  const map = new Map<string, WatchItem[]>();
  for (const i of items) {
    if (!i.playlist || i.locked) continue;
    const list = map.get(i.playlist);
    if (list) list.push(i);
    else map.set(i.playlist, [i]);
  }
  return [...map.entries()]
    .map(([name, list]) => ({ name, items: playlistOrder(list) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The queue shown next to the player: the item's playlist when it has one, otherwise the
 * `fallback` list (what the viewer was browsing) without locked / room entries.
 */
export function queueFor(
  items: readonly WatchItem[],
  current: WatchItem,
  fallback: readonly WatchItem[] = [],
): WatchItem[] {
  if (current.playlist)
    return playlistOrder(
      items.filter((i) => i.playlist === current.playlist && !i.locked),
    );
  return fallback.filter(
    (i) => !i.locked && i.origin === "catalog" && i.source !== null,
  );
}

export function nextInQueue(
  queue: readonly WatchItem[],
  currentId: string,
): WatchItem | null {
  const i = queue.findIndex((q) => q.id === currentId);
  if (i < 0) return queue[0] ?? null;
  return queue[i + 1] ?? null;
}

export interface Sections {
  /** live TV lane: live items + public rooms on air */
  live: WatchItem[];
  upcoming: WatchItem[];
  /** audio items: podcasts and music */
  audio: WatchItem[];
  playlists: Playlist[];
  /** one rail per category, newest first (audio and live items are in their own lanes) */
  categories: { name: string; items: WatchItem[] }[];
}

export function sectionsOf(
  items: readonly WatchItem[],
  now = Date.now(),
): Sections {
  const live = items.filter((i) => i.live || i.origin === "room");
  const upcoming = items
    .filter((i) => !i.live && i.startsAt !== null && when(i) > now)
    .sort((a, b) => when(a) - when(b));
  const audio = items
    .filter((i) => isAudioItem(i))
    .sort((a, b) => when(b) - when(a));
  const rest = items.filter(
    (i) => !live.includes(i) && !upcoming.includes(i) && !audio.includes(i),
  );
  const byCat = new Map<string, WatchItem[]>();
  for (const i of rest) {
    const k = i.category || "";
    const l = byCat.get(k);
    if (l) l.push(i);
    else byCat.set(k, [i]);
  }
  const categories = [...byCat.entries()]
    .map(([name, list]) => ({
      name,
      items: list.sort((a, b) => when(b) - when(a)),
    }))
    // editorial topics first (in their fixed order), other names alphabetically, the
    // uncategorised rail last
    .sort((a, b) =>
      a.name === ""
        ? 1
        : b.name === ""
          ? -1
          : compareCategories(a.name, b.name),
    );
  return {
    live,
    upcoming,
    audio,
    playlists: playlistsOf(items),
    categories,
  };
}
