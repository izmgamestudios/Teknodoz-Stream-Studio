// src/server/creators.ts
// Content-creator accounts. Nobody becomes a creator by clicking a button: they APPLY (full name
// + a phone number or an e-mail address, the other is optional), the administrator approves the
// application and hands the person a username + one-time password, and the creator then signs
// in. Passwords are stored as scrypt hashes; the plain password exists only in the approve /
// reset response. Sessions are signed HttpOnly cookies that are re-checked against the store on
// every request, so a revoked creator is out immediately.
//
//   POST   /api/creators/apply     { name, phone?, email?, website? }   (public, rate limited)
//   POST   /api/creators/login     { username, password }
//   POST   /api/creators/logout
//   GET    /api/creators/me        { enabled, creator, admin }
//   GET    /api/creators                          (admin) list, never with hashes
//   POST   /api/creators/:id/approve|reject|revoke|reset   (admin)
//   DELETE /api/creators/:id                      (admin)
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

import {
  isAdminRequest,
  isSecureRequest,
  parseCookies,
  safeEqual,
} from "./auth";
import type { RecordStore } from "./catalog";
import { clientIp } from "./client-ip";

export const CREATOR_COOKIE = "tkz_creator";
export const CREATOR_SESSION_S = 7 * 24 * 60 * 60;
export const CREATORS_API = "/api/creators";

export type CreatorStatus = "pending" | "approved" | "rejected" | "revoked";

export interface CreatorRecord {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: CreatorStatus;
  createdAt: string;
  decidedAt: string | null;
  username: string;
  /** scrypt "salt:hash" (hex); empty until approved */
  passwordHash: string;
  lastLoginAt: string | null;
}

export type PublicCreator = Omit<CreatorRecord, "passwordHash">;

export const LIMITS = {
  applyPerHour: 5,
  loginPerIp: { max: 10, windowMs: 10 * 60_000 },
  loginFailsPerUser: { max: 5, lockMs: 15 * 60_000 },
  maxPending: 500,
} as const;

/* ------------------------------ pure helpers ------------------------------ */

const fold = (s: string): string =>
  s
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i");

export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Digits with an optional leading +, 7..15 digits; null when it is not a phone number. */
export function normalizePhone(raw: string): string | null {
  const t = raw.trim();
  if (!t) return "";
  if (!/^\+?[\d\s().-]+$/.test(t)) return null;
  const digits = t.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return (t.startsWith("+") ? "+" : "") + digits;
}

export function normalizeEmail(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t) return "";
  if (t.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) return null;
  return t;
}

const PASS_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function newPassword(rand: (n: number) => number = randomInt): string {
  const part = () =>
    Array.from(
      { length: 4 },
      () => PASS_ALPHABET[rand(PASS_ALPHABET.length)],
    ).join("");
  return `${part()}-${part()}-${part()}`;
}

export function usernameBase(name: string): string {
  const parts = fold(name)
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean);
  const base = [parts[0], parts.length > 1 ? parts[parts.length - 1] : ""]
    .filter(Boolean)
    .join(".");
  return (base || "creator").slice(0, 24);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, "hex");
  const got = scryptSync(password, Buffer.from(saltHex, "hex"), want.length);
  return want.length === got.length && timingSafeEqual(want, got);
}

const DUMMY_HASH = hashPassword("not-a-real-password");

const key = (token: string): Buffer =>
  createHash("sha256").update(`tkz-creator-session-v1:${token}`).digest();

export function signCreatorSession(
  token: string,
  id: string,
  expMs: number,
): string {
  const body = `${id}.${expMs}.${randomBytes(9).toString("base64url")}`;
  return `${body}.${createHmac("sha256", key(token)).update(body).digest("base64url")}`;
}

/** The creator id inside a valid, unexpired cookie value; null otherwise. */
export function verifyCreatorSession(
  token: string,
  value: string,
  nowMs: number,
): string | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [id, exp, nonce, sig] = parts as [string, string, string, string];
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs <= nowMs) return null;
  const want = createHmac("sha256", key(token))
    .update(`${id}.${exp}.${nonce}`)
    .digest("base64url");
  return safeEqual(sig, want) ? id : null;
}

const toPublic = (c: CreatorRecord): PublicCreator => {
  const { passwordHash: _h, ...rest } = c;
  void _h;
  return rest;
};

