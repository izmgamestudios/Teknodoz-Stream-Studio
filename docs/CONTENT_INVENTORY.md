<!-- docs/CONTENT_INVENTORY.md -->

# Content inventory (Sprint S0 — discovery, no code)

Snapshot of the repository at commit `707e7d2` (branch `claude/studio-unified`). Input for `docs/prompts/content-engine.md`.

## 1. Routes

| Route | File | Notes |
|---|---|---|
| `/` | `routes/index.tsx` | Prompter |
| `/studio` | `routes/studio.tsx` | Live studio (layers, scenes) |
| `/classic`, `/classic/{prompter,join,remote}` | `routes/classic/*` | Classic studio |
| `/room`, `/r/$code`, `/join`, `/remote`, `/chat/$code` | `routes/*` | P2P rooms |
| `/live`, `/community`, `/guide`, `/download`, `/settings` | `routes/*` | As in the spec |
| **`/watch`** | `routes/watch.tsx` | **Public** stories / playlists / podcast / video catalog (exists, not in the spec) |
| **`/admin`** | `routes/admin.tsx` | Admin status, backup export/import, login |
| **`/catalog`** | `routes/catalog.tsx` | Admin management of watch items (CRUD, archive, story expiry, bulk) |
| **`/library`** | `routes/library.tsx` | Admin media library (upload, ffmpeg editor, Whisper) |
| **`/translations`** | `routes/translations.tsx` | Admin editor for tr/en/de/es overrides |

Not in the spec but present: `/watch`, `/catalog`, `/library`, `/translations`, `/api/*`, `/media/*`.

## 2. Existing story / video / podcast implementation

**It exists and is in production use.** The spec's §1 asks to migrate it onto the table engine, so this is the main decision for S1.

| Piece | Where | What it does |
|---|---|---|
| Public catalog | `src/server/catalog.ts` (`GET /api/catalog`) | Items: `story`, `playlist`, `episode`, `poster`, `captions`, `archived`, `storyUntil`, `featured`, `durationMs`, category, password-protected "unlock" (`POST /api/catalog/:id/unlock`) |
| Admin CRUD / bulk | `/catalog` + `POST /api/catalog/bulk` | archive / unarchive / delete / story expiry / feature |
| Media | `src/server/media.ts`, `media-edit.ts` | Files on disk (`MEDIA_DIR`), records `media_items`, Range streaming, ffmpeg edit jobs, Whisper |
| i18n | `src/server/i18n.ts` | `i18n_messages` overrides |
| Auth | `src/server/session.ts` | `CATALOG_ADMIN_TOKEN` → HttpOnly `tkz_admin` cookie (HMAC, 12 h, SameSite=Strict). **No PocketBase users / roles.** |
| Storage | `src/server/pocketbase.ts` | PocketBase (superuser client from server) or JSON files |

## 3. PocketBase today

- Version **0.40.5**, binary under PM2 (`127.0.0.1:8091`; 8090 was taken). Not systemd (site user has no sudo).
- Collections auto-created by the Node server with **superuser-only rules**: `catalog_items`, `i18n_messages`, `media_items`. Shape: `itemId` + one JSON `data` field. The browser never talks to PocketBase; everything goes through the Node API.
- No `users` roles, no `access_groups`, no `content_audit`, no `pb_migrations/`, no `pb_hooks/`.
- No public sub-domain for PocketBase and no backup job.

## 4. Local workspace (browser) storage

IndexedDB `teknodoz-studio` (stores `assets`, `kv`; `src/studio/storage/db.ts`).

localStorage keys by owner:

| Area | Keys |
|---|---|
| Local content (candidates for "local plane") | `studio.templates.v1` (classic templates), `studio.myTemplates.v1` (studio templates), `studio.rundown.v1`, `studio.sync.script.v1`, `studio.sync.main.last.v1`, `studio.sync.handoff.v1`, `tkz.templates.images.v1` |
| Settings / prefs | `tkz.settings.v1`, `tkz_prefs`, `tkz.brand.v1`, `studio.theme.v1`, `studio.audience.v1`, `studio.safeZones.v1`, `studio.micDevice.v1`, `studio.countdown.v1`, `studio.voice.v1`, `studio.autoupload.v1`, `studio.autoWhoosh.v1`, `studio.ice.v1`, `studio.player.autonext` |
| Room / live | `tkz.room.v1`, `tkz.room.auto.v1`, `tkz.live.v1`, `tkz.live.token`, `tkz.announce.v1`, `studio.signal` |
| Watch (viewer) | `studio.watch.progress.v1`, `studio.stories.seen.v1` |

