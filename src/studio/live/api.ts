// src/studio/live/api.ts
// Browser client of /api/live (see src/server/live.ts).

export type LiveApiErrorCode =
  | "unavailable" // no server API here (static / serverless hosting)
  | "disabled" // server runs but LIVE_ADMIN_TOKEN is not set
  | "network"
  | "forbidden"
  | "rate-limited"
  | "busy"
  | "bad-destination"
  | "bitrate-too-high"
  | "ffmpeg-missing"
  | "ended"
  | "bad-seq"
  | "too-large"
  | "not-found"
  | "bad-request"
  | "server";

export class LiveApiError extends Error {
  constructor(
    readonly code: LiveApiErrorCode,
    readonly status = 0,
    readonly data: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "LiveApiError";
  }
  /** `bad-destination` carries which destination and why. */
  get reason(): string | undefined {
    return typeof this.data["reason"] === "string"
      ? this.data["reason"]
      : undefined;
  }
  get index(): number | undefined {
    return typeof this.data["index"] === "number"
      ? this.data["index"]
      : undefined;
  }
}

export type LiveState = "starting" | "live" | "stopping" | "ended" | "error";

export interface LiveProgress {
  frame: number;
  fps: number;
  bitrateKbps: number;
  outTimeMs: number;
  speed: number;
  dropped: number;
}

export interface LiveSession {
  id: string;
  state: LiveState;
  startedAt: number;
  uptimeMs: number;
  bytesIn: number;
  chunks: number;
  nextSeq: number;
  destinations: { label: string; host: string; secure: boolean }[];
  progress: LiveProgress;
  error: string | null;
  tail: string[];
}

export interface LiveStatus {
  ffmpeg: { ok: boolean; version: string | null };
  limits: {
    maxDestinations: number;
    maxVideoKbps: number;
    maxMinutes: number;
    allowAnyHost: boolean;
    allowPrivate: boolean;
    hosts: string[];
  };
  session: LiveSession | null;
}

export interface StartBody {
  destinations: { label: string; server: string; key: string }[];
  video: { width: number; height: number; fps: number; kbps: number };
  audioKbps: number;
  container: "webm" | "mp4";
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const CODES: Record<string, LiveApiErrorCode> = {
  disabled: "disabled",
  forbidden: "forbidden",
  "rate-limited": "rate-limited",
  busy: "busy",
  "bad-destination": "bad-destination",
  "bitrate-too-high": "bitrate-too-high",
  "ffmpeg-missing": "ffmpeg-missing",
  ended: "ended",
  "bad-seq": "bad-seq",
  "too-large": "too-large",
  "not-found": "not-found",
  "bad-request": "bad-request",
};

export function createLiveApi(
  opts: { fetch?: FetchLike; baseUrl?: string } = {},
) {
  const doFetch: FetchLike =
    opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
  const base = opts.baseUrl ?? "";

  async function request<T>(
    path: string,
    init: {
      method?: string;
      token?: string;
      json?: unknown;
      body?: BodyInit;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (init.token) headers["authorization"] = `Bearer ${init.token}`;
    const req: RequestInit = {
      method: init.method ?? "GET",
      headers,
      cache: "no-store",
    };
    if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      req.body = JSON.stringify(init.json);
    } else if (init.body !== undefined) {
      headers["content-type"] = "application/octet-stream";
      req.body = init.body;
    }
    if (init.signal) req.signal = init.signal;
    let res: Response;
    try {
      res = await doFetch(`${base}/api/live${path}`, req);
    } catch (e) {
      if ((e as { name?: string } | null)?.name === "AbortError") throw e;
      throw new LiveApiError("network");
    }
    let data: Record<string, unknown>;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new LiveApiError("unavailable", res.status);
    }
    if (!res.ok) {
      const code = typeof data["error"] === "string" ? data["error"] : "";
      throw new LiveApiError(
        CODES[code] ?? (res.status >= 500 ? "server" : "bad-request"),
        res.status,
        data,
      );
    }
    return data as T;
  }

  return {
    health: () => request<{ enabled: boolean }>("/health"),
    status: (token: string) => request<LiveStatus>("/status", { token }),
    probe: (token: string, server: string) =>
      request<{
        host: string;
        port: number;
        reachable: boolean;
        ms: number | null;
      }>("/probe", {
        method: "POST",
        token,
        json: { server },
      }),
    start: (token: string, body: StartBody) =>
      request<{ session: LiveSession }>("/session", {
        method: "POST",
        token,
        json: body,
      }),
    session: (token: string, id: string) =>
      request<{ session: LiveSession }>(`/session/${id}`, { token }),
    stop: (token: string, id: string) =>
      request<{ session: LiveSession }>(`/session/${id}`, {
        method: "DELETE",
        token,
      }),
    chunk: (
      token: string,
      id: string,
      seq: number,
      data: Blob | Uint8Array,
      signal?: AbortSignal,
    ) =>
      request<{ ok: true; next: number; duplicate?: boolean }>(
        `/session/${id}/chunk?seq=${seq}`,
        {
          method: "POST",
          token,
          body: data as BodyInit,
          ...(signal ? { signal } : {}),
        },
      ),
  };
}

export type LiveApi = ReturnType<typeof createLiveApi>;
