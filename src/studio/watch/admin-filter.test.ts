// src/studio/watch/admin-filter.test.ts
import { describe, expect, it } from "vitest";

import {
  countAdmin,
  DEFAULT_ADMIN_QUERY,
  filterAdminItems,
  relativeTime,
  storyRemainingMs,
  storyState,
  untilFromPreset,
} from "./admin-filter";
import type { AdminItem } from "./catalog-client";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const hours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

const item = (o: Partial<AdminItem> & { id: string }): AdminItem => ({
  title: o.id,
  description: "",
  category: "",
  tags: [],
  source: { kind: "youtube", id: "dQw4w9WgXcQ" },
  visibility: "public",
  hasPassword: false,
  linkKey: null,
  startsAt: null,
  live: false,
  story: false,
  playlist: "",
  episode: null,
  poster: "",
  captions: [],
  archived: false,
  storyUntil: null,
  featured: false,
  durationMs: null,
  createdAt: "2026-10-01T10:00:00Z",
  ...o,
});

const items = [
  item({ id: "plain", title: "Düz video", category: "Film" }),
  item({ id: "s-soon", story: true, storyUntil: hours(2) }),
  item({ id: "s-late", story: true, storyUntil: hours(48) }),
  item({ id: "s-open", story: true }),
  item({ id: "s-dead", story: true, storyUntil: hours(-5) }),
  item({ id: "old", archived: true, createdAt: "2026-09-01T10:00:00Z" }),
  item({ id: "hero", featured: true, createdAt: "2026-10-20T10:00:00Z" }),
  item({ id: "priv", visibility: "private" }),
  item({ id: "tv", live: true }),
  item({ id: "next", startsAt: hours(24) }),
];
const ids = (q: Partial<typeof DEFAULT_ADMIN_QUERY>) =>
  filterAdminItems(items, { ...DEFAULT_ADMIN_QUERY, ...q }, NOW).map(
    (i) => i.id,
  );

describe("story state", () => {
  it("is off / active / expired and reports the time left", () => {
    expect(storyState(items[0]!, NOW)).toBe("off");
    expect(storyState(items[1]!, NOW)).toBe("active");
    expect(storyState(items[3]!, NOW)).toBe("active"); // no expiry
    expect(storyState(items[4]!, NOW)).toBe("expired");
    expect(storyRemainingMs(items[1]!, NOW)).toBe(2 * 3_600_000);
    expect(storyRemainingMs(items[3]!, NOW)).toBeNull();
    expect(storyRemainingMs(items[4]!, NOW)).toBeLessThan(0);
  });

  it("presets and relative time", () => {
    expect(untilFromPreset(24, NOW)).toBe(hours(24));
    expect(untilFromPreset(null, NOW)).toBeNull();
    expect(relativeTime(2 * 3_600_000, "en")).toBe("in 2 hours");
    expect(relativeTime(-3 * 86_400_000, "en")).toBe("3 days ago");
    expect(relativeTime(10 * 60_000, "en")).toBe("in 10 minutes");
  });
});

describe("filterAdminItems", () => {
  it("filters by status", () => {
    expect(ids({ status: "archived" })).toEqual(["old"]);
    expect(ids({ status: "story" }).sort()).toEqual([
      "s-late",
      "s-open",
      "s-soon",
    ]);
    expect(ids({ status: "story-expired" })).toEqual(["s-dead"]);
    expect(ids({ status: "featured" })).toEqual(["hero"]);
    expect(ids({ status: "private" })).toEqual(["priv"]);
    expect(ids({ status: "live" })).toEqual(["tv"]);
    expect(ids({ status: "upcoming" })).toEqual(["next"]);
    expect(ids({ status: "published" })).not.toContain("old");
  });

  it("searches and filters by category", () => {
    expect(ids({ text: "duz" })).toEqual(["plain"]);
    expect(ids({ category: "Film" })).toEqual(["plain"]);
  });

  it("sorts stories by the soonest expiry first", () => {
    const sorted = ids({ sort: "story" });
    expect(sorted.slice(0, 3)).toEqual(["s-dead", "s-soon", "s-late"]);
    expect(sorted[3]).toBe("s-open");
    expect(ids({ sort: "oldest" })[0]).toBe("old");
  });

  it("counts", () => {
    expect(countAdmin(items, NOW)).toEqual({
      total: 10,
      published: 9,
      archived: 1,
      storyActive: 3,
      storyExpired: 1,
      featured: 1,
    });
  });
});
