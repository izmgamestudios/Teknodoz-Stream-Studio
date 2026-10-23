// src/server/content-store.ts
// Persistence for `content_items`: one interface, three backends.
//  - record-backed (memory / JSON file): filters in memory, fine for tests and tiny sites
//  - PocketBase: real indexed columns, server-side filter / sort / paging (scales to ~1 M rows)
// Lists are always paged; nothing in the request path loads the whole table.
import { StoreUnavailableError, type RecordStore } from "./catalog";
import type { AuditEntry, AuditSink } from "./content";
import type { ContentRow } from "./content-model";
import type { PocketBase, PbRecord } from "./pocketbase";
import {
  VISIBILITIES,
  type EntityType,
  type Visibility,
} from "../shared/schema-registry";

export type ContentSort = "updated_desc" | "created_desc" | "title_asc";

export interface ContentQuery {
  type?: EntityType;
  visibility?: readonly Visibility[];
  locale?: string;
  tag?: string;
  /** substring of title / summary / tags */
  q?: string;
  /** default: live rows only */
  deleted?: "exclude" | "include" | "only";
  sort?: ContentSort;
  page?: number;
  perPage?: number;
  /** count all matches (an extra query on PocketBase) */
  withTotal?: boolean;
}

export interface ContentPage {
  items: ContentRow[];
  page: number;
  perPage: number;
  hasMore: boolean;
  /** null unless `withTotal` */
  total: number | null;
}

export interface ContentStore {
  get(id: string): Promise<ContentRow | null>;
  findBySlug(type: EntityType, slug: string): Promise<ContentRow | null>;
  findByExternalId(
    type: EntityType,
    externalId: string,
  ): Promise<ContentRow | null>;
  list(query: ContentQuery): Promise<ContentPage>;
  /** insert or replace by id */
  put(row: ContentRow): Promise<void>;
  /**
   * Writes many rows in one unit (PocketBase: one transaction). `isNew` says whether the row is
   * inserted or updated, so no lookups are needed.
   */
  putMany(rows: readonly { row: ContentRow; isNew: boolean }[]): Promise<void>;
}

export const MAX_PER_PAGE = 100;
export const DEFAULT_PER_PAGE = 50;

export function normalizePaging(q: ContentQuery): {
  page: number;
  perPage: number;
} {
  return {
    page: Math.max(1, Math.floor(q.page ?? 1)),
    perPage: Math.min(
      MAX_PER_PAGE,
      Math.max(1, Math.floor(q.perPage ?? DEFAULT_PER_PAGE)),
    ),
  };
}

const fold = (s: string): string =>
  s
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

/** In-memory evaluation of a query (reference semantics; the PocketBase filter mirrors it). */
export function matchesQuery(row: ContentRow, q: ContentQuery): boolean {
  const del = q.deleted ?? "exclude";
  if (del === "exclude" && row.is_deleted) return false;
  if (del === "only" && !row.is_deleted) return false;
  if (q.type && row.type !== q.type) return false;
  if (q.visibility && !q.visibility.includes(row.visibility)) return false;
  if (q.locale && row.locale !== q.locale) return false;
  if (q.tag && !row.tags.includes(q.tag)) return false;
  if (q.q) {
    const hay = fold(`${row.title}\n${row.summary}\n${row.tags.join(" ")}`);
    if (!hay.includes(fold(q.q))) return false;
  }
  return true;
}

export function sortRows(
  rows: ContentRow[],
  sort: ContentSort = "updated_desc",
): ContentRow[] {
  const by: Record<ContentSort, (a: ContentRow, b: ContentRow) => number> = {
    updated_desc: (a, b) =>
      b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id),
    created_desc: (a, b) =>
      b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
    title_asc: (a, b) =>
      a.title.localeCompare(b.title, "tr") || a.id.localeCompare(b.id),
  };
  return [...rows].sort(by[sort]);
}

/** Store over `{ id }` records (memory or JSON file). */
export function recordBackedContentStore(
  store: RecordStore<ContentRow>,
): ContentStore {
  const all = () => store.list();
  return {
    async get(id) {
      return (await all()).find((r) => r.id === id) ?? null;
    },
    async findBySlug(type, slug) {
      return (
        (await all()).find(
          (r) => r.type === type && r.slug === slug && slug !== "",
        ) ?? null
      );
    },
    async findByExternalId(type, externalId) {
      return (
        (await all()).find(
          (r) =>
            r.type === type &&
            r.external_id === externalId &&
            externalId !== "",
        ) ?? null
      );
    },
    async list(q) {
      const { page, perPage } = normalizePaging(q);
      const rows = sortRows(
        (await all()).filter((r) => matchesQuery(r, q)),
        q.sort,
      );
      const start = (page - 1) * perPage;
      return {
        items: rows.slice(start, start + perPage),
        page,
        perPage,
        hasMore: rows.length > start + perPage,
        total: q.withTotal ? rows.length : null,
      };
    },
    async put(row) {
      await store.upsert(row);
    },
    async putMany(rows) {
      for (const { row } of rows) await store.upsert(row);
    },
  };
}

