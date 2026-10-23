/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRoomsApi, LIMITS, type RoomsApi } from "./rooms";

const BASE = "http://studio.test";
const CODE = "TKZ1.AAAA_bbbb-1234";
let clock = 1_000_000;
let api: RoomsApi;

beforeEach(() => {
  clock = 1_000_000;
  vi.useFakeTimers();
  api = createRoomsApi({ now: () => clock });
});
afterEach(() => {
  api.dispose();
  vi.useRealTimers();
});

interface Opts {
  method?: string;
  body?: unknown;
  host?: string;
  guest?: string;
  ip?: string;
  raw?: string;
  signal?: AbortSignal;
}
async function call(path: string, o: Opts = {}) {
  const headers: Record<string, string> = {};
  if (o.host) headers["authorization"] = `Bearer ${o.host}`;
  if (o.guest) headers["x-guest-token"] = o.guest;
  if (o.ip) headers["x-forwarded-for"] = o.ip;
  const init: RequestInit = { method: o.method ?? "GET", headers };
  if (o.raw !== undefined) init.body = o.raw;
  else if (o.body !== undefined) init.body = JSON.stringify(o.body);
  if (o.signal) init.signal = o.signal;
  const res = await api.handle(new Request(`${BASE}${path}`, init));
  if (!res)
    return {
      status: -1,
      data: null as unknown as Record<string, any>,
      res: null,
    };
  return {
    status: res.status,
    data: (await res.json()) as Record<string, any>,
    res,
  };
}

async function makeRoom(ip = "1.1.1.1") {
  const r = await call("/api/room", { method: "POST", ip });
  return {
    code: r.data["code"] as string,
    host: r.data["hostToken"] as string,
  };
}
async function makeGuest(
  code: string,
  role = "guest",
  name = "Ayşe",
  ip = "2.2.2.2",
) {
  const r = await call(`/api/room/${code}/join`, {
    method: "POST",
    body: { name, role },
    ip,
  });
  return {
    status: r.status,
    id: r.data["guestId"] as string,
    token: r.data["guestToken"] as string,
    data: r.data,
  };
}

describe("routing", () => {
  it("ignores paths outside /api/room", async () => {
    expect(await api.handle(new Request(`${BASE}/studio`))).toBeNull();
    expect(await api.handle(new Request(`${BASE}/api/roomx`))).toBeNull();
  });
  it("health works and unknown routes are 404/405", async () => {
    expect((await call("/api/room/health")).data["ok"]).toBe(true);
    expect((await call("/api/room", { method: "GET" })).status).toBe(405);
    expect((await call("/api/room/ZZZZZZ")).status).toBe(404);
    expect((await call("/api/room/not-a-code")).status).toBe(404);
  });
});

