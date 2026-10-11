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
| `runtime/` | glue: owns media sources, wires compositor + audio + recorder + prompter + p2p + project | all of the above |
| `ui/` | React panels, using the runtime | `runtime` |
| `routes/` | `/` (prompter), `/studio`, `/join` (viewer/guest), `/remote` (phone control) | `ui` |

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
- Room mode (`src/server/rooms.ts` relay + `src/studio/room/*`): see `docs/ROOM.md`. The runtime is a per-page-load
  singleton (`acquireRuntime`) shared by all routes, and owns its program canvas, so connections, camera and
  recording survive navigation (e.g. Studio -> Room).
- i18n: `src/studio/i18n` (tr/en) covers the shell, settings and guest/remote/room pages; studio panels are Turkish.
