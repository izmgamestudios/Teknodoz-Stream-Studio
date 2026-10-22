// src/server/pocketbase.test.ts
// Runs the PocketBase client + stores against a tiny in-memory fake of the PocketBase REST API.
import { describe, expect, it } from "vitest";

import { createCatalogApi, type CatalogItem } from "./catalog";
import { createI18nApi } from "./i18n";
import {
  PocketBase,
  pbCatalogStore,
  pbI18nStore,
  pocketbaseFromEnv,
} from "./pocketbase";

interface Rec {
  id: string;
  [k: string]: unknown;
}

function fakePocketBase(
  opts: { legacyAdmin?: boolean; password?: string } = {},
) {
  const collections = new Map<string, Rec[]>();
  const log: string[] = [];
  let seq = 0;
  let down = false;
  const reply = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status });

  const fetchImpl = async (input: string, init?: RequestInit) => {
    if (down) throw new TypeError("fetch failed");
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    log.push(`${method} ${url.pathname}`);
    const login = opts.legacyAdmin
      ? "/api/admins/auth-with-password"
      : "/api/collections/_superusers/auth-with-password";
    if (url.pathname.endsWith("auth-with-password")) {
      if (url.pathname !== login) return reply(404);
      return body.password === (opts.password ?? "pw")
        ? reply(200, { token: "tok" })
        : reply(400, { message: "bad" });
    }
    if (
      (init?.headers as Record<string, string> | undefined)?.[
        "authorization"
      ] !== "tok"
    )
      return reply(401);
    if (url.pathname === "/api/collections" && method === "POST") {
      collections.set(body.name, []);
      return reply(200, { name: body.name });
    }
    const m = /^\/api\/collections\/([^/]+)(?:\/records(?:\/([^/]+))?)?$/.exec(
      url.pathname,
    );
    if (!m) return reply(404);
    const [, name, id] = m as unknown as [string, string, string | undefined];
    const rows = collections.get(name);
    if (!rows) return reply(404);
    if (!url.pathname.includes("/records")) return reply(200, { name });
    if (method === "GET")
      return reply(200, { items: rows, page: 1, totalPages: 1 });
    if (method === "POST") {
      const rec = { id: `r${++seq}`, ...body };
      rows.push(rec);
      return reply(200, rec);
    }
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return reply(404);
    if (method === "PATCH") {
      rows[i] = { ...rows[i]!, ...body };
      return reply(200, rows[i]);
    }
    rows.splice(i, 1);
    return reply(204);
  };
  return {
    fetchImpl,
    collections,
    log,
    setDown: (v: boolean) => {
      down = v;
    },
  };
}

const cfg = { url: "http://pb.test", email: "a@b.c", password: "pw" };
const item = (id: string): CatalogItem => ({
  id,
  title: id,
  description: "",
  category: "",
  tags: [],
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
  createdAt: "2026-10-22T10:00:00.000Z",
});

describe("pocketbaseFromEnv", () => {
  it("needs url, email and password; trims the slash; http(s) only", () => {
    expect(pocketbaseFromEnv({})).toBeNull();
    expect(
      pocketbaseFromEnv({
        POCKETBASE_URL: "http://x:8090/",
        POCKETBASE_ADMIN_EMAIL: "a",
        POCKETBASE_ADMIN_PASSWORD: "b",
      }),
    ).toEqual({ url: "http://x:8090", email: "a", password: "b" });
    expect(
      pocketbaseFromEnv({
        POCKETBASE_URL: "file:///x",
        POCKETBASE_ADMIN_EMAIL: "a",
        POCKETBASE_ADMIN_PASSWORD: "b",
      }),
    ).toBeNull();
  });
});

