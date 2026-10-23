// src/server/pocketbase.ts
// Minimal PocketBase (>= 0.23) REST client + the stores built on it. The browser never talks to
// PocketBase: collections keep their default rules (superuser only) and every request goes
// through our own /api/* handlers, which authenticate with the superuser credentials below.
//
//   POCKETBASE_URL=http://127.0.0.1:8090
//   POCKETBASE_ADMIN_EMAIL=...   POCKETBASE_ADMIN_PASSWORD=...
import {
  StoreUnavailableError,
  type CatalogItem,
  type CatalogStore,
  type RecordStore,
} from "./catalog";
import type { I18nStore, Overrides } from "./i18n";

export interface PbConfig {
  url: string;
  email: string;
  password: string;
}

export function pocketbaseFromEnv(
  env: Record<string, string | undefined>,
): PbConfig | null {
  const url = (env["POCKETBASE_URL"] ?? "").trim().replace(/\/+$/, "");
  const email = (env["POCKETBASE_ADMIN_EMAIL"] ?? "").trim();
  const password = env["POCKETBASE_ADMIN_PASSWORD"] ?? "";
  if (!url || !email || !password) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { url, email, password };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PbRecord {
  id: string;
  [field: string]: unknown;
}

export interface FieldDef {
  name: string;
  type: "text" | "json" | "bool" | "number";
  required?: boolean;
  max?: number;
  maxSize?: number;
}

const TOKEN_TTL_MS = 10 * 60_000;

export class PocketBase {
  private token: string | null = null;
  private tokenAt = 0;
  private ensured = new Map<string, Promise<void>>();

  constructor(
    private readonly cfg: PbConfig,
    private readonly doFetch: FetchLike = (i, init) => fetch(i, init),
    private readonly now: () => number = Date.now,
  ) {}

  private async raw(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers["authorization"] = token;
    try {
      return await this.doFetch(`${this.cfg.url}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new StoreUnavailableError("pocketbase unreachable");
    }
  }

  private async login(): Promise<string> {
    const creds = { identity: this.cfg.email, password: this.cfg.password };
    // PocketBase >= 0.23 uses the _superusers collection; older builds had /api/admins
    let res = await this.raw(
      "POST",
      "/api/collections/_superusers/auth-with-password",
      creds,
    );
    if (res.status === 404)
      res = await this.raw("POST", "/api/admins/auth-with-password", creds);
    if (!res.ok)
      throw new StoreUnavailableError(
        `pocketbase login failed (${res.status})`,
      );
    const data = (await res.json()) as { token?: string };
    if (!data.token)
      throw new StoreUnavailableError("pocketbase gave no token");
    this.token = data.token;
    this.tokenAt = this.now();
    return data.token;
  }

  private async auth(force = false): Promise<string> {
    if (!force && this.token && this.now() - this.tokenAt < TOKEN_TTL_MS)
      return this.token;
    return this.login();
  }

  /** Authenticated request; re-logs in once on 401/403. Returns the parsed JSON (or null). */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res = await this.raw(method, path, body, await this.auth());
    if (res.status === 401 || res.status === 403)
      res = await this.raw(method, path, body, await this.auth(true));
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new StoreUnavailableError(
        `pocketbase ${method} ${path} -> ${res.status} ${detail.slice(0, 200)}`,
      );
    }
    return (res.status === 204 ? null : await res.json()) as T;
  }

  async listAll(collection: string): Promise<PbRecord[]> {
    const out: PbRecord[] = [];
    for (let page = 1; page <= 50; page++) {
      const r = await this.request<{ items: PbRecord[]; totalPages: number }>(
        "GET",
        `/api/collections/${collection}/records?perPage=500&page=${page}`,
      );
      out.push(...r.items);
      if (page >= r.totalPages) break;
    }
    return out;
  }

  /** One record, or null when it does not exist. */
  async findRecord(collection: string, id: string): Promise<PbRecord | null> {
    let res = await this.raw(
      "GET",
      `/api/collections/${collection}/records/${encodeURIComponent(id)}`,
      undefined,
      await this.auth(),
    );
    if (res.status === 401 || res.status === 403)
      res = await this.raw(
        "GET",
        `/api/collections/${collection}/records/${encodeURIComponent(id)}`,
        undefined,
        await this.auth(true),
      );
    if (res.status === 404) return null;
    if (!res.ok)
      throw new StoreUnavailableError(
        `pocketbase GET ${collection}/${id} -> ${res.status}`,
      );
    return (await res.json()) as PbRecord;
  }

  /** One page of records (server-side filter / sort / paging). */
  async listPage(
    collection: string,
    o: {
      page: number;
      perPage: number;
      filter?: string;
      sort?: string;
      withTotal?: boolean;
    },
  ): Promise<{ items: PbRecord[]; totalItems: number; totalPages: number }> {
    const q = new URLSearchParams({
      page: String(o.page),
      perPage: String(o.perPage),
    });
    if (o.filter) q.set("filter", o.filter);
    if (o.sort) q.set("sort", o.sort);
    if (!o.withTotal) q.set("skipTotal", "1");
    return this.request("GET", `/api/collections/${collection}/records?${q}`);
  }

  create(collection: string, data: Record<string, unknown>): Promise<PbRecord> {
    return this.request("POST", `/api/collections/${collection}/records`, data);
  }

  update(
    collection: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<PbRecord> {
    return this.request(
      "PATCH",
      `/api/collections/${collection}/records/${id}`,
      data,
    );
  }

  async remove(collection: string, id: string): Promise<void> {
    await this.request<null>(
      "DELETE",
      `/api/collections/${collection}/records/${id}`,
    );
  }

  /** Creates the collection (superuser-only rules, unique index) when it does not exist yet. */
  ensureCollection(
    name: string,
    fields: FieldDef[],
    uniqueOn: string[],
    /** extra raw `CREATE [UNIQUE] INDEX …` statements (names must be unique per collection) */
    indexes: string[] = [],
  ): Promise<void> {
    const have = this.ensured.get(name);
    if (have) return have;
    const p = (async () => {
      const token = await this.auth();
      const probe = await this.raw(
        "GET",
        `/api/collections/${name}`,
        undefined,
        token,
      );
      if (probe.ok) return;
      if (probe.status !== 404)
        throw new StoreUnavailableError(
          `pocketbase probe ${name} -> ${probe.status}`,
        );
      await this.request("POST", "/api/collections", {
        name,
        type: "base",
        fields,
        indexes: [
          ...(uniqueOn.length
            ? [
                `CREATE UNIQUE INDEX idx_${name}_uq ON ${name} (${uniqueOn.join(", ")})`,
              ]
            : []),
          ...indexes,
        ],
      });
    })();
    // a failed attempt must be retried next time, not cached
    p.catch(() => this.ensured.delete(name));
    this.ensured.set(name, p);
    return p;
  }
}

/* ----------------------------- record stores ----------------------------- */

const CACHE_MS = 3000;

export function pbCatalogStore(
  pb: PocketBase,
  now: () => number = Date.now,
): CatalogStore {
  return pbRecordStore<CatalogItem>(pb, "catalog_items", now);
}

/**
 * `{ id }` records in a PocketBase collection with two fields: `itemId` (unique) and `data`
 * (the whole record as JSON). A short read cache avoids a round trip per page view, and the last
 * good copy is served while PocketBase is unreachable.
 */
export function pbRecordStore<T extends { id: string }>(
  pb: PocketBase,
  collection: string,
  now: () => number = Date.now,
  /** longest record id the collection must accept */
  idMax = 40,
): RecordStore<T> {
  let cache: { at: number; items: T[]; ids: Map<string, string> } | null = null;

  const ready = () =>
    pb.ensureCollection(
      collection,
      [
        { name: "itemId", type: "text", required: true, max: idMax },
        { name: "data", type: "json", maxSize: 2_000_000 },
      ],
      ["itemId"],
    );

  async function load(force = false) {
    if (!force && cache && now() - cache.at < CACHE_MS) return cache;
    try {
      await ready();
      const records = await pb.listAll(collection);
      const items: T[] = [];
      const ids = new Map<string, string>();
      for (const r of records) {
        const d = r["data"] as T | null;
        if (d && typeof d === "object" && typeof d.id === "string") {
          items.push(d);
          ids.set(d.id, r.id);
        }
      }
      cache = { at: now(), items, ids };
    } catch (e) {
      // serve the last good copy rather than taking the viewer page down
      if (!cache) throw e;
    }
    return cache;
  }

  return {
    async list() {
      return (await load()).items;
    },
    async upsert(item) {
      await ready();
      const c = await load(true);
      const recordId = c.ids.get(item.id);
      if (recordId) await pb.update(collection, recordId, { data: item });
      else await pb.create(collection, { itemId: item.id, data: item });
      cache = null;
    },
    async remove(id) {
      await ready();
      const c = await load(true);
      const recordId = c.ids.get(id);
      if (!recordId) return false;
      await pb.remove(collection, recordId);
      cache = null;
      return true;
    },
  };
}

/* ------------------------------ i18n store ------------------------------ */

const I18N = "i18n_messages";

export function pbI18nStore(
  pb: PocketBase,
  now: () => number = Date.now,
): I18nStore {
  let cache: { at: number; value: Overrides; ids: Map<string, string> } | null =
    null;
  const rid = (lang: string, key: string) => `${lang}\u0000${key}`;

  const ready = () =>
    pb.ensureCollection(
      I18N,
      [
        { name: "lang", type: "text", required: true, max: 8 },
        { name: "key", type: "text", required: true, max: 120 },
        { name: "value", type: "text", max: 4000 },
      ],
      ["lang", "key"],
    );

  async function load(force = false) {
    if (!force && cache && now() - cache.at < CACHE_MS) return cache;
    try {
      await ready();
      const value: Overrides = {};
      const ids = new Map<string, string>();
      for (const r of await pb.listAll(I18N)) {
        const lang = String(r["lang"] ?? "");
        const key = String(r["key"] ?? "");
        if (!lang || !key) continue;
        (value[lang] ??= {})[key] = String(r["value"] ?? "");
        ids.set(rid(lang, key), r.id);
      }
      cache = { at: now(), value, ids };
    } catch (e) {
      if (!cache) throw e;
    }
    return cache;
  }

  return {
    async all() {
      return (await load()).value;
    },
    async set(lang, key, value) {
      const c = await load(true);
      const id = c.ids.get(rid(lang, key));
      if (id) await pb.update(I18N, id, { value });
      else await pb.create(I18N, { lang, key, value });
      cache = null;
    },
    async remove(lang, key) {
      const c = await load(true);
      const id = c.ids.get(rid(lang, key));
      if (!id) return false;
      await pb.remove(I18N, id);
      cache = null;
      return true;
    },
  };
}
