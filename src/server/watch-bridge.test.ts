import { describe, expect, it } from "vitest";

import { memoryStore } from "./catalog";
import { blankRow, type ContentRow } from "./content-model";
import { recordBackedContentStore } from "./content-store";
import { bridgeItems, contentToItem } from "./watch-bridge";

const NOW = "2026-10-22T10:00:00.000Z";
const row = (type: ContentRow["type"], patch: Partial<ContentRow>) =>
  blankRow(type, "Başlık", NOW, {
    slug: "baslik",
    visibility: "public",
    ...patch,
  });

describe("watch bridge", () => {
  it("maps a public podcast with an uploaded file to an audio upload item with a page link", () => {
    const i = contentToItem(
      row("podcast", {
        summary: "Özet",
        meta: {
          media_url: "/media/0123456789abcdef",
          duration_sec: 61,
          series: "Seri",
          episode: 2,
        },
      }),
    );
    expect(i).toMatchObject({
      source: { kind: "upload", id: "0123456789abcdef", media: "audio" },
      playlist: "Seri",
      episode: 2,
      durationMs: 61_000,
      locked: false,
      pageUrl: "/library/podcasts/baslik",
    });
  });
  it("maps YouTube videos and skips rows that are not public or have no playable source", () => {
    expect(
      contentToItem(
        row("video", { meta: { media_url: "https://youtu.be/dQw4w9WgXcQ" } }),
      )?.source,
    ).toEqual({ kind: "youtube", id: "dQw4w9WgXcQ" });
    expect(
      contentToItem(
        row("video", {
          visibility: "protected",
          meta: { media_url: "https://youtu.be/dQw4w9WgXcQ" },
        }),
      ),
    ).toBeNull();
    expect(
      contentToItem(
        row("video", {
          visibility: "draft",
          meta: { media_url: "https://youtu.be/dQw4w9WgXcQ" },
        }),
      ),
    ).toBeNull();
    expect(contentToItem(row("video", { meta: {} }))).toBeNull();
    expect(
      contentToItem(
        row("video", { meta: { media_url: "http://insecure.example/x.mp4" } }),
      ),
    ).toBeNull();
  });
  it("lists the three public types and skips rows already in the catalog", async () => {
    const store = recordBackedContentStore(
      memoryStore<ContentRow>([
        row("podcast", {
          slug: "a",
          meta: { media_url: "/media/0123456789abcdef" },
        }),
        row("video", {
          slug: "b",
          external_id: "old-1",
          meta: { media_url: "https://youtu.be/dQw4w9WgXcQ" },
        }),
        row("story", {
          slug: "c",
          meta: { media_url: "https://youtu.be/dQw4w9WgXcQ" },
        }),
        row("video", {
          slug: "d",
          visibility: "private",
          meta: { media_url: "https://youtu.be/dQw4w9WgXcQ" },
        }),
      ]),
    );
    const items = await bridgeItems(store, new Set(["old-1"]));
    expect(items.map((i) => i.pageUrl).sort()).toEqual([
      "/library/podcasts/a",
      "/library/stories/c",
    ]);
  });
});

import { categoryOfRow } from "./watch-bridge";

describe("watch bridge categories", () => {
  it("uses meta.category, else the first tag naming an editorial topic", () => {
    expect(
      categoryOfRow(row("video", { meta: { category: "bilim ve teknoloji" } })),
    ).toBe("Bilim & Teknoloji");
    expect(
      categoryOfRow(row("video", { tags: ["röportaj", "kadın & ilham"] })),
    ).toBe("Kadın & İlham");
    expect(categoryOfRow(row("video", { tags: ["röportaj"] }))).toBe("");
  });
});
