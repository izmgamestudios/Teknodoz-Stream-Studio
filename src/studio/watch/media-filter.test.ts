// src/studio/watch/media-filter.test.ts
import { describe, expect, it } from "vitest";

import type { MediaRecord } from "./media-client";
import {
  DEFAULT_MEDIA_QUERY,
  filterMedia,
  formatBytes,
  isFiltered,
} from "./media-filter";

const rec = (o: Partial<MediaRecord> & { id: string }): MediaRecord => ({
  kind: "video",
  mime: "video/mp4",
  file: `${o.id}.mp4`,
  size: 10 * 1024 * 1024,
  title: o.id,
  filename: `${o.id}.mp4`,
  durationMs: 60_000,
  width: 1280,
  height: 720,
  chapters: [],
  captions: [],
  hasPoster: false,
  origin: "studio",
  parentId: null,
  createdAt: "2026-10-10T12:00:00.000Z",
  ...o,
});

const list = [
  rec({
    id: "a",
    title: "Röportaj Şubat",
    createdAt: "2026-10-01T10:00:00Z",
    size: 5 * 1024 * 1024,
    durationMs: 30_000,
  }),
  rec({
    id: "b",
    title: "Podcast 12",
    kind: "audio",
    mime: "audio/mpeg",
    origin: "upload",
    createdAt: "2026-10-05T10:00:00Z",
    size: 40 * 1024 * 1024,
    durationMs: 40 * 60_000,
    captions: [{ lang: "tr", label: "Türkçe" }],
  }),
  rec({
    id: "c",
    title: "Tanıtım",
    origin: "edit",
    createdAt: "2026-10-09T10:00:00Z",
    chapters: [
      { t: 0, label: "Giriş" },
      { t: 5, label: "Sponsor" },
    ],
  }),
];
const ids = (
  q: Partial<typeof DEFAULT_MEDIA_QUERY>,
  published: string[] = [],
) =>
  filterMedia(list, { ...DEFAULT_MEDIA_QUERY, ...q }, new Set(published)).map(
    (m) => m.id,
  );

describe("filterMedia", () => {
  it("searches titles, chapters and caption languages without diacritics", () => {
    expect(ids({ text: "roportaj subat" })).toEqual(["a"]);
    expect(ids({ text: "sponsor" })).toEqual(["c"]);
    expect(ids({ text: "turkce" })).toEqual(["b"]);
    expect(ids({ text: "yok boyle" })).toEqual([]);
  });

  it("filters by kind, origin, state and captions", () => {
    expect(ids({ kind: "audio" })).toEqual(["b"]);
    expect(ids({ origin: "edit" })).toEqual(["c"]);
    expect(ids({ state: "published" }, ["a", "c"])).toEqual(["c", "a"]);
    expect(ids({ state: "draft" }, ["a", "c"])).toEqual(["b"]);
    expect(ids({ captions: "with" })).toEqual(["b"]);
    expect(ids({ captions: "without" })).toEqual(["c", "a"]);
  });

  it("filters by date, size and duration ranges (inclusive)", () => {
    expect(ids({ from: "2026-10-05", to: "2026-10-09" })).toEqual(["c", "b"]);
    expect(ids({ minMb: "20" })).toEqual(["b"]);
    expect(ids({ maxMb: "5" })).toEqual(["a"]);
    expect(ids({ minMin: "10" })).toEqual(["b"]);
    expect(ids({ maxMin: "0,5" })).toEqual(["a"]);
    expect(ids({ minMb: "abc" })).toHaveLength(3); // garbage is ignored
  });

  it("sorts", () => {
    expect(ids({ sort: "newest" })).toEqual(["c", "b", "a"]);
    expect(ids({ sort: "oldest" })).toEqual(["a", "b", "c"]);
    expect(ids({ sort: "size" })).toEqual(["b", "c", "a"]);
    expect(ids({ sort: "duration" })[0]).toBe("b");
    expect(ids({ sort: "name" })).toEqual(["b", "a", "c"]);
  });

  it("knows when a filter is active and formats sizes", () => {
    expect(isFiltered(DEFAULT_MEDIA_QUERY)).toBe(false);
    expect(isFiltered({ ...DEFAULT_MEDIA_QUERY, sort: "size" })).toBe(false);
    expect(isFiltered({ ...DEFAULT_MEDIA_QUERY, text: "x" })).toBe(true);
    expect(formatBytes(512 * 1024)).toBe("512 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(3.5 * 1024 ** 3)).toBe("3.50 GB");
  });
});
