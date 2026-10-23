// src/server/guard.ts
// Global per-IP guard in front of every handler: generous enough that real use never notices,
// tight enough that a script hammering writes or the public pages gets 429 instead of the
// database. Specific endpoints (login, unlock, room join, import, bulk) keep their own,
// stricter limits.
import { clientIp } from "./client-ip";
import { createLimiter, guardClass, type Limiter } from "./rate-limit";

export interface GuardOptions {
  writesPerMinute?: number;
  pagesPerMinute?: number;
  now?: () => number;
  ip?: (req: Request) => string;
}

export function createGuard(opts: GuardOptions = {}) {
  const base = { windowMs: 60_000, ...(opts.now ? { now: opts.now } : {}) };
  const writes: Limiter = createLimiter({
    ...base,
    max: opts.writesPerMinute ?? 120,
  });
  const pages: Limiter = createLimiter({
    ...base,
    max: opts.pagesPerMinute ?? 600,
  });
  const ipOf = opts.ip ?? clientIp;

  return function guard(req: Request): Response | null {
    const cls = guardClass(req.method, new URL(req.url).pathname);
    if (!cls) return null;
    const r = (cls === "write" ? writes : pages).hit(ipOf(req));
    if (r.ok) return null;
    return new Response(JSON.stringify({ error: "rate-limited" }), {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(r.retryAfter),
        "cache-control": "no-store",
      },
    });
  };
}