describe("room lifecycle", () => {
  it("creates a 6-char unambiguous code and a secret host token", async () => {
    const { code, host } = await makeRoom();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(host.length).toBeGreaterThan(20);
    const info = await call(`/api/room/${code}`);
    expect(info.data).toMatchObject({
      exists: true,
      open: true,
      hostOnline: true,
    });
    // codes are case-insensitive
    expect((await call(`/api/room/${code.toLowerCase()}`)).status).toBe(200);
  });

  it("host presence times out", async () => {
    const { code } = await makeRoom();
    clock += LIMITS.hostOnlineMs + 1;
    expect((await call(`/api/room/${code}`)).data["hostOnline"]).toBe(false);
  });

  it("only the host can close; guests then see a closed event and cannot join", async () => {
    const { code, host } = await makeRoom();
    const g = await makeGuest(code);
    expect((await call(`/api/room/${code}`, { method: "DELETE" })).status).toBe(
      403,
    );
    expect(
      (
        await call(`/api/room/${code}`, {
          method: "DELETE",
          host: "x".repeat(24),
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(`/api/room/${code}`, { method: "DELETE", host })).status,
    ).toBe(200);
    const ev = await call(`/api/room/${code}/guest/${g.id}/events?wait=0`, {
      guest: g.token,
    });
    expect(ev.data["events"][0].type).toBe("closed");
    expect(ev.data["closed"]).toBe(true);
    expect((await makeGuest(code)).status).toBe(410);
  });
});

describe("podcast seats (audio flag)", () => {
  async function joinAudio(
    code: string,
    role: string,
    audio: unknown,
    ip: string,
  ) {
    return call(`/api/room/${code}/join`, {
      method: "POST",
      body: { name: "Ayşe", role, audio },
      ip,
    });
  }

  it("carries audio=true for guest / viewer through the join event, and ignores it elsewhere", async () => {
    const { code, host } = await makeRoom();
    const g = await joinAudio(code, "guest", true, "3.3.3.1");
    const v = await joinAudio(code, "viewer", true, "3.3.3.2");
    const r = await joinAudio(code, "remote", true, "3.3.3.3");
    const plain = await joinAudio(code, "guest", false, "3.3.3.4");
    expect(g.data).toMatchObject({ audio: true });
    expect(v.data).toMatchObject({ audio: true });
    expect(r.data["audio"]).toBeUndefined();
    expect(plain.data["audio"]).toBeUndefined();
    const ev = await call(`/api/room/${code}/host/events?since=0&wait=0`, {
      host,
    });
    const events = ev.data["events"] as { role: string; audio?: boolean }[];
    expect(events.map((e) => [e.role, e.audio ?? false])).toEqual([
      ["guest", true],
      ["viewer", true],
      ["remote", false],
      ["guest", false],
    ]);
  });

  it("rejects a non-boolean audio flag", async () => {
    const { code } = await makeRoom();
    expect((await joinAudio(code, "guest", "yes", "3.3.3.9")).status).toBe(400);
  });
});

describe("join → approve → connect flow", () => {
  it("delivers the whole handshake without any client polling delay", async () => {
    const { code, host } = await makeRoom();
    const g = await makeGuest(code, "remote", "Telefon");
    expect(g.status).toBe(201);

    // host sees the request in the waiting pool
    const e1 = await call(`/api/room/${code}/host/events?since=0&wait=0`, {
      host,
    });
    expect(e1.data["events"]).toHaveLength(1);
    expect(e1.data["events"][0]).toMatchObject({
      type: "join",
      guestId: g.id,
      name: "Telefon",
      role: "remote",
    });

    // host approves by sending its offer; the guest receives it
    const off = await call(`/api/room/${code}/host/offer`, {
      method: "POST",
      host,
      body: { guestId: g.id, offer: CODE },
    });
    expect(off.status).toBe(200);
    const e2 = await call(`/api/room/${code}/guest/${g.id}/events?wait=0`, {
      guest: g.token,
    });
    expect(e2.data["events"][0]).toMatchObject({ type: "offer", offer: CODE });

    // guest answers; host receives the answer
    const ans = await call(`/api/room/${code}/guest/${g.id}/answer`, {
      method: "POST",
      guest: g.token,
      body: { answer: CODE },
    });
    expect(ans.status).toBe(200);
    const e3 = await call(
      `/api/room/${code}/host/events?since=${e1.data["next"]}&wait=0`,
      { host },
    );
    expect(e3.data["events"][0]).toMatchObject({
      type: "answer",
      guestId: g.id,
      answer: CODE,
    });
  });

  it("long-poll wakes as soon as an event arrives", async () => {
    const { code, host } = await makeRoom();
    const pending = call(`/api/room/${code}/host/events?since=0&wait=20`, {
      host,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await makeGuest(code);
    const r = await pending;
    expect(r.data["events"]).toHaveLength(1);
  });

  it("long-poll returns empty after the wait elapses and never exceeds the cap", async () => {
    const { code, host } = await makeRoom();
    const pending = call(`/api/room/${code}/host/events?since=0&wait=999`, {
      host,
    });
    await vi.advanceTimersByTimeAsync(LIMITS.maxWaitMs + 100);
    const r = await pending;
    expect(r.data["events"]).toEqual([]);
  });

  it("aborting the request releases the waiter", async () => {
    const { code, host } = await makeRoom();
    const ac = new AbortController();
    const pending = call(`/api/room/${code}/host/events?since=0&wait=20`, {
      host,
      signal: ac.signal,
    });
    await vi.advanceTimersByTimeAsync(10);
    ac.abort();
    await vi.advanceTimersByTimeAsync(10);
    const r = await pending;
    expect(r.data["events"]).toEqual([]);
  });

  it("reject notifies the guest; offer to a rejected guest is a conflict", async () => {
    const { code, host } = await makeRoom();
    const g = await makeGuest(code);
    await call(`/api/room/${code}/host/reject`, {
      method: "POST",
      host,
      body: { guestId: g.id },
    });
    const e = await call(`/api/room/${code}/guest/${g.id}/events?wait=0`, {
      guest: g.token,
    });
    expect(e.data["events"][0].type).toBe("rejected");
    const off = await call(`/api/room/${code}/host/offer`, {
      method: "POST",
      host,
      body: { guestId: g.id, offer: CODE },
    });
    expect(off.status).toBe(409);
  });

  it("guest leave removes it from the pool and tells the host", async () => {
    const { code, host } = await makeRoom();
    const g = await makeGuest(code);
    // via body token, like navigator.sendBeacon
    const r = await call(`/api/room/${code}/guest/${g.id}/leave`, {
      method: "POST",
      body: { token: g.token },
    });
    expect(r.status).toBe(200);
    const e = await call(`/api/room/${code}/host/events?since=1&wait=0`, {
      host,
    });
    expect(e.data["events"][0]).toMatchObject({
      type: "leave",
      guestId: g.id,
      reason: "left",
    });
  });

  it("stale waiting guests are swept and reported", async () => {
    const { code, host } = await makeRoom();
    const g = await makeGuest(code);
    clock += LIMITS.guestStaleMs + LIMITS.sweepEveryMs + 1;
    await call(`/api/room/${code}/host/events?since=0&wait=0`, { host }); // triggers the sweep
    const e = await call(`/api/room/${code}/host/events?since=1&wait=0`, {
      host,
    });
    expect(e.data["events"][0]).toMatchObject({
      type: "leave",
      guestId: g.id,
      reason: "stale",
    });
  });

  it("idle rooms expire", async () => {
    const { code } = await makeRoom();
    clock += LIMITS.roomIdleMs + LIMITS.sweepEveryMs + 1;
    expect((await call(`/api/room/${code}`)).status).toBe(404);
    expect(api.stats().rooms).toBe(0);
  });
});

describe("authorization", () => {
  it("rejects missing/wrong tokens", async () => {
    const { code, host } = await makeRoom();
    const g = await makeGuest(code);
    expect((await call(`/api/room/${code}/host/events`)).status).toBe(403);
    expect(
      (await call(`/api/room/${code}/host/events`, { host: host + "x" }))
        .status,
    ).toBe(403);
    expect((await call(`/api/room/${code}/guest/${g.id}/events`)).status).toBe(
      403,
    );
    expect(
      (await call(`/api/room/${code}/guest/${g.id}/events`, { guest: host }))
        .status,
    ).toBe(403);
    // a guest token cannot act as host
    expect(
      (await call(`/api/room/${code}/host/events`, { host: g.token })).status,
    ).toBe(403);
    // one room's host token does not work on another room
    const other = await makeRoom("9.9.9.9");
    expect(
      (await call(`/api/room/${other.code}/host/events`, { host })).status,
    ).toBe(403);
  });
  it("a guest cannot read another guest's events", async () => {
    const { code } = await makeRoom();
    const a = await makeGuest(code, "guest", "A", "3.3.3.3");
    const b = await makeGuest(code, "guest", "B", "4.4.4.4");
    expect(
      (
        await call(`/api/room/${code}/guest/${a.id}/events?wait=0`, {
          guest: b.token,
        })
      ).status,
    ).toBe(403);
  });
});

describe("input validation & limits", () => {
  it("sanitizes names, falls back to a default and validates roles", async () => {
    const { code } = await makeRoom();
    const dirty =
      `  ${String.fromCharCode(0)}Ay${String.fromCharCode(0x200b)}şe\n  Yılmaz  `.padEnd(
        300,
        "x",
      );
    const g = await makeGuest(code, "viewer", dirty);
    const name = g.data["name"] as string;
    expect(name.length).toBeLessThanOrEqual(LIMITS.nameChars);
    expect(
      [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 0x200b),
    ).toBe(false);
    expect(
      (await makeGuest(code, "viewer", "   ", "5.5.5.5")).data["name"],
    ).toBe("İzleyici");
    const bad = await call(`/api/room/${code}/join`, {
      method: "POST",
      body: { role: "admin" },
      ip: "6.6.6.6",
    });
    expect(bad.status).toBe(400);
  });

  it("rejects malformed json, oversized bodies and bad SDP codes", async () => {
    const { code, host } = await makeRoom();
    const g = await makeGuest(code);
    expect(
      (
        await call(`/api/room/${code}/join`, {
          method: "POST",
          raw: "{nope",
          ip: "7.7.7.7",
        })
      ).status,
    ).toBe(400);
    const big = await call(`/api/room/${code}/join`, {
      method: "POST",
      raw: JSON.stringify({ role: "guest", name: "x".repeat(20_000) }),
      ip: "7.7.7.8",
    });
    expect(big.status).toBe(413);
    for (const offer of [
      "hello",
      "TKZ1.<script>",
      "TKZ1." + "a".repeat(LIMITS.maxCodeChars + 1),
    ]) {
      const r = await call(`/api/room/${code}/host/offer`, {
        method: "POST",
        host,
        body: { guestId: g.id, offer },
      });
      expect(r.status).toBe(400);
    }
  });

  it("rate-limits room creation and joins per client IP (last x-forwarded-for entry)", async () => {
    for (let i = 0; i < LIMITS.createPerHour; i++)
      expect(
        (await call("/api/room", { method: "POST", ip: "8.8.8.8" })).status,
      ).toBe(201);
    expect(
      (await call("/api/room", { method: "POST", ip: "8.8.8.8" })).status,
    ).toBe(429);
    // spoofing the first entry does not help
    expect(
      (await call("/api/room", { method: "POST", ip: "1.2.3.4, 8.8.8.8" }))
        .status,
    ).toBe(429);
    // other IPs are unaffected, and the window resets
    expect(
      (await call("/api/room", { method: "POST", ip: "8.8.4.4" })).status,
    ).toBe(201);
    clock += 3_600_001;
    expect(
      (await call("/api/room", { method: "POST", ip: "8.8.8.8" })).status,
    ).toBe(201);
  });

  it("caps the waiting pool", async () => {
    const { code } = await makeRoom();
    for (let i = 0; i < LIMITS.maxWaitingPerRoom; i++) {
      // distinct IPs so the per-IP join limiter is not what stops us
      expect(
        (await makeGuest(code, "guest", `G${i}`, `10.0.0.${i}`)).status,
      ).toBe(201);
    }
    expect((await makeGuest(code, "guest", "late", "10.9.9.9")).status).toBe(
      429,
    );
  });

  it("answers are only accepted after an offer", async () => {
    const { code } = await makeRoom();
    const g = await makeGuest(code);
    const r = await call(`/api/room/${code}/guest/${g.id}/answer`, {
      method: "POST",
      guest: g.token,
      body: { answer: CODE },
    });
    expect(r.status).toBe(409);
  });

  it("sets no-store and nosniff on every response", async () => {
    const r = await call("/api/room/health");
    expect(r.res?.headers.get("cache-control")).toBe("no-store");
    expect(r.res?.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("public listing", () => {
  it("lists only rooms the host published, while the host is online", async () => {
    const a = await makeRoom("1.1.1.1");
    const b = await makeRoom("1.1.1.2");
    expect((await call("/api/room/public")).data["rooms"]).toEqual([]);

    const noAuth = await call(`/api/room/${a.code}/host/listing`, {
      method: "POST",
      body: { listing: { title: "Show", category: "Tech" } },
    });
    expect(noAuth.status).toBe(403);

    const ok = await call(`/api/room/${a.code}/host/listing`, {
      method: "POST",
      host: a.host,
      body: { listing: { title: "Show", category: "Tech" } },
    });
    expect(ok.status).toBe(200);
    await makeGuest(a.code, "viewer");
    await makeGuest(a.code, "guest");
    const list = (await call("/api/room/public")).data["rooms"];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      code: a.code,
      title: "Show",
      category: "Tech",
      viewers: 1,
    });
    expect(JSON.stringify(list)).not.toContain(a.host);
    expect(JSON.stringify(list)).not.toContain(b.code);

    clock += LIMITS.hostOnlineMs + 1;
    expect((await call("/api/room/public")).data["rooms"]).toEqual([]);
  });

  it("unlists with null", async () => {
    const a = await makeRoom();
    const set = (listing: unknown) =>
      call(`/api/room/${a.code}/host/listing`, {
        method: "POST",
        host: a.host,
        body: { listing },
      });
    await set({ title: "X", category: "" });
    expect((await call("/api/room/public")).data["rooms"]).toHaveLength(1);
    await set(null);
    expect((await call("/api/room/public")).data["rooms"]).toHaveLength(0);
  });
});
