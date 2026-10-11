// src/server/rooms.ts
// Tiny in-memory signaling relay ("rooms"). It only carries short JSON messages (join requests,
// approvals and the SDP offer/answer codes); media never touches the server and nothing is
// persisted: restarting the process drops all rooms. No accounts, no database.
//
// Flow: host creates a room (short code + secret host token) -> guests open /r/<code> and post a
// join request ("waiting pool") -> host approves: it creates a WebRTC offer and posts it ->
// the guest long-polls it, answers -> host long-polls the answer -> WebRTC connects directly.
//
// Pure `Request -> Response` so it is unit-testable and independent of the HTTP framework.
// Needs ONE long-lived process (node-server preset behind a reverse proxy); on serverless
// platforms with per-request isolates the in-memory state is not shared.
import { z } from "zod";

export const ROOM_API_PREFIX = "/api/room";

/** Unambiguous alphabet (no 0/O/1/I). 32^6 ≈ 10^9 codes. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

export const LIMITS = {
  maxBodyBytes: 16 * 1024,
  maxCodeChars: 12 * 1024,
  maxRooms: 200,
  maxGuestsPerRoom: 60,
  maxWaitingPerRoom: 25,
  maxWaitersPerRoom: 80,
  maxEventsQueued: 300,
  nameChars: 40,
  roomIdleMs: 6 * 60 * 60_000,
  closedRetainMs: 2 * 60_000,
  guestStaleMs: 90_000,
  doneRetainMs: 2 * 60_000,
  hostOnlineMs: 45_000,
  defaultWaitMs: 20_000,
  maxWaitMs: 25_000,
  sweepEveryMs: 30_000,
  createPerHour: 10,
  joinPer10Min: 30,
} as const;

export type RoomRole = "guest" | "viewer" | "remote";

export type HostEvent =
  | {
      n: number;
      type: "join";
      guestId: string;
      name: string;
      role: RoomRole;
      at: number;
    }
  | { n: number; type: "answer"; guestId: string; answer: string }
  | { n: number; type: "leave"; guestId: string; reason: "left" | "stale" };

export type GuestEvent =
  | { n: number; type: "offer"; offer: string }
  | { n: number; type: "rejected" }
  | { n: number; type: "closed" };

type Waiter = () => void;

/** Omit that distributes over a union (plain Omit would flatten it). */
type DistOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

interface Guest {
  id: string;
  token: string;
  name: string;
  role: RoomRole;
  status: "waiting" | "offered" | "rejected" | "answered";
  lastSeen: number;
  doneAt: number | null;
  seq: number;
  events: GuestEvent[];
  waiters: Set<Waiter>;
}

interface Room {
  code: string;
  hostToken: string;
  createdAt: number;
  lastHostSeen: number;
  closedAt: number | null;
  seq: number;
  events: HostEvent[];
  waiters: Set<Waiter>;
  guests: Map<string, Guest>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export interface RoomsOptions {
  now?: () => number;
  /** random bytes source (tests) */
  randomBytes?: (n: number) => Uint8Array;
}

function defaultRandom(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time string comparison (lengths are public). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Drop control / zero-width characters, collapse whitespace, cap the length. */
function cleanName(raw: string, fallback: string): string {
  let out = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;
    const bad =
      c <= 0x1f ||
      c === 0x7f ||
      (c >= 0x200b && c <= 0x200f) ||
      c === 0x2028 ||
      c === 0x2029 ||
      c === 0xfeff;
    if (!bad) out += ch;
  }
  out = out.replace(/\s+/g, " ").trim().slice(0, LIMITS.nameChars);
  return out || fallback;
}

const DEFAULT_NAME: Record<RoomRole, string> = {
  guest: "Konuk",
  viewer: "İzleyici",
  remote: "Kumanda",
};

const codeField = z
  .string()
  .max(LIMITS.maxCodeChars)
  .regex(/^TKZ[0-9A-Za-z]*\.[A-Za-z0-9_-]+$/, "bad code");

const joinBody = z.object({
  name: z.string().max(1000).optional(),
  role: z.enum(["guest", "viewer", "remote"]),
});
const offerBody = z.object({ guestId: z.string().max(40), offer: codeField });
const rejectBody = z.object({ guestId: z.string().max(40) });
const answerBody = z.object({ answer: codeField });
const leaveBody = z
  .object({ token: z.string().max(100).optional() })
  .passthrough();

const SECURITY_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: SECURITY_HEADERS,
  });
}