/* ----------------------------------- API ---------------------------------- */

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
  });

const applyBody = z.object({
  name: z.string().max(200),
  phone: z.string().max(40).optional().default(""),
  email: z.string().max(200).optional().default(""),
  /** honeypot: real people never fill it */
  website: z.string().max(200).optional().default(""),
});
const loginBody = z.object({
  username: z.string().min(1).max(60),
  password: z.string().min(1).max(100),
});

export interface CreatorsOptions {
  /** the admin token (also the signing secret); null disables the whole feature */
  token: string | null;
  store: RecordStore<CreatorRecord>;
  now?: () => number;
}

export function createCreatorsApi(opts: CreatorsOptions) {
  const now = opts.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  const hits = new Map<string, number[]>();
  const fails = new Map<string, { count: number; until: number }>();

  function limited(bucket: string, max: number, windowMs: number): boolean {
    const t = now();
    const arr = (hits.get(bucket) ?? []).filter((x) => t - x < windowMs);
    arr.push(t);
    hits.set(bucket, arr);
    if (hits.size > 5000) hits.clear();
    return arr.length > max;
  }

  /** The approved creator behind this request's cookie, or null. */
  async function creatorOf(req: Request): Promise<CreatorRecord | null> {
    if (!opts.token) return null;
    const cookie = parseCookies(req.headers.get("cookie"))[CREATOR_COOKIE];
    if (!cookie) return null;
    const id = verifyCreatorSession(opts.token, cookie, now());
    if (!id) return null;
    const rec = (await opts.store.list()).find((c) => c.id === id);
    return rec && rec.status === "approved" ? rec : null;
  }

  const cookieHeader = (value: string | null, secure: boolean): string =>
    [
      `${CREATOR_COOKIE}=${value ?? ""}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${value === null ? 0 : CREATOR_SESSION_S}`,
      ...(secure ? ["Secure"] : []),
    ].join("; ");

  async function readJson(req: Request): Promise<unknown> {
    const raw = await req.text();
    if (raw.length > 4096) throw new Error("too-large");
    return JSON.parse(raw);
  }

  async function uniqueUsername(
    name: string,
    all: CreatorRecord[],
  ): Promise<string> {
    const taken = new Set(all.map((c) => c.username).filter(Boolean));
    const base = usernameBase(name);
    for (let i = 0; i < 50; i++) {
      const u = `${base}${randomInt(10, 100)}`;
      if (!taken.has(u)) return u;
    }
    return `${base}${randomBytes(3).toString("hex")}`;
  }

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (
      url.pathname !== CREATORS_API &&
      !url.pathname.startsWith(`${CREATORS_API}/`)
    )
      return null;
    if (!opts.token) return json({ error: "disabled" }, 503);
    const rest = url.pathname
      .slice(CREATORS_API.length)
      .split("/")
      .filter(Boolean);
    const method = req.method.toUpperCase();
    const ip = clientIp(req);
    const secure = isSecureRequest(req);
    const admin = isAdminRequest(req, opts.token, now());

    try {
      if (rest[0] === "me" && method === "GET") {
        const c = await creatorOf(req);
        return json({
          enabled: true,
          admin,
          creator: c ? { name: c.name, username: c.username } : null,
        });
      }

      if (rest[0] === "apply" && method === "POST") {
        if (limited(`apply:${ip}`, LIMITS.applyPerHour, 3_600_000))
          return json({ error: "rate-limited" }, 429);
        const b = applyBody.safeParse(await readJson(req));
        if (!b.success) return json({ error: "bad-request" }, 400);
        if (b.data.website) return json({ ok: true }); // bot: pretend it worked
        const name = normalizeName(b.data.name);
        const phone = normalizePhone(b.data.phone);
        const email = normalizeEmail(b.data.email);
        if (name.length < 2 || name.length > 80)
          return json({ error: "bad-name" }, 400);
        if (phone === null) return json({ error: "bad-phone" }, 400);
        if (email === null) return json({ error: "bad-email" }, 400);
        if (!phone && !email) return json({ error: "contact-required" }, 400);
        const all = await opts.store.list();
        const dup = all.some(
          (c) =>
            (c.status === "pending" || c.status === "approved") &&
            ((email && c.email === email) || (phone && c.phone === phone)),
        );
        // same answer for a duplicate: the form must not reveal who already applied
        if (dup) return json({ ok: true });
        if (
          all.filter((c) => c.status === "pending").length >= LIMITS.maxPending
        )
          return json({ error: "busy" }, 503);
        await opts.store.upsert({
          id: randomBytes(9).toString("base64url"),
          name,
          phone,
          email,
          status: "pending",
          createdAt: iso(),
          decidedAt: null,
          username: "",
          passwordHash: "",
          lastLoginAt: null,
        });
        return json({ ok: true });
      }

      if (rest[0] === "login" && method === "POST") {
        if (
          limited(
            `login:${ip}`,
            LIMITS.loginPerIp.max,
            LIMITS.loginPerIp.windowMs,
          )
        )
          return json({ error: "rate-limited" }, 429);
        const b = loginBody.safeParse(await readJson(req));
        if (!b.success) return json({ error: "bad-request" }, 400);
        const username = b.data.username.trim().toLowerCase();
        const lock = fails.get(username);
        if (lock && lock.until > now())
          return json({ error: "rate-limited" }, 429);
        const rec = (await opts.store.list()).find(
          (c) => c.username === username && c.status === "approved",
        );
        // verify against a dummy hash for unknown users so timing does not reveal them
        const ok =
          checkPassword(
            b.data.password.trim().toUpperCase(),
            rec?.passwordHash || DUMMY_HASH,
          ) && Boolean(rec);
        if (!ok || !rec) {
          const f = fails.get(username) ?? { count: 0, until: 0 };
          f.count++;
          if (f.count >= LIMITS.loginFailsPerUser.max) {
            f.count = 0;
            f.until = now() + LIMITS.loginFailsPerUser.lockMs;
          }
          fails.set(username, f);
          if (fails.size > 5000) fails.clear();
          return json({ error: "unauthorized" }, 401);
        }
        fails.delete(username);
        await opts.store.upsert({ ...rec, lastLoginAt: iso() });
        const value = signCreatorSession(
          opts.token,
          rec.id,
          now() + CREATOR_SESSION_S * 1000,
        );
        return json(
          { creator: { name: rec.name, username: rec.username } },
          200,
          {
            "set-cookie": cookieHeader(value, secure),
          },
        );
      }

      if (rest[0] === "logout" && method === "POST")
        return json({ ok: true }, 200, {
          "set-cookie": cookieHeader(null, secure),
        });

      // ------------------------------- admin only -------------------------------
      if (!admin) return json({ error: "unauthorized" }, 401);

      if (rest.length === 0 && method === "GET") {
        const all = await opts.store.list();
        return json({
          creators: all
            .map(toPublic)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        });
      }

      const id = rest[0];
      if (!id) return json({ error: "not-found" }, 404);
      const all = await opts.store.list();
      const rec = all.find((c) => c.id === id);
      if (!rec) return json({ error: "not-found" }, 404);

      if (rest.length === 1 && method === "DELETE") {
        await opts.store.remove(id);
        return json({ ok: true });
      }

      const action = rest[1];
      if (rest.length === 2 && method === "POST") {
        if (action === "approve" || action === "reset") {
          if (action === "reset" && rec.status !== "approved")
            return json({ error: "bad-state" }, 409);
          if (action === "approve" && rec.status === "approved")
            return json({ error: "bad-state" }, 409);
          const username =
            rec.username || (await uniqueUsername(rec.name, all));
          const password = newPassword();
          const next: CreatorRecord = {
            ...rec,
            status: "approved",
            decidedAt: iso(),
            username,
            passwordHash: hashPassword(password),
          };
          await opts.store.upsert(next);
          fails.delete(username);
          return json({
            creator: toPublic(next),
            credentials: { username, password },
          });
        }
        if (action === "reject" || action === "revoke") {
          const from = action === "reject" ? "pending" : "approved";
          if (rec.status !== from) return json({ error: "bad-state" }, 409);
          const next: CreatorRecord = {
            ...rec,
            status: action === "reject" ? "rejected" : "revoked",
            decidedAt: iso(),
            passwordHash: "",
          };
          await opts.store.upsert(next);
          return json({ creator: toPublic(next) });
        }
      }
      return json({ error: "not-found" }, 404);
    } catch {
      return json({ error: "bad-request" }, 400);
    }
  }

  return { handle, creatorOf, enabled: opts.token !== null };
}