describe("PocketBase catalog store", () => {
  it("creates the collection once, then upserts / lists / removes", async () => {
    const f = fakePocketBase();
    const store = pbCatalogStore(new PocketBase(cfg, f.fetchImpl));
    expect(await store.list()).toEqual([]);
    await store.upsert(item("aaa"));
    await store.upsert(item("bbb"));
    await store.upsert({ ...item("aaa"), title: "renamed" });
    const list = await store.list();
    expect(list.map((i) => i.title).sort()).toEqual(["bbb", "renamed"]);
    expect(f.collections.get("catalog_items")).toHaveLength(2);
    expect(f.log.filter((l) => l === "POST /api/collections")).toHaveLength(1);
    expect(await store.remove("bbb")).toBe(true);
    expect(await store.remove("bbb")).toBe(false);
    expect(f.collections.get("catalog_items")).toHaveLength(1);
  });

  it("falls back to the legacy admin login", async () => {
    const f = fakePocketBase({ legacyAdmin: true });
    const store = pbCatalogStore(new PocketBase(cfg, f.fetchImpl));
    await store.upsert(item("aaa"));
    expect(await store.list()).toHaveLength(1);
  });

  it("serves the last good list while PocketBase is down; errors if it never worked", async () => {
    const f = fakePocketBase();
    let t = 0;
    const store = pbCatalogStore(
      new PocketBase(cfg, f.fetchImpl, () => t),
      () => t,
    );
    await store.upsert(item("aaa"));
    expect(await store.list()).toHaveLength(1);
    f.setDown(true);
    t += 10_000;
    expect(await store.list()).toHaveLength(1);

    const cold = pbCatalogStore(new PocketBase(cfg, f.fetchImpl));
    await expect(cold.list()).rejects.toThrow(/unreachable/);
  });

  it("reports a wrong password as store-unavailable", async () => {
    const f = fakePocketBase({ password: "other" });
    const store = pbCatalogStore(new PocketBase(cfg, f.fetchImpl));
    await expect(store.list()).rejects.toThrow(/login failed/);
  });

  it("works end to end behind the catalog API (503 when down)", async () => {
    const f = fakePocketBase();
    const api = createCatalogApi({
      token: "t".repeat(20),
      store: pbCatalogStore(new PocketBase(cfg, f.fetchImpl)),
    });
    const put = await api.handle(
      new Request("http://x/api/catalog/item", {
        method: "PUT",
        headers: {
          authorization: `Bearer ${"t".repeat(20)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Live",
          source: { kind: "youtube-live", channel: "UCX6OQ3DkcsbYNE6H8uQQuVA" },
          live: true,
        }),
      }),
    );
    expect(put?.status).toBe(201);
    const list = await (await api.handle(
      new Request("http://x/api/catalog"),
    ))!.json();
    expect(list.items[0].source).toEqual({
      kind: "youtube-live",
      channel: "UCX6OQ3DkcsbYNE6H8uQQuVA",
    });

    const cold = createCatalogApi({
      token: null,
      store: pbCatalogStore(
        new PocketBase(cfg, async () => {
          throw new TypeError("x");
        }),
      ),
    });
    expect(
      (await cold.handle(new Request("http://x/api/catalog")))?.status,
    ).toBe(503);
  });
});

describe("PocketBase i18n store + API", () => {
  const TOKEN = "t".repeat(20);
  const call = async (
    api: ReturnType<typeof createI18nApi>,
    method: string,
    path: string,
    body?: unknown,
    auth = true,
  ) => {
    const res = await api.handle(
      new Request(`http://x${path}`, {
        method,
        headers: auth ? { authorization: `Bearer ${TOKEN}` } : {},
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
    return {
      status: res!.status,
      body: (await res!.json()) as Record<string, unknown>,
    };
  };

  it("stores, lists and removes overrides", async () => {
    const f = fakePocketBase();
    const api = createI18nApi({
      token: TOKEN,
      store: pbI18nStore(new PocketBase(cfg, f.fetchImpl)),
    });
    expect(
      (await call(api, "GET", "/api/i18n", undefined, false)).body,
    ).toEqual({ overrides: {} });
    expect(
      (await call(api, "PUT", "/api/i18n/de/nav.watch", { value: "Zuschauen" }))
        .status,
    ).toBe(200);
    expect(
      (await call(api, "PUT", "/api/i18n/de/nav.watch", { value: "Schauen" }))
        .status,
    ).toBe(200);
    expect(
      (await call(api, "GET", "/api/i18n", undefined, false)).body,
    ).toEqual({ overrides: { de: { "nav.watch": "Schauen" } } });
    expect(f.collections.get("i18n_messages")).toHaveLength(1);
    expect((await call(api, "DELETE", "/api/i18n/de/nav.watch")).status).toBe(
      200,
    );
    expect((await call(api, "DELETE", "/api/i18n/de/nav.watch")).status).toBe(
      404,
    );
  });

  it("guards writes: auth, known language/key, placeholders, empty values", async () => {
    const api = createI18nApi({
      token: TOKEN,
      store: pbI18nStore(new PocketBase(cfg, fakePocketBase().fetchImpl)),
    });
    expect(
      (await call(api, "PUT", "/api/i18n/de/nav.watch", { value: "x" }, false))
        .status,
    ).toBe(401);
    expect(
      (await call(api, "PUT", "/api/i18n/fr/nav.watch", { value: "x" })).status,
    ).toBe(400);
    expect(
      (await call(api, "PUT", "/api/i18n/de/no.such.key", { value: "x" }))
        .status,
    ).toBe(400);
    expect(
      (await call(api, "PUT", "/api/i18n/de/watch.count", { value: "Inhalte" }))
        .body,
    ).toEqual({ error: "placeholder-mismatch" });
    expect(
      (
        await call(api, "PUT", "/api/i18n/de/watch.count", {
          value: "{n} Inhalte",
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(api, "PUT", "/api/i18n/de/nav.watch", { value: "  " }))
        .status,
    ).toBe(400);
    const off = createI18nApi({
      token: null,
      store: pbI18nStore(new PocketBase(cfg, fakePocketBase().fetchImpl)),
    });
    expect(
      (await call(off, "PUT", "/api/i18n/de/nav.watch", { value: "x" })).status,
    ).toBe(503);
  });
});
