// src/server/security-headers.ts
// Headers every response should carry. Handlers that set their own value (the SEO pages bring
// a hash-based CSP, the embed page its own frame-ancestors) are left alone: only missing
// headers are added.
const BASE: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "cross-origin-opener-policy": "same-origin-allow-popups",
  "x-permitted-cross-domain-policies": "none",
};

/**
 * `object-src`, `base-uri`, `form-action` and `frame-ancestors` are safe for the React app (it
 * needs inline scripts for hydration, so `script-src` stays open there; the public SEO pages
 * have a strict hash-based policy of their own).
 */
const APP_CSP =
  "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

export function withSecurityHeaders(req: Request, res: Response): Response {
  const url = new URL(req.url);
  const headers = new Headers(res.headers);
  let changed = false;
  const set = (k: string, v: string) => {
    if (!headers.has(k)) {
      headers.set(k, v);
      changed = true;
    }
  };
  for (const [k, v] of Object.entries(BASE)) set(k, v);
  const secure =
    url.protocol === "https:" ||
    req.headers.get("x-forwarded-proto")?.split(",").pop()?.trim() === "https";
  if (secure) set("strict-transport-security", "max-age=31536000");
  const type = headers.get("content-type") ?? "";
  if (type.startsWith("text/html")) set("content-security-policy", APP_CSP);
  if (!changed) return res;
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
