<!-- docs/CONTENT_DECISIONS.md -->

# Content Engine — decisions (answers to S0), SEO / AEO / GEO, scale plan

Positioning: Teknodoz Studio is a product of a software company entering the **production (broadcast) sector**. Two audiences:

1. **Directors / production crews** use the creator tools (studio, prompter, library, editor).
2. **The public / press (PR)** opens published video, audio and stories **anonymously by URL** — no login, no app, fast, indexable by Google, answer engines and AI assistants.

Stage: **beta / early-access MVP**, cheap to run today, shaped to grow to hundreds of thousands of rows by scaling the server, not by rewriting.

## 1. Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Gateway | **A — the Node server is the only gateway.** PocketBase stays private on `127.0.0.1:8091`. No public `pb.` host, no PB hooks, no browser-to-PB calls. | One process to secure, cache and rate-limit; reuses the existing cookie session, zod and vitest. Smaller attack surface and no new DNS/proxy. B stays possible later because storage is behind the `RecordStore` interface. |
| 2 | Existing `/watch` data | **Migrate in place** with an idempotent script; old `itemId` becomes `external_id`. `/watch` keeps working during the migration (dual-read until S3 is done). | No content loss, no downtime. |
| 3 | Git flow | One branch per sprint (`sprint/s1-…`), merged into `claude/studio-unified` and `main` **after the sprint report**. No PRs unless you ask. | Lovable syncs from the connected branch; history is never rewritten. |
| 4 | Admin identity | Keep the **admin token + HttpOnly cookie**. Add `editor` role later via signed per-user tokens, not PB `users`. | Works today; PB users add a second login system for no MVP gain. |
| 5 | Route names | **Public:** `/library/stories`, `/library/videos`, `/library/podcasts`, item pages `/library/:type/:slug`, `/docs`. **Admin:** media library moves to `/admin/media`; tables at `/admin/tables/:type`. `/watch` stays the interactive player hub and links to the item pages. Old admin URLs redirect. | Keeps the spec's names; the public URLs are the SEO surface. |
| 6 | Dependencies | **SheetJS** from the vendor tarball (pinned, advisories checked) and **`marked`** (tokenizer only) — **both deferred to S3**. S1/S2 add none. | Install only when used. |

## 2. Public, anonymous, search-ready surface (SEO · AEO · GEO)

Every `public` item has one canonical, server-rendered URL: `/library/{type}/{slug}`. Content is in the HTML (no client-only rendering), so crawlers and AI fetchers see it without running JS.

### 2.1 SEO (classic search)
- SSR HTML, one `<h1>`, semantic landmarks, `<link rel="canonical">`, `hreflang` for tr / en / de / es with `x-default`.
- `<title>` and meta description from `seoTitle` / `seoDescription` (fall back to title / summary). Open Graph + Twitter cards with `ogImage` (poster fallback).
- `robots.txt`, `sitemap.xml` as a **sitemap index** → paged files of ≤ 5,000 URLs per type/locale, `lastmod` from `updated`; **video sitemap** entries (`video:content_loc`, duration, thumbnail). Only `public`, not deleted, not `noindex`.
- Stable slugs; a slug change writes a `redirects` row → 301. Drafts, private, protected → `noindex` and not in sitemaps (protected pages are stubs: title only).
- Performance targets: LCP < 2.5 s on 4G, no layout shift; posters as sized `<img>`, `preload="none"` for media.

### 2.2 AEO (answer engines / featured snippets / voice)
- Every item has an **answer-first `summary`** (≤ 60 words) shown at the top and used as the meta description and `speakable` text.
- Optional `faq` block (`[{q, a}]`) rendered as visible Q&A and as `FAQPage` JSON-LD (only when the text is on the page).
- **Transcripts are the main asset:** Whisper captions (`.vtt`) are rendered as an indexable, time-linked transcript below the player. Chapters become a "Key moments" list and `Clip` / `hasPart` markup.

### 2.3 GEO (generative engines / AI assistants)
- `llms.txt` (site map for LLMs: what the product is, section links, licence/attribution policy) and `llms-full.txt` (public items as Markdown, paged) — cheap, cacheable.
- Every item page has a **Markdown twin** at `…/{slug}.md` (title, summary, key points, transcript, source links, date, author/organisation) so assistants can quote it cleanly.
- JSON-LD graph per page: `Organization` + `WebSite` (site level), `VideoObject` / `AudioObject` / `PodcastEpisode` + `PodcastSeries`, `Article`, `BreadcrumbList`, `CreativeWork` licence. Sources (`/docs`) are linked as `citation`.
- Visible **author / publisher / date / last-updated** on each page (E-E-A-T), plus a short methodology/"about the production" page.
- `robots.txt` has an **AI-crawler policy switch** in admin settings (allow GPTBot, Google-Extended, PerplexityBot, ClaudeBot, … or block) — default **allow** for public PR content.
- Feeds: **RSS** per podcast series (Apple/Spotify-ready), **oEmbed** endpoint so third parties can embed a player, `Link: rel=alternate` to the Markdown twin and feed.

