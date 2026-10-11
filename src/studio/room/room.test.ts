import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRoomsApi, type RoomsApi } from "../../server/rooms";
import { createMemoryKvStore } from "../storage";
import type { PeerInfo } from "../types";
import {
  createRoomApi,
  buildRoomLink,
  isRoomCode,
  type FetchLike,
} from "./api";
import { RoomGuestSession } from "./guest-session";
import { RoomHostSession, type HostBridge } from "./host-session";
import { csvCell, logToCsv } from "./log";

const OFFER = "TKZ1.OFFER_abc-123";
const ANSWER = "TKZ1.ANSWER_xyz-789";

let relay: RoomsApi;
let relayFetch: FetchLike;

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

function fakeBridge() {
  let peers: PeerInfo[] = [];
  const subs = new Set<() => void>();
  const calls = {
    invites: [] as { role: string; name?: string }[],
    answers: [] as { peerId: string; code: string }[],
    kicked: [] as string[],
  };
  let n = 0;
  const bridge: HostBridge = {
    async createInvite(role, name) {
      const peerId = `p${++n}`;
      calls.invites.push({ role, ...(name ? { name } : {}) });
      peers = [
        ...peers,
        {
          id: peerId,
          role,
          name: name ?? "",
          status: "connecting",
          gain: 1,
          muted: false,
        },
      ];
      subs.forEach((s) => s());
      return { peerId, code: OFFER };
    },
    async acceptAnswer(peerId, code) {
      calls.answers.push({ peerId, code });
    },
    kickPeer(id) {
      calls.kicked.push(id);
      return true;
    },
    getPeers: () => peers,
    subscribePeers(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
  const setStatus = (peerId: string, status: PeerInfo["status"]) => {
    peers = peers.map((p) => (p.id === peerId ? { ...p, status } : p));
    subs.forEach((s) => s());
  };
  return { bridge, calls, setStatus };
}

function fakeClient() {
  const listeners = new Set<(s: string) => void>();
  return {
    status: "connecting" as string,
    onStatus(cb: (s: string) => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {},
    emit(s: string) {
      this.status = s;
      listeners.forEach((l) => l(s));
    },
  };
}

async function until(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  relay = createRoomsApi();
  relayFetch = (url, init) =>
    relay
      .handle(new Request(`http://studio.test${url}`, init as RequestInit))
      .then((r) => r ?? new Response("<html>spa</html>", { status: 200 }));
});
afterEach(() => relay.dispose());

function makeHost(
  extra: Partial<ConstructorParameters<typeof RoomHostSession>[0]> = {},
) {
  const b = fakeBridge();
  const kv = createMemoryKvStore();
  const storage = memStorage();
  const session = new RoomHostSession({
    bridge: b.bridge,
    kv,
    api: createRoomApi({ fetch: relayFetch }),
    storage,
    waitSec: 0.2,
    ...extra,
  });
  return { session, kv, storage, ...b };
}

function makeGuest(code: string, client = fakeClient()) {
  const answers: string[] = [];
  const g = new RoomGuestSession({
    code,
    fetch: relayFetch,
    storage: memStorage(),
    waitSec: 0.2,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    acceptOffer: (async (offer: string) => {
      answers.push(offer);
      return { client, answerCode: ANSWER };
    }) as any,
  });
  return { g, client, answers };
}

describe("links", () => {
  it("builds short links and validates codes", () => {
    expect(buildRoomLink("https://x.org/", "k7m2qx")).toBe(
      "https://x.org/r/K7M2QX",
    );
    expect(buildRoomLink("https://x.org", "K7M2QX", "remote")).toBe(
      "https://x.org/r/K7M2QX?as=remote",
    );
    expect(buildRoomLink("https://x.org", "K7M2QX", "guest")).toBe(
      "https://x.org/r/K7M2QX",
    );
    expect(isRoomCode("k7m2qx")).toBe(true);
    expect(isRoomCode("K7M2Q0")).toBe(false);
    expect(isRoomCode("TOOLONGCODE")).toBe(false);
    expect(buildRoomLink("https://x.org", "K7M2QX").length).toBeLessThan(40);
  });
});

describe("host + guest through the relay", () => {
  it("guest asks, host approves, handshake completes with no copy/paste", async () => {
    const h = makeHost();
    expect(await h.session.open()).toBe(true);
    const code = h.session.getSnapshot().code as string;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    const { g, client, answers } = makeGuest(code);
    expect(await g.join("Ayşe", "guest")).toBe(true);

    await until(() => h.session.getSnapshot().waiting === 1);
    const entry = h.session.getSnapshot().pool[0]!;
    expect(entry).toMatchObject({
      name: "Ayşe",
      role: "guest",
      state: "waiting",
    });

    expect(await h.session.approve(entry.guestId)).toBe(true);
    expect(h.calls.invites).toEqual([{ role: "guest", name: "Ayşe" }]);

    await until(() => answers.length === 1);
    expect(answers[0]).toBe(OFFER);
    await until(() => h.calls.answers.length === 1);
    expect(h.calls.answers[0]).toEqual({ peerId: "p1", code: ANSWER });

    // WebRTC comes up -> pool entry becomes connected, guest phase connected
    h.setStatus("p1", "connected");
    client.emit("connected");
    await until(() => g.getSnapshot().phase === "connected");
    expect(h.session.getSnapshot().pool[0]?.state).toBe("connected");
    const texts = h.session
      .getSnapshot()
      .log.map((l) => l.text)
      .join("\n");
    expect(texts).toContain("Katılma isteği: Ayşe");
    expect(texts).toContain("Onaylandı: Ayşe");
    expect(texts).toContain("Ayşe bağlandı");

    g.dispose();
    h.session.dispose();
  });

  it("reject tells the guest", async () => {
    const h = makeHost();
    await h.session.open();
    const { g } = makeGuest(h.session.getSnapshot().code as string);
    await g.join("X", "viewer");
    await until(() => h.session.getSnapshot().waiting === 1);
    await h.session.reject(h.session.getSnapshot().pool[0]!.guestId);
    await until(() => g.getSnapshot().phase === "rejected");
    expect(h.session.getSnapshot().pool[0]?.state).toBe("rejected");
    expect(h.calls.invites).toHaveLength(0);
    g.dispose();
    h.session.dispose();
  });

  it("auto-approve per role approves immediately; others still wait", async () => {
    const h = makeHost();
    await h.session.open();
    h.session.setAutoApprove("viewer", true);
    const code = h.session.getSnapshot().code as string;
    const a = makeGuest(code);
    const b = makeGuest(code);
    await a.g.join("İzleyici", "viewer");
    await b.g.join("Konuk", "guest");
    await until(() => h.calls.invites.length === 1);
    expect(h.calls.invites[0]?.role).toBe("viewer");
    await until(() => h.session.getSnapshot().pool.length === 2);
    expect(h.session.getSnapshot().waiting).toBe(1);
    a.g.dispose();
    b.g.dispose();
    h.session.dispose();
  });

  it("fails an approved guest that never connects and frees the peer", async () => {
    const h = makeHost({ connectTimeoutMs: 80 });
    await h.session.open();
    const { g } = makeGuest(h.session.getSnapshot().code as string);
    await g.join("Yavaş", "guest");
    await until(() => h.session.getSnapshot().waiting === 1);
    await h.session.approve(h.session.getSnapshot().pool[0]!.guestId);
    await until(() => h.session.getSnapshot().pool[0]?.state === "failed");
    expect(h.calls.kicked).toEqual(["p1"]);
    g.dispose();
    h.session.dispose();
  });

  it("a guest that leaves while waiting is marked as left", async () => {
    const h = makeHost();
    await h.session.open();
    const { g } = makeGuest(h.session.getSnapshot().code as string);
    await g.join("Vazgeçen", "guest");
    await until(() => h.session.getSnapshot().waiting === 1);
    g.leave();
    await until(() => h.session.getSnapshot().pool[0]?.state === "left");
    g.dispose();
    h.session.dispose();
  });

  it("closing the room tells waiting guests and invalidates the code", async () => {
    const h = makeHost();
    await h.session.open();
    const code = h.session.getSnapshot().code as string;
    const { g } = makeGuest(code);
    await g.join("Bekleyen", "guest");
    await h.session.close();
    await until(() => g.getSnapshot().phase === "closed");
    expect(h.session.getSnapshot().status).toBe("idle");
    const probe = makeGuest(code);
    expect(["closed", "missing"]).toContain(await probe.g.check());
    g.dispose();
    h.session.dispose();
  });

  it("a host reload resumes the same room code", async () => {
    const h = makeHost();
    await h.session.open();
    const code = h.session.getSnapshot().code;
    h.session.dispose();
    const again = new RoomHostSession({
      bridge: fakeBridge().bridge,
      kv: h.kv,
      api: createRoomApi({ fetch: relayFetch }),
      storage: h.storage,
      waitSec: 0.2,
    });
    await again.open();
    expect(again.getSnapshot().code).toBe(code);
    // newRoom() issues a different code
    await again.newRoom();
    expect(again.getSnapshot().code).not.toBe(code);
    again.dispose();
  });

  it("guest reload during the wait resumes the same pool entry", async () => {
    const h = makeHost();
    await h.session.open();
    const code = h.session.getSnapshot().code as string;
    const store = memStorage();
    const mk = () =>
      new RoomGuestSession({
        code,
        fetch: relayFetch,
        storage: store,
        waitSec: 0.2,
      });
    const first = mk();
    await first.join("Yenileyen", "guest");
    first.dispose();
    const second = mk();
    expect(await second.resume()).toBe(true);
    expect(second.getSnapshot().phase).toBe("waiting");
    await until(() => h.session.getSnapshot().waiting === 1);
    expect(h.session.getSnapshot().pool).toHaveLength(1); // no duplicate entry
    second.dispose();
    h.session.dispose();
  });
});

describe("failure modes", () => {
  it("reports unavailable when the server has no relay (HTML fallback page)", async () => {
    const html: FetchLike = async () =>
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    const h = makeHost({ api: createRoomApi({ fetch: html }) });
    expect(await h.session.open()).toBe(false);
    expect(h.session.getSnapshot().status).toBe("unavailable");
    h.session.dispose();
  });

  it("reports unavailable on network errors", async () => {
    const down: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    const h = makeHost({ api: createRoomApi({ fetch: down }) });
    expect(await h.session.open()).toBe(false);
    expect(h.session.getSnapshot().status).toBe("unavailable");
    h.session.dispose();
  });

  it("guest sees missing/closed rooms", async () => {
    const g = new RoomGuestSession({
      code: "ZZZZZZ",
      fetch: relayFetch,
      storage: null,
    });
    expect(await g.check()).toBe("missing");
    g.dispose();
  });

  it("api.health reflects availability", async () => {
    expect(await createRoomApi({ fetch: relayFetch }).health()).toBe(true);
    expect(
      await createRoomApi({ fetch: async () => new Response("x") }).health(),
    ).toBe(false);
  });
});

describe("log export", () => {
  it("neutralizes spreadsheet formulas and escapes CSV", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("plain")).toBe("plain");
    const csv = logToCsv([
      { id: "1", at: 0, kind: "request", text: "=cmd", guestId: "g" },
    ]);
    expect(csv.split("\r\n")[1]).toContain("'=cmd");
  });

  it("persists the log and reloads it", async () => {
    const h = makeHost();
    await h.session.open();
    await new Promise((r) => setTimeout(r, 30));
    const kv = h.kv;
    h.session.dispose();
    const again = new RoomHostSession({
      bridge: fakeBridge().bridge,
      kv,
      api: createRoomApi({ fetch: relayFetch }),
      storage: memStorage(),
      waitSec: 0.2,
    });
    await until(() => again.getSnapshot().log.length > 0);
    expect(again.getSnapshot().log[0]?.text).toContain("Oda oluşturuldu");
    again.dispose();
  });
});