/* ------------------------------ PocketBase ------------------------------ */

export const CONTENT_COLLECTION = "content_items";

const esc = (s: string): string =>
  s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** PocketBase filter expression equivalent to `matchesQuery` (values are escaped, enums checked). */
export function pbFilter(q: ContentQuery): string {
  const parts: string[] = [];
  const del = q.deleted ?? "exclude";
  if (del === "exclude") parts.push("is_deleted = false");
  if (del === "only") parts.push("is_deleted = true");
  if (q.type) parts.push(`type = "${esc(q.type)}"`);
  if (q.visibility) {
    const v = q.visibility.filter((x) =>
      (VISIBILITIES as readonly string[]).includes(x),
    );
    parts.push(
      v.length
        ? `(${v.map((x) => `visibility = "${x}"`).join(" || ")})`
        : 'id = ""',
    );
  }
  if (q.locale) parts.push(`locale = "${esc(q.locale)}"`);
  if (q.tag) parts.push(`tags ~ "${esc(JSON.stringify(q.tag).slice(1, -1))}"`);
  if (q.q) {
    const t = esc(q.q);
    parts.push(`(title ~ "${t}" || summary ~ "${t}" || tags ~ "${t}")`);
  }
  return parts.join(" && ");
}

const SORT: Record<ContentSort, string> = {
  updated_desc: "-updated_at,id",
  created_desc: "-created_at,id",
  title_asc: "title,id",
};

export function rowToRecord(r: ContentRow): Record<string, unknown> {
  const { id: _id, ...rest } = r;
  return rest;
}

export function recordToRow(rec: PbRecord): ContentRow {
  const j = <T>(v: unknown, d: T): T =>
    v === null || v === undefined || v === "" ? d : (v as T);
  return {
    id: rec.id,
    type: rec["type"] as ContentRow["type"],
    external_id: String(rec["external_id"] ?? ""),
    slug: String(rec["slug"] ?? ""),
    title: String(rec["title"] ?? ""),
    summary: String(rec["summary"] ?? ""),
    body_blocks: j(rec["body_blocks"], []),
    locale: (rec["locale"] as ContentRow["locale"]) || "tr",
    visibility: (rec["visibility"] as ContentRow["visibility"]) || "draft",
    access_group: String(rec["access_group"] ?? ""),
    tags: j(rec["tags"], []),
    source_url: String(rec["source_url"] ?? ""),
    og_image: String(rec["og_image"] ?? ""),
    seo_title: String(rec["seo_title"] ?? ""),
    seo_description: String(rec["seo_description"] ?? ""),
    noindex: rec["noindex"] === true,
    meta: j(rec["meta"], {}),
    owner: String(rec["owner"] ?? ""),
    schema_version: Number(rec["schema_version"] ?? 1),
    is_deleted: rec["is_deleted"] === true,
    created_at: String(rec["created_at"] ?? ""),
    updated_at: String(rec["updated_at"] ?? ""),
  };
}

