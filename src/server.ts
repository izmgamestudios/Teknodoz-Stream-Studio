import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { createLiveApi } from "./server/live";
import { liveConfigFromEnv, tokenTooShort } from "./server/live-policy";
import { handleManifest } from "./server/manifest";
import { createCatalogApi, catalogTokenFromEnv } from "./server/catalog";
import { fileRecordStore, fileStore } from "./server/catalog-store";
import { createAdminApi } from "./server/admin";
import { createSessionApi } from "./server/session";
import { ffmpegPoster } from "./server/ffmpeg";
import { ffprobeProber } from "./server/ffprobe";
import { createMediaApi, type MediaRecord } from "./server/media";
import { createMediaEditApi } from "./server/media-edit";
import { whisperFromEnv } from "./server/whisper";
import { createI18nApi } from "./server/i18n";
import { fileI18nStore } from "./server/i18n-store";
import {
  PocketBase,
  pbCatalogStore,
  pbI18nStore,
  pbRecordStore,
  pocketbaseFromEnv,
} from "./server/pocketbase";
import { createRoomsApi } from "./server/rooms";

type ServerEntry = {
  fetch: (
    request: Request,
    env: unknown,
    ctx: unknown,
  ) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

// In-memory signaling relay for "room" links (see src/server/rooms.ts).
const rooms = createRoomsApi();

// RTMP(S) live bridge (see src/server/live.ts). Off unless LIVE_ADMIN_TOKEN is set; the env is
// only readable on Node-like runtimes, elsewhere the bridge stays disabled.
const liveEnv: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};
if (tokenTooShort(liveEnv))
  console.warn(
    "[live] LIVE_ADMIN_TOKEN is shorter than 16 characters: live bridge disabled",
  );
const live = createLiveApi({ config: liveConfigFromEnv(liveEnv) });

// Viewer-home video catalog + translation overrides (see src/server/catalog.ts, i18n.ts).
// Reads are public; writes need CATALOG_ADMIN_TOKEN. Data lives in PocketBase when
// POCKETBASE_URL / _ADMIN_EMAIL / _ADMIN_PASSWORD are set, otherwise in JSON files
// (CATALOG_FILE, I18N_FILE; default ./data/*.json).
const pbConfig = pocketbaseFromEnv(liveEnv);
const pb = pbConfig ? new PocketBase(pbConfig) : null;
if (pb) console.info("[data] PocketBase storage:", pbConfig?.url);
const adminToken = catalogTokenFromEnv(liveEnv);
const catalogStore = pb
  ? pbCatalogStore(pb)
  : fileStore(liveEnv["CATALOG_FILE"]?.trim() || "data/catalog.json");
const i18nStore = pb
  ? pbI18nStore(pb)
  : fileI18nStore(liveEnv["I18N_FILE"]?.trim() || "data/i18n.json");
const catalog = createCatalogApi({ token: adminToken, store: catalogStore });
// Media library: files on disk (MEDIA_DIR) + one record per file next to the catalog.
const mediaStore = pb
  ? pbRecordStore<MediaRecord>(pb, "media_items")
  : fileRecordStore<MediaRecord>(
      liveEnv["MEDIA_INDEX_FILE"]?.trim() || "data/media.json",
    );
const ffmpegBin =
  liveEnv["FFMPEG_PATH"]?.trim() ||
  liveEnv["LIVE_FFMPEG_PATH"]?.trim() ||
  "ffmpeg";
const prober = ffprobeProber(liveEnv["FFPROBE_PATH"]?.trim() || "ffprobe");
const media = createMediaApi({
  token: adminToken,
  store: mediaStore,
  dir: liveEnv["MEDIA_DIR"]?.trim() || "data/media",
  maxBytes: Math.max(1, Number(liveEnv["MEDIA_MAX_MB"]) || 1024) * 1024 * 1024,
  probe: prober,
  poster: (input, out) => ffmpegPoster(ffmpegBin, input, out),
});
// Editing (ffmpeg) and automatic subtitles (Whisper CLI, WHISPER_* env) on top of the library.
const mediaEdit = createMediaEditApi({
  token: adminToken,
  media,
  ffmpegBin,
  probe: prober,
  whisper: whisperFromEnv(liveEnv),
});
const i18n = createI18nApi({ token: adminToken, store: i18nStore });
const session = createSessionApi({ token: adminToken });
const admin = createAdminApi({
  token: adminToken,
  catalog: catalogStore,
  i18n: i18nStore,
  storage: pb ? "pocketbase" : "file",
});

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(
    consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`),
  );
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as {
      unhandled?: unknown;
      message?: unknown;
    };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const manifestResponse = handleManifest(request);
      if (manifestResponse) return manifestResponse;
      const roomResponse = await rooms.handle(request);
      if (roomResponse) return roomResponse;
      const catalogResponse = await catalog.handle(request);
      if (catalogResponse) return catalogResponse;
      const sessionResponse = await session.handle(request);
      if (sessionResponse) return sessionResponse;
      const mediaEditResponse = await mediaEdit.handle(request);
      if (mediaEditResponse) return mediaEditResponse;
      const mediaResponse = await media.handle(request);
      if (mediaResponse) return mediaResponse;
      const adminResponse = await admin.handle(request);
      if (adminResponse) return adminResponse;
      const i18nResponse = await i18n.handle(request);
      if (i18nResponse) return i18nResponse;
      const liveResponse = await live.handle(request);
      if (liveResponse) return liveResponse;
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
