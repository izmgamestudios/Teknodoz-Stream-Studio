// src/server/catalog.ts
// Video catalog behind the viewer home page (/watch): YouTube / Vimeo / file links and room links
// curated by the admin. Pure `Request -> Response` like rooms.ts. Persistence is a JSON file
// (CATALOG_FILE, default ./data/catalog.json) written atomically, injectable for tests.
//
// Public items are listed with their source. Private items are listed WITHOUT a source ("locked")
// and are unlocked by a password and/or a secret link key; the unlock endpoint is rate limited.
// Writes need `Authorization: Bearer <CATALOG_ADMIN_TOKEN>` (>= 16 chars); unset = read-only.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { isAdminRequest } from "./auth";
import { clientIp } from "./client-ip";

import { z } from "zod";

import { isMediaSource, type MediaSource } from "../studio/watch/media-url";

/** The backing store (e.g. PocketBase) cannot be reached right now. */
export class StoreUnavailableError extends Error {
  constructor(detail = "store unavailable") {
    super(detail);
    this.name = "StoreUnavailableError";
  }
}

export const CATALOG_API_PREFIX = "/api/catalog";
export const MIN_ADMIN_TOKEN = 16;
export const CATALOG_LIMITS = {
  maxItems: 500,
  maxBodyBytes: 16 * 1024,
  unlockPerMinute: 8,
} as const;

export interface CatalogItem {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  source: MediaSource;
  visibility: "public" | "private";
  /** scrypt hash "salt:hash" (hex); null = no password */
  passwordHash: string | null;
  /** secret link key; null = none */
  linkKey: string | null;
  /** ISO time; future = upcoming, past = replay/live */
  startsAt: string | null;
  /** marked live by the admin (YouTube live etc.) */
  live: boolean;
  /** shown in the stories bar (short, vertical-friendly clips) */
  story: boolean;
  /** playlist / series / show name; items sharing it form a queue ("" = none) */
  playlist: string;
  /** episode number inside the playlist (orders the queue) */
  episode: number | null;
  /** cover image: https URL or /media/... path ("" = none) */
  poster: string;
  /** subtitle tracks (WebVTT) */
  captions: Caption[];
  /** archived items are kept but hidden from the watch page */
  archived: boolean;
  /** ISO time the story stops showing in the stories bar (null = until archived) */
  storyUntil: string | null;
  /** shown in the hero banner at the top of the watch page */
  featured: boolean;
  /** length in ms when known (library uploads), shown on the card */
  durationMs: number | null;
  createdAt: string;
}

export interface Caption {
  lang: string;
  label: string;
  /** https URL or /media/... path to a .vtt file */
  url: string;
}

/** Fields added after the first release: older stored records get these defaults. */
export function withDefaults(i: CatalogItem): CatalogItem {
  return {
    ...i,
    story: i.story ?? false,
    playlist: i.playlist ?? "",
    episode: i.episode ?? null,
    poster: i.poster ?? "",
    captions: i.captions ?? [],
    archived: i.archived ?? false,
    storyUntil: i.storyUntil ?? null,
    featured: i.featured ?? false,
    durationMs: i.durationMs ?? null,
  };
}

/** https URL, or a path inside our own media library (no "..", no empty segments). */
export function isAssetUrl(u: string): boolean {
  if (u === "") return true;
  if (/^https:\/\/[^\s]+$/.test(u)) return true;
  return (
    /^\/media\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(u) &&
    !u.split("/").some((seg) => seg === "..")
  );
}

const assetUrl = z.string().max(500).refine(isAssetUrl, "bad-url");

export const captionSchema = z.object({
  lang: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/),
  label: z.string().trim().min(1).max(40),
  url: assetUrl.refine((u) => u !== "", "bad-url"),
});

/** Persistence for `{ id }` records: memory (tests), JSON file, or PocketBase. */
export interface RecordStore<T extends { id: string }> {
  list(): Promise<T[]>;
  upsert(item: T): Promise<void>;
  /** false when the id did not exist */
  remove(id: string): Promise<boolean>;
}

export type CatalogStore = RecordStore<CatalogItem>;

export function memoryStore<T extends { id: string } = CatalogItem>(
  initial: T[] = [],
): RecordStore<T> {
  const items = new Map(initial.map((i) => [i.id, i]));
  return {
    list: async () => [...items.values()],
    upsert: async (item) => {
      items.set(item.id, item);
    },
    remove: async (id) => items.delete(id),
  };
}

export type PublicItem = Omit<
  CatalogItem,
  "passwordHash" | "linkKey" | "source"
> & {
  locked: boolean;
  needsPassword: boolean;
  source: MediaSource | null;
  /** public SEO page of an item that comes from the content engine ("" / absent = none) */
  pageUrl?: string;
};