export function createRoomsApi(options: RoomsOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const random = options.randomBytes ?? defaultRandom;
  const rooms = new Map<string, Room>();
  const hits = new Map<string, { count: number; start: number }>();
  let lastSweep = 0;

  /* ----------------------------- helpers ----------------------------- */

  function newCode(): string {
    for (let attempt = 0; attempt < 20; attempt++) {
      const bytes = random(CODE_LENGTH);
      let code = "";
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[(bytes[i] ?? 0) % CODE_ALPHABET.length];
      }
      if (!rooms.has(code)) return code;
    }
    throw new HttpError(503, "busy");
  }

  function newToken(bytes = 18): string {
    return b64url(random(bytes));
  }

  function rateLimit(
    req: Request,
    bucket: string,
    max: number,
    windowMs: number,
  ): void {
    const fwd = req.headers.get("x-forwarded-for");
    // The reverse proxy APPENDS the real client address: only the last entry is trustworthy.
    const ip =
      (fwd ? fwd.split(",").pop()?.trim() : req.headers.get("x-real-ip")) ||
      "unknown";
    const key = `${bucket}|${ip}`;
    const t = now();
    const h = hits.get(key);
    if (!h || t - h.start >= windowMs) {
      hits.set(key, { count: 1, start: t });
      return;
    }
    h.count++;
    if (h.count > max) throw new HttpError(429, "rate-limited");
  }

  function wake(set: Set<Waiter>): void {
    for (const w of [...set]) w();
  }

  function pushHost(room: Room, ev: DistOmit<HostEvent, "n">): void {
    room.seq++;
    room.events.push({ ...ev, n: room.seq } as HostEvent);
    if (room.events.length > LIMITS.maxEventsQueued) {
      room.events.splice(0, room.events.length - LIMITS.maxEventsQueued);
    }
    wake(room.waiters);
  }

  function pushGuest(g: Guest, ev: DistOmit<GuestEvent, "n">): void {
    g.seq++;
    g.events.push({ ...ev, n: g.seq } as GuestEvent);
    if (g.events.length > 50) g.events.splice(0, g.events.length - 50);
    wake(g.waiters);
  }

  function sweep(): void {
    const t = now();
    if (t - lastSweep < LIMITS.sweepEveryMs) return;
    lastSweep = t;
    for (const [k, h] of hits) if (t - h.start > 3_600_000) hits.delete(k);
    for (const [code, room] of rooms) {
      const idle = t - Math.max(room.lastHostSeen, room.createdAt);
      if (
        (room.closedAt !== null && t - room.closedAt > LIMITS.closedRetainMs) ||
        idle > LIMITS.roomIdleMs
      ) {
        wake(room.waiters);
        for (const g of room.guests.values()) wake(g.waiters);
        rooms.delete(code);
        continue;
      }
      for (const [gid, g] of room.guests) {
        if (g.status === "answered" || g.status === "rejected") {
          if (g.doneAt !== null && t - g.doneAt > LIMITS.doneRetainMs)
            room.guests.delete(gid);
        } else if (t - g.lastSeen > LIMITS.guestStaleMs) {
          room.guests.delete(gid);
          pushHost(room, { type: "leave", guestId: gid, reason: "stale" });
        }
      }
    }
  }

  function getRoom(codeRaw: string): Room {
    const code = codeRaw.toUpperCase();
    if (!CODE_RE.test(code)) throw new HttpError(404, "not-found");
    const room = rooms.get(code);
    if (!room) throw new HttpError(404, "not-found");
    return room;
  }

  function authHost(req: Request, room: Room): void {
    const m = /^Bearer\s+(\S{10,100})$/.exec(
      req.headers.get("authorization") ?? "",
    );
    if (!m || !safeEqual(m[1] as string, room.hostToken))
      throw new HttpError(403, "forbidden");
    room.lastHostSeen = now();
  }

  function getGuest(
    room: Room,
    gid: string,
    token: string | null | undefined,
  ): Guest {
    const g = room.guests.get(gid);
    if (!g || !token || !safeEqual(token, g.token))
      throw new HttpError(403, "forbidden");
    g.lastSeen = now();
    return g;
  }

  async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
    const text = await req.text();
    if (text.length > LIMITS.maxBodyBytes)
      throw new HttpError(413, "too-large");
    let raw: unknown;
    try {
      raw = text ? JSON.parse(text) : {};
    } catch {
      throw new HttpError(400, "bad-json");
    }
    const r = schema.safeParse(raw);
    if (!r.success) throw new HttpError(400, "bad-request");
    return r.data;
  }

  function waitFor(
    waiters: Set<Waiter>,
    ms: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (waiters.size >= LIMITS.maxWaitersPerRoom)
      throw new HttpError(429, "too-many-waiters");
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        waiters.delete(done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      waiters.add(done);
      signal.addEventListener("abort", done, { once: true });
    });
  }

  function parseWait(url: URL): { since: number; waitMs: number } {
    const since = Math.max(
      0,
      Math.floor(Number(url.searchParams.get("since") ?? 0)) || 0,
    );
    const w = Number(
      url.searchParams.get("wait") ?? LIMITS.defaultWaitMs / 1000,
    );
    const waitMs = Math.min(
      LIMITS.maxWaitMs,
      Math.max(0, (Number.isFinite(w) ? w : 0) * 1000),
    );
    return { since, waitMs };
  }

  /* ------------------------------ routes ------------------------------ */

  function createRoom(req: Request): Response {
    rateLimit(req, "create", LIMITS.createPerHour, 3_600_000);
    if (rooms.size >= LIMITS.maxRooms) throw new HttpError(503, "busy");
    const t = now();
    const room: Room = {
      code: newCode(),
      hostToken: newToken(24),
      createdAt: t,
      lastHostSeen: t,
      closedAt: null,
      seq: 0,
      events: [],
      waiters: new Set(),
      guests: new Map(),
    };
    rooms.set(room.code, room);
    return json(
      {
        code: room.code,
        hostToken: room.hostToken,
        idleTtlMs: LIMITS.roomIdleMs,
      },
      201,
    );
  }

  function roomInfo(room: Room): Response {
    const open = room.closedAt === null;
    return json({
      exists: true,
      open,
      hostOnline: open && now() - room.lastHostSeen < LIMITS.hostOnlineMs,
    });
  }

  function closeRoom(req: Request, room: Room): Response {
    authHost(req, room);
    if (room.closedAt === null) {
      room.closedAt = now();
      for (const g of room.guests.values()) pushGuest(g, { type: "closed" });
    }
    return json({ ok: true });
  }

  async function join(req: Request, room: Room): Promise<Response> {
    rateLimit(req, "join", LIMITS.joinPer10Min, 600_000);
    if (room.closedAt !== null) throw new HttpError(410, "closed");
    const body = await readJson(req, joinBody);
    if (room.guests.size >= LIMITS.maxGuestsPerRoom)
      throw new HttpError(429, "room-full");
    let waiting = 0;
    for (const g of room.guests.values()) if (g.status === "waiting") waiting++;
    if (waiting >= LIMITS.maxWaitingPerRoom)
      throw new HttpError(429, "pool-full");
    const guest: Guest = {
      id: newToken(9),
      token: newToken(24),
      name: cleanName(body.name ?? "", DEFAULT_NAME[body.role]),
      role: body.role,
      status: "waiting",
      lastSeen: now(),
      doneAt: null,
      seq: 0,
      events: [],
      waiters: new Set(),
    };
    room.guests.set(guest.id, guest);
    pushHost(room, {
      type: "join",
      guestId: guest.id,
      name: guest.name,
      role: guest.role,
      at: now(),
    });
    return json(
      {
        guestId: guest.id,
        guestToken: guest.token,
        name: guest.name,
        role: guest.role,
      },
      201,
    );
  }

  async function hostEvents(
    req: Request,
    url: URL,
    room: Room,
  ): Promise<Response> {
    authHost(req, room);
    const { since, waitMs } = parseWait(url);
    const pick = () => room.events.filter((e) => e.n > since);
    let events = pick();
    if (events.length === 0 && waitMs > 0 && room.closedAt === null) {
      await waitFor(room.waiters, waitMs, req.signal);
      room.lastHostSeen = now();
      events = pick();
    }
    return json({
      events,
      next: events.length ? (events[events.length - 1] as HostEvent).n : since,
      closed: room.closedAt !== null,
    });
  }

  async function hostOffer(req: Request, room: Room): Promise<Response> {
    authHost(req, room);
    const body = await readJson(req, offerBody);
    const g = room.guests.get(body.guestId);
    if (!g) throw new HttpError(404, "guest-not-found");
    if (g.status !== "waiting") throw new HttpError(409, "bad-state");
    g.status = "offered";
    pushGuest(g, { type: "offer", offer: body.offer });
    return json({ ok: true });
  }

  async function hostReject(req: Request, room: Room): Promise<Response> {
    authHost(req, room);
    const body = await readJson(req, rejectBody);
    const g = room.guests.get(body.guestId);
    if (!g) return json({ ok: true });
    g.status = "rejected";
    g.doneAt = now();
    pushGuest(g, { type: "rejected" });
    return json({ ok: true });
  }

  async function guestEvents(
    req: Request,
    url: URL,
    room: Room,
    gid: string,
  ): Promise<Response> {
    const g = getGuest(room, gid, req.headers.get("x-guest-token"));
    const { since, waitMs } = parseWait(url);
    const pick = () => g.events.filter((e) => e.n > since);
    let events = pick();
    if (events.length === 0 && waitMs > 0 && room.closedAt === null) {
      await waitFor(g.waiters, waitMs, req.signal);
      g.lastSeen = now();
      events = pick();
    }
    const hostOnline =
      room.closedAt === null && now() - room.lastHostSeen < LIMITS.hostOnlineMs;
    return json({
      events,
      next: events.length ? (events[events.length - 1] as GuestEvent).n : since,
      hostOnline,
      closed: room.closedAt !== null,
    });
  }

  async function guestAnswer(
    req: Request,
    room: Room,
    gid: string,
  ): Promise<Response> {
    const g = getGuest(room, gid, req.headers.get("x-guest-token"));
    const body = await readJson(req, answerBody);
    if (g.status !== "offered") throw new HttpError(409, "bad-state");
    g.status = "answered";
    g.doneAt = now();
    pushHost(room, { type: "answer", guestId: g.id, answer: body.answer });
    return json({ ok: true });
  }

  async function guestLeave(
    req: Request,
    room: Room,
    gid: string,
  ): Promise<Response> {
    // sendBeacon cannot set headers, so the token may also come in the body.
    let token = req.headers.get("x-guest-token");
    if (!token) token = (await readJson(req, leaveBody)).token ?? null;
    const g = getGuest(room, gid, token);
    if (g.status !== "answered") {
      room.guests.delete(g.id);
      pushHost(room, { type: "leave", guestId: g.id, reason: "left" });
    }
    return json({ ok: true });
  }

  /* ------------------------------ router ------------------------------ */

  /** Handle `/api/room/*`. Returns null for any other path so the caller can fall through. */
  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (
      url.pathname !== ROOM_API_PREFIX &&
      !url.pathname.startsWith(`${ROOM_API_PREFIX}/`)
    )
      return null;
    try {
      sweep();
      const rest = url.pathname
        .slice(ROOM_API_PREFIX.length)
        .split("/")
        .filter(Boolean);
      const method = req.method.toUpperCase();
      if (rest.length === 0) {
        if (method === "POST") return createRoom(req);
        throw new HttpError(405, "method-not-allowed");
      }
      if (rest[0] === "health" && rest.length === 1) {
        return json({ ok: true, v: 1, rooms: rooms.size });
      }
      const room = getRoom(rest[0] as string);
      if (rest.length === 1) {
        if (method === "GET") return roomInfo(room);
        if (method === "DELETE") return closeRoom(req, room);
        throw new HttpError(405, "method-not-allowed");
      }
      if (rest[1] === "join" && rest.length === 2 && method === "POST")
        return await join(req, room);
      if (rest[1] === "host" && rest.length === 3) {
        if (rest[2] === "events" && method === "GET")
          return await hostEvents(req, url, room);
        if (rest[2] === "offer" && method === "POST")
          return await hostOffer(req, room);
        if (rest[2] === "reject" && method === "POST")
          return await hostReject(req, room);
      }
      if (rest[1] === "guest" && rest.length === 4) {
        const gid = rest[2] as string;
        if (rest[3] === "events" && method === "GET")
          return await guestEvents(req, url, room, gid);
        if (rest[3] === "answer" && method === "POST")
          return await guestAnswer(req, room, gid);
        if (rest[3] === "leave" && method === "POST")
          return await guestLeave(req, room, gid);
      }
      throw new HttpError(404, "not-found");
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code }, e.status);
      console.error("[rooms]", e);
      return json({ error: "internal" }, 500);
    }
  }

  return {
    handle,
    /** test / introspection helpers */
    stats: () => ({ rooms: rooms.size }),
    dispose(): void {
      for (const room of rooms.values()) {
        wake(room.waiters);
        for (const g of room.guests.values()) wake(g.waiters);
      }
      rooms.clear();
      hits.clear();
    },
  };
}

export type RoomsApi = ReturnType<typeof createRoomsApi>;
