// src/server/i18n.ts
// Server-side translation overrides. The built-in messages (src/studio/i18n/messages*.ts) are the
// defaults; whatever is stored here wins, so wording can be fixed or a language completed from the
// /translations admin page without a new build. Stored in PocketBase (collection i18n_messages)
// or, without it, in a JSON file.
//
//   GET    /api/i18n                  public: { overrides: { de: { "nav.watch": "…" } } }
//   PUT    /api/i18n/:lang/:key       admin:  { value }
//   DELETE /api/i18n/:lang/:key       admin:  back to the built-in text
import { z } from "zod";

import { LANGS, tr } from "../studio/i18n/messages";
import { isAdminRequest } from "./auth";
import { StoreUnavailableError } from "./catalog";

export const I18N_API_PREFIX = "/api/i18n";

export type Overrides = Record<string, Record<string, string>>;

export interface I18nStore {
  all(): Promise<Overrides>;
  set(lang: string, key: string, value: string): Promise<void>;
  /** false when there was no override */
  remove(lang: string, key: string): Promise<boolean>;
}

export function memoryI18nStore(initial: Overrides = {}): I18nStore {
  const data: Overrides = structuredClone(initial);
  return {
    all: async () => structuredClone(data),
    set: async (lang, key, value) => {
      (data[lang] ??= {})[key] = value;
    },
    remove: async (lang, key) => {
      if (!data[lang] || !(key in data[lang])) return false;
      delete data[lang][key];
      return true;
    },
  };
}

const placeholders = (s: string): string =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-cache",
    },
  });

const putBody = z.object({ value: z.string().max(4000) });

export function createI18nApi(opts: {
  token: string | null;
  store: I18nStore;
}) {
  const langs = new Set<string>(LANGS.map((l) => l.id));

  const isAdmin = (req: Request): boolean => isAdminRequest(req, opts.token);

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (
      url.pathname !== I18N_API_PREFIX &&
      !url.pathname.startsWith(`${I18N_API_PREFIX}/`)
    )
      return null;
    const rest = url.pathname
      .slice(I18N_API_PREFIX.length)
      .split("/")
      .filter(Boolean);
    const method = req.method.toUpperCase();
    try {
      if (rest.length === 0 && method === "GET")
        return json({ overrides: await opts.store.all() });
      if (rest.length !== 2 || (method !== "PUT" && method !== "DELETE"))
        return json({ error: "not-found" }, 404);
      if (!opts.token) return json({ error: "admin-disabled" }, 503);
      if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
      const lang = rest[0] as string;
      const key = decodeURIComponent(rest[1] as string);
      if (!langs.has(lang) || !Object.prototype.hasOwnProperty.call(tr, key))
        return json({ error: "unknown-key" }, 400);
      if (method === "DELETE") {
        return (await opts.store.remove(lang, key))
          ? json({ ok: true })
          : json({ error: "not-found" }, 404);
      }
      const body = putBody.safeParse(JSON.parse(await req.text()));
      if (!body.success) return json({ error: "bad-request" }, 400);
      const value = body.data.value.trim();
      if (value === "") return json({ error: "bad-request" }, 400);
      // a translation must keep the {placeholders} the code fills in
      if (placeholders(value) !== placeholders(tr[key as keyof typeof tr]))
        return json({ error: "placeholder-mismatch" }, 400);
      await opts.store.set(lang, key, value);
      return json({ ok: true });
    } catch (e) {
      if (e instanceof StoreUnavailableError)
        return json({ error: "store-unavailable" }, 503);
      if (e instanceof SyntaxError) return json({ error: "bad-request" }, 400);
      console.error("[i18n]", e);
      return json({ error: "internal" }, 500);
    }
  }

  return { handle };
}