const text = (max: number) => z.string().trim().max(max);
const itemBody = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]{3,40}$/)
    .optional(),
  title: text(120).min(1),
  description: text(1000).default(""),
  category: text(30).default(""),
  tags: z.array(text(24).min(1)).max(8).default([]),
  source: z.unknown().refine(isMediaSource, "bad-source"),
  visibility: z.enum(["public", "private"]).default("public"),
  /** "" keeps/clears: undefined = keep existing, null = remove, string = set */
  password: z.string().min(4).max(100).nullable().optional(),
  /** true = (re)generate the secret link key, false = remove it */
  linkKey: z.boolean().optional(),
  startsAt: z.string().datetime({ offset: true }).nullable().default(null),
  live: z.boolean().default(false),
  story: z.boolean().default(false),
  playlist: text(60).default(""),
  episode: z.number().int().min(0).max(100000).nullable().default(null),
  poster: assetUrl.default(""),
  captions: z.array(captionSchema).max(8).default([]),
  archived: z.boolean().default(false),
  storyUntil: z.string().datetime({ offset: true }).nullable().default(null),
  featured: z.boolean().default(false),
  durationMs: z.number().int().min(0).max(86_400_000).nullable().default(null),
});

const bulkBody = z.object({
  ids: z
    .array(z.string().regex(/^[a-z0-9-]{3,40}$/))
    .min(1)
    .max(200),
  action: z.enum(["archive", "unarchive", "delete", "story", "feature"]),
  /** story / feature: switch on or off */
  on: z.boolean().optional(),
  /** story: expiry (null = until archived) */
  until: z.string().datetime({ offset: true }).nullable().optional(),
});

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

export function checkPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, "hex");
  const got = scryptSync(pw, Buffer.from(saltHex, "hex"), want.length);
  return want.length === got.length && timingSafeEqual(want, got);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Is this item currently shown as a story? (flagged, and its expiry has not passed) */
export function storyActive(item: CatalogItem, nowMs: number): boolean {
  if (!item.story || item.archived) return false;
  if (!item.storyUntil) return true;
  const until = Date.parse(item.storyUntil);
  return Number.isNaN(until) || until > nowMs;
}

