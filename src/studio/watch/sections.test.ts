// src/studio/watch/sections.test.ts
import { describe, expect, it } from "vitest";

import type { WatchItem } from "./filter";
import {
  nextInQueue,
  playlistOrder,
  playlistsOf,
  queueFor,
  sectionsOf,
  storiesOf,
} from "./sections";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const item = (o: Partial<WatchItem> & { id: string }): WatchItem => ({
  origin: "catalog",
  title: o.id,
  description: "",
  category: "",
  tags: [],
  source: { kind: "youtube", id: "dQw4w9WgXcQ" },
  locked: false,
  needsPassword: false,
  live: false,
  startsAt: null,
  createdAt: "2026-10-01T10:00:00Z",
  story: false,
  playlist: "",
  episode: null,
  poster: "",
  captions: [],
  ...o,
});

describe("stories", () => {
  it("keeps playable, non-audio story items, newest first", () => {
    const list = [
      item({ id: "a", story: true, createdAt: "2026-10-02T00:00:00Z" }),
      item({ id: "b", story: true, createdAt: "2026-10-05T00:00:00Z" }),
      item({ id: "c", story: true, locked: true, source: null }),
      item({
        id: "d",
        story: true,
        source: { kind: "audio", url: "https://x.test/a.mp3" },
      }),
      item({ id: "e" }),
    ];
    expect(storiesOf(list).map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("playlists and the queue", () => {
  const eps = [
    item({ id: "e3", playlist: "Dizi", episode: 3 }),
    item({ id: "e1", playlist: "Dizi", episode: 1 }),
    item({
      id: "x",
      playlist: "Dizi",
      episode: null,
      createdAt: "2026-09-01T00:00:00Z",
    }),
    item({ id: "e2", playlist: "Dizi", episode: 2 }),
    item({
      id: "lock",
      playlist: "Dizi",
      episode: 4,
      locked: true,
      source: null,
    }),
    item({ id: "solo" }),
  ];

  it("orders by episode number, unnumbered after numbered", () => {
    expect(
      playlistOrder(eps.filter((i) => i.playlist)).map((i) => i.id),
    ).toEqual(["e1", "e2", "e3", "lock", "x"]);
    expect(playlistsOf(eps)).toHaveLength(1);
    expect(playlistsOf(eps)[0]?.items.map((i) => i.id)).toEqual([
      "e1",
      "e2",
      "e3",
      "x",
    ]);
  });

  it("queue = the playlist, else the browsing list without locked/rooms", () => {
    expect(queueFor(eps, eps[1]!).map((i) => i.id)).toEqual([
      "e1",
      "e2",
      "e3",
      "x",
    ]);
    const browsing = [
      item({ id: "p" }),
      item({ id: "q", locked: true, source: null }),
      item({ id: "r", origin: "room" }),
    ];
    expect(queueFor(eps, eps[5]!, browsing).map((i) => i.id)).toEqual(["p"]);
  });

  it("finds the next item", () => {
    const q = queueFor(eps, eps[1]!);
    expect(nextInQueue(q, "e1")?.id).toBe("e2");
    expect(nextInQueue(q, "x")).toBeNull();
    expect(nextInQueue(q, "nope")?.id).toBe("e1");
  });
});

describe("sectionsOf", () => {
  it("splits live, upcoming, audio and category rails", () => {
    const list = [
      item({ id: "live", live: true, category: "Haber" }),
      item({ id: "room", origin: "room", live: true }),
      item({ id: "soon", startsAt: "2026-10-23T10:00:00Z" }),
      item({
        id: "pod",
        source: { kind: "audio", url: "https://x.test/p.mp3" },
        category: "Podcast",
      }),
      item({ id: "film", category: "Film", createdAt: "2026-09-01T00:00:00Z" }),
      item({
        id: "film2",
        category: "Film",
        createdAt: "2026-10-01T00:00:00Z",
      }),
      item({ id: "news", category: "Haber" }),
      item({ id: "none" }),
    ];
    const s = sectionsOf(list, NOW);
    expect(s.live.map((i) => i.id)).toEqual(["live", "room"]);
    expect(s.upcoming.map((i) => i.id)).toEqual(["soon"]);
    expect(s.audio.map((i) => i.id)).toEqual(["pod"]);
    expect(s.categories.map((c) => c.name)).toEqual(["Film", "Haber", ""]);
    expect(s.categories[0]?.items.map((i) => i.id)).toEqual(["film2", "film"]);
  });
});
