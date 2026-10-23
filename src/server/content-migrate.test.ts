// src/server/content-migrate.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";

import { memoryStore, type CatalogItem } from "./catalog";
import { memoryAudit } from "./content";
import { catalogToRow, createMigrationApi, typeOf } from "./content-migrate";
import type { ContentRow } from "./content-model";
import { recordBackedContentStore } from "./content-store";

const TOKEN = "a-very-long-admin-token-123";

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  id: "ep-1",
  title: "Bölüm Bir",
  description: "Açıklama bir.\n\nİkinci paragraf.",
  category: "Röportaj",
  tags: ["a"],
  source: { kind: "youtube", id: "dQw4w9WgXcQ" },
  visibility: "public",
  passwordHash: null,
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
  createdAt: "2026-01-01T00:00:00.000Z",
  ...o,
});

describe("catalogToRow", () => {
  it("maps types, media urls and keeps secrets out", () => {
    expect(typeOf(item())).toBe("video");
    expect(typeOf(item({ story: true }))).toBe("story");
    expect(
      typeOf(item({ source: { kind: "upload", id: "abc", media: "audio" } })),
    ).toBe("podcast");
    const r = catalogToRow(
      item({
        source: { kind: "upload", id: "0123456789abcdef", media: "audio" },
        playlist: "Seri A",
        episode: 3,
        durationMs: 61_000,
        passwordHash: "00:11",
        linkKey: "secret-key",
        visibility: "private",
      }),
      "bolum-bir",
      "2026-10-22T00:00:00.000Z",
    )!;
    expect(r).toMatchObject({
      type: "podcast",
      external_id: "catalog:ep-1",
      slug: "bolum-bir",
      visibility: "private",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(r.meta).toMatchObject({
      media_url: "/media/0123456789abcdef",
      duration_sec: 61,
      series: "Seri A",
      episode: 3,
    });
    expect(JSON.stringify(r)).not.toMatch(/secret-key|"00:11"/);
    expect(
      (r.meta["legacy"] as { passwordProtected: boolean }).passwordProtected,
    ).toBe(true);
    expect(r.body_blocks).toHaveLength(2);
  });

  it("archived items become drafts; room links are skipped", () => {
    expect(catalogToRow(item({ archived: true }), "x", "n")?.visibility).toBe(
      "draft",
    );
    expect(
      catalogToRow(item({ source: { kind: "room", code: "abc" } }), "x", "n"),
    ).toBeNull();
  });
});

describe("migration API", () => {
  function setup(items: CatalogItem[]) {
    const catalog = memoryStore<CatalogItem>(items);
    const rows = memoryStore<ContentRow>();
    const store = recordBackedContentStore(rows);
    const audit = memoryAudit();
    const api = createMigrationApi({
      token: TOKEN,
      catalog,
      store,
      audit,
      now: () => new Date("2026-10-22T00:00:00Z"),
    });
    const post = async (qs = "", auth = true) => {
      const res = await api.handle(
        new Request(`http://x/api/admin/migrate/watch${qs}`, {
          method: "POST",
          headers: auth ? { authorization: `Bearer ${TOKEN}` } : {},
        }),
      );
      return { status: res!.status, json: (await res!.json()) as any };
    };
    return { post, rows, audit };
  }

  it("is admin only, dry-runs by default and is idempotent on commit", async () => {
    const s = setup([
      item(),
      item({ id: "ep-2", title: "Bölüm Bir" }),
      item({ id: "r", source: { kind: "room", code: "abc" } }),
      item({ id: "ep-3", title: "Hikaye", story: true }),
    ]);
    expect((await s.post("", false)).status).toBe(401);
    const dry = await s.post();
    expect(dry.json).toMatchObject({
      commit: false,
      total: 4,
      created: 3,
      existing: 0,
      skipped: 1,
    });
    expect(await s.rows.list()).toHaveLength(0);
    const done = await s.post("?commit=1");
    expect(done.json.created).toBe(3);
    const list = await s.rows.list();
    expect(list.map((r) => r.slug).sort()).toEqual([
      "bolum-bir",
      "bolum-bir-2",
      "hikaye",
    ]);
    const again = await s.post("?commit=1");
    expect(again.json).toMatchObject({ created: 0, existing: 3, skipped: 1 });
    expect(await s.rows.list()).toHaveLength(3);
    expect(s.audit.entries.map((e) => e.action)).toEqual(["migrate-watch"]);
  });
});
