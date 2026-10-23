// src/server/session.test.ts
import { describe, expect, it } from "vitest";

import {
  isAdminRequest,
  parseCookies,
  SESSION_COOKIE,
  sessionCookie,
  signSession,
  verifySession,
} from "./auth";
import { createCatalogApi, memoryStore } from "./catalog";
import { createSessionApi } from "./session";

const TOKEN = "t".repeat(20);
const NOW = 1_800_000_000_000;

const cookieOf = (res: Response): string =>
  /tkz_admin=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";

describe("session signing", () => {
  it("verifies its own signature, rejects tampering, expiry and other tokens", () => {
    const v = signSession(TOKEN, NOW + 1000);
    expect(verifySession(TOKEN, v, NOW)).toBe(true);
    expect(verifySession(TOKEN, v, NOW + 2000)).toBe(false); // expired
    expect(verifySession("x".repeat(20), v, NOW)).toBe(false); // token changed -> all sessions die
    const [exp, nonce, sig] = v.split(".");
    expect(
      verifySession(TOKEN, `${Number(exp) + 99999}.${nonce}.${sig}`, NOW),
    ).toBe(false);
    expect(verifySession(TOKEN, `${exp}.${nonce}.AAAA`, NOW)).toBe(false);
    expect(verifySession(TOKEN, "garbage", NOW)).toBe(false);
  });

  it("builds a hardened cookie", () => {
    const c = sessionCookie("abc", true);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Secure");
    expect(c).toContain("Path=/");
    expect(sessionCookie(null, false)).toContain("Max-Age=0");
    expect(sessionCookie("abc", false)).not.toContain("Secure");
    expect(parseCookies("a=1; tkz_admin=x.y.z; b=2")[SESSION_COOKIE]).toBe(
      "x.y.z",
    );
  });
});

describe("session api", () => {
  const api = createSessionApi({ token: TOKEN, now: () => NOW });
  const call = (
    method: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    api.handle(
      new Request("https://studio.test/api/session", {
        method,
        headers: { "x-forwarded-for": "1.2.3.4", ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    ) as Promise<Response>;

  it("a rotating client-typed X-Forwarded-For does not reset the login lock-out", async () => {
    const fresh = createSessionApi({ token: TOKEN, now: () => NOW });
    let last = 0;
    for (let i = 0; i < 40; i++) {
      const r = (await fresh.handle(
        new Request("https://studio.test/api/session", {
          method: "POST",
          headers: { "x-forwarded-for": `9.9.9.${i}, 10.0.0.7` },
          body: JSON.stringify({ token: `wrong-${i}` }),
        }),
      )) as Response;
      last = r.status;
    }
    expect(last).toBe(429);
  });

  it("ignores other paths", async () => {
    expect(await api.handle(new Request("https://x/api/catalog"))).toBeNull();
  });

  it("rejects a wrong token, accepts the right one and sets an HttpOnly cookie", async () => {
    expect((await call("POST", { token: "nope" })).status).toBe(401);
    const ok = await call("POST", { token: TOKEN });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(ok.headers.get("set-cookie")).toMatch(/Secure/);
    const cookie = `${SESSION_COOKIE}=${cookieOf(ok)}`;
    expect(await (await call("GET", undefined, { cookie })).json()).toEqual({
      admin: true,
      enabled: true,
    });
    expect(await (await call("GET")).json()).toEqual({
      admin: false,
      enabled: true,
    });
    expect((await call("DELETE")).headers.get("set-cookie")).toContain(
      "Max-Age=0",
    );
  });

  it("rate limits login attempts", async () => {
    const limited = createSessionApi({ token: TOKEN, now: () => NOW });
    let last = 0;
    for (let i = 0; i < 12; i++)
      last = (await limited.handle(
        new Request("https://x/api/session", {
          method: "POST",
          headers: { "x-forwarded-for": "9.9.9.9" },
          body: JSON.stringify({ token: "bad" }),
        }),
      ))!.status;
    expect(last).toBe(429);
  });

  it("is disabled without a configured token", async () => {
    const off = createSessionApi({ token: null });
    const r = await off.handle(
      new Request("https://x/api/session", {
        method: "POST",
        body: JSON.stringify({ token: "x" }),
      }),
    );
    expect(r!.status).toBe(503);
    expect(
      await (await off.handle(new Request("https://x/api/session")))!.json(),
    ).toEqual({ admin: false, enabled: false });
  });
});

describe("isAdminRequest", () => {
  const session = `${SESSION_COOKIE}=${signSession(TOKEN, Date.now() + 60_000)}`;
  const req = (method: string, headers: Record<string, string>) =>
    new Request("https://studio.test/api/catalog/item", { method, headers });

  it("accepts a Bearer token or a valid cookie, nothing else", () => {
    expect(
      isAdminRequest(req("GET", { authorization: `Bearer ${TOKEN}` }), TOKEN),
    ).toBe(true);
    expect(
      isAdminRequest(req("GET", { authorization: "Bearer wrong" }), TOKEN),
    ).toBe(false);
    expect(isAdminRequest(req("GET", { cookie: session }), TOKEN)).toBe(true);
    expect(
      isAdminRequest(
        req("GET", { cookie: `${SESSION_COOKIE}=forged.value.here` }),
        TOKEN,
      ),
    ).toBe(false);
    expect(isAdminRequest(req("GET", {}), TOKEN)).toBe(false);
    expect(isAdminRequest(req("GET", { cookie: session }), null)).toBe(false);
  });

  it("cookie-authenticated writes must be same-origin (CSRF)", () => {
    expect(
      isAdminRequest(
        req("PUT", {
          cookie: session,
          origin: "https://studio.test",
          host: "studio.test",
        }),
        TOKEN,
      ),
    ).toBe(true);
    expect(isAdminRequest(req("PUT", { cookie: session }), TOKEN)).toBe(true); // no Origin: non-browser
    expect(
      isAdminRequest(
        req("PUT", {
          cookie: session,
          origin: "https://evil.example",
          host: "studio.test",
        }),
        TOKEN,
      ),
    ).toBe(false);
    expect(
      isAdminRequest(
        req("DELETE", { cookie: session, origin: "null", host: "studio.test" }),
        TOKEN,
      ),
    ).toBe(false);
    // a cross-site GET cannot change anything, Bearer is not affected by Origin
    expect(
      isAdminRequest(
        req("PUT", {
          authorization: `Bearer ${TOKEN}`,
          origin: "https://evil.example",
        }),
        TOKEN,
      ),
    ).toBe(true);
  });

  it("protects the catalog API through the cookie", async () => {
    const catalog = createCatalogApi({ token: TOKEN, store: memoryStore() });
    const put = (headers: Record<string, string>) =>
      catalog.handle(
        new Request("https://studio.test/api/catalog/item", {
          method: "PUT",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({
            title: "x",
            source: { kind: "youtube", id: "dQw4w9WgXcQ" },
          }),
        }),
      );
    expect((await put({}))!.status).toBe(401);
    expect((await put({ cookie: session }))!.status).toBe(201);
  });
});
