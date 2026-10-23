// src/server/rate-limit.ts
// Fixed-window per-key counter used by the global guard in server.ts. In-process on purpose
// (one Node process); the key space is bounded so a flood of random keys cannot eat memory.
export interface Limiter {
  /** counts one hit; `retryAfter` (seconds) is set when the key is over its limit */
  hit(key: string): { ok: boolean; retryAfter: number };
}

export function createLimiter(opts: {
  max: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}): Limiter {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 20_000;
  const windows = new Map<string, { start: number; count: number }>();

  function prune(t: number): void {
    for (const [k, w] of windows)
      if (t - w.start >= opts.windowMs) windows.delete(k);
    // still full of live windows: drop the oldest half rather than refusing everybody
    if (windows.size >= maxKeys) {
      let i = 0;
      for (const k of windows.keys()) {
        windows.delete(k);
        if (++i >= maxKeys / 2) break;
      }
    }
  }

  return {
    hit(key) {
      const t = now();
      let w = windows.get(key);
      if (!w || t - w.start >= opts.windowMs) {
        if (windows.size >= maxKeys) prune(t);
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      w.count++;
      if (w.count <= opts.max) return { ok: true, retryAfter: 0 };
      return {
        ok: false,
        retryAfter: Math.max(
          1,
          Math.ceil((w.start + opts.windowMs - t) / 1000),
        ),
      };
    },
  };
}

/** Routes the global guard leaves alone: they stream a lot or have their own, tighter limits. */
export function guardClass(
  method: string,
  pathname: string,
): "write" | "page" | null {
  if (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/media/") ||
    pathname.startsWith("/api/listen") || // chunk uploads: one per second by design
    pathname.startsWith("/listen/") ||
    pathname.startsWith("/api/rooms") ||
    pathname.startsWith("/api/live") ||
    pathname === "/api/session" // own, stricter lock-out
  )
    return null;
  const m = method.toUpperCase();
  if (pathname.startsWith("/api/") && m !== "GET" && m !== "HEAD")
    return "write";
  if (
    (m === "GET" || m === "HEAD") &&
    (pathname.startsWith("/library") ||
      pathname.startsWith("/docs") ||
      pathname.startsWith("/embed") ||
      pathname.startsWith("/sitemap") ||
      pathname.startsWith("/api/"))
  )
    return "page";
  return null;
}
