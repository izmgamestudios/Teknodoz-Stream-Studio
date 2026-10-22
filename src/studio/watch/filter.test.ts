// src/studio/watch/filter.test.ts
import { describe, expect, it } from "vitest";

import {
  categoriesOf,
  DEFAULT_QUERY,
  filterItems,
  fold,
  type WatchItem,
} from "./filter";

const NOW = Date.parse("2026-10-22T12:00:00");
const yt = { kind: "youtube", id: "dQw4w9WgXcQ" } as const;
const item = (o: Partial<WatchItem> & { id: string }): WatchItem => ({
  origin: "catalog",
  title: o.id,
  description: "",
  category: "",
  tags: [],
  source: yt,
  locked: false,
  needsPassword: false,
  live: false,
  startsAt: null,
  createdAt: "2026-10-01T10:00:00",
  story: false,
  playlist: "",
  episode: null,
  poster: "",
  captions: [],
  ...o,
});

describe("fold", () => {
  it("ignores case and diacritics", () => {
    expect(fold("Şarkı ÜBER Straße")).toBe("sarki uber strasse");
  });
});

describe("filterItems", () => {
  const items = [
    item({
      id: "old",
      title: "Eski Şarkı",
      category: "Müzik",
      createdAt: "2026-08-01T10:00:00",
    }),
    item({ id: "live", title: "Canlı", live: true, category: "Teknoloji" }),
    item({ id: "soon", title: "Yarın", startsAt: "2026-10-23T18:00:00" }),
    item({ id: "later", title: "Haftaya", startsAt: "2026-10-29T18:00:00" }),
    item({
      id: "today",
      title: "Bugün",
      createdAt: "2026-10-22T08:00:00",
      tags: ["react"],
    }),
    item({
      id: "room",
      origin: "room",
      title: "Oda",
      source: { kind: "room", code: "AB3CDE" },
    }),
  ];

  it("smart sort: live, then soonest upcoming, then newest", () => {
    const ids = filterItems(items, DEFAULT_QUERY, NOW).map((i) => i.id);
    expect(ids.slice(0, 2).sort()).toEqual(["live", "room"]);
    expect(ids.slice(2)).toEqual(["soon", "later", "today", "old"]);
  });

  it("searches title, tags and category without diacritics", () => {
    const f = (text: string) =>
      filterItems(items, { ...DEFAULT_QUERY, text }, NOW).map((i) => i.id);
    expect(f("sarki")).toEqual(["old"]);
    expect(f("REACT")).toEqual(["today"]);
    expect(f("muzik eski")).toEqual(["old"]);
    expect(f("yok böyle")).toEqual([]);
  });

  it("filters by category and time", () => {
    const f = (o: Partial<typeof DEFAULT_QUERY>) =>
      filterItems(items, { ...DEFAULT_QUERY, ...o }, NOW).map((i) => i.id);
    expect(f({ category: "Müzik" })).toEqual(["old"]);
    expect(f({ time: "upcoming" })).toEqual(["soon", "later"]);
    expect(f({ time: "today" })).toEqual(["today"]);
    expect(f({ time: "live" }).sort()).toEqual(["live", "room"]);
    expect(f({ time: "month" })).toContain("today");
    expect(f({ time: "month" })).not.toContain("old");
  });

  it("filters by playlist and searches playlist names", () => {
    const withPl = [
      item({ id: "a", playlist: "Gece Haberleri" }),
      item({ id: "b", playlist: "Dizi X" }),
      item({ id: "c" }),
    ];
    const ids = (q: Partial<typeof DEFAULT_QUERY>) =>
      filterItems(withPl, { ...DEFAULT_QUERY, ...q }, NOW).map((i) => i.id);
    expect(ids({ playlist: "Dizi X" })).toEqual(["b"]);
    expect(ids({ text: "gece haberleri" })).toEqual(["a"]);
  });

  it("lists distinct sorted categories", () => {
    expect(categoriesOf(items)).toEqual(["Müzik", "Teknoloji"]);
  });
});
