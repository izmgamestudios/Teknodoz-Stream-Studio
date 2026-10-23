// src/server/content.ts
// Content gateway (pure Request -> Response). Admin routes need the admin session / token;
// library routes are public and anonymous. Visibility is decided only by content-model.ts.
//
//   GET    /api/content                    admin  paged list (type, visibility, q, tag, locale, deleted, sort, page, perPage, total)
//   POST   /api/content                    admin  create { type, ...fields }
//   GET    /api/content/:id                admin
//   PUT    /api/content/:id                admin  patch fields (type is immutable)
//   DELETE /api/content/:id                admin  soft delete;  POST /api/content/:id/restore
//   GET    /api/library/:type              public public items + protected stubs, paged
//   GET    /api/library/:type/:slug        public one item (or a stub / a slug redirect)
import {
  PUBLIC_TYPES,
  ENTITY_TYPES,
  VISIBILITIES,
  slugify,
  type EntityType,
} from "../shared/schema-registry";
import { isAdminRequest } from "./auth";
import { StoreUnavailableError, type RecordStore } from "./catalog";
import {
  CONTENT_ID_RE,
  libraryView,
  visibleTo,
  type ContentRow,
  type LibraryItem,
  type LibraryStub,
} from "./content-model";
import type { ContentQuery, ContentSort, ContentStore } from "./content-store";
import { applyInput } from "./content-write";

export const CONTENT_API_PREFIX = "/api/content";
export const LIBRARY_API_PREFIX = "/api/library";
const MAX_BODY_BYTES = 1_000_000;
/** Cloudflare / browsers may keep public library responses; revalidate in the background. */
export const PUBLIC_CACHE =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  target_collection: string;
  target_ids: string[];
  before: unknown;
  after: unknown;
  source: "api" | "bulk" | "import";
}
export interface AuditSink {
  append(e: AuditEntry): Promise<void>;
}
export const memoryAudit = (): AuditSink & { entries: AuditEntry[] } => {
  const entries: AuditEntry[] = [];
  return { entries, append: async (e) => void entries.push(e) };
};

export interface Redirect {
  /** `${type}:${from}` */
  id: string;
  type: EntityType;
  from: string;
  to: string;
}

export interface ContentOptions {
  token: string | null;
  store: ContentStore;
  redirects: RecordStore<Redirect>;
  audit: AuditSink;
  now?: () => Date;
}

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });

const isType = (v: string): v is EntityType =>
  (ENTITY_TYPES as readonly string[]).includes(v);
const isPublicType = (v: string): v is EntityType =>
  PUBLIC_TYPES.includes(v as EntityType);

function parseQuery(url: URL, admin: boolean): ContentQuery | null {
  const g = (k: string) => url.searchParams.get(k) ?? "";
  const q: ContentQuery = {
    page: Number(g("page")) || 1,
    perPage: Math.min(Number(g("perPage")) || 50, admin ? 100 : 50),
  };
  if (g("type")) {
    if (!isType(g("type"))) return null;
    q.type = g("type") as EntityType;
  }
  if (g("visibility")) {
    const v = g("visibility").split(",");
    if (!v.every((x) => (VISIBILITIES as readonly string[]).includes(x)))
      return null;
    q.visibility = v as ContentQuery["visibility"] & string[];
  }
  if (g("q")) q.q = g("q").slice(0, 100);
  if (g("tag")) q.tag = g("tag").slice(0, 40);
  if (g("locale")) q.locale = g("locale").slice(0, 4);
  const sort = g("sort");
  if (sort) {
    if (!["updated_desc", "created_desc", "title_asc"].includes(sort))
      return null;
    q.sort = sort as ContentSort;
  }
  if (admin) {
    const d = g("deleted");
    if (d === "include" || d === "only") q.deleted = d;
    if (g("total") === "1") q.withTotal = true;
  }
  return q;
}

/** List view: no body, so a page of 50 stays small. */
function listItem(v: LibraryItem | LibraryStub): unknown {
  if (v.protected) return v;
  const { body_blocks: _b, ...rest } = v;
  return rest;
}