export function pbContentStore(pb: PocketBase): ContentStore {
  const t = (name: string, max = 500) => ({ name, type: "text" as const, max });
  const ready = () =>
    pb.ensureCollection(
      CONTENT_COLLECTION,
      [
        t("type", 30),
        t("external_id", 80),
        t("slug", 120),
        { ...t("title", 200), required: true },
        t("summary", 600),
        { name: "body_blocks", type: "json", maxSize: 2_000_000 },
        t("locale", 4),
        t("visibility", 12),
        t("access_group", 40),
        { name: "tags", type: "json", maxSize: 4000 },
        t("source_url", 2000),
        t("og_image", 2000),
        t("seo_title", 100),
        t("seo_description", 200),
        { name: "noindex", type: "bool" },
        { name: "meta", type: "json", maxSize: 200_000 },
        t("owner", 40),
        { name: "schema_version", type: "number" },
        { name: "is_deleted", type: "bool" },
        t("created_at", 40),
        t("updated_at", 40),
      ],
      [],
      [
        `CREATE INDEX idx_${CONTENT_COLLECTION}_list ON ${CONTENT_COLLECTION} (type, visibility, is_deleted, updated_at)`,
        `CREATE UNIQUE INDEX idx_${CONTENT_COLLECTION}_slug ON ${CONTENT_COLLECTION} (type, slug) WHERE slug != ''`,
        `CREATE UNIQUE INDEX idx_${CONTENT_COLLECTION}_ext ON ${CONTENT_COLLECTION} (type, external_id) WHERE external_id != ''`,
      ],
    );

  async function one(filter: string): Promise<ContentRow | null> {
    await ready();
    const r = await pb.listPage(CONTENT_COLLECTION, {
      page: 1,
      perPage: 1,
      filter,
    });
    return r.items[0] ? recordToRow(r.items[0]) : null;
  }

  return {
    async get(id) {
      await ready();
      const rec = await pb.findRecord(CONTENT_COLLECTION, id);
      return rec ? recordToRow(rec) : null;
    },
    findBySlug: (type, slug) =>
      slug === ""
        ? Promise.resolve(null)
        : one(`type = "${esc(type)}" && slug = "${esc(slug)}"`),
    findByExternalId: (type, ext) =>
      ext === ""
        ? Promise.resolve(null)
        : one(`type = "${esc(type)}" && external_id = "${esc(ext)}"`),
    async list(q) {
      await ready();
      const { page, perPage } = normalizePaging(q);
      const r = await pb.listPage(CONTENT_COLLECTION, {
        page,
        perPage,
        filter: pbFilter(q),
        sort: SORT[q.sort ?? "updated_desc"],
        withTotal: q.withTotal ?? false,
      });
      return {
        items: r.items.map(recordToRow),
        page,
        perPage,
        // without totals PocketBase cannot say; one extra row would be needed, so ask for a full page
        hasMore: q.withTotal ? page < r.totalPages : r.items.length === perPage,
        total: q.withTotal ? r.totalItems : null,
      };
    },
    async putMany(rows) {
      if (rows.length === 0) return;
      await ready();
      const base = `/api/collections/${CONTENT_COLLECTION}/records`;
      const requests = rows.map(({ row, isNew }) =>
        isNew
          ? {
              method: "POST" as const,
              url: base,
              body: { id: row.id, ...rowToRecord(row) },
            }
          : {
              method: "PATCH" as const,
              url: `${base}/${row.id}`,
              body: rowToRecord(row),
            },
      );
      try {
        await pb.batch(requests);
        return;
      } catch (first) {
        // the batch API is off by default: switch it on once and retry
        try {
          await pb.enableBatch();
          await pb.batch(requests);
          return;
        } catch {
          // an unavailable server must not be retried row by row
          if (
            first instanceof StoreUnavailableError &&
            /unreachable/.test(first.message)
          )
            throw first;
        }
      }
      // last resort (old PocketBase without /api/batch): row by row
      for (const { row, isNew } of rows) {
        if (isNew)
          await pb.create(CONTENT_COLLECTION, {
            id: row.id,
            ...rowToRecord(row),
          });
        else await pb.update(CONTENT_COLLECTION, row.id, rowToRecord(row));
      }
    },
    async put(row) {
      await ready();
      const exists = await pb.findRecord(CONTENT_COLLECTION, row.id);
      if (exists) await pb.update(CONTENT_COLLECTION, row.id, rowToRecord(row));
      else
        await pb.create(CONTENT_COLLECTION, {
          id: row.id,
          ...rowToRecord(row),
        });
    },
  };
}

export { StoreUnavailableError };

/* ------------------------------- audit sink ------------------------------- */

export function pbAuditSink(pb: PocketBase): AuditSink {
  const text = (name: string, max = 200) => ({
    name,
    type: "text" as const,
    max,
  });
  const ready = () =>
    pb.ensureCollection(
      "content_audit",
      [
        text("at", 40),
        text("actor", 40),
        text("action", 40),
        text("target_collection", 60),
        { name: "target_ids", type: "json", maxSize: 200_000 },
        { name: "before", type: "json", maxSize: 50_000 },
        { name: "after", type: "json", maxSize: 50_000 },
        text("source", 12),
      ],
      [],
      ["CREATE INDEX idx_content_audit_at ON content_audit (at)"],
    );
  return {
    async append(e: AuditEntry) {
      try {
        await ready();
        await pb.create("content_audit", { ...e });
      } catch (err) {
        // an audit hiccup must not undo or block the edit itself
        console.error("[audit]", err);
      }
    },
  };
}
