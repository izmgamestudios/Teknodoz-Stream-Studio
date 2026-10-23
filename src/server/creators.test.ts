import { describe, expect, it } from "vitest";

import { memoryStore } from "./catalog";
import {
  checkPassword,
  createCreatorsApi,
  hashPassword,
  newPassword,
  normalizeEmail,
  normalizePhone,
  signCreatorSession,
  usernameBase,
  verifyCreatorSession,
  type CreatorRecord,
} from "./creators";

const TOKEN = "admin-token-1234567890abcdef";
let NOW = 1_800_000_000_000;

function setup() {
  const store = memoryStore<CreatorRecord>();
  const api = createCreatorsApi({ token: TOKEN, store, now: () => NOW });
  let n = 0;
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    api.handle(
      new Request(`https://studio.test/api/creators${path}`, {
        method,
        headers: { "x-forwarded-for": `1.1.1.${++n % 200}`, ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    ) as Promise<Response>;
  const admin = { authorization: `Bearer ${TOKEN}` };
  return { api, store, call, admin };
}

describe("helpers", () => {
  it("normalises phones and e-mails", () => {
    expect(normalizePhone("0 (532) 111-22-33")).toBe("05321112233");
    expect(normalizePhone("+90 532 111 22 33")).toBe("+905321112233");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizeEmail(" Ayse@Example.COM ")).toBe("ayse@example.com");
    expect(normalizeEmail("nope")).toBeNull();
  });
  it("makes readable usernames and unambiguous passwords", () => {
    expect(usernameBase("Ayşe  Yılmaz Çelik")).toBe("ayse.celik");
    expect(usernameBase("İbrahim")).toBe("ibrahim");
    expect(usernameBase("***")).toBe("creator");
    expect(newPassword()).toMatch(
      /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/,
    );
  });
  it("hashes with scrypt and verifies", () => {
    const h = hashPassword("ABCD-EFGH-JKLM");
    expect(h).not.toContain("ABCD");
    expect(checkPassword("ABCD-EFGH-JKLM", h)).toBe(true);
    expect(checkPassword("ABCD-EFGH-JKLN", h)).toBe(false);
    expect(checkPassword("x", "garbage")).toBe(false);
  });
  it("signs sessions and rejects tampering and expiry", () => {
    const v = signCreatorSession(TOKEN, "abc", NOW + 1000);
    expect(verifyCreatorSession(TOKEN, v, NOW)).toBe("abc");
    expect(verifyCreatorSession(TOKEN, v, NOW + 2000)).toBeNull();
    expect(
      verifyCreatorSession(TOKEN, v.replace("abc", "abd"), NOW),
    ).toBeNull();
    expect(verifyCreatorSession("other-token-1234567890", v, NOW)).toBeNull();
  });
});

describe("apply", () => {
  it("needs a name and a phone OR an e-mail", async () => {
    const { call } = setup();
    expect((await call("/apply", "POST", { name: "Ayşe Yılmaz" })).status).toBe(
      400,
    );
    expect(
      (await (await call("/apply", "POST", { name: "Ayşe Yılmaz" })).json())
        .error,
    ).toBe("contact-required");
    expect(
      (await call("/apply", "POST", { name: "A", email: "a@b.co" })).status,
    ).toBe(400);
    expect(
      (await call("/apply", "POST", { name: "Ayşe Yılmaz", email: "bad" }))
        .status,
    ).toBe(400);
    expect(
      (await call("/apply", "POST", { name: "Ayşe Yılmaz", phone: "12" }))
        .status,
    ).toBe(400);
    expect(
      (
        await call("/apply", "POST", {
          name: "Ayşe Yılmaz",
          phone: "0532 111 22 33",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/apply", "POST", {
          name: "Ali Veli",
          email: "ali@example.com",
        })
      ).status,
    ).toBe(200);
  });
  it("stores a pending application, answers the same for duplicates and honeypots", async () => {
    const { call, store } = setup();
    await call("/apply", "POST", {
      name: "Ayşe Yılmaz",
      email: "ayse@example.com",
    });
    const dup = await call("/apply", "POST", {
      name: "Ayşe Y.",
      email: "AYSE@example.com",
    });
    expect(await dup.json()).toEqual({ ok: true });
    const bot = await call("/apply", "POST", {
      name: "Bot Bot",
      email: "bot@example.com",
      website: "http://spam",
    });
    expect(await bot.json()).toEqual({ ok: true });
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      status: "pending",
      username: "",
      passwordHash: "",
    });
  });
  it("rate-limits applications per IP", async () => {
    const { api } = setup();
    let last = 0;
    for (let i = 0; i < 7; i++)
      last = (await api.handle(
        new Request("https://studio.test/api/creators/apply", {
          method: "POST",
          headers: { "x-forwarded-for": "9.9.9.9" },
          body: JSON.stringify({
            name: "Kişi " + i,
            email: `k${i}@example.com`,
          }),
        }),
      ))!.status;
    expect(last).toBe(429);
  });
});

