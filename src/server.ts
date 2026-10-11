import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { createLiveApi } from "./server/live";
import { liveConfigFromEnv, tokenTooShort } from "./server/live-policy";
import { handleManifest } from "./server/manifest";
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
