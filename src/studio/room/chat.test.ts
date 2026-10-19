import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRoomsApi, type RoomsApi } from "../../server/rooms";
import type { StudioClient } from "../p2p";
import { createMemoryKvStore } from "../storage";
import type { PeerInfo } from "../types";
import { createRoomApi, RoomApiError, type FetchLike } from "./api";
import { RoomChatClient } from "./chat-client";
import { RoomGuestSession } from "./guest-session";
import { RoomHostSession, type HostBridge } from "./host-session";
import { roomBadge } from "./badge";

const OFFER = "TKZ1.OFFER_abc-123";
const ANSWER = "TKZ1.ANSWER_xyz-789";

let relay: RoomsApi;
let relayFetch: FetchLike;
let ips = 0;

beforeEach(() => {
  relay = createRoomsApi();
  relayFetch = (url, init) => {
    // distinct client IPs so the per-IP rate limits of the relay stay out of the way
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    headers.set("x-forwarded-for", `10.0.0.${(ips++ % 250) + 1}`);
    return relay
      .handle(
        new Request(`http://studio.test${url}`, {
          ...(init as RequestInit),
          headers,
        }),
      )
      .then((r) => r ?? new Response("<html>spa</html>", { status: 200 }));
  };
});
afterEach(() => relay.dispose());

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