### 2.4 PR / press helpers (small, high value)
- Shareable short URL and a **press kit** block per item (logo, poster, description, embed code, transcript download).
- Embed page `/embed/:type/:slug` (minimal player, `noindex`, allowlisted `frame-ancestors` setting).

## 3. Cost / performance plan (cheap now, scalable later)

| Layer | MVP | Growth path |
|---|---|---|
| Public pages | Server-rendered by Node; **`Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`** so Cloudflare serves almost all hits. In-process LRU (500 pages) for cache misses. | Raise TTL, add Cloudflare cache rules / purge-by-tag on publish. |
| Database | PocketBase (SQLite, WAL). `content_items` uses **real, indexed columns** for `type, visibility, slug, external_id, locale, is_deleted, updated`; JSON only for `body_blocks` and `meta`. Comfortable to **~1 M rows** on one small VPS. Lists are always **cursor-paged** (50), never full-table. | Read replica / Litestream backup; move to Postgres behind `RecordStore` if write load demands. |
| Today's problem | `catalog_items` keeps one JSON blob per row and the API lists everything. Fine for tens of items, **not** for thousands. | Fixed by the S2 migration (columns + indexes + paging). |
| Media | Streamed from disk with Range (already). Posters are small JPEGs. | Cloudflare R2 + custom domain (no egress fees); keep `MEDIA_QUOTA_GB`. |
| Search (admin) | PocketBase filter (`~`) on title / summary / tags. FTS5 cannot be created through the PocketBase API, so it is **deferred**. | Meilisearch / Typesense when the table passes a few thousand rows. |
| Sitemaps / llms | Generated on demand, cached 1 h; paged files keep each response small. | Pre-generate on publish. |
| Writes | Bulk / import chunks of 500 in one transaction; rate limits per admin. | Background queue. |
| Ops | PM2 (no sudo); nightly `pb_data` snapshot via `sqlite3 .backup` + `rclone` off-server; one restore drill in S2. | systemd + Litestream when there is root access. |

## 4. Security posture (unchanged principles)
- All visibility is enforced **in the Node gateway** (single code path `visibleTo(viewer, row)`), covered by tests for anonymous / owner / admin. The browser never receives drafts, private rows or protected bodies.
- Secrets (stream keys, RTMPS URLs with keys, API keys, tokens, passwords, room join codes, guest phones/emails) are `secret: true` in the registry and excluded from templates, exports and the public API **by construction** (tested).
- Import never produces `public` / `protected` (spec §7.2). Passwords hashed with scrypt (Node `crypto`), unlock lock-out (5 fails → 15 min).
- No HTML stored or rendered from user data; `body_blocks` only; embeds from an allowlist.

## 5. Revised sprint plan

| Sprint | Scope (changes vs spec in **bold**) |
|---|---|
| **S1** | `src/shared/schema-registry` (zod per type, secret flags, **SEO fields: summary, seoTitle, seoDescription, ogImage, faq, noindex**), local workspace JSON export/import (scripts, scenes, classic templates) with round-trip test. |
| S2 | **Node-gateway storage:** `content_items` / `content_audit` / `content_redirects` collections with columns + indexes (idempotent creation code, no `pb_migrations`; `access_groups` moves to S4, FTS deferred), `visibleTo` rules + tests, `/watch` data migration script, backup + restore drill. |
| S3 | Templates (CSV/XLSX/JSON), dry-run + commit import, matching, table engine at `/admin/tables/:type`. Adds SheetJS + `marked`. |
| S4 | Bulk API, access groups, unlock + lock-out, protected stubs. |
| **S5** | **Public SSR pages `/library/*`, `/docs`, JSON-LD, sitemap index + video sitemap, `robots.txt`, `llms.txt`, Markdown twins, RSS, oEmbed, redirects, cache headers.** URL-tree import/export. |
| S6 | Hardening: rate limits, CSP, accessibility, i18n check, Playwright, **Lighthouse + structured-data validation in CI**. |
