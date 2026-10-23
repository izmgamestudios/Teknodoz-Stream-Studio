// src/server/content.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";

import { memoryStore, type RecordStore } from "./catalog";
import {
  blankRow,
  libraryView,
  visibleTo,
  type ContentRow,
  type Viewer,
} from "./content-model";
import {
  matchesQuery,
  pbContentStore,
  pbFilter,
  recordBackedContentStore,
  recordToRow,
  rowToRecord,
  type ContentStore,
} from "./content-store";
import { createContentApi, memoryAudit, type Redirect } from "./content";
import { PocketBase } from "./pocketbase";

const TOKEN = "a-very-long-admin-token-123";
const NOW = "2026-10-22T10:00:00.000Z";

const row = (patch: Partial<ContentRow> = {}): ContentRow =>
  blankRow("video", "Röportaj", NOW, { slug: "roportaj", ...patch });

describe("visibleTo / libraryView (rule matrix)", () => {
  const states = {
    draft: row({ visibility: "draft" }),
    private: row({ visibility: "private", owner: "u1" }),
    public: row({ visibility: "public" }),
    protected: row({ visibility: "protected" }),
    deleted: row({ visibility: "public", is_deleted: true }),
  };
  const viewers = {
    anonymous: { role: "anonymous" },
    owner: { role: "owner", id: "u1" },
    stranger: { role: "owner", id: "u2" },
    admin: { role: "admin" },
  } satisfies Record<string, Viewer>;

  it("anonymous sees only live public rows; protected is never raw", () => {
    const seen = Object.entries(states)
      .filter(([, r]) => visibleTo(viewers.anonymous, r))
      .map(([k]) => k);
    expect(seen).toEqual(["public"]);
  });

  it("owner sees own non-deleted rows, not others'", () => {
    expect(visibleTo(viewers.owner, states.private)).toBe(true);
    expect(visibleTo(viewers.stranger, states.private)).toBe(false);
    expect(visibleTo(viewers.owner, states.deleted)).toBe(false);
    expect(visibleTo(viewers.owner, states.protected)).toBe(false);
  });

  it("admin sees everything including the trash", () => {
    for (const r of Object.values(states))
      expect(visibleTo(viewers.admin, r)).toBe(true);
  });

  it("library view: public in full, protected as a stub, the rest hidden", () => {
    expect(libraryView(states.public)).toMatchObject({
      protected: false,
      title: "Röportaj",
    });
    const stub = libraryView(states.protected);
    expect(stub).toEqual({
      id: states.protected.id,
      type: "video",
      slug: "roportaj",
      title: "Röportaj",
      protected: true,
    });
    expect(libraryView(states.draft)).toBeNull();
    expect(libraryView(states.private)).toBeNull();
    expect(libraryView(states.deleted)).toBeNull();
    expect(
      libraryView(row({ type: "guide", visibility: "public" })),
    ).toBeNull();
    // owner / access group / audit data never reach the public view
    expect(Object.keys(libraryView(states.public)!)).not.toContain("owner");
    expect(Object.keys(libraryView(states.public)!)).not.toContain(
      "access_group",
    );
  });
});

describe("query semantics", () => {
  it("matches like the PocketBase filter describes", () => {
    const r = row({
      visibility: "public",
      tags: ["röportaj"],
      title: "Işık Çağı",
    });
    expect(matchesQuery(r, { type: "video", visibility: ["public"] })).toBe(
      true,
    );
    expect(matchesQuery(r, { type: "story" })).toBe(false);
    expect(matchesQuery(r, { q: "isik cagi" })).toBe(true);
    expect(matchesQuery(r, { tag: "röportaj" })).toBe(true);
    expect(matchesQuery(row({ is_deleted: true }), {})).toBe(false);
    expect(matchesQuery(row({ is_deleted: true }), { deleted: "only" })).toBe(
      true,
    );
  });

  it("builds an escaped PocketBase filter", () => {
    expect(pbFilter({})).toBe("is_deleted = false");
    expect(
      pbFilter({
        type: "video",
        visibility: ["public", "protected"],
        deleted: "include",
      }),
    ).toBe(
      'type = "video" && (visibility = "public" || visibility = "protected")',
    );
    const f = pbFilter({ q: 'x" || id != "', deleted: "include" });
    expect(f).toBe(
      '(title ~ "x\\" || id != \\"" || summary ~ "x\\" || id != \\"" || tags ~ "x\\" || id != \\"")',
    );
    expect(pbFilter({ visibility: [] as never })).toContain('id = ""');
  });

  it("round-trips a row through a PocketBase record", () => {
    const r = row({ tags: ["a"], meta: { duration_sec: 5 }, noindex: true });
    expect(recordToRow({ id: r.id, ...rowToRecord(r) })).toEqual(r);
  });
});

