/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_LIMITS, ChatError, RoomChat, cleanLine } from "./room-chat";
import { createRoomsApi, type RoomsApi } from "./rooms";

let clock = 1_000_000;
beforeEach(() => {
  clock = 1_000_000;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const guest = (id = "g1", name = "Ayşe") => ({
  id,
  name,
  role: "guest" as const,
});
const mod = { kind: "moderator" } as const;
const part = (id: string) => ({ kind: "participant", id }) as const;
const tick = (ms = 2_000) => {
  clock += ms;
};

function newChat() {
  return new RoomChat(() => clock);
}

describe("cleanLine", () => {
  it("collapses whitespace, strips control/zero-width chars and caps length", () => {
    expect(cleanLine("  a\n\t b​c  ", 50)).toBe("a b c");
    expect(cleanLine("x".repeat(500), 280)).toHaveLength(280);
    expect(cleanLine("\u0000\u0007", 10)).toBe("");
  });
});

describe("RoomChat moderation", () => {
  it("holds participant messages until approved, then shows them to everyone", () => {
    const c = newChat();
    const m = c.post(guest("g1"), "Merhaba <b>dünya</b>");
    expect(m.status).toBe("pending");
    expect(m.text).toBe("Merhaba <b>dünya</b>"); // stored as text, never interpreted
    expect(c.view(0, mod)).toHaveLength(1);
    expect(c.view(0, part("g1"))).toHaveLength(1); // author sees own pending
    expect(c.view(0, part("g2"))).toHaveLength(0); // others do not
    expect(c.pendingCount()).toBe(1);

    const before = c.rev;
    c.moderate(m.id, "approve", "editor");
    expect(c.rev).toBeGreaterThan(before);
    expect(c.view(0, part("g2"))[0]?.text).toBe("Merhaba <b>dünya</b>");
    expect(c.pendingCount()).toBe(0);
    // incremental poll: nothing new after the latest revision
    expect(c.view(c.rev, part("g2"))).toHaveLength(0);
  });

  it("never leaks rejected content, but tells clients to drop a hidden one", () => {
    const c = newChat();
    const bad = c.post(guest("g1"), "spam");
    c.moderate(bad.id, "reject", "editor");
    expect(c.view(0, part("g2"))).toHaveLength(0);

    tick();
    const shown = c.post(guest("g1"), "ok");
    c.moderate(shown.id, "approve", "host");
    const seen = c.rev;
    c.moderate(shown.id, "reject", "editor");
    const upd = c.view(seen, part("g2"));
    expect(upd).toHaveLength(1);
    expect(upd[0]).toMatchObject({
      id: shown.id,
      status: "rejected",
      text: "",
    });
  });

  it("open mode auto-approves, off mode refuses participants but not moderators", () => {
    const c = newChat();
    c.setMode("open");
    expect(c.post(guest(), "hi").status).toBe("approved");
    c.setMode("off");
    tick();
    expect(() => c.post(guest(), "hi")).toThrow(ChatError);
    expect(
      c.post({ id: "editor", name: "Editör", role: "editor" }, "x").status,
    ).toBe("approved");
  });

  it("editors approve/reject/edit but only the director puts a message on air", () => {
    const c = newChat();
    const m = c.post(guest(), "soru");
    expect(() => c.moderate(m.id, "onair", "host")).toThrow(/bad-state/); // not approved yet
    c.moderate(m.id, "edit", "editor", "  düzeltilmiş   soru ");
    const edited = c.view(0, mod)[0];
    expect(edited).toMatchObject({ text: "düzeltilmiş soru", edited: true });
    c.moderate(m.id, "approve", "editor");
    expect(() => c.moderate(m.id, "onair", "editor")).toThrow(/forbidden/);
    c.moderate(m.id, "onair", "host");
    expect(c.onAir).toBe(m.id);
    expect(() => c.moderate(m.id, "edit", "editor", "   ")).toThrow(
      /bad-request/,
    );
    c.moderate(m.id, "reject", "editor"); // rejecting takes it off air
    expect(c.onAir).toBeNull();
    c.moderate(m.id, "approve", "host");
    c.moderate(m.id, "onair", "host");
    c.moderate(m.id, "offair", "host");
    expect(c.onAir).toBeNull();
    expect(() => c.moderate(999, "approve", "host")).toThrow(/not-found/);
  });

  it("rejects empty text and throttles floods", () => {
    const c = newChat();
    expect(() => c.post(guest(), " \n​ ")).toThrow(/bad-request/);
    c.post(guest("g1"), "1");
    expect(() => c.post(guest("g1"), "2")).toThrow(/rate-limited/); // < min gap
    tick();
    for (let i = 2; i <= CHAT_LIMITS.maxPendingPerAuthor; i++) {
      c.post(guest("g1"), String(i));
      tick();
    }
    expect(() => c.post(guest("g1"), "6")).toThrow(/rate-limited/); // pending cap
    // another participant is not affected
    expect(c.post(guest("g2"), "hey").status).toBe("pending");
  });

  it("caps the global queue and trims old non-pending messages", () => {
    const c = newChat();
    c.setMode("open");
    for (let i = 0; i < CHAT_LIMITS.keep + 20; i++) {
      c.post(guest(`g${i % 40}`), `m${i}`);
      tick(2_000);
    }
    expect(c.view(0, mod).length).toBeLessThanOrEqual(CHAT_LIMITS.keep);
    const q = newChat();
    for (let i = 0; i < CHAT_LIMITS.maxPending; i++) {
      q.post(guest(`p${i}`), "x");
    }
    expect(() => q.post(guest("late"), "x")).toThrow(/queue-full/);
  });
});

/* ------------------------------ HTTP level ------------------------------ */

const BASE = "http://studio.test";
const CODE = "TKZ1.AAAA_bbbb-1234";
let api: RoomsApi;

async function call(
  path: string,
  o: {
    method?: string;
    body?: unknown;
    bearer?: string;
    guest?: string;
    ip?: string;
    signal?: AbortSignal;
  } = {},
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": o.ip ?? "9.9.9.9",
  };
  if (o.bearer) headers["authorization"] = `Bearer ${o.bearer}`;
  if (o.guest) headers["x-guest-token"] = o.guest;
  const init: RequestInit = { method: o.method ?? "GET", headers };
  if (o.body !== undefined) init.body = JSON.stringify(o.body);
  if (o.signal) init.signal = o.signal;
  const res = await api.handle(new Request(`${BASE}${path}`, init));
  return {
    status: res?.status ?? -1,
    data: (res ? await res.json() : null) as Record<string, any>,
  };
}

async function setup() {
  api = createRoomsApi({ now: () => clock });
  const r = await call("/api/room", { method: "POST", ip: "1.1.1.1" });
  const code = r.data["code"] as string;
  const host = r.data["hostToken"] as string;
  const join = async (role = "guest", name = "Ayşe", approve = true) => {
    const j = await call(`/api/room/${code}/join`, {
      method: "POST",
      body: { name, role },
      ip: `3.3.3.${Math.floor(Math.random() * 200)}`,
    });
    const id = j.data["guestId"] as string;
    const token = j.data["guestToken"] as string;
    if (approve) {
      await call(`/api/room/${code}/host/offer`, {
        method: "POST",
        bearer: host,
        body: { guestId: id, offer: CODE },
      });
      await call(`/api/room/${code}/guest/${id}/answer`, {
        method: "POST",
        guest: token,
        body: { answer: CODE },
      });
    }
    return { id, token };
  };
  return { code, host, join };
}

describe("chat over HTTP", () => {
  afterEach(() => api?.dispose());

  it("only approved (connected) non-remote participants may chat", async () => {
    const { code, join } = await setup();
    const waiting = await join("guest", "Bekleyen", false);
    const r1 = await call(`/api/room/${code}/guest/${waiting.id}/chat`, {
      method: "POST",
      guest: waiting.token,
      body: { text: "hi" },
    });
    expect(r1.status).toBe(409);
    const remote = await join("remote", "Tel");
    const r2 = await call(`/api/room/${code}/guest/${remote.id}/chat`, {
      guest: remote.token,
    });
    expect(r2.status).toBe(403);
    const ok = await join("guest", "Ayşe");
    const bad = await call(`/api/room/${code}/guest/${ok.id}/chat`, {
      guest: "x".repeat(24),
    });
    expect(bad.status).toBe(403);
  });

  it("runs the full queue: post -> editor approves -> participants see -> director airs it", async () => {
    const { code, host, join } = await setup();
    const a = await join("guest", "Ayşe");
    const b = await join("viewer", "Burak");

    const ek = await call(`/api/room/${code}/host/editor`, {
      method: "POST",
      bearer: host,
    });
    const editor = ek.data["editorKey"] as string;
    expect(editor).toMatch(/^\S{10,100}$/);

    const posted = await call(`/api/room/${code}/guest/${a.id}/chat`, {
      method: "POST",
      guest: a.token,
      body: { text: "Fiyat ne kadar?" },
    });
    expect(posted.status).toBe(201);
    const id = posted.data["message"].id as number;
    expect(posted.data["message"].status).toBe("pending");

    // the other participant sees nothing yet; the editor sees the queue
    const seenB = await call(`/api/room/${code}/guest/${b.id}/chat?since=0`, {
      guest: b.token,
    });
    expect(seenB.data["messages"]).toEqual([]);
    const q = await call(`/api/room/${code}/chat?since=0`, { bearer: editor });
    expect(q.status).toBe(200);
    expect(q.data["as"]).toBe("editor");
    expect(q.data["pending"]).toBe(1);
    expect(q.data["messages"][0].text).toBe("Fiyat ne kadar?");

    const approve = await call(`/api/room/${code}/chat/${id}`, {
      method: "POST",
      bearer: editor,
      body: { action: "approve" },
    });
    expect(approve.status).toBe(200);
    const seenB2 = await call(
      `/api/room/${code}/guest/${b.id}/chat?since=${seenB.data["rev"]}`,
      { guest: b.token },
    );
    expect(seenB2.data["messages"][0]).toMatchObject({
      id,
      status: "approved",
    });

    // editor cannot air; the director can
    const denied = await call(`/api/room/${code}/chat/${id}`, {
      method: "POST",
      bearer: editor,
      body: { action: "onair" },
    });
    expect(denied.status).toBe(403);
    const air = await call(`/api/room/${code}/chat/${id}`, {
      method: "POST",
      bearer: host,
      body: { action: "onair" },
    });
    expect(air.data["onAir"]).toBe(id);
    const hostView = await call(`/api/room/${code}/chat?since=0`, {
      bearer: host,
    });
    expect(hostView.data["onAir"]).toBe(id);
    expect(hostView.data["as"]).toBe("host");
  });

  it("director controls the mode and rotates / revokes the editor key", async () => {
    const { code, host, join } = await setup();
    const a = await join();
    const k1 = (
      await call(`/api/room/${code}/host/editor`, {
        method: "POST",
        bearer: host,
      })
    ).data["editorKey"] as string;
    const k2 = (
      await call(`/api/room/${code}/host/editor`, {
        method: "POST",
        bearer: host,
      })
    ).data["editorKey"] as string;
    expect(k2).not.toBe(k1);
    expect((await call(`/api/room/${code}/chat`, { bearer: k1 })).status).toBe(
      403,
    );
    expect((await call(`/api/room/${code}/chat`, { bearer: k2 })).status).toBe(
      200,
    );
    // editors cannot touch the mode or the key
    const m = await call(`/api/room/${code}/host/chat-mode`, {
      method: "POST",
      bearer: k2,
      body: { mode: "off" },
    });
    expect(m.status).toBe(403);
    const m2 = await call(`/api/room/${code}/host/chat-mode`, {
      method: "POST",
      bearer: host,
      body: { mode: "off" },
    });
    expect(m2.data["mode"]).toBe("off");
    const refused = await call(`/api/room/${code}/guest/${a.id}/chat`, {
      method: "POST",
      guest: a.token,
      body: { text: "hello" },
    });
    expect(refused.status).toBe(403);
    await call(`/api/room/${code}/host/editor`, {
      method: "DELETE",
      bearer: host,
    });
    expect((await call(`/api/room/${code}/chat`, { bearer: k2 })).status).toBe(
      403,
    );
  });

  it("moderators can post and the host/editor token never works for the wrong route", async () => {
    const { code, host } = await setup();
    const p = await call(`/api/room/${code}/chat`, {
      method: "POST",
      bearer: host,
      body: { text: "Hoş geldiniz" },
    });
    expect(p.status).toBe(201);
    expect(p.data["message"]).toMatchObject({
      role: "reji",
      status: "approved",
    });
    expect((await call(`/api/room/${code}/chat`)).status).toBe(403);
    expect(
      (
        await call(`/api/room/${code}/chat/abc`, {
          method: "POST",
          bearer: host,
          body: { action: "approve" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(`/api/room/${code}/chat/1`, {
          method: "POST",
          bearer: host,
          body: { action: "explode" },
        })
      ).status,
    ).toBe(400);
  });

  it("long-poll wakes up as soon as a message is approved", async () => {
    const { code, host, join } = await setup();
    const a = await join();
    const posted = await call(`/api/room/${code}/guest/${a.id}/chat`, {
      method: "POST",
      guest: a.token,
      body: { text: "selam" },
    });
    const rev = (
      await call(`/api/room/${code}/guest/${a.id}/chat?since=0`, {
        guest: a.token,
      })
    ).data["rev"] as number;
    const waiting = call(
      `/api/room/${code}/guest/${a.id}/chat?since=${rev}&wait=20`,
      {
        guest: a.token,
      },
    );
    await Promise.resolve();
    await call(`/api/room/${code}/chat/${posted.data["message"].id}`, {
      method: "POST",
      bearer: host,
      body: { action: "approve" },
    });
    const res = await waiting;
    expect(res.data["messages"][0]).toMatchObject({ status: "approved" });
  });

  it("keeps an answered guest alive while it keeps polling the chat", async () => {
    const { code, join } = await setup();
    const a = await join();
    for (let i = 0; i < 5; i++) {
      clock += 60_000; // 5 minutes total, well past doneRetainMs
      const r = await call(`/api/room/${code}/guest/${a.id}/chat?since=0`, {
        guest: a.token,
      });
      expect(r.status).toBe(200);
    }
    clock += 10 * 60_000; // stops polling -> eventually dropped
    await call("/api/room/health");
    const gone = await call(`/api/room/${code}/guest/${a.id}/chat`, {
      guest: a.token,
    });
    expect(gone.status).toBe(403);
  });

  it("closing the room reports closed and rejects new messages", async () => {
    const { code, host, join } = await setup();
    const a = await join();
    await call(`/api/room/${code}`, { method: "DELETE", bearer: host });
    const r = await call(`/api/room/${code}/guest/${a.id}/chat`, {
      method: "POST",
      guest: a.token,
      body: { text: "hello?" },
    });
    expect(r.status).toBe(410);
    const poll = await call(`/api/room/${code}/chat`, { bearer: host });
    expect(poll.data["closed"]).toBe(true);
  });
});
