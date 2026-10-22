// src/server/auth.ts
// Admin authentication shared by every /api route that needs the administrator:
//   - `Authorization: Bearer <CATALOG_ADMIN_TOKEN>` (scripts, curl), or
//   - the signed `tkz_admin` session cookie created by POST /api/session (the web UI).
//
// The cookie is HttpOnly (scripts in the page can never read it), SameSite=Strict, Secure over
// https, expires after 12 hours and is signed with a key derived from the token: changing the
// token invalidates every session. State-changing requests that rely on the cookie must come from
// the same origin (CSRF defence in depth on top of SameSite).
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE = "tkz_admin";
export const SESSION_MAX_AGE_S = 12 * 60 * 60;
export const LOGIN_ATTEMPTS = { max: 10, windowMs: 10 * 60_000 } as const;

const sha = (s: string): Buffer => createHash("sha256").update(s).digest();

/** Constant-time string comparison (hashes first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha(a), sha(b));
}

function sessionKey(token: string): Buffer {
  return sha(`tkz-session-v1:${token}`);
}

export function signSession(token: string, expiresAtMs: number): string {
  const body = `${expiresAtMs}.${randomBytes(9).toString("base64url")}`;
  const sig = createHmac("sha256", sessionKey(token))
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(
  token: string,
  value: string,
  nowMs: number,
): boolean {
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts as [string, string, string];
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs <= nowMs) return false;
  const want = createHmac("sha256", sessionKey(token))
    .update(`${exp}.${nonce}`)
    .digest("base64url");
  return safeEqual(sig, want);
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** `value = null` clears the cookie. */
export function sessionCookie(value: string | null, secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE}=${value ?? ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${value === null ? 0 : SESSION_MAX_AGE_S}`,
    ...(secure ? ["Secure"] : []),
  ];
  return attrs.join("; ");
}

export function isSecureRequest(req: Request): boolean {
  return (
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ||
    new URL(req.url).protocol === "https:"
  );
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients and same-origin GETs carry none
  try {
    const host = req.headers.get("host") ?? new URL(req.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Is this request made by the administrator (Bearer token or valid session cookie)? */
export function isAdminRequest(
  req: Request,
  token: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!token) return false;
  const bearer = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  if (bearer) return safeEqual(bearer[1] as string, token);
  const cookie = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (!cookie || !verifySession(token, cookie, nowMs)) return false;
  return SAFE_METHODS.has(req.method.toUpperCase()) || sameOrigin(req);
}
