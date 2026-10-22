// src/server/session.ts
// Administrator login for the web UI.
//   GET    /api/session   { admin: boolean, enabled: boolean }
//   POST   /api/session   { token }  -> sets the signed HttpOnly session cookie
//   DELETE /api/session   -> clears it
import { z } from "zod";

import {
  isAdminRequest,
  isSecureRequest,
  LOGIN_ATTEMPTS,
  safeEqual,
  sessionCookie,
  signSession,
  SESSION_MAX_AGE_S,
} from "./auth";

export const SESSION_API_PATH = "/api/session";

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

export function createSessionApi(opts: {
  token: string | null;
  now?: () => number;
}) {
  const now = opts.now ?? Date.now;
  const attempts = new Map<string, number[]>();

  const ipOf = (req: Request): string =>
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";

  function tooMany(ip: string): boolean {
    const t = now();
    const recent = (attempts.get(ip) ?? []).filter(
      (x) => t - x < LOGIN_ATTEMPTS.windowMs,
    );
    recent.push(t);
    attempts.set(ip, recent);
    if (attempts.size > 5000) attempts.clear();
    return recent.length > LOGIN_ATTEMPTS.max;
  }

  async function handle(req: Request): Promise<Response | null> {
    if (new URL(req.url).pathname !== SESSION_API_PATH) return null;
    const method = req.method.toUpperCase();
    const secure = isSecureRequest(req);

    if (method === "GET") {
      return json({
        admin: isAdminRequest(req, opts.token, now()),
        enabled: opts.token !== null,
      });
    }
    if (method === "DELETE") {
      return json({ ok: true }, 200, {
        "set-cookie": sessionCookie(null, secure),
      });
    }
    if (method === "POST") {
      if (!opts.token) return json({ error: "admin-disabled" }, 503);
      const ip = ipOf(req);
      if (tooMany(ip)) return json({ error: "rate-limited" }, 429);
      let body: { token: string };
      try {
        const parsed = z
          .object({ token: z.string().min(1).max(500) })
          .safeParse(JSON.parse(await req.text()));
        if (!parsed.success) return json({ error: "bad-request" }, 400);
        body = parsed.data;
      } catch {
        return json({ error: "bad-request" }, 400);
      }
      if (!safeEqual(body.token, opts.token))
        return json({ error: "unauthorized" }, 401);
      attempts.delete(ip);
      const value = signSession(opts.token, now() + SESSION_MAX_AGE_S * 1000);
      return json({ admin: true }, 200, {
        "set-cookie": sessionCookie(value, secure),
      });
    }
    return json({ error: "method-not-allowed" }, 405);
  }

  return { handle };
}
