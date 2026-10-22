/* eslint-disable @typescript-eslint/no-explicit-any */
// src/server/catalog.test.ts
import { describe, expect, it } from "vitest";

import { createCatalogApi, memoryStore } from "./catalog";

const TOKEN = "t".repeat(20);
const mk = (token: string | null = TOKEN) =>
  createCatalogApi({ token, store: memoryStore() });

const call = async (
  api: ReturnType<typeof mk>,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) => {
  const res = await api.handle(
    new Request(`http://x${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  if (!res) throw new Error("not handled");
  return { status: res.status, body: (await res.json()) as any };
};

const yt = { kind: "youtube", id: "dQw4w9WgXcQ" };

describe("catalog api", () => {
  it("ignores other paths", async () => {
    expect(await mk().handle(new Request("http://x/api/room"))).toBeNull();
  });

  it("requires the admin token for writes; disabled without one", async () => {
    const put = { title: "A", source: yt };
    expect((await call(mk(), "PUT", "/api/catalog/item", put)).status).toBe(
      401,
    );
    expect(
      (await call(mk(), "PUT", "/api/catalog/item", put, "wrong".repeat(5)))
        .status,
    ).toBe(401);
    expect((await call(mk(null), "PUT", "/api/catalog/item", put)).status).toBe(
      503,
    );
  });

  it("creates, lists, updates and deletes public items", async () => {
    const api = mk();
    const c = await call(
      api,
      "PUT",
      "/api/catalog/item",
      { title: "Hello", category: "Tech", tags: ["a"], source: yt },
      TOKEN,
    );
    expect(c.status).toBe(201);
    const id = c.body.item.id as string;
    const list = await call(api, "GET", "/api/catalog");
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].source).toEqual(yt);
    const u = await call(
      api,
      "PUT",
      "/api/catalog/item",
      { id, title: "Renamed", source: yt },
      TOKEN,
    );
    expect(u.status).toBe(200);
    expect((await call(api, "GET", "/api/catalog")).body.items[0].title).toBe(
      "Renamed",
    );
    expect(
      (await call(api, "DELETE", `/api/catalog/item/${id}`, undefined, TOKEN))
        .status,
    ).toBe(200);
    expect((await call(api, "GET", "/api/catalog")).body.items).toHaveLength(0);
  });

  it("rejects bad sources", async () => {
    const r = await call(
      mk(),
      "PUT",
      "/api/catalog/item",
      { title: "x", source: { kind: "file", url: "javascript:1" } },
      TOKEN,
    );
    expect(r.status).toBe(400);
  });

  it("hides private sources until a password or link key unlocks them", async () => {
    const api = mk();
    const c = await call(
      api,
      "PUT",
      "/api/catalog/item",
      {
        title: "Secret",
        source: yt,
        visibility: "private",
        password: "hunter22",
        linkKey: true,
      },
      TOKEN,
    );
    const id = c.body.item.id as string;
    const key = c.body.item.linkKey as string;
    expect(JSON.stringify(c.body)).not.toContain("passwordHash");
    const listed = (await call(api, "GET", "/api/catalog")).body.items[0];
    expect(listed.locked).toBe(true);
    expect(listed.source).toBeNull();
    expect(JSON.stringify(listed)).not.toContain(key);
    expect(
      (await call(api, "POST", "/api/catalog/unlock", { id, password: "nope" }))
        .status,
    ).toBe(403);
    expect(
      (
        await call(api, "POST", "/api/catalog/unlock", {
          id,
          password: "hunter22",
        })
      ).body.item.source,
    ).toEqual(yt);
    expect(
      (await call(api, "POST", "/api/catalog/unlock", { id, key })).body.item
        .source,
    ).toEqual(yt);
  });

  it("rate limits unlock attempts", async () => {
    const api = mk();
    let last = 0;
    for (let i = 0; i < 12; i++)
      last = (
        await call(api, "POST", "/api/catalog/unlock", {
          id: "nope",
          password: "x",
        })
      ).status;
    expect(last).toBe(429);
  });
});

describe("catalog: stories, playlists, captions, audio", () => {
  it("stores the new fields and fills defaults for older records", async () => {
    const legacy = {
      id: "legacy-1",
      title: "Old",
      description: "",
      category: "",
      tags: [],
      source: yt,
      visibility: "public",
      passwordHash: null,
      linkKey: null,
      startsAt: null,
      live: false,
      createdAt: "2026-10-01T10:00:00.000Z",
    };
    const api = createCatalogApi({
      token: TOKEN,
      store: memoryStore([legacy as never]),
    });
    const old = (await call(api, "GET", "/api/catalog")).body.items[0];
    expect(old).toMatchObject({
      story: false,
      playlist: "",
      episode: null,
      poster: "",
      captions: [],
    });

    const c = await call(
      api,
      "PUT",
      "/api/catalog/item",
      {
        title: "Podcast #1",
        source: { kind: "audio", url: "https://cdn.example.org/p1.mp3" },
        story: true,
        playlist: "Teknoloji",
        episode: 1,
        poster: "https://cdn.example.org/c.jpg",
        captions: [
          { lang: "tr", label: "Türkçe", url: "/media/abc/captions/tr.vtt" },
        ],
      },
      TOKEN,
    );
    expect(c.status).toBe(201);
    const pub = (await call(api, "GET", "/api/catalog")).body.items.find(
      (i: any) => i.title === "Podcast #1",
    );
    expect(pub).toMatchObject({
      story: true,
      playlist: "Teknoloji",
      episode: 1,
      source: { kind: "audio" },
    });
    expect(pub.captions).toHaveLength(1);
  });

  it("rejects unsafe poster / caption URLs", async () => {
    const api = mk();
    const put = (extra: object) =>
      call(
        api,
        "PUT",
        "/api/catalog/item",
        { title: "x", source: yt, ...extra },
        TOKEN,
      );
    expect((await put({ poster: "javascript:alert(1)" })).status).toBe(400);
    expect(
      (await put({ poster: "http://insecure.example/a.jpg" })).status,
    ).toBe(400);
    expect((await put({ poster: "/media/../../etc/passwd" })).status).toBe(400);
    expect(
      (
        await put({
          captions: [{ lang: "tr", label: "x", url: "data:text/vtt,x" }],
        })
      ).status,
    ).toBe(400);
    expect((await put({ episode: -1 })).status).toBe(400);
    expect((await put({ poster: "/media/abc123/poster.jpg" })).status).toBe(
      201,
    );
  });
});

describe("catalog: archive, story expiry, featured, bulk actions", () => {
  const T0 = Date.parse("2026-10-22T12:00:00Z");
  const setup = () => {
    let clock = T0;
    const api = createCatalogApi({
      token: TOKEN,
      store: memoryStore(),
      now: () => clock,
    });
    return { api, tick: (ms: number) => (clock += ms) };
  };
  const put = (api: ReturnType<typeof mk>, body: object) =>
    call(api, "PUT", "/api/catalog/item", { source: yt, ...body }, TOKEN);

  it("archived items vanish from the public list but stay in the admin list", async () => {
    const { api } = setup();
    const a = await put(api, { title: "Keep" });
    const b = await put(api, { title: "Old", archived: true });
    const pub = (await call(api, "GET", "/api/catalog")).body.items;
    expect(pub.map((i: any) => i.title)).toEqual(["Keep"]);
    const adm = (await call(api, "GET", "/api/catalog/admin", undefined, TOKEN))
      .body.items;
    expect(adm).toHaveLength(2);
    expect(adm.find((i: any) => i.title === "Old").archived).toBe(true);
    expect(
      (await call(api, "POST", "/api/catalog/unlock", { id: b.body.item.id }))
        .status,
    ).toBe(404);
    expect(a.status).toBe(201);
  });

  it("a story stops being a story when its expiry passes (the video stays)", async () => {
    const { api, tick } = setup();
    await put(api, {
      title: "Story",
      story: true,
      storyUntil: new Date(T0 + 3_600_000).toISOString(),
    });
    await put(api, { title: "Forever", story: true });
    const stories = async () =>
      (await call(api, "GET", "/api/catalog")).body.items
        .filter((i: any) => i.story)
        .map((i: any) => i.title);
    expect(await stories()).toEqual(["Story", "Forever"]);
    tick(2 * 3_600_000);
    expect(await stories()).toEqual(["Forever"]);
    const all = (await call(api, "GET", "/api/catalog")).body.items;
    expect(all.map((i: any) => i.title)).toContain("Story"); // still a normal video
  });

  it("bulk: archive / unarchive / story with expiry / feature / delete", async () => {
    const { api } = setup();
    const ids: string[] = [];
    for (const n of ["a1", "b2", "c3"])
      ids.push((await put(api, { title: n })).body.item.id);
    const bulk = (body: object) =>
      call(api, "POST", "/api/catalog/bulk", { ids, ...body }, TOKEN);
    const admin = async () =>
      (await call(api, "GET", "/api/catalog/admin", undefined, TOKEN)).body
        .items;

    expect((await bulk({ action: "archive" })).body.changed).toBe(3);
    expect((await admin()).every((i: any) => i.archived)).toBe(true);
    await bulk({ action: "unarchive" });
    expect((await admin()).some((i: any) => i.archived)).toBe(false);

    const until = new Date(T0 + 86_400_000).toISOString();
    await bulk({ action: "story", on: true, until });
    expect(
      (await admin()).every((i: any) => i.story && i.storyUntil === until),
    ).toBe(true);
    await bulk({ action: "story", on: false });
    expect((await admin()).some((i: any) => i.story || i.storyUntil)).toBe(
      false,
    );

    await bulk({ action: "feature", on: true });
    expect((await admin()).every((i: any) => i.featured)).toBe(true);
    await bulk({ action: "archive" }); // archiving un-features
    expect((await admin()).some((i: any) => i.featured)).toBe(false);

    expect(
      (
        await call(
          api,
          "POST",
          "/api/catalog/bulk",
          { ids: ["nope-nope"], action: "delete" },
          TOKEN,
        )
      ).body.changed,
    ).toBe(0);
    expect((await bulk({ action: "delete" })).body.changed).toBe(3);
    expect(await admin()).toHaveLength(0);
  });

  it("bulk needs the admin and a valid body", async () => {
    const { api } = setup();
    expect(
      (
        await call(api, "POST", "/api/catalog/bulk", {
          ids: ["abc"],
          action: "delete",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          api,
          "POST",
          "/api/catalog/bulk",
          { ids: [], action: "delete" },
          TOKEN,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          api,
          "POST",
          "/api/catalog/bulk",
          { ids: ["abc"], action: "explode" },
          TOKEN,
        )
      ).status,
    ).toBe(400);
  });
});
