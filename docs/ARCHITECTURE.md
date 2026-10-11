# Teknodoz Studio — Architecture

Zero-server, zero-database, zero-login, 100% client-side. Everything lives under `src/studio/`.
`src/studio/types.ts` is the single source of truth for shared types (layers, scenes, project,
protocol messages, compositor hook contracts). Never redefine them elsewhere.

## Module map

| Dir | Responsibility | Depends on |
|---|---|---|
| `storage/` | IndexedDB asset store (`AssetStore`), `localStorage` + cookie settings/shortcuts, project autosave | `types` |
| `engine/compositor.ts` etc. | 1080p60 canvas compositor: layers, transforms, blend, opacity, chroma key, scene transitions, hit-testing | `types` |
| `engine/audio-bus.ts`, `recorder.ts`, `chapters.ts` | Web Audio mixer (gain/mute/VU), `captureStream` + `MediaRecorder`, markers → `chapters.txt` + `.srt` | `types` |
| `prompter/` | script parsing, scroll engine, Web Speech follow, burn-in renderer, .txt/.docx import | `types` |
| `proto/` | device frames (mobile 390x844, desktop 16:9), touch ripples, tab-capture bridge | `types` |
| `p2p/` | serverless WebRTC: signaling codec, host (green room), guest/viewer, remote control, QR encoder | `types` |
| `project/` | project store (scenes/layers CRUD, undo), `.pptdz` export/import, migrations | `types`, `AssetStore` |
| `templates/` | Declarative broadcast frame templates (`catalog.ts`), pure `buildTemplateScene` (-> normal Scene of existing layer kinds), canvas-generated dotted backdrop stored as an image asset | `types`, `defaults` |
| `live/` | `/live` page logic: platform presets, API client, sequential chunk uploader, `LiveStreamer` (MediaRecorder → server ffmpeg bridge → RTMP(S)); server half in `src/server/live*.ts`, see `docs/LIVE.md` | `types` |
| `sponsors/` | On-air sponsor layer drawing (`draw.ts`, tier-weighted rotation), screen-time accounting (`exposure.ts`) and the CSV report; sponsor records live in `ProjectState.sponsors` (carried by `.pptdz`) | `types`, `room/chat-draw` |
| `community/` | Validated channel links (`channels.ts`/`links.ts`), share-intent URLs and announcement text (`share.ts`), project supporters wall + application kit (`supporters.ts`) | `credits` |
| `branding/` | The brand model (name, logo, slogan, "Early access" badge, colors, share metadata, icons): validation (`brand.ts`), SSR `<head>` meta/links + CSS variables + web manifest (`head.ts`), owner config (`config.ts`), env layer (`server-brand.ts`), per-browser overrides (`local.ts`), editor helpers (`export.ts`, `check.ts`, `labels.ts`), see `docs/BRANDING.md` | `zod` |
| `pwa/` | Installable app: service worker registration, install prompt hook, platform/browser detection, native download links (`downloads.ts` + owner file `downloads-config.ts`); the worker itself is `public/sw.js`, see `docs/DOWNLOADS.md` | – |
| `guide/` | The user guide as data (`content.ts`, tr/en), Drive/YouTube/link resources with strict parsing (`resources.ts` + owner file `resources-config.ts`), Markdown renderer for `docs/USER-GUIDE*.md` (`markdown.ts`; a test keeps the files in sync) | `i18n`, `defaults` |
| `runtime/` | glue: owns media sources, wires compositor + audio + recorder + prompter + p2p + project | all of the above |
| `ui/` | React panels, using the runtime | `runtime` |
| `routes/` | `/` (prompter), `/studio`, `/room`, `/live`, `/community`, `/guide`, `/download`, `/settings`, `/join` (viewer/guest), `/remote` (phone control), `/r/CODE`, `/chat/CODE` | `ui` |

## Hard constraints

- No network calls except optional public STUN (setting `usePublicStun`) for WebRTC ICE.
  No analytics, no CDN scripts, no fonts beyond what the app already loads.
- No new npm dependencies (the environment cannot refresh `bun.lock`). Use platform APIs
  (IndexedDB, Web Audio, WebRTC, CompressionStream, Web Speech, MediaRecorder).
- Strict TypeScript: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noPropertyAccessFromIndexSignature` are on. SSR is on (TanStack Start): never touch
  `window`/`document`/`navigator`/`indexedDB` at module top level; guard or do it in effects.
- Untrusted input (imported `.pptdz`, P2P messages, URL fragments, pasted codes) is validated
  with `zod` (already a dependency) before use. Never `innerHTML` untrusted text.
- Prettier style of the repo: double quotes, semicolons, 2 spaces, trailing commas, 100 cols.
  Run `npx prettier --write <your files>` before finishing.
- Keep each file focused (<~400 lines where possible). Pure logic gets vitest unit tests next to
  the file as `*.test.ts` (jsdom env is the default; use `// @vitest-environment node` when needed).

## Privacy model

Camera/mic/screen never leave the device except via the explicit P2P connection the user opens.
Public STUN only reveals the IP to the STUN operator; no media or SDP goes through any server.
Signaling is manual (copy/paste/QR/link fragment) because there is no server by design.

## Implementation notes (current)

- `runtime/StudioRuntime` is the only place that touches media devices, the compositor, the recorder and
  the P2P host. UI code reads state through `useSyncExternalStore` hooks in `runtime/use-studio.tsx`.
- The compositor renders ONE program canvas; editing happens live on the active scene. Scene changes use the
  scene's transition. Preview == program (no separate preview bus yet).
- Hidden-tab frame pacing: the compositor falls back to a Web Worker timer when the tab is not visible.
- Prototype pixels enter only through `getDisplayMedia`; see `src/studio/proto/README.md`.
- P2P is manual-signaling only (offer/answer codes in the URL fragment or pasted). The host owns one
  RTCPeerConnection per peer (mesh), default cap 8, no TURN.
- Smoke-tested in headless Chromium (fake media devices): camera -> canvas, scene hotkeys, MP4 + chapters/SRT,
  two-page P2P with green room, phone remote, `.pptdz` export. Unit tests: `npm run test`.
- Optional server pieces (both off/unused on static hosting): the room relay and the RTMP(S) live bridge (`src/server/live.ts`, token-gated, needs ffmpeg).
- Room mode (`src/server/rooms.ts` relay + `src/studio/room/*`): see `docs/ROOM.md`. The runtime is a per-page-load
  singleton (`acquireRuntime`) shared by all routes, and owns its program canvas, so connections, camera and
  recording survive navigation (e.g. Studio -> Room).
- Brand layering (`src/studio/branding`): `DEFAULT_BRAND` < `config.ts` < `BRAND_*` environment < per-browser overrides. The root route
  loads the server brand through a `createServerFn` (`branding/server-fn.ts`) and builds `<head>`, CSS variables and `lang` from it;
  `/manifest.webmanifest` is answered by `src/server/manifest.ts` from the same brand. Every value is validated before it reaches CSS or markup.
- PWA: `public/sw.js` caches static files only (never `/api/*`, never HTML) and is registered in production builds only.
- i18n: `src/studio/i18n` (tr/en) covers the shell, settings and guest/remote/room pages; studio panels are Turkish.
