import { describe, expect, it } from "vitest";

import { clientIp } from "./client-ip";
import { createGuard } from "./guard";
import { createLimiter, guardClass } from "./rate-limit";
import { withSecurityHeaders } from "./security-headers";

const req = (path: string, init: RequestInit = {}) =>
  new Request(`http://x.test${path}`, init);

describe("clientIp", () => {
  it("uses the LAST forwarded entry (the proxy's), never what the client typed first", () => {
    const r = req("/", {
      headers: { "x-forwarded-for": "6.6.6.6, 7.7.7.7, 10.0.0.2" },
    });
    expect(clientIp(r, undefined)).toBe("10.0.0.2");
  });
  it("prefers a trusted header when configured", () => {
    const r = req("/", {
      headers: { "cf-connecting-ip": "5.5.5.5", "x-forwarded-for": "1.1.1.1" },
    });
    expect(clientIp(r, "CF-Connecting-IP")).toBe("5.5.5.5");
    expect(clientIp(r, undefined)).toBe("1.1.1.1");
  });
  it("falls back to x-real-ip, then unknown", () => {
    expect(
      clientIp(req("/", { headers: { "x-real-ip": "3.3.3.3" } }), undefined),
    ).toBe("3.3.3.3");
    expect(clientIp(req("/"), undefined)).toBe("unknown");
  });
});

describe("limiter", () => {
  it("allows max hits per window, then reports retry-after, then resets", () => {
    let t = 0;
    const l = createLimiter({ max: 2, windowMs: 1000, now: () => t });
    expect(l.hit("a").ok).toBe(true);
    expect(l.hit("a").ok).toBe(true);
    const over = l.hit("a");
    expect(over.ok).toBe(false);
    expect(over.retryAfter).toBe(1);
    expect(l.hit("b").ok).toBe(true);
    t = 1001;
    expect(l.hit("a").ok).toBe(true);
  });
  it("keeps memory bounded under a flood of keys", () => {
    const l = createLimiter({ max: 1, windowMs: 60_000, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) l.hit(`k${i}`);
    expect(l.hit("fresh").ok).toBe(true);
  });
});

describe("guard", () => {
  it("classifies routes", () => {
    expect(guardClass("POST", "/api/content")).toBe("write");
    expect(guardClass("GET", "/library/videos")).toBe("page");
    expect(guardClass("GET", "/media/a.mp4")).toBeNull();
    expect(guardClass("GET", "/assets/x.js")).toBeNull();
    expect(guardClass("POST", "/api/rooms")).toBeNull();
    expect(guardClass("POST", "/api/session")).toBeNull();
    expect(guardClass("GET", "/studio")).toBeNull();
  });
  it("answers 429 with retry-after once an IP is over its write budget", async () => {
    const g = createGuard({ writesPerMinute: 3, ip: () => "9.9.9.9" });
    for (let i = 0; i < 3; i++)
      expect(g(req("/api/content", { method: "POST" }))).toBeNull();
    const res = g(req("/api/content", { method: "POST" }));
    expect(res?.status).toBe(429);
    expect(res?.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(res?.headers.get("cache-control")).toBe("no-store");
    expect(await res?.json()).toEqual({ error: "rate-limited" });
  });
  it("does not let a spoofed first X-Forwarded-For entry dodge the limit", () => {
    const g = createGuard({ writesPerMinute: 2 });
    const hit = (spoof: string) =>
      g(
        req("/api/catalog/bulk", {
          method: "POST",
          headers: { "x-forwarded-for": `${spoof}, 10.1.1.1` },
        }),
      );
    expect(hit("1.1.1.1")).toBeNull();
    expect(hit("2.2.2.2")).toBeNull();
    expect(hit("3.3.3.3")?.status).toBe(429);
  });
});

describe("security headers", () => {
  const html = () =>
    new Response("<p>x</p>", { headers: { "content-type": "text/html" } });
  it("adds nosniff, referrer, permissions and an app CSP to HTML", () => {
    const r = withSecurityHeaders(req("/studio"), html());
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBeTruthy();
    expect(r.headers.get("permissions-policy")).toContain("microphone=(self)");
    expect(r.headers.get("content-security-policy")).toContain(
      "object-src 'none'",
    );
    expect(r.headers.get("strict-transport-security")).toBeNull();
  });
  it("adds HSTS behind an https proxy", () => {
    const r = withSecurityHeaders(
      req("/", { headers: { "x-forwarded-proto": "https" } }),
      html(),
    );
    expect(r.headers.get("strict-transport-security")).toContain("max-age=");
  });
  it("never overrides a handler's own CSP and leaves JSON without a CSP", () => {
    const own = new Response("x", {
      headers: {
        "content-type": "text/html",
        "content-security-policy": "default-src 'none'",
      },
    });
    expect(
      withSecurityHeaders(req("/"), own).headers.get("content-security-policy"),
    ).toBe("default-src 'none'");
    const json = withSecurityHeaders(
      req("/api/x"),
      new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    expect(json.headers.get("content-security-policy")).toBeNull();
    expect(json.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
