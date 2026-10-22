// src/server/catalog.ts
// Video catalog behind the viewer home page (/watch): YouTube / Vimeo / file links and room links
// curated by the admin. Pure `Request -> Response` like rooms.ts. Persistence is a JSON file
// (CATALOG_FILE, default ./data/catalog.json) written atomically, injectable for tests.
//
// Public items are listed with their source. Private items are listed WITHOUT a source ("locked")
// and are unlocked by a password and/or a secret link key; the unlock endpoint is rate limited.
// Writes need `Authorization: Bearer <CATALOG_ADMIN_TOKEN>` (>= 16 chars); unset = read-only.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { isMediaSource, type MediaSource } from "../studio/watch/media-url";

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
  createdAt: string;
}

export interface CatalogStore {
  load(): CatalogItem[];
  save(items: CatalogItem[]): void;
}

export function memoryStore(initial: CatalogItem[] = []): CatalogStore {
  let items = initial;
  return {
    load: () => items,
    save: (next) => {
      items = next;
    },
  };
}

export type PublicItem = Omit<
  CatalogItem,
  "passwordHash" | "linkKey" | "source"
> & {
  locked: boolean;
  needsPassword: boolean;
  source: MediaSource | null;
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
});

function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

function checkPassword(pw: string, stored: string): boolean {
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

export function toPublic(item: CatalogItem, unlocked = false): PublicItem {
  const { passwordHash, linkKey, source, ...rest } = item;
  const locked = item.visibility === "private" && !unlocked;
  return {
    ...rest,
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

  function isAdmin(req: Request): boolean {
    if (!opts.token) return false;
    const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
    return !!m && safeEqual(m[1] as string, opts.token);
  }

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
        const items = opts.store.load().map((i) => toPublic(i));
        return json({ items, admin: opts.token !== null });
      }

      if (rest[0] === "unlock" && rest.length === 1 && method === "POST") {
        const ip =
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
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
        const item = opts.store.load().find((i) => i.id === body.data.id);
        if (!item) return json({ error: "not-found" }, 404);
        if (item.visibility === "public") return json({ item: toPublic(item) });
        const okKey =
          !!body.data.key &&
          !!item.linkKey &&
          safeEqual(body.data.key, item.linkKey);
        const okPw =
          !!body.data.password &&
          !!item.passwordHash &&
          checkPassword(body.data.password, item.passwordHash);
        if (!okKey && !okPw) return json({ error: "forbidden" }, 403);
        return json({ item: toPublic(item, true) });
      }

      if (!opts.token) return json({ error: "admin-disabled" }, 503);
      if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);

      if (rest[0] === "admin" && rest.length === 1 && method === "GET") {
        const items = opts.store.load().map(({ passwordHash, ...i }) => ({
          ...i,
          hasPassword: passwordHash !== null,
        }));
        return json({ items });
      }

      if (rest[0] === "item" && rest.length === 1 && method === "PUT") {
        const parsed = itemBody.safeParse(await readJson(req));
        if (!parsed.success) return json({ error: "bad-request" }, 400);
        const b = parsed.data;
        const items = [...opts.store.load()];
        const idx = b.id ? items.findIndex((i) => i.id === b.id) : -1;
        const prev = idx >= 0 ? items[idx] : undefined;
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
          createdAt: prev?.createdAt ?? new Date(now()).toISOString(),
        };
        if (idx >= 0) items[idx] = next;
        else items.push(next);
        opts.store.save(items);
        const { passwordHash, ...adminView } = next;
        return json(
          { item: { ...adminView, hasPassword: passwordHash !== null } },
          idx >= 0 ? 200 : 201,
        );
      }

      if (rest[0] === "item" && rest.length === 2 && method === "DELETE") {
        const items = opts.store.load();
        const next = items.filter((i) => i.id !== rest[1]);
        if (next.length === items.length)
          return json({ error: "not-found" }, 404);
        opts.store.save(next);
        return json({ ok: true });
      }
      return json({ error: "not-found" }, 404);
    } catch (e) {
      if (e instanceof SyntaxError || (e as Error).message === "too-large")
        return json({ error: "bad-request" }, 400);
      console.error("[catalog]", e);
      return json({ error: "internal" }, 500);
    }
  }

  return { handle };
}