export function createContentApi(opts: ContentOptions) {
  const now = opts.now ?? (() => new Date());

  async function uniqueSlug(
    type: EntityType,
    wanted: string,
    selfId: string,
  ): Promise<string | null> {
    const base = slugify(wanted, 110);
    for (let n = 1; n <= 30; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      const hit = await opts.store.findBySlug(type, slug);
      if (!hit || hit.id === selfId) return slug;
    }
    return null;
  }

  async function write(
    req: Request,
    existing: ContentRow | null,
    forcedType?: EntityType,
  ): Promise<Response> {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "too-large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "bad-request" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return json({ error: "bad-request" }, 400);
    const { type: inType, ...fields } = body as Record<string, unknown>;
    const type =
      existing?.type ??
      forcedType ??
      (typeof inType === "string" && isType(inType) ? inType : null);
    if (!type) return json({ error: "bad-type" }, 400);
    if (existing && inType !== undefined && inType !== existing.type)
      return json({ error: "type-immutable" }, 400);

    const stamp = now().toISOString();
    const r = applyInput(type, existing, fields, stamp, "admin");
    if (!r.ok) return json({ error: r.error, issues: r.issues ?? [] }, 400);
    const row = r.row;

    // slug: explicit conflicts are errors, generated ones are made unique
    const explicit = typeof (fields as { slug?: unknown }).slug === "string";
    const wanted = row.slug;
    const slug = await uniqueSlug(type, wanted, row.id);
    if (slug === null || (explicit && slug !== slugify(wanted, 110)))
      return json({ error: "slug-taken" }, 409);
    row.slug = slug;
    if (row.external_id) {
      const dup = await opts.store.findByExternalId(type, row.external_id);
      if (dup && dup.id !== row.id)
        return json({ error: "external-id-taken" }, 409);
    }

    await opts.store.put(row);
    if (
      existing &&
      existing.slug !== row.slug &&
      existing.slug &&
      existing.visibility === "public"
    )
      await opts.redirects.upsert({
        id: `${type}:${existing.slug}`,
        type,
        from: existing.slug,
        to: row.slug,
      });
    await opts.audit.append({
      at: stamp,
      actor: "admin",
      action: existing ? "update" : "create",
      target_collection: "content_items",
      target_ids: [row.id],
      before: existing
        ? {
            visibility: existing.visibility,
            slug: existing.slug,
            title: existing.title,
          }
        : null,
      after: { visibility: row.visibility, slug: row.slug, title: row.title },
      source: "api",
    });
    return json({ item: row }, existing ? 200 : 201);
  }

  async function setDeleted(
    row: ContentRow,
    deleted: boolean,
  ): Promise<Response> {
    const stamp = now().toISOString();
    const next = { ...row, is_deleted: deleted, updated_at: stamp };
    await opts.store.put(next);
    await opts.audit.append({
      at: stamp,
      actor: "admin",
      action: deleted ? "soft-delete" : "restore",
      target_collection: "content_items",
      target_ids: [row.id],
      before: { is_deleted: row.is_deleted },
      after: { is_deleted: deleted },
      source: "api",
    });
    return json({ item: next });
  }

  async function adminRoutes(
    req: Request,
    url: URL,
    rest: string[],
  ): Promise<Response> {
    const method = req.method.toUpperCase();
    if (!isAdminRequest(req, opts.token, now().getTime()))
      return json({ error: "unauthorized" }, 401);

    if (rest.length === 0) {
      if (method === "GET") {
        const q = parseQuery(url, true);
        if (!q) return json({ error: "bad-query" }, 400);
        const page = await opts.store.list(q);
        return json({
          ...page,
          items: page.items.filter((r) => visibleTo({ role: "admin" }, r)),
        });
      }
      if (method === "POST") return write(req, null);
      return json({ error: "method-not-allowed" }, 405);
    }
    const id = rest[0] ?? "";
    if (!CONTENT_ID_RE.test(id)) return json({ error: "not-found" }, 404);
    const row = await opts.store.get(id);
    if (!row) return json({ error: "not-found" }, 404);
    if (rest.length === 1) {
      if (method === "GET") return json({ item: row });
      if (method === "PUT") return write(req, row);
      if (method === "DELETE") return setDeleted(row, true);
    }
    if (rest.length === 2 && rest[1] === "restore" && method === "POST")
      return setDeleted(row, false);
    return json({ error: "not-found" }, 404);
  }

  async function libraryRoutes(
    req: Request,
    url: URL,
    rest: string[],
  ): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD")
      return json({ error: "method-not-allowed" }, 405);
    const type = rest[0] ?? "";
    if (!isPublicType(type)) return json({ error: "not-found" }, 404);
    const cache = { "cache-control": PUBLIC_CACHE };

    if (rest.length === 1) {
      const q = parseQuery(url, false);
      if (!q) return json({ error: "bad-query" }, 400);
      q.type = type;
      q.visibility = ["public", "protected"];
      const page = await opts.store.list(q);
      const items = page.items
        .map(libraryView)
        .filter((v): v is LibraryItem | LibraryStub => v !== null)
        .map(listItem);
      return json(
        {
          items,
          page: page.page,
          perPage: page.perPage,
          hasMore: page.hasMore,
        },
        200,
        cache,
      );
    }
    if (rest.length === 2) {
      const slug = rest[1] ?? "";
      const row = await opts.store.findBySlug(type, slug);
      const view = row ? libraryView(row) : null;
      if (view) return json({ item: view }, 200, cache);
      const redirect = (await opts.redirects.list()).find(
        (r) => r.id === `${type}:${slug}`,
      );
      if (redirect) return json({ redirect: redirect.to }, 200, cache);
      return json({ error: "not-found" }, 404, {
        "cache-control": "public, max-age=30",
      });
    }
    return json({ error: "not-found" }, 404);
  }

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    const adminPath =
      path === CONTENT_API_PREFIX || path.startsWith(`${CONTENT_API_PREFIX}/`);
    const libPath = path.startsWith(`${LIBRARY_API_PREFIX}/`);
    if (!adminPath && !libPath) return null;
    try {
      return adminPath
        ? await adminRoutes(
            req,
            url,
            path.slice(CONTENT_API_PREFIX.length).split("/").filter(Boolean),
          )
        : await libraryRoutes(
            req,
            url,
            path.slice(LIBRARY_API_PREFIX.length).split("/").filter(Boolean),
          );
    } catch (e) {
      if (e instanceof StoreUnavailableError)
        return json({ error: "store-unavailable" }, 503);
      console.error("[content]", e);
      return json({ error: "internal" }, 500);
    }
  }

  return { handle };
}
