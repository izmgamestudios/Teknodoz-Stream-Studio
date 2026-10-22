// src/server/admin.ts
// Admin hub API: storage status and JSON backup / restore of everything kept on the server
// (catalog items + translation overrides). All routes need the CATALOG_ADMIN_TOKEN.
//
//   GET  /api/admin/status   { storage, healthy, counts, checkedAt }
//   GET  /api/admin/export   full backup (contains password hashes + secret link keys: keep private)
//   POST /api/admin/import   merge a backup into the store (existing ids are replaced)
import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { tr } from "../studio/i18n/messages";
import { isMediaSource } from "../studio/watch/media-url";
import {
  captionSchema,
  isAssetUrl,
  CATALOG_LIMITS,
  StoreUnavailableError,
  type CatalogItem,
  type CatalogStore,
} from "./catalog";
import type { I18nStore } from "./i18n";

export const ADMIN_API_PREFIX = "/api/admin";
export const BACKUP_VERSION = 1;
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const LANGS = new Set(["tr", "en", "de", "es"]);

const text = (max: number) => z.string().max(max);
const itemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,40}$/),
  title: text(120).min(1),
  description: text(1000),
  category: text(30),
  tags: z.array(text(24)).max(8),
  source: z.unknown().refine(isMediaSource, "bad-source"),
  visibility: z.enum(["public", "private"]),
  passwordHash: z
    .string()
    .regex(/^[0-9a-f]{32}:[0-9a-f]{64}$/)
    .nullable(),
  linkKey: z.string().max(100).nullable(),
  startsAt: z.string().datetime({ offset: true }).nullable(),
  live: z.boolean(),
  // added after the first release: older backups lack these
  story: z.boolean().default(false),
  playlist: text(60).default(""),
  episode: z.number().int().min(0).max(100000).nullable().default(null),
  poster: z.string().max(500).refine(isAssetUrl, "bad-url").default(""),
  captions: z.array(captionSchema).max(8).default([]),
  createdAt: z.string().datetime({ offset: true }),
});

const placeholders = (s: string): string =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
  });

export interface AdminOptions {
  token: string | null;
  catalog: CatalogStore;
  i18n: I18nStore;
  /** which backend is configured (shown in the panel) */
  storage: "pocketbase" | "file";
  now?: () => number;
}

export function createAdminApi(opts: AdminOptions) {
  const now = opts.now ?? Date.now;

  function isAdmin(req: Request): boolean {
    if (!opts.token) return false;
    const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
    if (!m) return false;
    const a = Buffer.from(m[1] as string);
    const b = Buffer.from(opts.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  const countOverrides = (o: Record<string, Record<string, string>>): number =>
    Object.values(o).reduce((n, m) => n + Object.keys(m).length, 0);

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (
      url.pathname !== ADMIN_API_PREFIX &&
      !url.pathname.startsWith(`${ADMIN_API_PREFIX}/`)
    )
      return null;
    const route = url.pathname
      .slice(ADMIN_API_PREFIX.length)
      .replace(/^\/|\/$/g, "");
    const method = req.method.toUpperCase();
    if (!opts.token) return json({ error: "admin-disabled" }, 503);
    if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);

    try {
      if (route === "status" && method === "GET") {
        let healthy = true;
        let catalog = 0;
        let overrides = 0;
        try {
          catalog = (await opts.catalog.list()).length;
          overrides = countOverrides(await opts.i18n.all());
        } catch (e) {
          if (!(e instanceof StoreUnavailableError)) throw e;
          healthy = false;
        }
        return json({
          storage: opts.storage,
          healthy,
          counts: { catalog, overrides },
          checkedAt: new Date(now()).toISOString(),
        });
      }

      if (route === "export" && method === "GET") {
        const stamp = new Date(now()).toISOString().slice(0, 10);
        return json(
          {
            version: BACKUP_VERSION,
            exportedAt: new Date(now()).toISOString(),
            catalog: await opts.catalog.list(),
            i18n: await opts.i18n.all(),
          },
          200,
          {
            "content-disposition": `attachment; filename="teknodoz-backup-${stamp}.json"`,
          },
        );
      }

      if (route === "import" && method === "POST") {
        const raw = await req.text();
        if (raw.length > MAX_IMPORT_BYTES)
          return json({ error: "too-large" }, 413);
        const body = z
          .object({
            version: z.literal(BACKUP_VERSION),
            catalog: z
              .array(z.unknown())
              .max(CATALOG_LIMITS.maxItems)
              .default([]),
            i18n: z
              .record(z.string(), z.record(z.string(), z.string()))
              .default({}),
          })
          .safeParse(JSON.parse(raw));
        if (!body.success) return json({ error: "bad-backup" }, 400);

        // validate everything first so a bad file changes nothing
        const items: CatalogItem[] = [];
        for (const it of body.data.catalog) {
          const p = itemSchema.safeParse(it);
          if (!p.success) return json({ error: "bad-item" }, 400);
          items.push(p.data as unknown as CatalogItem);
        }
        const messages: [string, string, string][] = [];
        for (const [lang, map] of Object.entries(body.data.i18n)) {
          if (!LANGS.has(lang)) return json({ error: "bad-language" }, 400);
          for (const [key, value] of Object.entries(map)) {
            if (!Object.prototype.hasOwnProperty.call(tr, key))
              return json({ error: "unknown-key" }, 400);
            const v = value.trim();
            if (v === "" || v.length > 4000)
              return json({ error: "bad-message" }, 400);
            if (placeholders(v) !== placeholders(tr[key as keyof typeof tr]))
              return json({ error: "placeholder-mismatch" }, 400);
            messages.push([lang, key, v]);
          }
        }
        for (const item of items) await opts.catalog.upsert(item);
        for (const [lang, key, value] of messages)
          await opts.i18n.set(lang, key, value);
        return json({ ok: true, catalog: items.length, i18n: messages.length });
      }
      return json({ error: "not-found" }, 404);
    } catch (e) {
      if (e instanceof StoreUnavailableError)
        return json({ error: "store-unavailable" }, 503);
      if (e instanceof SyntaxError) return json({ error: "bad-request" }, 400);
      console.error("[admin]", e);
      return json({ error: "internal" }, 500);
    }
  }

  return { handle };
}
