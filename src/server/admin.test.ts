/* eslint-disable @typescript-eslint/no-explicit-any */
// src/server/admin.test.ts
import { describe, expect, it } from "vitest";

import { createAdminApi } from "./admin";
import {
  createCatalogApi,
  memoryStore,
  StoreUnavailableError,
} from "./catalog";
import { memoryI18nStore } from "./i18n";

const TOKEN = "t".repeat(20);

function setup(token: string | null = TOKEN) {
  const catalog = memoryStore();
  const i18n = memoryI18nStore();
  const api = createAdminApi({
    token,
    catalog,
    i18n,
    storage: "file",
    now: () => Date.parse("2026-10-22T12:00:00Z"),
  });
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    auth = true,
  ) => {
    const res = await api.handle(
      new Request(`http://x${path}`, {
        method,
        headers: auth ? { authorization: `Bearer ${TOKEN}` } : {},
        ...(body !== undefined
          ? { body: typeof body === "string" ? body : JSON.stringify(body) }
          : {}),
      }),
    );
    return {
      status: res!.status,
      res: res!,
      body: (await res!.clone().json()) as any,
    };
  };
  return { catalog, i18n, api, call };
}

const item = (id: string) => ({
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
  createdAt: "2026-10-01T10:00:00.000Z",
});

describe("admin api", () => {
  it("ignores other paths and needs the admin token", async () => {
    const s = setup();
    expect(await s.api.handle(new Request("http://x/api/catalog"))).toBeNull();
    expect(
      (await s.call("GET", "/api/admin/status", undefined, false)).status,
    ).toBe(401);
    expect((await setup(null).call("GET", "/api/admin/status")).status).toBe(
      503,
    );
  });

  it("reports storage, health and counts", async () => {
    const s = setup();
    await s.catalog.upsert(item("aaa") as any);
    await s.i18n.set("de", "nav.watch", "Ansehen");
    const r = await s.call("GET", "/api/admin/status");
    expect(r.body).toMatchObject({
      storage: "file",
      healthy: true,
      counts: { catalog: 1, overrides: 1 },
    });
  });

  it("reports an unreachable store as unhealthy instead of failing", async () => {
    const s = setup();
    s.catalog.list = async () => {
      throw new StoreUnavailableError();
    };
    const r = await s.call("GET", "/api/admin/status");
    expect(r.status).toBe(200);
    expect(r.body.healthy).toBe(false);
  });

  it("exports a downloadable backup and imports it back", async () => {
    const a = setup();
    await a.catalog.upsert(item("aaa") as any);
    await a.i18n.set("es", "nav.watch", "Ver");
    const ex = await a.call("GET", "/api/admin/export");
    expect(ex.res.headers.get("content-disposition")).toContain(
      "teknodoz-backup-2026-10-22.json",
    );
    expect(ex.body).toMatchObject({
      version: 1,
      catalog: [{ id: "aaa" }],
      i18n: { es: { "nav.watch": "Ver" } },
    });

    const b = setup();
    const im = await b.call("POST", "/api/admin/import", ex.body);
    expect(im.body).toEqual({ ok: true, catalog: 1, i18n: 1 });
    expect(await b.catalog.list()).toHaveLength(1);
    expect(await b.i18n.all()).toEqual({ es: { "nav.watch": "Ver" } });
  });

  it("imports nothing when any part of the backup is invalid", async () => {
    const s = setup();
    const bad = (extra: object) =>
      s.call("POST", "/api/admin/import", { version: 1, ...extra });
    expect(
      (
        await bad({
          catalog: [
            { ...item("aaa"), source: { kind: "file", url: "javascript:1" } },
          ],
        })
      ).body.error,
    ).toBe("bad-item");
    expect(
      (await bad({ catalog: [item("ok1"), { ...item("bbb"), id: "BAD ID" }] }))
        .body.error,
    ).toBe("bad-item");
    expect((await bad({ i18n: { fr: { "nav.watch": "x" } } })).body.error).toBe(
      "bad-language",
    );
    expect((await bad({ i18n: { de: { "no.such": "x" } } })).body.error).toBe(
      "unknown-key",
    );
    expect(
      (await bad({ i18n: { de: { "watch.count": "Inhalte" } } })).body.error,
    ).toBe("placeholder-mismatch");
    expect(
      (await s.call("POST", "/api/admin/import", { version: 2 })).body.error,
    ).toBe("bad-backup");
    expect((await s.call("POST", "/api/admin/import", "{nope")).status).toBe(
      400,
    );
    expect(await s.catalog.list()).toHaveLength(0);
    expect(await s.i18n.all()).toEqual({});
  });

  it("keeps password hashes working across a backup round trip", async () => {
    const a = setup();
    const cat = createCatalogApi({ token: TOKEN, store: a.catalog });
    const put = await cat.handle(
      new Request("http://x/api/catalog/item", {
        method: "PUT",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Secret",
          source: { kind: "youtube", id: "dQw4w9WgXcQ" },
          visibility: "private",
          password: "hunter22",
        }),
      }),
    );
    const id = ((await put!.json()) as any).item.id as string;
    const backup = (await a.call("GET", "/api/admin/export")).body;
    const b = setup();
    expect((await b.call("POST", "/api/admin/import", backup)).status).toBe(
      200,
    );
    const cat2 = createCatalogApi({ token: TOKEN, store: b.catalog });
    const unlock = await cat2.handle(
      new Request("http://x/api/catalog/unlock", {
        method: "POST",
        body: JSON.stringify({ id, password: "hunter22" }),
      }),
    );
    expect(unlock!.status).toBe(200);
  });
});