describe("approval and login", () => {
  async function approved() {
    const s = setup();
    await s.call("/apply", "POST", {
      name: "Ayşe Yılmaz",
      email: "ayse@example.com",
    });
    const id = (await s.store.list())[0]!.id;
    const res = await s.call(`/${id}/approve`, "POST", undefined, s.admin);
    const body = await res.json();
    return {
      ...s,
      id,
      creds: body.credentials as { username: string; password: string },
    };
  }

  it("only the administrator can list or decide", async () => {
    const { call, id } = await approved();
    expect((await call("")).status).toBe(401);
    expect((await call(`/${id}/revoke`, "POST")).status).toBe(401);
  });

  it("approve returns credentials once; the store only keeps a hash", async () => {
    const { store, creds } = await approved();
    expect(creds.username).toMatch(/^ayse\.yilmaz\d\d$/);
    expect(creds.password).toMatch(/^[A-Z2-9-]{14}$/);
    const rec = (await store.list())[0]!;
    expect(rec.status).toBe("approved");
    expect(JSON.stringify(rec)).not.toContain(creds.password);
  });

  it("lists applications without hashes", async () => {
    const { call, admin } = await approved();
    const list = await (await call("", "GET", undefined, admin)).json();
    expect(list.creators).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("passwordHash");
  });

  it("logs in with the credentials (case/space tolerant), sets an HttpOnly cookie, /me knows them", async () => {
    const { call, creds } = await approved();
    const res = await call("/login", "POST", {
      username: creds.username,
      password: ` ${creds.password.toLowerCase()} `,
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const me = await (
      await call("/me", "GET", undefined, { cookie: cookie.split(";")[0]! })
    ).json();
    expect(me).toMatchObject({
      enabled: true,
      admin: false,
      creator: { username: creds.username },
    });
    expect((await (await call("/me")).json()).creator).toBeNull();
  });

  it("rejects wrong passwords and unknown users with the same answer", async () => {
    const { call, creds } = await approved();
    const a = await call("/login", "POST", {
      username: creds.username,
      password: "WRONG-WRONG-WRONG",
    });
    const b = await call("/login", "POST", {
      username: "nobody",
      password: "WRONG-WRONG-WRONG",
    });
    expect(a.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
  });

  it("locks a username after repeated failures, even from rotating addresses", async () => {
    const { call, creds } = await approved();
    let status = 0;
    for (let i = 0; i < 6; i++)
      status = (
        await call("/login", "POST", {
          username: creds.username,
          password: "BAD",
        })
      ).status;
    expect(status).toBe(429);
    expect(
      (
        await call("/login", "POST", {
          username: creds.username,
          password: creds.password,
        })
      ).status,
    ).toBe(429);
    NOW += 16 * 60_000;
    expect(
      (
        await call("/login", "POST", {
          username: creds.username,
          password: creds.password,
        })
      ).status,
    ).toBe(200);
  });

  it("revoking ends an existing session at once; reset issues a new password", async () => {
    const { call, admin, id, creds } = await approved();
    const login = await call("/login", "POST", {
      username: creds.username,
      password: creds.password,
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const reset = await (
      await call(`/${id}/reset`, "POST", undefined, admin)
    ).json();
    expect(reset.credentials.password).not.toBe(creds.password);
    expect(
      (
        await call("/login", "POST", {
          username: creds.username,
          password: creds.password,
        })
      ).status,
    ).toBe(401);
    expect((await call(`/${id}/revoke`, "POST", undefined, admin)).status).toBe(
      200,
    );
    expect(
      (await (await call("/me", "GET", undefined, { cookie })).json()).creator,
    ).toBeNull();
    expect(
      (
        await call("/login", "POST", {
          username: creds.username,
          password: reset.credentials.password,
        })
      ).status,
    ).toBe(401);
  });

  it("state checks: no double approval, reject only pending, delete removes", async () => {
    const { call, admin, id, store } = await approved();
    expect(
      (await call(`/${id}/approve`, "POST", undefined, admin)).status,
    ).toBe(409);
    expect((await call(`/${id}/reject`, "POST", undefined, admin)).status).toBe(
      409,
    );
    expect((await call(`/${id}`, "DELETE", undefined, admin)).status).toBe(200);
    expect(await store.list()).toHaveLength(0);
  });

  it("is off without an admin token", async () => {
    const api = createCreatorsApi({
      token: null,
      store: memoryStore<CreatorRecord>(),
    });
    expect(
      (await api.handle(new Request("https://x/api/creators/me")))!.status,
    ).toBe(503);
    expect(await api.handle(new Request("https://x/api/other"))).toBeNull();
  });
});