export function toPublic(
  item: CatalogItem,
  unlocked = false,
  nowMs: number = Date.now(),
): PublicItem {
  const { passwordHash, linkKey, source, ...rest } = item;
  const locked = item.visibility === "private" && !unlocked;
  return {
    ...rest,
    // an expired story is just a normal video again
    story: storyActive(item, nowMs),
    locked,
    needsPassword: passwordHash !== null,
    source: locked ? null : source,
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

export interface CatalogOptions {
  token: string | null;
  store: CatalogStore;
  /** extra public items merged into the list (content engine); gets the ids already listed */
  extra?: (listed: ReadonlySet<string>) => Promise<PublicItem[]>;
  now?: () => number;
}

export function catalogTokenFromEnv(
  env: Record<string, string | undefined>,
): string | null {
  const t = (env["CATALOG_ADMIN_TOKEN"] ?? "").trim();
  return t.length >= MIN_ADMIN_TOKEN ? t : null;
}

export function createCatalogApi(opts: CatalogOptions) {
  const now = opts.now ?? Date.now;
  const attempts = new Map<string, number[]>();

  function limited(key: string): boolean {
    const t = now();
    const hits = (attempts.get(key) ?? []).filter((x) => t - x < 60_000);
    hits.push(t);
    attempts.set(key, hits);
    if (attempts.size > 5000) attempts.clear();
    return hits.length > CATALOG_LIMITS.unlockPerMinute;
  }

  const isAdmin = (req: Request): boolean =>
    isAdminRequest(req, opts.token, now());

  async function readJson(req: Request): Promise<unknown> {
    const raw = await req.text();
    if (raw.length > CATALOG_LIMITS.maxBodyBytes) throw new Error("too-large");
    return JSON.parse(raw);
  }

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (
      url.pathname !== CATALOG_API_PREFIX &&
      !url.pathname.startsWith(`${CATALOG_API_PREFIX}/`)
    )
      return null;
    const rest = url.pathname
      .slice(CATALOG_API_PREFIX.length)
      .split("/")
      .filter(Boolean);
    const method = req.method.toUpperCase();
    try {
      if (rest.length === 0 && method === "GET") {
        const t = now();
        const items = (await opts.store.list())
          .map(withDefaults)
          .filter((i) => !i.archived)
          .map((i) => toPublic(i, false, t));
        let more: PublicItem[] = [];
        try {
          more = (await opts.extra?.(new Set(items.map((i) => i.id)))) ?? [];
        } catch (e) {
          // the engine being down must not take the whole watch page with it
          console.warn("[catalog] extra items unavailable:", e);
        }
        return json({ items: [...items, ...more], admin: opts.token !== null });
      }

      if (rest[0] === "unlock" && rest.length === 1 && method === "POST") {
        const ip = clientIp(req);
        if (limited(`unlock:${ip}`))
          return json({ error: "rate-limited" }, 429);
        const body = z
          .object({
            id: z.string().max(40),
            password: z.string().max(100).optional(),
            key: z.string().max(100).optional(),
          })
          .safeParse(await readJson(req));
        if (!body.success) return json({ error: "bad-request" }, 400);
        const found = (await opts.store.list()).find(
          (i) => i.id === body.data.id,
        );
        const item = found && withDefaults(found);
        if (!item || item.archived) return json({ error: "not-found" }, 404);
        if (item.visibility === "public")
          return json({ item: toPublic(item, false, now()) });
        const okKey =
          !!body.data.key &&
          !!item.linkKey &&
          safeEqual(body.data.key, item.linkKey);
        const okPw =
          !!body.data.password &&
          !!item.passwordHash &&
          checkPassword(body.data.password, item.passwordHash);
        if (!okKey && !okPw) return json({ error: "forbidden" }, 403);
        return json({ item: toPublic(item, true, now()) });
      }

      if (!opts.token) return json({ error: "admin-disabled" }, 503);
      if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);

      if (rest[0] === "admin" && rest.length === 1 && method === "GET") {
        const items = (await opts.store.list()).map((raw) => {
          const { passwordHash, ...i } = withDefaults(raw);
          return { ...i, hasPassword: passwordHash !== null };
        });
        return json({ items });
      }

      if (rest[0] === "item" && rest.length === 1 && method === "PUT") {
        const parsed = itemBody.safeParse(await readJson(req));
        if (!parsed.success) return json({ error: "bad-request" }, 400);
        const b = parsed.data;
        const items = await opts.store.list();
        const prev = b.id ? items.find((i) => i.id === b.id) : undefined;
        if (!prev && items.length >= CATALOG_LIMITS.maxItems)
          return json({ error: "full" }, 409);
        const next: CatalogItem = {
          id: prev?.id ?? b.id ?? randomBytes(6).toString("hex"),
          title: b.title,
          description: b.description,
          category: b.category,
          tags: b.tags,
          source: b.source as MediaSource,
          visibility: b.visibility,
          passwordHash:
            b.password === undefined
              ? (prev?.passwordHash ?? null)
              : b.password === null
                ? null
                : hashPassword(b.password),
          linkKey:
            b.linkKey === undefined
              ? (prev?.linkKey ?? null)
              : b.linkKey
                ? randomBytes(12).toString("base64url")
                : null,
          startsAt: b.startsAt,
          live: b.live,
          story: b.story,
          playlist: b.playlist,
          episode: b.episode,
          poster: b.poster,
          captions: b.captions,
          archived: b.archived,
          storyUntil: b.story ? b.storyUntil : null,
          featured: b.featured,
          durationMs: b.durationMs,
          createdAt: prev?.createdAt ?? new Date(now()).toISOString(),
        };
        await opts.store.upsert(next);
        const { passwordHash, ...adminView } = next;
        return json(
          { item: { ...adminView, hasPassword: passwordHash !== null } },
          prev ? 200 : 201,
        );
      }

      if (rest[0] === "bulk" && rest.length === 1 && method === "POST") {
        const parsed = bulkBody.safeParse(await readJson(req));
        if (!parsed.success) return json({ error: "bad-request" }, 400);
        const { ids, action, on, until } = parsed.data;
        const byId = new Map(
          (await opts.store.list()).map((i) => [i.id, withDefaults(i)]),
        );
        let changed = 0;
        for (const id of ids) {
          const it = byId.get(id);
          if (!it) continue;
          if (action === "delete") {
            if (await opts.store.remove(id)) changed++;
            continue;
          }
          const next: CatalogItem =
            action === "archive"
              ? { ...it, archived: true, featured: false }
              : action === "unarchive"
                ? { ...it, archived: false }
                : action === "feature"
                  ? { ...it, featured: on ?? true }
                  : {
                      ...it,
                      story: on ?? true,
                      storyUntil: (on ?? true) ? (until ?? null) : null,
                    };
          await opts.store.upsert(next);
          changed++;
        }
        return json({ ok: true, changed });
      }

      if (rest[0] === "item" && rest.length === 2 && method === "DELETE") {
        const removed = await opts.store.remove(rest[1] as string);
        if (!removed) return json({ error: "not-found" }, 404);
        return json({ ok: true });
      }
      return json({ error: "not-found" }, 404);
    } catch (e) {
      if (e instanceof StoreUnavailableError)
        return json({ error: "store-unavailable" }, 503);
      if (e instanceof SyntaxError || (e as Error).message === "too-large")
        return json({ error: "bad-request" }, 400);
      console.error("[catalog]", e);
      return json({ error: "internal" }, 500);
    }
  }

  return { handle };
}
