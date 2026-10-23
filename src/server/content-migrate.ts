// src/server/content-migrate.ts
// One-time (idempotent) move of the /watch catalog into content_items.
//   POST /api/admin/migrate/watch            dry run: counts + a sample, nothing written
//   POST /api/admin/migrate/watch?commit=1   writes missing rows (existing external ids are skipped)
// The old catalog stays untouched and /watch keeps reading it until the table engine replaces it.
// Password hashes and secret link keys are NOT copied.
import { textToBlocks } from "../shared/blocks";
import { slugify, type EntityType } from "../shared/schema-registry";
import { isAdminRequest } from "./auth";
import {
  StoreUnavailableError,
  type CatalogItem,
  type CatalogStore,
} from "./catalog";
import type { AuditSink } from "./content";
import { blankRow, type ContentRow } from "./content-model";
import type { ContentStore } from "./content-store";

export const MIGRATE_PATH = "/api/admin/migrate/watch";

export function mediaUrlOf(item: CatalogItem): string | null {
  const s = item.source;
  switch (s.kind) {
    case "file":
    case "audio":
      return s.url;
    case "upload":
      return `/media/${s.id}`;
    case "youtube":
      return `https://www.youtube.com/watch?v=${s.id}`;
    case "vimeo":
      return `https://vimeo.com/${s.id}`;
    case "youtube-live":
      return `https://www.youtube.com/channel/${s.channel}/live`;
    case "room":
      return null;
  }
}

export function typeOf(item: CatalogItem): EntityType {
  if (item.story) return "story";
  const s = item.source;
  if (s.kind === "audio" || (s.kind === "upload" && s.media === "audio"))
    return "podcast";
  return "video";
}

/** Pure mapping of one catalog item. `slug` must already be unique for its type. */
export function catalogToRow(
  item: CatalogItem,
  slug: string,
  now: string,
): ContentRow | null {
  const media = mediaUrlOf(item);
  if (media === null) return null; // room links are not publishable media
  const type = typeOf(item);
  const meta: Record<string, unknown> = { media_url: media };
  if (item.poster) meta["poster_url"] = item.poster;
  if (item.durationMs)
    meta["duration_sec"] = Math.round(item.durationMs / 1000);
  if (item.category) meta["category"] = item.category;
  if (type === "story" && item.storyUntil)
    meta["story_until"] = item.storyUntil;
  if (type === "podcast") {
    if (item.playlist) meta["series"] = item.playlist;
    if (item.episode !== null) meta["episode"] = item.episode;
  }
  meta["legacy"] = {
    catalogId: item.id,
    playlist: item.playlist,
    episode: item.episode,
    featured: item.featured,
    live: item.live,
    startsAt: item.startsAt,
    captions: item.captions,
    source: item.source,
    archived: item.archived,
    passwordProtected: item.passwordHash !== null || item.linkKey !== null,
  };
  return blankRow(type, item.title, now, {
    external_id: `catalog:${item.id}`,
    slug,
    summary: item.description.slice(0, 300),
    body_blocks: textToBlocks(item.description),
    visibility: item.archived
      ? "draft"
      : item.visibility === "public"
        ? "public"
        : "private",
    tags: item.tags.slice(0, 20),
    meta,
    created_at: item.createdAt,
  });
}

export interface MigrationReport {
  commit: boolean;
  total: number;
  created: number;
  existing: number;
  skipped: number;
  sample: {
    external_id: string;
    type: EntityType;
    slug: string;
    visibility: string;
  }[];
}

export async function migrateCatalog(
  catalog: CatalogStore,
  store: ContentStore,
  commit: boolean,
  now: string,
): Promise<{ report: MigrationReport; rows: ContentRow[] }> {
  const items = await catalog.list();
  const rows: ContentRow[] = [];
  const taken = new Set<string>();
  const report: MigrationReport = {
    commit,
    total: items.length,
    created: 0,
    existing: 0,
    skipped: 0,
    sample: [],
  };
  for (const item of items) {
    const type = typeOf(item);
    if (await store.findByExternalId(type, `catalog:${item.id}`)) {
      report.existing++;
      continue;
    }
    const base = slugify(item.title, 110);
    let slug = base;
    for (let n = 2; n < 50; n++) {
      if (
        !taken.has(`${type}:${slug}`) &&
        !(await store.findBySlug(type, slug))
      )
        break;
      slug = `${base}-${n}`;
    }
    const row = catalogToRow(item, slug, now);
    if (!row) {
      report.skipped++;
      continue;
    }
    taken.add(`${type}:${slug}`);
    rows.push(row);
    report.created++;
    if (report.sample.length < 5)
      report.sample.push({
        external_id: row.external_id,
        type,
        slug,
        visibility: row.visibility,
      });
  }
  if (commit) for (const r of rows) await store.put(r);
  return { report, rows };
}

export function createMigrationApi(opts: {
  token: string | null;
  catalog: CatalogStore;
  store: ContentStore;
  audit: AuditSink;
  now?: () => Date;
}) {
  const now = opts.now ?? (() => new Date());
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (url.pathname.replace(/\/+$/, "") !== MIGRATE_PATH) return null;
    if (req.method !== "POST")
      return json({ error: "method-not-allowed" }, 405);
    if (!isAdminRequest(req, opts.token, now().getTime()))
      return json({ error: "unauthorized" }, 401);
    try {
      const commit = url.searchParams.get("commit") === "1";
      const stamp = now().toISOString();
      const { report, rows } = await migrateCatalog(
        opts.catalog,
        opts.store,
        commit,
        stamp,
      );
      if (commit && rows.length)
        await opts.audit.append({
          at: stamp,
          actor: "admin",
          action: "migrate-watch",
          target_collection: "content_items",
          target_ids: rows.map((r) => r.id),
          before: null,
          after: { created: report.created },
          source: "import",
        });
      return json(report);
    } catch (e) {
      if (e instanceof StoreUnavailableError)
        return json({ error: "store-unavailable" }, 503);
      console.error("[migrate]", e);
      return json({ error: "internal" }, 500);
    }
  }
  return { handle };
}