function setup() {
  const rows = memoryStore<ContentRow>();
  const store: ContentStore = recordBackedContentStore(rows);
  const redirects: RecordStore<Redirect> = memoryStore<Redirect>();
  const audit = memoryAudit();
  const api = createContentApi({
    token: TOKEN,
    store,
    redirects,
    audit,
    now: () => new Date(NOW),
  });
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    admin = true,
  ) => {
    const res = await api.handle(
      new Request(`http://x${path}`, {
        method,
        headers: {
          ...(admin ? { authorization: `Bearer ${TOKEN}` } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
    return { res: res!, json: (await res!.json()) as any };
  };
  return { store, audit, call, redirects };
}

describe("admin API", () => {
  it("needs the admin token", async () => {
    const s = setup();
    expect(
      (await s.call("GET", "/api/content", undefined, false)).res.status,
    ).toBe(401);
    expect(
      (
        await s.call(
          "POST",
          "/api/content",
          { type: "video", title: "x" },
          false,
        )
      ).res.status,
    ).toBe(401);
  });

  it("creates a draft with a generated slug, validates fields and rejects secrets", async () => {
    const s = setup();
    const c = await s.call("POST", "/api/content", {
      type: "video",
      title: "Çağrı Merkezi Röportajı",
      body_md: "Birinci paragraf.\n\nİkinci paragraf.",
      media_url: "https://example.org/a.mp4",
      duration_sec: 120,
    });
    expect(c.res.status).toBe(201);
    expect(c.json.item).toMatchObject({
      type: "video",
      slug: "cagri-merkezi-roportaji",
      visibility: "draft",
      summary: "Birinci paragraf.",
    });
    expect(c.json.item.body_blocks).toHaveLength(2);
    const md = await s.call("POST", "/api/content", {
      type: "video",
      title: "Md",
      body_md: "# Başlık\n\n- a\n- b\n\nMetin",
    });
    expect(
      md.json.item.body_blocks.map((b: { type: string }) => b.type),
    ).toEqual(["heading", "list", "paragraph"]);
    expect(c.json.item.meta).toMatchObject({ duration_sec: 120 });
    expect(
      (
        await s.call("POST", "/api/content", {
          type: "video",
          title: "x",
          media_url: "javascript:1",
        })
      ).res.status,
    ).toBe(400);
    expect(
      (
        await s.call("POST", "/api/content", {
          type: "live_event",
          title: "x",
          stream_key: "k",
        })
      ).res.status,
    ).toBe(400);
    expect(
      (await s.call("POST", "/api/content", { type: "nope", title: "x" })).res
        .status,
    ).toBe(400);
    expect(s.audit.entries.map((e) => e.action)).toEqual(["create", "create"]);
  });

  it("keeps slugs unique and refuses an explicit duplicate", async () => {
    const s = setup();
    const a = await s.call("POST", "/api/content", {
      type: "story",
      title: "Aynı Ad",
    });
    const b = await s.call("POST", "/api/content", {
      type: "story",
      title: "Aynı Ad",
    });
    expect(a.json.item.slug).toBe("ayni-ad");
    expect(b.json.item.slug).toBe("ayni-ad-2");
    const c = await s.call("POST", "/api/content", {
      type: "story",
      title: "Başka",
      slug: "ayni-ad",
    });
    expect(c.res.status).toBe(409);
    // same slug in another type is fine
    expect(
      (
        await s.call("POST", "/api/content", {
          type: "video",
          title: "x",
          slug: "ayni-ad",
        })
      ).res.status,
    ).toBe(201);
  });

  it("patches, forbids type changes, soft-deletes and restores", async () => {
    const s = setup();
    const c = await s.call("POST", "/api/content", {
      type: "podcast",
      title: "Bölüm 1",
    });
    const id = c.json.item.id;
    const u = await s.call("PUT", `/api/content/${id}`, {
      summary: "Kısa özet",
      tags: ["a", "b"],
    });
    expect(u.json.item).toMatchObject({
      title: "Bölüm 1",
      summary: "Kısa özet",
      tags: ["a", "b"],
    });
    expect(
      (await s.call("PUT", `/api/content/${id}`, { type: "video" })).res.status,
    ).toBe(400);
    expect(
      (await s.call("DELETE", `/api/content/${id}`)).json.item.is_deleted,
    ).toBe(true);
    expect((await s.call("GET", "/api/content")).json.items).toHaveLength(0);
    expect(
      (await s.call("GET", "/api/content?deleted=only")).json.items,
    ).toHaveLength(1);
    expect(
      (await s.call("POST", `/api/content/${id}/restore`)).json.item.is_deleted,
    ).toBe(false);
    expect(s.audit.entries.map((e) => e.action)).toEqual([
      "create",
      "update",
      "soft-delete",
      "restore",
    ]);
  });

  it("pages the list server-side", async () => {
    const s = setup();
    for (let i = 0; i < 7; i++)
      await s.call("POST", "/api/content", { type: "video", title: `V ${i}` });
    const p1 = await s.call("GET", "/api/content?perPage=3&total=1");
    expect(p1.json).toMatchObject({
      page: 1,
      perPage: 3,
      hasMore: true,
      total: 7,
    });
    expect(p1.json.items).toHaveLength(3);
    const p3 = await s.call("GET", "/api/content?perPage=3&page=3");
    expect(p3.json.items).toHaveLength(1);
    expect(p3.json.hasMore).toBe(false);
    expect(
      (await s.call("GET", "/api/content?visibility=bogus")).res.status,
    ).toBe(400);
  });
});

describe("public library API (anonymous)", () => {
  async function seeded() {
    const s = setup();
    const mk = async (
      title: string,
      visibility: string,
      extra: Record<string, unknown> = {},
    ) =>
      (
        await s.call("POST", "/api/content", {
          type: "video",
          title,
          visibility,
          ...extra,
        })
      ).json.item;
    await mk("Açık Video", "public", { summary: "Özet", body_md: "Metin" });
    await mk("Taslak", "draft");
    await mk("Özel", "private");
    await mk("Şifreli", "protected");
    const del = await mk("Silinmiş", "public");
    await s.call("DELETE", `/api/content/${del.id}`);
    return s;
  }

  it("lists public items and protected stubs only, without bodies, with cache headers", async () => {
    const s = await seeded();
    const { res, json } = await s.call(
      "GET",
      "/api/library/video",
      undefined,
      false,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    const titles = json.items.map((i: any) => i.title).sort();
    expect(titles).toEqual(["Açık Video", "Şifreli"]);
    const protectedItem = json.items.find((i: any) => i.title === "Şifreli");
    expect(protectedItem).toEqual(expect.objectContaining({ protected: true }));
    expect(Object.keys(protectedItem).sort()).toEqual([
      "id",
      "protected",
      "slug",
      "title",
      "type",
    ]);
    expect(JSON.stringify(json)).not.toContain("body_blocks");
    expect(JSON.stringify(json)).not.toMatch(/Taslak|Özel|Silinmiş/);
  });

  it("serves one item by slug; hides drafts; stubs protected", async () => {
    const s = await seeded();
    const open = await s.call(
      "GET",
      "/api/library/video/acik-video",
      undefined,
      false,
    );
    expect(open.json.item).toMatchObject({
      title: "Açık Video",
      protected: false,
    });
    expect(open.json.item.body_blocks).toHaveLength(1);
    expect(
      (await s.call("GET", "/api/library/video/taslak", undefined, false)).res
        .status,
    ).toBe(404);
    expect(
      (await s.call("GET", "/api/library/video/ozel", undefined, false)).res
        .status,
    ).toBe(404);
    expect(
      (await s.call("GET", "/api/library/video/silinmis", undefined, false)).res
        .status,
    ).toBe(404);
    const stub = await s.call(
      "GET",
      "/api/library/video/sifreli",
      undefined,
      false,
    );
    expect(stub.json.item).toMatchObject({ protected: true });
    expect(stub.json.item.body_blocks).toBeUndefined();
  });

  it("only exposes public types and follows slug redirects", async () => {
    const s = await seeded();
    expect(
      (await s.call("GET", "/api/library/guide", undefined, false)).res.status,
    ).toBe(404);
    const id = (
      await s.call("GET", "/api/library/video/acik-video", undefined, false)
    ).json.item.id;
    await s.call("PUT", `/api/content/${id}`, { slug: "yeni-adres" });
    const old = await s.call(
      "GET",
      "/api/library/video/acik-video",
      undefined,
      false,
    );
    expect(old.json).toEqual({ redirect: "yeni-adres" });
    expect(
      (await s.call("GET", "/api/library/video/yeni-adres", undefined, false))
        .res.status,
    ).toBe(200);
  });

  it("an anonymous client cannot reach the admin API or write", async () => {
    const s = await seeded();
    expect(
      (await s.call("GET", "/api/content", undefined, false)).res.status,
    ).toBe(401);
    expect(
      (await s.call("POST", "/api/library/video", {}, false)).res.status,
    ).toBe(405);
  });
});

describe("PocketBase content store (fake REST)", () => {
  it("creates with the row id, updates in place and reads back", async () => {
    const recs = new Map<string, Record<string, unknown>>();
    const created: string[] = [];
    const fetchImpl = async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const method = init?.method ?? "GET";
      const reply = (s: number, b?: unknown) =>
        new Response(b === undefined ? null : JSON.stringify(b), { status: s });
      if (url.pathname.endsWith("auth-with-password"))
        return reply(200, { token: "tok" });
      if (url.pathname === "/api/collections" && method === "POST") {
        created.push(JSON.parse(String(init?.body)).indexes.join("|"));
        return reply(200, {});
      }
      if (url.pathname === "/api/collections/content_items")
        return reply(created.length ? 200 : 404, {});
      const m = /records(?:\/([^/]+))?$/.exec(url.pathname);
      const id = m?.[1];
      if (method === "GET" && id)
        return recs.has(id) ? reply(200, recs.get(id)) : reply(404);
      if (method === "GET") {
        const slug = /slug = "([^"]+)"/.exec(
          url.searchParams.get("filter") ?? "",
        )?.[1];
        const items = [...recs.values()].filter(
          (r) => !slug || r["slug"] === slug,
        );
        return reply(200, {
          items,
          page: 1,
          totalPages: 1,
          totalItems: items.length,
        });
      }
      const body = JSON.parse(String(init?.body));
      if (method === "POST") {
        recs.set(body.id, body);
        return reply(200, body);
      }
      if (method === "PATCH" && id) {
        recs.set(id, { ...recs.get(id), ...body });
        return reply(200, recs.get(id));
      }
      return reply(500);
    };
    const pb = new PocketBase(
      { url: "http://pb", email: "a", password: "b" },
      fetchImpl,
    );
    const store = pbContentStore(pb);
    const r = row({ visibility: "public", slug: "x-y" });
    await store.put(r);
    expect(created[0]).toContain("WHERE slug != ''");
    expect(await store.get(r.id)).toEqual(r);
    await store.put({ ...r, title: "Yeni" });
    expect((await store.get(r.id))?.title).toBe("Yeni");
    expect((await store.findBySlug("video", "x-y"))?.id).toBe(r.id);
    expect(await store.get("zzzzzzzzzzzzzzz")).toBeNull();
    const page = await store.list({ perPage: 10, withTotal: true });
    expect(page.total).toBe(1);
  });
});