The prompter script itself lives in IndexedDB `kv` / `studio.sync.script.v1`.

## 5. Hosting and delivery

- Frontend: TanStack Start, built with `NITRO_PRESET=node-server`, run by PM2 on **CloudPanel** (port 3011, `teknodoz-studio.ortakofis.org`). Lovable connects to the same GitHub repo (default target is Cloudflare Workers).
- Dependencies relevant to the spec: `zod` only. **No** XLSX / CSV / Markdown libraries installed.

## 6. Conflicts between the spec and the current system

| # | Spec says | Reality | Proposal |
|---|---|---|---|
| 1 | Story/video/podcast are not built | `/watch` + `/catalog` + `/library` exist and are live | Migrate in S1–S3: map `catalog_items` → `content_items` (types `story`/`video`/`podcast`), keep the `/watch` UI reading from the new API. One implementation, as the spec requires. |
| 2 | Browser talks to PocketBase; rules enforce access; `users.role` | Browser only talks to the Node server; PB is superuser-only; admin = shared token + cookie | Choose: **(A)** keep Node as the only gateway (hooks logic lives in `src/server`, PB stays private) or **(B)** go to the spec's PB-native model (PB hooks, PB users, public `pb.` sub-domain). A is smaller and keeps the existing cookie session; B matches the spec text. |
| 3 | PocketBase JS hooks (`pb_hooks`) | Node server already does validation and transactions-like writes | If A: implement bulk/import/unlock in `src/server` (zod is available, tests are vitest). If B: hooks + migrations. |
| 4 | systemd | Site user has no sudo; PM2 is used | Keep PM2 (or ask the server owner for a systemd unit) |
| 5 | "No direct commits to `main`", branch + PR per sprint | Lovable syncs from the connected branch; I have been pushing `claude/studio-unified` and `main` | Need your call: PR per sprint into `main` (slower, safer) or keep the current flow |
| 6 | Public library routes `/library/stories`, `/library/videos`, `/library/podcasts` | `/library` is the **admin media library** | Rename the admin page (e.g. `/admin/media`) or use `/browse/*` for public pages |
| 7 | Admin tables at `/admin/tables/:type` | `/admin` is a single page; `/catalog`, `/library`, `/translations` are separate admin routes | Fold them under `/admin/*` in S3 |
| 8 | `/docs` public sources | `docs/` folder is Markdown on GitHub; `docs/KAYNAKCA.md` is a static bibliography; `/guide` renders in-app help | `/docs` route is free; seed `sources` from `KAYNAKCA.md` |
| 9 | XLSX via SheetJS, Markdown parser | Neither installed | New dependencies need your approval (see §7) |
| 10 | Local plane with optional publish for scripts, scenes, classic templates | Local data exists, but with ad-hoc localStorage keys and no export schema | S1 registry + versioned JSON export covers it |

## 7. Dependencies the spec would add (approval needed before S1/S3)

| Package | Reason | Notes |
|---|---|---|
| `xlsx` (SheetJS) | XLSX template and import | npm copy is stale and has known advisories; patched builds come from the SheetJS CDN tarball, not npm. Needs a deliberate pin. |
| Markdown parser (`marked` or `markdown-it`) | `body_md` → `body_blocks` | Use only to tokenise; blocks are built from tokens, no HTML output |
| CSV | none needed | Small hand-written RFC 4180 parser avoids a dependency |
| `zod` | already present | Schema registry |

## 8. Decisions I need from you to start S1

1. **Gateway model:** A (Node stays the only gateway, simplest) or B (PocketBase-native rules/hooks/users, public `pb.` sub-domain)?
2. **Migration of existing `/watch` data:** convert in place (one-time script, keep ids as `external_id`) — OK?
3. **Git flow:** PR per sprint into `main`, or keep pushing as now?
4. **Route names:** rename the admin media page and use `/library/{stories,videos,podcasts}` for the public pages?
5. **Dependencies:** approve SheetJS (CDN tarball pin) and `marked`?
6. **Admin identity:** keep the shared admin token (+ add `editor` role later) or move to PocketBase `users`?

Nothing has been installed or changed on the server; this sprint only adds this file.
