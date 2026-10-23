// src/server/watch-bridge.ts
// Public content rows (stories, videos, podcasts from the Content Engine) shown on the Watch &
// Listen page next to the curated catalog. Only `public`, indexable-or-not rows with a playable
// source are bridged; protected rows never leave the engine. Rows migrated from the old catalog
// (external_id = catalog id) are skipped so nothing shows twice.
import {
  CANONICAL_CATEGORIES,
  canonicalCategory,
} from "../studio/watch/categories";
import { parseMediaInput, type MediaSource } from "../studio/watch/media-url";
import type { PublicItem } from "./catalog";
import type { ContentRow } from "./content-model";
import type { ContentStore } from "./content-store";
import { itemPath } from "./seo/model";

const UPLOAD = /^\/media\/([a-f0-9]{16})(?:[/?#].*)?$/;

export function sourceOf(row: ContentRow): MediaSource | null {
  const raw = row.meta["media_url"];
  if (typeof raw !== "string" || raw === "") return null;
  const up = UPLOAD.exec(raw);
  if (up)
    return {
      kind: "upload",
      id: up[1] as string,
      media: row.type === "podcast" ? "audio" : "video",
    };
  return parseMediaInput(raw);
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** meta.category when set; else the first tag that names an editorial topic. */
export function categoryOfRow(row: ContentRow): string {
  const own = canonicalCategory(str(row.meta["category"]));
  if (own) return own;
  for (const t of row.tags) {
    const c = canonicalCategory(t);
    if ((CANONICAL_CATEGORIES as readonly string[]).includes(c)) return c;
  }
  return "";
}

export function contentToItem(row: ContentRow): PublicItem | null {
  if (row.visibility !== "public" || row.is_deleted) return null;
  const source = sourceOf(row);
  if (!source) return null;
  const dur = row.meta["duration_sec"];
  const episode = row.meta["episode"];
  const poster = str(row.meta["poster_url"]) || row.og_image;
  return {
    id: `c-${row.id}`,
    title: row.title,
    description: row.summary,
    category: categoryOfRow(row),
    tags: row.tags,
    source,
    visibility: "public",
    locked: false,
    needsPassword: false,
    startsAt: null,
    live: false,
    story: row.type === "story",
    playlist: str(row.meta["series"]),
    episode: typeof episode === "number" ? episode : null,
    poster:
      poster.startsWith("https://") || poster.startsWith("/media/")
        ? poster
        : "",
    captions: [],
    archived: false,
    storyUntil: null,
    featured: false,
    durationMs:
      typeof dur === "number" && dur > 0 ? Math.round(dur * 1000) : null,
    createdAt: row.created_at,
    pageUrl: itemPath(row.type, row.slug),
  };
}

/** Newest public rows of the three public types, capped so /watch stays one cheap response. */
export async function bridgeItems(
  store: ContentStore,
  skipExternalIds: ReadonlySet<string>,
  cap = 200,
): Promise<PublicItem[]> {
  const out: PublicItem[] = [];
  for (const type of ["podcast", "video", "story"] as const) {
    const page = await store.list({
      type,
      visibility: ["public"],
      sort: "updated_desc",
      perPage: cap,
    });
    for (const row of page.items) {
      if (row.external_id && skipExternalIds.has(row.external_id)) continue;
      const item = contentToItem(row);
      if (item) out.push(item);
    }
  }
  return out.slice(0, cap);
}
