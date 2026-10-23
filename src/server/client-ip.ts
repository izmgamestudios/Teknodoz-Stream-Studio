// src/server/client-ip.ts
// The one place that decides "who is calling". The first X-Forwarded-For entry is whatever the
// client typed, so it can never key a rate limit or a lock-out: a proxy APPENDS the address it
// saw, which makes the LAST entry the trustworthy one. Behind Cloudflare set
// TRUSTED_IP_HEADER=cf-connecting-ip (only do that when the origin accepts Cloudflare traffic only).
export function clientIp(
  req: Request,
  trustedHeader: string | undefined = typeof process !== "undefined"
    ? process.env["TRUSTED_IP_HEADER"]
    : undefined,
): string {
  const trusted = trustedHeader?.trim().toLowerCase();
  if (trusted) {
    const v = req.headers.get(trusted)?.split(",")[0]?.trim();
    if (v) return v.slice(0, 64);
  }
  const fwd = req.headers.get("x-forwarded-for");
  const last = fwd?.split(",").pop()?.trim();
  return (last || req.headers.get("x-real-ip")?.trim() || "unknown").slice(
    0,
    64,
  );
}
