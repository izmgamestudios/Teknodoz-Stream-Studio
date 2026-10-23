// src/server/seo/router.ts
// Public, anonymous, cacheable pages + feeds (pure Request -> Response). Every response carries
// ETag + Cache-Control (CDN: s-maxage, stale-while-revalidate) and a short in-process cache, so a
// burst of visitors or crawlers costs one database read per page per minute.
import { createHash } from "node:crypto";

import { PUBLIC_TYPES, type EntityType } from "../../shared/schema-registry";
import type { RecordStore } from "../catalog";
import type { Redirect } from "../content";
import type { ContentRow } from "../content-model";
import type { ContentStore } from "../content-store";
import { CSP } from "./html";
import {
  llmsFull,
  llmsTxt,
  markdownTwin,
  oembed,
  podcastRss,
  robotsTxt,
  sitemapIndex,
  sitemapPages,
  sitemapUrls,
  SITEMAP_CHUNK,
} from "./feeds";
import { PATH_TYPE, itemPath, listPath, transcriptCues } from "./model";
import {
  renderDocs,
  renderEmbed,
  renderIndex,
  renderItem,
  renderList,
  renderNotFound,
  renderStub,
  type Page,
} from "./render";
import type { SiteConfig } from "./site";
import { normalizeLocale, tx } from "./text";

export const PAGE_CACHE =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
const SHORT_CACHE = "public, max-age=60, s-maxage=60";
const LRU_MAX = 500;
const LRU_TTL_MS = 60_000;
const PER_PAGE = 24;

interface Cached {
  at: number;
  status: number;
  type: string;
  body: string;
  headers: Record<string, string>;
}

export interface SeoOptions {
  store: ContentStore;
  redirects: RecordStore<Redirect>;
  site: () => SiteConfig;
  /** reads a `/media/...` text file (captions) */
  readVtt: (path: string) => Promise<string | null>;
  now?: () => number;
}

const SECURITY: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