async function until(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function setup() {
  let peers: PeerInfo[] = [];
  const subs = new Set<() => void>();
  let n = 0;
  const bridge: HostBridge = {
    async createInvite(role, name) {
      const peerId = `p${++n}`;
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
    async acceptAnswer() {},
    kickPeer: () => true,
    getPeers: () => peers,
    subscribePeers(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
  const kv = createMemoryKvStore();
  const storage = memStorage();
  const makeHost = () =>
    new RoomHostSession({
      bridge,
      kv,
      api: createRoomApi({ fetch: relayFetch }),
      storage,
      waitSec: 0.2,
    });
  const host = makeHost();
  const guest = async (name: string, role: "guest" | "viewer" | "remote") => {
    const code = host.getSnapshot().code as string;
    const g = new RoomGuestSession({
      code,
      fetch: relayFetch,
      storage: memStorage(),
      waitSec: 0.2,
      acceptOffer: (async () => ({
        client: {
          status: "connected",
          onStatus: () => () => {},
          dispose() {},
        },
        answerCode: ANSWER,
      })) as unknown as typeof StudioClient.acceptOffer,
    });
    await g.join(name, role);
    await until(() =>
      host
        .getSnapshot()
        .pool.some((e) => e.name === name && e.state === "waiting"),
    );
    const entry = host.getSnapshot().pool.find((e) => e.name === name)!;
    await host.approve(entry.guestId);
    await until(() => g.getSnapshot().phase === "connected");
    return g;
  };
  return { host, guest, makeHost };
}

describe("room chat through host, editor and participants", () => {
  it("queues participant messages, editor approves, director airs", async () => {
    const { host, guest } = setup();
    await host.open();
    const a = await guest("Ayşe", "guest");
    const b = await guest("Burak", "viewer");
    await until(
      () =>
        host.chat.getSnapshot().status === "live" &&
        a.chat.getSnapshot().status === "live" &&
        b.chat.getSnapshot().status === "live",
    );
    expect(host.chat.getSnapshot().as).toBe("host");
    expect(a.chat.getSnapshot().as).toBe("participant");

    // editor seat via the issued key
    expect(host.editorLink()).toBe("");
    expect(await host.issueEditorKey()).toBe(true);
    const link = host.editorLink();
    expect(link).toMatch(/\/chat\/[A-Z2-9]{6}#k=\S+$/);
    const key = host.getSnapshot().editorKey as string;
    const editor = new RoomChatClient({
      api: createRoomApi({ fetch: relayFetch }),
      waitSec: 0.2,
    });
    editor.connect(host.getSnapshot().code as string, {
      kind: "bearer",
      token: key,
    });
    await until(() => editor.getSnapshot().as === "editor");

    // Ayşe asks a question
    const sent = await a.chat.post("Fiyat ne kadar?");
    expect(sent.status).toBe("pending");
    await until(() => editor.getSnapshot().pending === 1);
    expect(host.chat.getSnapshot().pending).toBe(1);
    // Burak sees nothing yet, Ayşe sees her own pending message
    expect(b.chat.getSnapshot().messages).toEqual([]);
    expect(a.chat.getSnapshot().messages[0]?.status).toBe("pending");

    await editor.moderate(sent.id, "edit", "Fiyat ne kadar olacak?");
    await editor.moderate(sent.id, "approve");
    await until(() => b.chat.getSnapshot().messages.length === 1);
    expect(b.chat.getSnapshot().messages[0]).toMatchObject({
      text: "Fiyat ne kadar olacak?",
      edited: true,
      status: "approved",
    });

    // the editor may not air; the director can, and everyone is told
    await expect(editor.moderate(sent.id, "onair")).rejects.toMatchObject({
      code: "forbidden",
    });
    await host.chat.moderate(sent.id, "onair");
    await until(() => b.chat.getSnapshot().onAir?.id === sent.id);
    await until(() => editor.getSnapshot().onAir?.id === sent.id);
    expect(host.chat.getSnapshot().onAir?.text).toBe("Fiyat ne kadar olacak?");

    // hiding it takes it off air and drops it from other participants' feed
    await editor.moderate(sent.id, "reject");
    await until(() => b.chat.getSnapshot().messages.length === 0);
    expect(b.chat.getSnapshot().onAir).toBeNull();
    expect(a.chat.getSnapshot().messages[0]?.status).toBe("rejected");

    editor.dispose();
    a.dispose();
    b.dispose();
    host.dispose();
  });

  it("modes: open publishes at once, off blocks participants", async () => {
    const { host, guest } = setup();
    await host.open();
    const a = await guest("Ayşe", "guest");
    await until(() => a.chat.getSnapshot().status === "live");
    await host.setChatMode("open");
    await until(() => a.chat.getSnapshot().mode === "open");
    const m = await a.chat.post("merhaba");
    expect(m.status).toBe("approved");
    await host.setChatMode("off");
    await until(() => a.chat.getSnapshot().mode === "off");
    await expect(a.chat.post("tekrar")).rejects.toMatchObject({
      detail: "chat-closed",
    });
    expect(
      host
        .getSnapshot()
        .log.some((l) => l.kind === "chat" && l.text.includes("kapalı")),
    ).toBe(true);
    a.dispose();
    host.dispose();
  });

  it("phone remotes get no chat seat and a revoked editor key is denied", async () => {
    const { host, guest } = setup();
    await host.open();
    const phone = await guest("Tel", "remote");
    expect(phone.chat.getSnapshot().status).toBe("idle");

    await host.issueEditorKey();
    const key = host.getSnapshot().editorKey as string;
    const editor = new RoomChatClient({
      api: createRoomApi({ fetch: relayFetch }),
      waitSec: 0.2,
    });
    editor.connect(host.getSnapshot().code as string, {
      kind: "bearer",
      token: key,
    });
    await until(() => editor.getSnapshot().as === "editor");
    await host.revokeEditorKey();
    expect(host.getSnapshot().editorKey).toBeNull();
    await until(() => editor.getSnapshot().status === "denied");
    await expect(editor.post("x")).rejects.toBeInstanceOf(RoomApiError);
    editor.dispose();
    phone.dispose();
    host.dispose();
  });

  it("a host reload resumes the same room, editor key and chat", async () => {
    const { host, guest, makeHost } = setup();
    await host.open();
    await host.issueEditorKey();
    const key = host.getSnapshot().editorKey;
    const code = host.getSnapshot().code;
    const a = await guest("Ayşe", "guest");
    await until(() => a.chat.getSnapshot().status === "live");
    const m = await a.chat.post("kalıcı mı?");
    host.dispose();

    const again = makeHost();
    await again.open();
    expect(again.getSnapshot().code).toBe(code);
    expect(again.getSnapshot().editorKey).toBe(key);
    await until(() => again.chat.getSnapshot().messages.length === 1);
    expect(again.chat.getSnapshot().messages[0]).toMatchObject({
      id: m.id,
      status: "pending",
    });
    a.dispose();
    again.dispose();
  });

  it("closing the room ends the chat for everyone and forgets the key", async () => {
    const { host, guest } = setup();
    await host.open();
    await host.issueEditorKey();
    const a = await guest("Ayşe", "guest");
    await until(() => a.chat.getSnapshot().status === "live");
    await host.close();
    await until(() => a.chat.getSnapshot().status === "closed");
    expect(host.chat.getSnapshot().status).toBe("idle");
    expect(host.getSnapshot().editorKey).toBeNull();
    a.dispose();
    host.dispose();
  });
});

describe("chat-only participants", () => {
  function chatOnly(code: string, storage = memStorage()) {
    return new RoomGuestSession({
      code,
      fetch: relayFetch,
      storage,
      waitSec: 0.2,
    });
  }

  it("join without approval, skip the pool, chat and resume after a reload", async () => {
    const { host } = setup();
    await host.open();
    const code = host.getSnapshot().code as string;
    const storage = memStorage();
    const g = chatOnly(code, storage);
    expect(await g.join("Selin", "chat")).toBe(true);
    expect(g.getSnapshot()).toMatchObject({
      phase: "chatting",
      role: "chat",
      client: null,
    });
    await until(() => g.chat.getSnapshot().status === "live");

    // never in the director's waiting pool, but counted as audience
    expect(host.getSnapshot().pool).toEqual([]);
    await until(() => host.chat.getSnapshot().audience === 1);

    const m = await g.chat.post("Canlıyı nereden izleyebilirim?");
    expect(m).toMatchObject({ status: "pending", role: "chat" });
    await until(() => host.chat.getSnapshot().pending === 1);
    await host.chat.moderate(m.id, "approve");
    await until(() => g.chat.getSnapshot().messages[0]?.status === "approved");

    // reload: same storage -> same seat, no new join
    g.dispose();
    const again = chatOnly(code, storage);
    expect(await again.resume()).toBe(true);
    expect(again.getSnapshot().phase).toBe("chatting");
    await until(() => again.chat.getSnapshot().messages.length === 1);
    again.dispose();
    host.dispose();
  });

  it("falls back to the form when the saved seat is gone", async () => {
    const { host } = setup();
    await host.open();
    const code = host.getSnapshot().code as string;
    const storage = memStorage();
    storage.setItem(
      `tkz.guest.${code}`,
      JSON.stringify({
        guestId: "zzz",
        token: "t".repeat(24),
        name: "X",
        role: "chat",
      }),
    );
    const g = chatOnly(code, storage);
    expect(await g.resume()).toBe(false);
    expect(g.getSnapshot().phase).toBe("idle");
    g.dispose();
    host.dispose();
  });
});

describe("room badge store", () => {
  it("keeps a stable snapshot and only notifies on real changes", () => {
    roomBadge.set({ waiting: 0, chat: 0 });
    const calls: number[] = [];
    const off = roomBadge.subscribe(() => calls.push(1));
    const a = roomBadge.get();
    roomBadge.set({ waiting: 0 }); // no change
    expect(roomBadge.get()).toBe(a);
    expect(calls).toHaveLength(0);
    roomBadge.set({ chat: 3 });
    expect(roomBadge.get()).toEqual({ waiting: 0, chat: 3 });
    expect(roomBadge.get()).not.toBe(a);
    roomBadge.set({ waiting: 2 });
    expect(roomBadge.get()).toEqual({ waiting: 2, chat: 3 });
    expect(calls).toHaveLength(2);
    off();
    roomBadge.set({ waiting: 0, chat: 0 });
    expect(calls).toHaveLength(2);
    expect(roomBadge.getServer()).toEqual({ waiting: 0, chat: 0 });
  });
});
