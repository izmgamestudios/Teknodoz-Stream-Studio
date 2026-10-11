// src/studio/room/api.ts
// Browser client for the /api/room signaling relay (see src/server/rooms.ts).
import type {
  ChatAction,
  ChatMessage,
  ChatMode,
  RoomRole,
} from "../../server/rooms";

export type { ChatAction, ChatMessage, ChatMode, RoomRole };

export type RoomApiErrorCode =
  /** the relay is not there (static hosting / serverless): fall back to manual codes */
  | "unavailable"
  | "network"
  | "not-found"
  | "forbidden"
  | "closed"
  | "rate-limited"
  | "full"
  | "bad-request"
  | "conflict"
  | "server";

export class RoomApiError extends Error {
  constructor(
    readonly code: RoomApiErrorCode,
    readonly status = 0,
    /** raw error code of the relay, e.g. "chat-closed" / "queue-full" */
    readonly detail?: string,
  ) {
    super(code);
    this.name = "RoomApiError";
  }
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface HostEvent {
  n: number;
  type: "join" | "answer" | "leave";
  guestId: string;
  name?: string;
  role?: RoomRole;
  at?: number;
  answer?: string;
  reason?: "left" | "stale";
}
export interface GuestEvent {
  n: number;
  type: "offer" | "rejected" | "closed";
  offer?: string;
}

export interface ChatPollResponse {
  messages: ChatMessage[];
  rev: number;
  mode: ChatMode;
  /** id of the message currently on air (director's choice) */
  onAir: number | null;
  closed: boolean;
  /** moderators only */
  pending?: number;
  as?: "host" | "editor";
}

function mapStatus(
  status: number,
  serverCode: string | undefined,
): RoomApiErrorCode {
  if (status === 404) return "not-found";
  if (status === 403) return "forbidden";
  if (status === 410) return "closed";
  if (status === 409) return "conflict";
  if (status === 429)
    return serverCode === "rate-limited" ? "rate-limited" : "full";
  if (status === 400 || status === 413) return "bad-request";
  if (status === 405) return "unavailable";
  return status >= 500 ? "server" : "bad-request";
}

export interface RoomApiOptions {
  fetch?: FetchLike;
  /** prefix for the endpoints, default "" (same origin) */
  baseUrl?: string;
}

export function createRoomApi(opts: RoomApiOptions = {}) {
  const doFetch: FetchLike =
    opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = opts.baseUrl ?? "";

  async function request<T>(
    path: string,
    init: RequestInit & { json?: unknown; host?: string; guest?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (init.host) headers["authorization"] = `Bearer ${init.host}`;
    if (init.guest) headers["x-guest-token"] = init.guest;
    const req: RequestInit = {
      method: init.method ?? "GET",
      headers,
      cache: "no-store",
    };
    if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      req.body = JSON.stringify(init.json);
    }
    if (init.signal) req.signal = init.signal;
    let res: Response;
    try {
      res = await doFetch(`${base}/api/room${path}`, req);
    } catch (e) {
      if ((e as { name?: string } | null)?.name === "AbortError") throw e;
      throw new RoomApiError("network");
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // an HTML page (SPA fallback) means the relay is not deployed here
      throw new RoomApiError("unavailable", res.status);
    }
    if (!res.ok) {
      const code = (data as { error?: string } | null)?.error;
      throw new RoomApiError(mapStatus(res.status, code), res.status, code);
    }
    return data as T;
  }

  return {
    async health(): Promise<boolean> {
      try {
        const r = await request<{ ok?: boolean }>("/health");
        return r.ok === true;
      } catch {
        return false;
      }
    },
    createRoom: () =>
      request<{ code: string; hostToken: string }>("", { method: "POST" }),
    info: (code: string) =>
      request<{ exists: boolean; open: boolean; hostOnline: boolean }>(
        `/${code}`,
      ),
    closeRoom: (code: string, host: string) =>
      request<{ ok: true }>(`/${code}`, { method: "DELETE", host }),
    join: (code: string, body: { name: string; role: RoomRole }) =>
      request<{
        guestId: string;
        guestToken: string;
        name: string;
        role: RoomRole;
      }>(`/${code}/join`, { method: "POST", json: body }),
    hostEvents: (
      code: string,
      host: string,
      since: number,
      waitSec: number,
      signal?: AbortSignal,
    ) =>
      request<{ events: HostEvent[]; next: number; closed: boolean }>(
        `/${code}/host/events?since=${since}&wait=${waitSec}`,
        { host, ...(signal ? { signal } : {}) },
      ),
    hostOffer: (code: string, host: string, guestId: string, offer: string) =>
      request<{ ok: true }>(`/${code}/host/offer`, {
        method: "POST",
        host,
        json: { guestId, offer },
      }),
    hostReject: (code: string, host: string, guestId: string) =>
      request<{ ok: true }>(`/${code}/host/reject`, {
        method: "POST",
        host,
        json: { guestId },
      }),
    guestEvents: (
      code: string,
      guestId: string,
      token: string,
      since: number,
      waitSec: number,
      signal?: AbortSignal,
    ) =>
      request<{
        events: GuestEvent[];
        next: number;
        hostOnline: boolean;
        closed: boolean;
      }>(`/${code}/guest/${guestId}/events?since=${since}&wait=${waitSec}`, {
        guest: token,
        ...(signal ? { signal } : {}),
      }),
    guestAnswer: (
      code: string,
      guestId: string,
      token: string,
      answer: string,
    ) =>
      request<{ ok: true }>(`/${code}/guest/${guestId}/answer`, {
        method: "POST",
        guest: token,
        json: { answer },
      }),
    /* ---- chat: director (host token) / editor (editor key) ---- */
    chatPoll: (
      code: string,
      bearer: string,
      since: number,
      waitSec: number,
      signal?: AbortSignal,
    ) =>
      request<ChatPollResponse>(
        `/${code}/chat?since=${since}&wait=${waitSec}`,
        { host: bearer, ...(signal ? { signal } : {}) },
      ),
    chatPost: (code: string, bearer: string, text: string) =>
      request<{ message: ChatMessage }>(`/${code}/chat`, {
        method: "POST",
        host: bearer,
        json: { text },
      }),
    chatAction: (
      code: string,
      bearer: string,
      id: number,
      action: ChatAction,
      text?: string,
    ) =>
      request<{ message: ChatMessage; onAir: number | null }>(
        `/${code}/chat/${id}`,
        {
          method: "POST",
          host: bearer,
          json: text === undefined ? { action } : { action, text },
        },
      ),
    setChatMode: (code: string, host: string, mode: ChatMode) =>
      request<{ mode: ChatMode }>(`/${code}/host/chat-mode`, {
        method: "POST",
        host,
        json: { mode },
      }),
    /** (Re)issue the editor key; the previous one stops working. */
    issueEditorKey: (code: string, host: string) =>
      request<{ editorKey: string }>(`/${code}/host/editor`, {
        method: "POST",
        host,
      }),
    revokeEditorKey: (code: string, host: string) =>
      request<{ editorKey: null }>(`/${code}/host/editor`, {
        method: "DELETE",
        host,
      }),
    /* ---- chat: participants ---- */
    guestChatPoll: (
      code: string,
      guestId: string,
      token: string,
      since: number,
      waitSec: number,
      signal?: AbortSignal,
    ) =>
      request<ChatPollResponse>(
        `/${code}/guest/${guestId}/chat?since=${since}&wait=${waitSec}`,
        { guest: token, ...(signal ? { signal } : {}) },
      ),
    guestChatPost: (
      code: string,
      guestId: string,
      token: string,
      text: string,
    ) =>
      request<{ message: ChatMessage }>(`/${code}/guest/${guestId}/chat`, {
        method: "POST",
        guest: token,
        json: { text },
      }),
    guestLeave: (code: string, guestId: string, token: string) =>
      request<{ ok: true }>(`/${code}/guest/${guestId}/leave`, {
        method: "POST",
        guest: token,
        json: {},
        keepalive: true,
      }),
  };
}

export type RoomApi = ReturnType<typeof createRoomApi>;

/** Short invite link: `/r/<code>`; non-default roles add `?as=`. */
export function buildRoomLink(
  origin: string,
  code: string,
  role?: RoomRole,
): string {
  const base = `${origin.replace(/\/+$/, "")}/r/${code.toUpperCase()}`;
  return role && role !== "guest" ? `${base}?as=${role}` : base;
}

export function isRoomCode(s: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(s.toUpperCase());
}