export function createSeoApi(opts: SeoOptions) {
  const now = opts.now ?? Date.now;
  const lru = new Map<string, Cached>();

  const etag = (body: string): string =>
    `W/"${createHash("sha1").update(body).digest("hex").slice(0, 20)}"`;

  function respond(req: Request, c: Cached): Response {
    const headers: Record<string, string> = {
      ...c.headers,
      "content-type": c.type,
      etag: etag(c.body),
    };
    if (
      c.status === 200 &&
      req.headers.get("if-none-match") === headers["etag"]
    )
      return new Response(null, {
        status: 304,
        headers: {
          etag: headers["etag"],
          "cache-control": headers["cache-control"] ?? PAGE_CACHE,
        },
      });
    return new Response(req.method === "HEAD" ? null : c.body, {
      status: c.status,
      headers,
    });
  }

  const asPage = (
    p: Page,
    extra: Record<string, string> = {},
    cache = PAGE_CACHE,
    frame = "'self'",
    site: SiteConfig,
  ): Cached => ({
    at: now(),
    status: p.status,
    type: "text/html; charset=utf-8",
    body: p.html,
    headers: {
      ...SECURITY,
      "cache-control": p.status === 200 ? cache : SHORT_CACHE,
      "content-security-policy": CSP(
        frame === "embed" ? site.embedOrigins : frame,
      ),
      "x-robots-tag": p.robots,
      ...extra,
    },
  });

  const text = (
    body: string,
    type: string,
    cache = PAGE_CACHE,
    status = 200,
    extra: Record<string, string> = {},
  ): Cached => ({
    at: now(),
    status,
    type,
    body,
    headers: { ...SECURITY, "cache-control": cache, ...extra },
  });

  /** All public, indexable rows of a type, newest first (paged internally). */
  async function allPublic(
    type: EntityType,
    max = 50_000,
  ): Promise<ContentRow[]> {
    const out: ContentRow[] = [];
    for (let page = 1; out.length < max; page++) {
      const r = await opts.store.list({
        type,
        visibility: ["public"],
        sort: "updated_desc",
        page,
        perPage: 100,
      });
      out.push(...r.items.filter((x) => !x.noindex));
      if (!r.hasMore) break;
    }
    return out;
  }

  async function itemRow(
    type: EntityType,
    slug: string,
  ): Promise<{ row: ContentRow | null; redirect: string | null }> {
    const row = await opts.store.findBySlug(type, slug);
    if (
      row &&
      !row.is_deleted &&
      (row.visibility === "public" || row.visibility === "protected")
    )
      return { row, redirect: null };
    const r = (await opts.redirects.list()).find(
      (x) => x.id === `${type}:${slug}`,
    );
    return { row: null, redirect: r ? itemPath(type, r.to) : null };
  }

  async function build(
    req: Request,
    url: URL,
    site: SiteConfig,
  ): Promise<Cached | Response | null> {
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const locale = normalizeLocale(url.searchParams.get("lang"));
    const page = Math.max(
      1,
      Math.min(10_000, Math.floor(Number(url.searchParams.get("page")) || 1)),
    );

    if (path === "/robots.txt")
      return text(robotsTxt(site), "text/plain; charset=utf-8");

    if (path === "/sitemap.xml") {
      const parts: { path: string; lastmod: string }[] = [
        { path: "/sitemap-pages.xml", lastmod: new Date(now()).toISOString() },
      ];
      for (const type of PUBLIC_TYPES) {
        const total = (await allPublic(type)).length;
        for (
          let n = 1;
          n <= Math.max(1, Math.ceil(total / SITEMAP_CHUNK)) && total > 0;
          n++
        )
          parts.push({
            path: `/sitemap-${type === "story" ? "stories" : type === "video" ? "videos" : "podcasts"}-${n}.xml`,
            lastmod: new Date(now()).toISOString(),
          });
      }
      return text(
        sitemapIndex(site, parts),
        "application/xml; charset=utf-8",
        "public, max-age=3600",
      );
    }
    if (path === "/sitemap-pages.xml")
      return text(
        sitemapPages(site, new Date(now()).toISOString()),
        "application/xml; charset=utf-8",
        "public, max-age=3600",
      );
    const sm = /^\/sitemap-(stories|videos|podcasts)-(\d+)\.xml$/.exec(path);
    if (sm) {
      const rows = await allPublic(PATH_TYPE[sm[1]!]!);
      const n = Number(sm[2]);
      const chunk = rows.slice((n - 1) * SITEMAP_CHUNK, n * SITEMAP_CHUNK);
      return chunk.length
        ? text(
            sitemapUrls(site, chunk),
            "application/xml; charset=utf-8",
            "public, max-age=3600",
          )
        : text("not found\n", "text/plain; charset=utf-8", SHORT_CACHE, 404);
    }

    if (path === "/llms.txt") {
      const sections = [];
      for (const type of PUBLIC_TYPES) {
        const r = await opts.store.list({
          type,
          visibility: ["public"],
          sort: "updated_desc",
          perPage: 30,
        });
        sections.push({
          title: tx(
            locale === "tr" ? "en" : locale,
            type === "story"
              ? "stories"
              : type === "video"
                ? "videos"
                : "podcasts",
          ),
          path: listPath(type),
          rows: r.items.filter((x) => !x.noindex),
        });
      }
      const docs = await opts.store.list({
        type: "source",
        visibility: ["public"],
        perPage: 1,
        withTotal: true,
      });
      return text(
        llmsTxt(site, sections, docs.total ?? 0),
        "text/plain; charset=utf-8",
      );
    }
    if (path === "/llms-full.txt") {
      const rows: ContentRow[] = [];
      for (const type of PUBLIC_TYPES) {
        const r = await opts.store.list({
          type,
          visibility: ["public"],
          sort: "updated_desc",
          page,
          perPage: 20,
        });
        rows.push(...r.items.filter((x) => !x.noindex));
      }
      return text(llmsFull(site, rows), "text/plain; charset=utf-8");
    }

    if (path === "/api/oembed") {
      const target = url.searchParams.get("url") ?? "";
      let t: URL;
      try {
        t = new URL(target);
      } catch {
        return text(
          JSON.stringify({ error: "bad-url" }),
          "application/json; charset=utf-8",
          SHORT_CACHE,
          400,
        );
      }
      const m = /^\/library\/(stories|videos|podcasts)\/([a-z0-9-]+)$/.exec(
        t.pathname,
      );
      const row = m ? (await itemRow(PATH_TYPE[m[1]!]!, m[2]!)).row : null;
      if (
        !row ||
        row.visibility !== "public" ||
        new URL(site.origin).host !== t.host
      )
        return text(
          JSON.stringify({ error: "not-found" }),
          "application/json; charset=utf-8",
          SHORT_CACHE,
          404,
        );
      const o = oembed(
        site,
        row,
        Number(url.searchParams.get("maxwidth")) || 0,
        Number(url.searchParams.get("maxheight")) || 0,
      );
      return text(JSON.stringify(o), "application/json+oembed; charset=utf-8");
    }

    if (path === "/docs") {
      const rows: ContentRow[] = [];
      for (let p = 1; p <= 20; p++) {
        const r = await opts.store.list({
          type: "source",
          visibility: ["public"],
          page: p,
          perPage: 100,
          sort: "title_asc",
        });
        rows.push(...r.items);
        if (!r.hasMore) break;
      }
      return asPage(
        renderDocs(site, locale, rows),
        {},
        PAGE_CACHE,
        "'self'",
        site,
      );
    }

    if (path === "/library") {
      const sections = [];
      for (const type of ["story", "video", "podcast"] as const) {
        const r = await opts.store.list({
          type,
          visibility: ["public", "protected"],
          sort: "updated_desc",
          perPage: 6,
        });
        sections.push({ type, rows: r.items });
      }
      return asPage(
        renderIndex(site, locale, sections),
        {},
        PAGE_CACHE,
        "'self'",
        site,
      );
    }

    const m =
      /^\/library\/(stories|videos|podcasts)(?:\/(feed\.xml|[a-z0-9-]+(?:\.md)?))?$/.exec(
        path,
      );
    if (m) {
      const type = PATH_TYPE[m[1]!]!;
      const rest = m[2];
      if (rest === undefined) {
        const tag = url.searchParams.get("tag") ?? "";
        const r = await opts.store.list({
          type,
          visibility: ["public", "protected"],
          sort: "updated_desc",
          page,
          perPage: PER_PAGE,
          ...(tag ? { tag: tag.slice(0, 40) } : {}),
          ...(url.searchParams.get("locale")
            ? { locale: url.searchParams.get("locale")! }
            : {}),
        });
        const pg = renderList(
          site,
          locale,
          type as "story" | "video" | "podcast",
          page,
          r.items,
          r.hasMore,
        );
        return asPage(
          tag
            ? {
                ...pg,
                robots: "noindex,follow",
                html: pg.html.replace(
                  /content="index[^"]*"/,
                  'content="noindex,follow"',
                ),
              }
            : pg,
          {},
          PAGE_CACHE,
          "'self'",
          site,
        );
      }
      if (rest === "feed.xml") {
        if (type !== "podcast")
          return text(
            "not found\n",
            "text/plain; charset=utf-8",
            SHORT_CACHE,
            404,
          );
        const rows = (await allPublic("podcast", 500)).slice(0, 100);
        return text(
          podcastRss(site, rows, locale),
          "application/rss+xml; charset=utf-8",
        );
      }
      const wantsMd = rest.endsWith(".md");
      const slug = wantsMd ? rest.slice(0, -3) : rest;
      const { row, redirect } = await itemRow(type, slug);
      if (redirect)
        return new Response(null, {
          status: 301,
          headers: {
            location: redirect + (wantsMd ? ".md" : ""),
            "cache-control": PAGE_CACHE,
          },
        });
      if (!row)
        return asPage(
          renderNotFound(site, locale),
          {},
          PAGE_CACHE,
          "'self'",
          site,
        );
      if (row.visibility === "protected")
        return wantsMd
          ? asPage(renderNotFound(site, locale), {}, PAGE_CACHE, "'self'", site)
          : asPage(renderStub(site, row), {}, PAGE_CACHE, "'self'", site);
      const cues = await transcriptCues(row, opts.readVtt);
      if (wantsMd)
        return text(
          markdownTwin(site, row, cues),
          "text/markdown; charset=utf-8",
          PAGE_CACHE,
          200,
          row.noindex ? { "x-robots-tag": "noindex" } : {},
        );
      let related: ContentRow[] = [];
      if (row.tags[0]) {
        const r = await opts.store.list({
          type,
          visibility: ["public"],
          tag: row.tags[0],
          sort: "updated_desc",
          perPage: 5,
        });
        related = r.items
          .filter((x) => x.id !== row.id && !x.noindex)
          .slice(0, 4);
      }
      return asPage(
        renderItem(site, row, cues, related),
        {},
        PAGE_CACHE,
        "'self'",
        site,
      );
    }

    const em = /^\/embed\/(stories|videos|podcasts)\/([a-z0-9-]+)$/.exec(path);
    if (em) {
      const { row } = await itemRow(PATH_TYPE[em[1]!]!, em[2]!);
      if (!row || row.visibility !== "public")
        return asPage(
          renderNotFound(site, locale),
          {},
          PAGE_CACHE,
          "'self'",
          site,
        );
      return asPage(renderEmbed(site, row), {}, PAGE_CACHE, "embed", site);
    }
    void req;
    return null;
  }

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const p = url.pathname;
    const ours =
      p === "/robots.txt" ||
      p === "/llms.txt" ||
      p === "/llms-full.txt" ||
      p === "/docs" ||
      p === "/api/oembed" ||
      /^\/sitemap(-.*)?\.xml$/.test(p) ||
      p === "/library" ||
      p.startsWith("/library/") ||
      p.startsWith("/embed/");
    if (!ours) return null;
    if (req.method !== "GET" && req.method !== "HEAD")
      return new Response("method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });

    const key = `${p}${url.search}`;
    const hit = lru.get(key);
    if (hit && now() - hit.at < LRU_TTL_MS) return respond(req, hit);
    try {
      const built = await build(req, url, opts.site());
      if (built === null) return null;
      if (built instanceof Response) return built;
      lru.set(key, built);
      if (lru.size > LRU_MAX) lru.delete(lru.keys().next().value as string);
      return respond(req, built);
    } catch (e) {
      console.error("[seo]", e);
      return new Response("temporarily unavailable", {
        status: 503,
        headers: { "retry-after": "30", "cache-control": "no-store" },
      });
    }
  }

  return { handle };
}
