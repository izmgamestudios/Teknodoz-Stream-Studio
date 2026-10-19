import { afterEach, describe, expect, it, vi } from "vitest";
import { P2PError } from "./errors";
import { SignalError, decodeSignal, encodeSignal } from "./signaling";
import { StudioHost, REMOTE_STATE_MIN_INTERVAL_MS } from "./host";
import {
  asFake,
  fakeRtcFactory,
  fakeStream,
  fakeTrack,
  settle,
  FakeStream,
  type FakeTransceiver,
} from "./__fakes__/fake-rtc";
import { makeHarness, makePair, type Pair } from "./__fakes__/pair";
import type { PeerInfo, RemoteState } from "../types";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const STATE: RemoteState = {
  scenes: [
    { id: "a", name: "Solo", hotkey: "1" },
    { id: "b", name: "Mobil" },
  ],
  activeSceneId: "a",
  recording: false,
  micMuted: false,
  prompterPlaying: false,
  prompterSpeed: 60,
  recordingMs: 0,
};

/** Simulate the remote end writing on the host's control channel. */
function inject(pair: Pair, message: unknown): void {
  pair.hostDc.receive(
    typeof message === "string" ? message : JSON.stringify(message),
  );
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

function statusOf(host: StudioHost, id: string): string | undefined {
  return host.getPeer(id)?.status;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createInvite", () => {
  it("returns a decodable offer code, a fragment link and registers the peer", async () => {
    const h = makeHarness();
    const invite = await h.host.createInvite("viewer", "Ayşe");
    expect(invite.url).toBe(`https://studio.test/join#c=${invite.code}`);
    const offer = await decodeSignal(invite.code);
    expect(offer).toMatchObject({ v: 1, type: "offer", role: "viewer" });
    expect(offer.sdp).toContain("a=candidate:");
    expect(h.host.getPeers()).toEqual([
      {
        id: invite.peerId,
        role: "viewer",
        name: "Ayşe",
        status: "connecting",
        gain: 1,
        muted: false,
      },
    ]);
  });

  it("uses /remote links for remote peers and /join for viewers and guests", async () => {
    const h = makeHarness();
    expect((await h.host.createInvite("remote")).url).toMatch(
      /^https:\/\/studio\.test\/remote#c=TKZ1\./,
    );
    expect((await h.host.createInvite("guest")).url).toMatch(
      /^https:\/\/studio\.test\/join#c=TKZ1\./,
    );
  });

  it("numbers default names per role and sanitizes given ones", async () => {
    const h = makeHarness();
    await h.host.createInvite("guest");
    await h.host.createInvite("guest");
    await h.host.createInvite("viewer");
    await h.host.createInvite("remote", "  Tel\u0000efon  ");
    expect(h.host.getPeers().map((p) => p.name)).toEqual([
      "Konuk 1",
      "Konuk 2",
      "İzleyici 1",
      "Tel efon",
    ]);
  });

  it("configures ICE servers from usePublicStun", async () => {
    const off = makeHarness({ usePublicStun: false });
    await off.host.createInvite("viewer");
    expect(off.net.pcs[0]?.config.iceServers).toEqual([]);
    expect(off.net.pcs[0]?.config.bundlePolicy).toBe("max-bundle");

    const on = makeHarness({ usePublicStun: true });
    await on.host.createInvite("viewer");
    expect(on.net.pcs[0]?.config.iceServers).toEqual([
      {
        urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
      },
    ]);
  });

  it("creates transceivers up front: guest sendrecv, viewer sendonly, remote none", async () => {
    const h = makeHarness();
    await h.host.createInvite("guest");
    await h.host.createInvite("viewer");
    await h.host.createInvite("remote");
    const shape = (i: number) =>
      h.net.pcs[i]?.transceivers.map((t) => `${t.kind}:${t.direction}`) ?? [];
    expect(shape(0)).toEqual(["video:sendrecv", "audio:sendrecv"]);
    expect(shape(1)).toEqual(["video:sendonly", "audio:sendonly"]);
    expect(shape(2)).toEqual([]);
    for (const pc of h.net.pcs) {
      expect(pc.channels.map((c) => c.label)).toEqual(["ctl"]);
    }
  });

  it("restricts offered codecs via setCodecPreferences (and can be turned off)", async () => {
    const h = makeHarness();
    await h.host.createInvite("guest");
    const [video, audio] = h.net.pcs[0]?.transceivers as [
      FakeTransceiver,
      FakeTransceiver,
    ];
    expect(audio.codecPrefs?.map((c) => c.mimeType)).toEqual(["audio/opus"]);
    expect(video.codecPrefs?.map((c) => c.mimeType)).toEqual([
      "video/VP8",
      "video/H264",
      "video/rtx",
    ]);

    const off = makeHarness({ compactCodecs: false });
    await off.host.createInvite("guest");
    expect(
      off.net.pcs[0]?.transceivers.every((t) => t.codecPrefs === null),
    ).toBe(true);
  });

  it("survives browsers that reject or lack setCodecPreferences", async () => {
    const throwing = makeHarness();
    throwing.net.options.throwOnCodecPrefs = true;
    await expect(throwing.host.createInvite("viewer")).resolves.toBeDefined();
    expect(
      throwing.net.pcs[0]?.transceivers.every((t) => t.codecPrefs === null),
    ).toBe(true);

    const net = makeHarness().net;
    const host = new StudioHost({
      usePublicStun: false,
      rtcFactory: fakeRtcFactory(net, false),
    });
    await expect(host.createInvite("viewer")).resolves.toBeDefined();
  });

  it("fails with ice-failed when no candidate exists and leaves no trace", async () => {
    const h = makeHarness();
    h.net.options.noCandidates = true;
    const error = await rejection(h.host.createInvite("viewer"));
    expect(error).toBeInstanceOf(P2PError);
    expect((error as P2PError).code).toBe("ice-failed");
    expect(h.host.getPeers()).toEqual([]);
    expect(h.net.pcs[0]?.closed).toBe(true);
    // the slot was released
    h.net.options.noCandidates = false;
    await expect(h.host.createInvite("viewer")).resolves.toBeDefined();
  });

  it("proceeds with partial candidates when gathering times out", async () => {
    const h = makeHarness({ iceTimeoutMs: 30 });
    h.net.options.neverGather = true;
    const started = Date.now();
    const invite = await h.host.createInvite("viewer");
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    expect((await decodeSignal(invite.code)).sdp).toContain("a=candidate:");
  });

  it("enforces the peer cap atomically, even for concurrent invites", async () => {
    const h = makeHarness({ maxPeers: 2 });
    const results = await Promise.allSettled([
      h.host.createInvite("viewer"),
      h.host.createInvite("viewer"),
      h.host.createInvite("viewer"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const failed = results.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(P2PError);
    expect((failed.reason as P2PError).code).toBe("max-peers");
    expect(h.host.getPeers()).toHaveLength(2);
  });

  it("defaults to 8 peers and frees slots for kicked and disconnected peers", async () => {
    const h = makeHarness();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++)
      ids.push((await h.host.createInvite("viewer")).peerId);
    await expect(h.host.createInvite("viewer")).rejects.toMatchObject({
      code: "max-peers",
    });
    h.host.kick(ids[0] as string);
    await expect(h.host.createInvite("viewer")).resolves.toBeDefined();
    // a disconnected (but still listed) peer no longer counts
    h.net.pcs[1]?.setHealth("failed");
    expect(statusOf(h.host, ids[1] as string)).toBe("disconnected");
    await expect(h.host.createInvite("viewer")).resolves.toBeDefined();
  });

  it("drops invites that are never answered after inviteTtlMs", async () => {
    const h = makeHarness({ inviteTtlMs: 40 });
    const unanswered = await h.host.createInvite("viewer");
    const answered = await makePair(h, "viewer");
    await sleep(100);
    expect(h.host.getPeer(unanswered.peerId)).toBeUndefined();
    expect(h.net.pcs[0]?.closed).toBe(true);
    expect(statusOf(h.host, answered.invite.peerId)).toBe("connected");
    await expect(
      h.host.acceptAnswer(unanswered.peerId, answered.answerCode),
    ).rejects.toMatchObject({ code: "unknown-peer" });
  });

  it("throws unsupported when WebRTC is missing and no factory was injected", async () => {
    const host = new StudioHost({ usePublicStun: false });
    await expect(host.createInvite("viewer")).rejects.toMatchObject({
      code: "unsupported",
    });
  });
});

describe("acceptAnswer", () => {
  it("connects a viewer end to end", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer", { clientName: "Ayşe" });
    expect(h.host.getPeer(p.invite.peerId)).toMatchObject({
      status: "connected",
      name: "Ayşe",
      role: "viewer",
    });
    expect(p.client.status).toBe("connected");
    expect(p.client.peerId).toBe(p.invite.peerId);
  });

  it("rejects unknown peers, garbage and wrongly-directed codes with typed errors", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer", { connect: false });
    await expect(
      h.host.acceptAnswer("nope", p.answerCode),
    ).rejects.toMatchObject({
      code: "unknown-peer",
    });
    const garbage = await rejection(
      h.host.acceptAnswer(p.invite.peerId, "hello"),
    );
    expect(garbage).toBeInstanceOf(SignalError);
    expect((garbage as SignalError).code).toBe("bad-prefix");
    await expect(
      h.host.acceptAnswer(p.invite.peerId, p.invite.code),
    ).rejects.toMatchObject({
      code: "wrong-direction",
    });
    // the invite is still usable after all those mistakes
    await h.host.acceptAnswer(p.invite.peerId, p.answerCode);
    await settle();
    expect(statusOf(h.host, p.invite.peerId)).toBe("connected");
  });

  it("rejects an answer made for a different role", async () => {
    const h = makeHarness();
    const viewer = await h.host.createInvite("viewer");
    const guest = await makePair(h, "guest", { connect: false });
    await expect(
      h.host.acceptAnswer(viewer.peerId, guest.answerCode),
    ).rejects.toMatchObject({
      code: "role-mismatch",
    });
  });

  it("maps a browser-rejected SDP to bad-sdp and allows a corrected retry", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer", { connect: false });
    const bogus = await encodeSignal({
      type: "answer",
      role: "viewer",
      sdp: "v=0\r\ns=-\r\n",
    });
    await expect(
      h.host.acceptAnswer(p.invite.peerId, bogus),
    ).rejects.toMatchObject({
      code: "bad-sdp",
    });
    await h.host.acceptAnswer(p.invite.peerId, p.answerCode);
    await settle();
    expect(statusOf(h.host, p.invite.peerId)).toBe("connected");
  });

  it("is idempotent for the same answer, also when pasted concurrently", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer", { connect: false });
    const spy = vi.spyOn(p.hostPc, "setRemoteDescription");
    await Promise.all([
      h.host.acceptAnswer(p.invite.peerId, p.answerCode),
      h.host.acceptAnswer(p.invite.peerId, p.answerCode),
    ]);
    await h.host.acceptAnswer(p.invite.peerId, p.answerCode);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("refuses a different second answer", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer");
    const decoded = await decodeSignal(p.answerCode);
    const other = await encodeSignal({
      ...decoded,
      sdp: decoded.sdp + "a=x-other:1\r\n",
    });
    await expect(
      h.host.acceptAnswer(p.invite.peerId, other),
    ).rejects.toMatchObject({
      code: "already-answered",
    });
  });

  it("treats late answers as errors: kicked, disconnected and disposed", async () => {
    const h = makeHarness();
    const kicked = await makePair(h, "viewer", { connect: false });
    h.host.kick(kicked.invite.peerId);
    await expect(
      h.host.acceptAnswer(kicked.invite.peerId, kicked.answerCode),
    ).rejects.toMatchObject({ code: "unknown-peer" });

    const failed = await makePair(h, "viewer", { connect: false });
    failed.hostPc.setHealth("failed");
    expect(statusOf(h.host, failed.invite.peerId)).toBe("disconnected");
    await expect(
      h.host.acceptAnswer(failed.invite.peerId, failed.answerCode),
    ).rejects.toMatchObject({ code: "bad-state" });

    const late = await makePair(h, "viewer", { connect: false });
    const pending = h.host.acceptAnswer(late.invite.peerId, late.answerCode);
    h.host.kick(late.invite.peerId); // kicked while the code is being decoded
    await expect(pending).rejects.toBeInstanceOf(P2PError);

    h.host.dispose();
    await expect(
      h.host.acceptAnswer(late.invite.peerId, late.answerCode),
    ).rejects.toMatchObject({
      code: "disposed",
    });
  });

  it("caps viewer/guest video bitrate once negotiated (and can be disabled)", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer");
    const video = p.hostPc.transceivers[0]?.sender;
    expect(video?.setParametersCalls).toBe(1);
    expect(video?.parameters.encodings[0]?.maxBitrate).toBe(2_500_000);

    const custom = makeHarness({ maxPeerBitrateKbps: 800 });
    const c = await makePair(custom, "guest");
    expect(
      c.hostPc.transceivers[0]?.sender.parameters.encodings[0]?.maxBitrate,
    ).toBe(800_000);

    const off = makeHarness({ maxPeerBitrateKbps: 0 });
    const o = await makePair(off, "viewer");
    expect(o.hostPc.transceivers[0]?.sender.setParametersCalls).toBe(0);
  });
});

describe("snapshot and subscription", () => {
  it("returns a referentially stable, frozen snapshot until something changes", async () => {
    const h = makeHarness();
    const a = await h.host.createInvite("viewer");
    const b = await h.host.createInvite("viewer");
    const first = h.host.getPeers();
    expect(h.host.getPeers()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    h.net.pcs[0]?.setHealth("failed"); // only peer A changes
    const second = h.host.getPeers();
    expect(second).not.toBe(first);
    expect(h.host.getPeers()).toBe(second);
    expect(second[0]?.status).toBe("disconnected");
    expect(second[1]).toBe(first[1]); // unchanged peer keeps its identity
    expect(h.host.getPeer(b.peerId)).toBe(first[1]);
    expect(h.host.getPeer(a.peerId)).toBe(second[0]);
  });

  it("notifies subscribers and onPeersChange, supports unsubscribe, ignores no-op changes", async () => {
    const seen: PeerInfo[][] = [];
    const options: PeerInfo[][] = [];
    const h = makeHarness({
      onPeersChange: (peers) => void options.push([...peers]),
    });
    const unsubscribe = h.host.subscribe((peers) => void seen.push([...peers]));
    const p = await makePair(h, "guest");
    expect(seen.length).toBeGreaterThan(0);
    expect(options.length).toBe(seen.length);
    const before = seen.length;
    h.host.setGuestMuted(p.invite.peerId, false); // already false: no change, no event
    h.host.setGuestGain(p.invite.peerId, 1);
    expect(seen.length).toBe(before);
    h.host.setGuestMuted(p.invite.peerId, true);
    expect(seen.length).toBe(before + 1);
    unsubscribe();
    h.host.setGuestMuted(p.invite.peerId, false);
    expect(seen.length).toBe(before + 1);
    expect(options.length).toBe(before + 2);
  });

  it("works detached (useSyncExternalStore style) and survives throwing listeners", async () => {
    const h = makeHarness();
    const { subscribe, getPeers } = h.host;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const good = vi.fn();
    subscribe(() => {
      throw new Error("boom");
    });
    subscribe(good);
    await h.host.createInvite("viewer");
    expect(good).toHaveBeenCalled();
    expect(getPeers()).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
  });
});

describe("connection health", () => {
  it("marks failed/closed connections disconnected and releases everything", async () => {
    const h = makeHarness();
    const p = await makePair(h, "guest");
    const events: Array<[string, MediaStream | null]> = [];
    h.host.onGuestStream((id, stream) => void events.push([id, stream]));
    await p.client.startGuest(fakeStream("video", "audio"), "Ayşe");
    await settle();
    expect(events).toHaveLength(1);
    p.hostPc.setHealth("failed");
    expect(statusOf(h.host, p.invite.peerId)).toBe("disconnected");
    expect(events[1]).toEqual([p.invite.peerId, null]);
    expect(p.hostPc.closed).toBe(true);
    expect(p.hostDc.readyState).toBe("closed");
    expect(p.hostPc.listenerCount("track")).toBe(0);
    expect(p.hostPc.listenerCount("connectionstatechange")).toBe(0);
    expect(p.hostDc.listenerCount("message")).toBe(0);
    expect(p.client.status).toBe("disconnected");
    // inbound tracks are released; the peer stays listed until removed
    expect(h.host.getPeers()).toHaveLength(1);
    expect(h.host.pruneDisconnected()).toBe(1);
    expect(h.host.getPeers()).toEqual([]);
    expect(h.host.pruneDisconnected()).toBe(0);
  });

  it("treats ICE 'disconnected' as transient for disconnectGraceMs", async () => {
    const h = makeHarness({ disconnectGraceMs: 40 });
    const p = await makePair(h, "viewer");
    p.hostPc.setHealth("disconnected");
    expect(statusOf(h.host, p.invite.peerId)).toBe("connected");
    p.hostPc.setHealth("connected"); // recovered in time
    await sleep(80);
    expect(statusOf(h.host, p.invite.peerId)).toBe("connected");
    p.hostPc.setHealth("disconnected");
    await sleep(80);
    expect(statusOf(h.host, p.invite.peerId)).toBe("disconnected");
  });

  it("falls back to iceConnectionState when connectionState is unavailable", async () => {
    const h = makeHarness();
    const invite = await h.host.createInvite("viewer");
    const pc = h.net.pcs[0];
    Object.defineProperty(pc, "connectionState", {
      value: undefined,
      configurable: true,
    });
    pc!.iceConnectionState = "completed";
    pc!.bus.emit("iceconnectionstatechange");
    expect(statusOf(h.host, invite.peerId)).toBe("connected");
    pc!.iceConnectionState = "failed";
    pc!.bus.emit("iceconnectionstatechange");
    expect(statusOf(h.host, invite.peerId)).toBe("disconnected");
  });

  it("notices when the remote end closes the control channel", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer");
    p.client.dispose();
    expect(statusOf(h.host, p.invite.peerId)).toBe("disconnected");
  });
});

describe("green room (guest)", () => {
  async function guestPair(h = makeHarness()) {
    const p = await makePair(h, "guest");
    const events: Array<[string, MediaStream | null]> = [];
    h.host.onGuestStream((id, stream) => void events.push([id, stream]));
    return { h, p, events };
  }

  it("keeps the guest hidden until it asks to join, then exposes its camera/mic stream", async () => {
    const { h, p, events } = await guestPair();
    expect(statusOf(h.host, p.invite.peerId)).toBe("connected");
    expect(events).toEqual([]);
    expect(h.host.getGuestStream(p.invite.peerId)).toBeNull();

    await p.client.startGuest(fakeStream("video", "audio"), "Ayşe Yılmaz");
    await settle();

    expect(h.host.getPeer(p.invite.peerId)).toMatchObject({
      status: "waiting",
      name: "Ayşe Yılmaz",
    });
    expect(p.client.status).toBe("waiting");
    expect(events).toHaveLength(1);
    const stream = events[0]?.[1] as unknown as FakeStream;
    expect(events[0]?.[0]).toBe(p.invite.peerId);
    const [video, audio] = p.hostPc.transceivers;
    expect(stream.tracks).toEqual([
      video?.receiver.track,
      audio?.receiver.track,
    ]);
    expect(h.host.getGuestStream(p.invite.peerId)).toBe(
      stream as unknown as MediaStream,
    );
  });

  it("moves through waiting -> on-air -> waiting and keeps the client in sync", async () => {
    const { h, p } = await guestPair();
    await p.client.startGuest(fakeStream("video", "audio"), "Ayşe");
    await settle();
    expect(h.host.bringOnAir(p.invite.peerId)).toBe(true);
    expect(statusOf(h.host, p.invite.peerId)).toBe("on-air");
    expect(p.client.status).toBe("on-air");
    expect(h.host.bringOnAir(p.invite.peerId)).toBe(true); // idempotent
    expect(h.host.takeOffAir(p.invite.peerId)).toBe(true);
    expect(statusOf(h.host, p.invite.peerId)).toBe("waiting");
    expect(p.client.status).toBe("waiting");
    expect(h.host.takeOffAir(p.invite.peerId)).toBe(true); // idempotent
    const types = p.hostDc.sentMessages().map((m) => m["type"]);
    expect(types).toEqual([
      "hello",
      "guest-approved",
      "guest-on-air",
      "guest-off-air",
    ]);
  });

  it("rejects a guest: back to viewer, stream retracted, client stops publishing and may retry", async () => {
    const { h, p, events } = await guestPair();
    const local = fakeStream("video", "audio");
    await p.client.startGuest(local, "Ayşe");
    await settle();
    h.host.bringOnAir(p.invite.peerId);
    expect(h.host.rejectGuest(p.invite.peerId)).toBe(true);
    await settle();
    expect(statusOf(h.host, p.invite.peerId)).toBe("connected");
    expect(events.at(-1)).toEqual([p.invite.peerId, null]);
    expect(h.host.getGuestStream(p.invite.peerId)).toBeNull();
    expect(p.client.status).toBe("rejected");
    expect(p.clientPc.transceivers.every((t) => t.sender.track === null)).toBe(
      true,
    );
    expect(h.host.rejectGuest(p.invite.peerId)).toBe(false); // nothing left to reject

    await p.client.startGuest(local, "Ayşe");
    await settle();
    expect(statusOf(h.host, p.invite.peerId)).toBe("waiting");
    expect(events.at(-1)?.[1]).not.toBeNull();
  });

  it("lets a guest leave (role 'viewer' announcement)", async () => {
    const { h, p, events } = await guestPair();
    await p.client.startGuest(fakeStream("video", "audio"), "Ayşe");
    await settle();
    h.host.bringOnAir(p.invite.peerId);
    await p.client.leaveGuest();
    await settle();
    expect(statusOf(h.host, p.invite.peerId)).toBe("connected");
    expect(events.at(-1)).toEqual([p.invite.peerId, null]);
    expect(p.client.status).toBe("connected");
    expect(p.clientPc.transceivers.every((t) => t.sender.track === null)).toBe(
      true,
    );
  });

  it("returns false for unknown peers, non-guests and wrong states", async () => {
    const { h, p } = await guestPair();
    const viewer = await makePair(h, "viewer");
    expect(h.host.bringOnAir("nope")).toBe(false);
    expect(h.host.bringOnAir(p.invite.peerId)).toBe(false); // not in the green room yet
    expect(h.host.takeOffAir(p.invite.peerId)).toBe(false);
    expect(h.host.rejectGuest(p.invite.peerId)).toBe(false);
    expect(h.host.bringOnAir(viewer.invite.peerId)).toBe(false);
    expect(h.host.setGuestGain(viewer.invite.peerId, 1)).toBe(false);
    expect(h.host.setGuestMuted(viewer.invite.peerId, true)).toBe(false);
    expect(h.host.setGuestGain("nope", 1)).toBe(false);
    expect(h.host.kick("nope")).toBe(false);
  });

  it("only guests can ask to join; roles can never be changed by the peer", async () => {
    const h = makeHarness();
    const viewer = await makePair(h, "viewer");
    inject(viewer, { type: "join-request", name: "Sneaky" });
    inject(viewer, { type: "role", role: "guest", name: "Sneaky" });
    inject(viewer, { type: "role", role: "remote", name: "Sneaky" });
    expect(h.host.getPeer(viewer.invite.peerId)).toMatchObject({
      role: "viewer",
      status: "connected",
    });

    const guest = await makePair(h, "guest");
    const commands = vi.fn();
    h.host.onRemoteCommand(commands);
    inject(guest, { type: "role", role: "remote", name: "x" });
    inject(guest, { type: "remote-cmd", cmd: { kind: "marker" } });
    inject(viewer, { type: "remote-cmd", cmd: { kind: "marker" } });
    expect(commands).not.toHaveBeenCalled();
    expect(h.host.getPeer(guest.invite.peerId)?.role).toBe("guest");
  });

  it("answers repeated join-requests idempotently and sanitizes the announced name", async () => {
    const { h, p } = await guestPair();
    inject(p, { type: "join-request", name: "Evil‮name\u0000" });
    inject(p, { type: "join-request", name: "Evil‮name\u0000" });
    expect(h.host.getPeer(p.invite.peerId)).toMatchObject({
      status: "waiting",
      name: "Evil name",
    });
    h.host.bringOnAir(p.invite.peerId);
    inject(p, { type: "join-request", name: "Evil name" }); // resync, never demotes an on-air guest
    expect(statusOf(h.host, p.invite.peerId)).toBe("on-air");
    expect(p.hostDc.sentMessages().at(-1)).toEqual({ type: "guest-on-air" });
  });

  it("kick closes the connection, removes the peer and retracts the stream; inbound tracks are released", async () => {
    const { h, p, events } = await guestPair();
    await p.client.startGuest(fakeStream("video", "audio"), "Ayşe");
    await settle();
    const inbound = p.hostPc.transceivers.map((t) => asFake(t.receiver.track));
    expect(h.host.kick(p.invite.peerId)).toBe(true);
    expect(h.host.getPeers()).toEqual([]);
    expect(events.at(-1)).toEqual([p.invite.peerId, null]);
    expect(inbound.every((t) => t.stopCalls === 1)).toBe(true);
    expect(p.hostPc.closed).toBe(true);
    expect(p.client.status).toBe("disconnected");
  });

  it("bookkeeps gain and mute (clamped, validated) without touching media", async () => {
    const { h, p } = await guestPair();
    expect(h.host.setGuestGain(p.invite.peerId, 2.5)).toBe(true);
    expect(h.host.getPeer(p.invite.peerId)?.gain).toBe(1.5);
    h.host.setGuestGain(p.invite.peerId, -1);
    expect(h.host.getPeer(p.invite.peerId)?.gain).toBe(0);
    h.host.setGuestGain(p.invite.peerId, 0.8);
    expect(h.host.getPeer(p.invite.peerId)?.gain).toBe(0.8);
    expect(h.host.setGuestGain(p.invite.peerId, Number.NaN)).toBe(false);
    expect(h.host.setGuestGain(p.invite.peerId, Number.POSITIVE_INFINITY)).toBe(
      false,
    );
    expect(h.host.getPeer(p.invite.peerId)?.gain).toBe(0.8);
    expect(h.host.setGuestMuted(p.invite.peerId, true)).toBe(true);
    expect(h.host.getPeer(p.invite.peerId)?.muted).toBe(true);
  });
});

describe("program stream", () => {
  it("swaps tracks into viewer and guest senders, never into remote peers", async () => {
    const h = makeHarness();
    const viewer = await makePair(h, "viewer");
    const guest = await makePair(h, "guest");
    const remote = await makePair(h, "remote");
    const program = fakeStream("video", "audio") as unknown as FakeStream;
    h.host.setProgramStream(program as unknown as MediaStream);
    await settle();
    for (const p of [viewer, guest]) {
      const [video, audio] = p.hostPc.transceivers;
      expect(video?.sender.track).toBe(program.getVideoTracks()[0]);
      expect(audio?.sender.track).toBe(program.getAudioTracks()[0]);
    }
    expect(remote.hostPc.transceivers).toHaveLength(0);

    h.host.setProgramStream(null);
    await settle();
    expect(
      viewer.hostPc.transceivers.every((t) => t.sender.track === null),
    ).toBe(true);
  });

  it("applies the current program to peers invited later and avoids redundant swaps", async () => {
    const h = makeHarness();
    const program = fakeStream("video", "audio") as unknown as FakeStream;
    h.host.setProgramStream(program as unknown as MediaStream);
    const p = await makePair(h, "viewer");
    const [video] = p.hostPc.transceivers;
    expect(video?.sender.track).toBe(program.getVideoTracks()[0]);
    expect(video?.sender.replaced).toHaveLength(1);
    h.host.setProgramStream(program as unknown as MediaStream);
    await settle();
    expect(video?.sender.replaced).toHaveLength(1);
  });

  it("never stops program tracks (they belong to the runtime), even on kick/dispose", async () => {
    const h = makeHarness();
    const program = fakeStream("video", "audio") as unknown as FakeStream;
    h.host.setProgramStream(program as unknown as MediaStream);
    const p = await makePair(h, "viewer");
    h.host.kick(p.invite.peerId);
    h.host.dispose();
    expect(program.tracks.every((t) => t.stopCalls === 0)).toBe(true);
  });

  it("tolerates senders that reject replaceTrack", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer");
    for (const t of p.hostPc.transceivers) t.sender.failReplace = true;
    expect(() =>
      h.host.setProgramStream(fakeStream("video", "audio")),
    ).not.toThrow();
    await settle();
    expect(statusOf(h.host, p.invite.peerId)).toBe("connected");
  });

  it("handles streams with only one kind of track", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer");
    h.host.setProgramStream(fakeStream("video"));
    await settle();
    const [video, audio] = p.hostPc.transceivers;
    expect(video?.sender.track).not.toBeNull();
    expect(audio?.sender.track).toBeNull();
  });
});

describe("remote control", () => {
  it("delivers validated commands from remote peers to every handler", async () => {
    const h = makeHarness();
    const p = await makePair(h, "remote");
    const a = vi.fn();
    const b = vi.fn();
    h.host.onRemoteCommand(a);
    const offB = h.host.onRemoteCommand(b);
    expect(p.client.sendCommand({ kind: "scene", id: "sc_2" })).toBe(true);
    expect(p.client.sendCommand({ kind: "prompter", action: "toggle" })).toBe(
      true,
    );
    expect(a).toHaveBeenNthCalledWith(1, p.invite.peerId, {
      kind: "scene",
      id: "sc_2",
    });
    expect(a).toHaveBeenNthCalledWith(2, p.invite.peerId, {
      kind: "prompter",
      action: "toggle",
    });
    expect(b).toHaveBeenCalledTimes(2);
    offB();
    p.client.sendCommand({ kind: "marker" });
    expect(a).toHaveBeenCalledTimes(3);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("ignores malformed, oversized and unknown messages and isolates throwing handlers", async () => {
    const h = makeHarness();
    const p = await makePair(h, "remote");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = vi.fn();
    h.host.onRemoteCommand(() => {
      throw new Error("handler bug");
    });
    h.host.onRemoteCommand(handler);
    inject(p, "not json");
    inject(p, { type: "remote-cmd", cmd: { kind: "scene-index", index: -1 } });
    inject(p, { type: "remote-cmd", cmd: { kind: "format-disk" } });
    inject(p, { type: "remote-cmd", cmd: { kind: "marker" }, extra: 1 });
    inject(
      p,
      '{"type":"remote-cmd","cmd":{"kind":"marker"},"__proto__":{"x":1}}',
    );
    inject(p, "x".repeat(70 * 1024));
    inject(p, { type: "hello", peerId: "spoof" }); // host-only type
    expect(handler).not.toHaveBeenCalled();
    inject(p, { type: "remote-cmd", cmd: { kind: "marker" } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled();
    expect(statusOf(h.host, p.invite.peerId)).toBe("connected");
  });

  it("drops connections that keep sending garbage", async () => {
    const h = makeHarness();
    const p = await makePair(h, "remote");
    for (let i = 0; i < 50; i++) inject(p, "garbage");
    expect(statusOf(h.host, p.invite.peerId)).toBe("connected");
    inject(p, "garbage");
    expect(statusOf(h.host, p.invite.peerId)).toBe("disconnected");
  });

  it("rate limits floods of valid commands", async () => {
    const h = makeHarness();
    const p = await makePair(h, "remote");
    const handler = vi.fn();
    h.host.onRemoteCommand(handler);
    for (let i = 0; i < 200; i++)
      inject(p, { type: "remote-cmd", cmd: { kind: "marker" } });
    // 60 messages per one-second window; the client's `role` greeting at connect already used one
    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(59);
    expect(handler.mock.calls.length).toBeLessThanOrEqual(60);
    expect(statusOf(h.host, p.invite.peerId)).toBe("connected");
  });

  it("ignores reserved in-band sdp/ice messages", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer");
    const spy = vi.spyOn(p.hostPc, "setRemoteDescription");
    inject(p, { type: "sdp", description: { type: "offer", sdp: "v=0" } });
    inject(p, { type: "ice", candidate: { candidate: "candidate:1" } });
    expect(spy).not.toHaveBeenCalled();
    expect(statusOf(h.host, p.invite.peerId)).toBe("connected");
  });

  describe("broadcastRemoteState", () => {
    const remoteStates = (p: Pair) =>
      p.hostDc.sentMessages().filter((m) => m["type"] === "remote-state");

    it("sends to remote peers only, coalesced to 10 Hz with the latest state winning", async () => {
      const h = makeHarness();
      const remote = await makePair(h, "remote");
      const viewer = await makePair(h, "viewer");
      const guest = await makePair(h, "guest");
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);

      h.host.broadcastRemoteState({ ...STATE, recordingMs: 1 });
      expect(remoteStates(remote)).toHaveLength(1); // leading edge is immediate
      h.host.broadcastRemoteState({ ...STATE, recordingMs: 2 });
      h.host.broadcastRemoteState({ ...STATE, recordingMs: 3 });
      expect(remoteStates(remote)).toHaveLength(1);
      vi.advanceTimersByTime(REMOTE_STATE_MIN_INTERVAL_MS - 1);
      expect(remoteStates(remote)).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(remoteStates(remote)).toHaveLength(2); // trailing edge
      expect(
        (remoteStates(remote)[1] as { state: RemoteState }).state.recordingMs,
      ).toBe(3);

      // sustained calls never exceed 10 messages per second
      for (let t = 0; t < 1000; t += 10) {
        h.host.broadcastRemoteState({ ...STATE, recordingMs: 100 + t });
        vi.advanceTimersByTime(10);
      }
      vi.advanceTimersByTime(200);
      const sent = remoteStates(remote).length - 2;
      expect(sent).toBeGreaterThanOrEqual(9);
      expect(sent).toBeLessThanOrEqual(11);

      expect(remoteStates(viewer)).toHaveLength(0);
      expect(remoteStates(guest)).toHaveLength(0);
    });

    it("does not re-send an unchanged state", async () => {
      const h = makeHarness();
      const remote = await makePair(h, "remote");
      vi.useFakeTimers();
      vi.setSystemTime(2_000_000);
      h.host.broadcastRemoteState(STATE);
      vi.advanceTimersByTime(REMOTE_STATE_MIN_INTERVAL_MS);
      h.host.broadcastRemoteState({ ...STATE });
      vi.advanceTimersByTime(REMOTE_STATE_MIN_INTERVAL_MS);
      expect(remoteStates(remote)).toHaveLength(1);
      h.host.broadcastRemoteState({ ...STATE, recording: true });
      expect(remoteStates(remote)).toHaveLength(2);
    });

    it("hands the latest state to a remote that connects later and to the client listeners", async () => {
      const h = makeHarness();
      h.host.broadcastRemoteState(STATE);
      const remote = await makePair(h, "remote");
      expect(remote.client.remoteState).toEqual(STATE);
      const seen: RemoteState[] = [];
      remote.client.onRemoteState((s) => void seen.push(s)); // replays the current state
      expect(seen).toEqual([STATE]);
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 10_000);
      h.host.broadcastRemoteState({
        ...STATE,
        recording: true,
        recordingMs: 5000,
      });
      expect(seen.at(-1)).toMatchObject({ recording: true, recordingMs: 5000 });
    });

    it("stops sending to disconnected remotes and after dispose", async () => {
      const h = makeHarness();
      const remote = await makePair(h, "remote");
      remote.hostPc.setHealth("failed");
      const before = remote.hostDc.sent.length;
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 10_000);
      h.host.broadcastRemoteState(STATE);
      expect(remote.hostDc.sent.length).toBe(before);
      h.host.dispose();
      expect(() => h.host.broadcastRemoteState(STATE)).not.toThrow();
    });

    it("survives a channel that throws on send or is backed up", async () => {
      const h = makeHarness();
      const remote = await makePair(h, "remote");
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 10_000);
      remote.hostDc.throwOnSend = true;
      expect(() => h.host.broadcastRemoteState(STATE)).not.toThrow();
      remote.hostDc.throwOnSend = false;
      remote.hostDc.bufferedAmount = 10 * 1024 * 1024;
      vi.advanceTimersByTime(REMOTE_STATE_MIN_INTERVAL_MS);
      const sentBefore = remote.hostDc.sent.length;
      h.host.broadcastRemoteState({ ...STATE, recordingMs: 99 });
      expect(remote.hostDc.sent.length).toBe(sentBefore);
      remote.hostDc.bufferedAmount = 0;
      vi.advanceTimersByTime(REMOTE_STATE_MIN_INTERVAL_MS);
      h.host.broadcastRemoteState({ ...STATE, recordingMs: 100 });
      expect(remote.hostDc.sent.length).toBe(sentBefore + 1);
    });
  });
});

describe("dispose", () => {
  it("closes every connection, clears state and rejects further use", async () => {
    const h = makeHarness();
    const a = await makePair(h, "viewer");
    const b = await makePair(h, "guest");
    const listener = vi.fn();
    h.host.subscribe(listener);
    h.host.dispose();
    h.host.dispose(); // idempotent
    expect(a.hostPc.closed && b.hostPc.closed).toBe(true);
    expect(h.host.getPeers()).toEqual([]);
    expect(h.host.getPeers()).toBe(h.host.getPeers());
    expect(listener).not.toHaveBeenCalled();
    await expect(h.host.createInvite("viewer")).rejects.toMatchObject({
      code: "disposed",
    });
    expect(() => h.host.setProgramStream(fakeStream("video"))).not.toThrow();
    expect(h.host.kick(a.invite.peerId)).toBe(false);
    expect(a.client.status).toBe("disconnected");
  });

  it("aborts an in-flight invite immediately instead of waiting for the ICE timeout", async () => {
    const h = makeHarness({ iceTimeoutMs: 60_000 });
    h.net.options.neverGather = true;
    const pending = h.host.createInvite("viewer");
    await settle();
    const started = Date.now();
    h.host.dispose();
    await expect(pending).rejects.toMatchObject({ code: "disposed" });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(h.net.pcs[0]?.closed).toBe(true);
  });

  it("does not leak timers: a disposed host with pending invites stays quiet", async () => {
    const h = makeHarness({ inviteTtlMs: 30 });
    await h.host.createInvite("viewer");
    h.host.dispose();
    await sleep(80);
    expect(h.host.getPeers()).toEqual([]);
  });
});

describe("misc", () => {
  it("adopts the pre-negotiated receiver tracks even when no track events fire", async () => {
    const h = makeHarness();
    h.net.options.suppressTrackEvents = true;
    const p = await makePair(h, "guest");
    await p.client.startGuest(fakeStream("video", "audio"), "Ayşe");
    await settle();
    const stream = h.host.getGuestStream(
      p.invite.peerId,
    ) as unknown as FakeStream;
    expect(stream.tracks).toEqual(
      p.hostPc.transceivers.map((t) => t.receiver.track),
    );
    expect(h.host.getPeer(p.invite.peerId)?.status).toBe("waiting");
  });

  it("ignores inbound tracks from viewers and non-guests", async () => {
    const h = makeHarness();
    const events = vi.fn();
    h.host.onGuestStream(events);
    const p = await makePair(h, "viewer");
    p.hostPc.bus.emit("track", { track: fakeTrack("video"), streams: [] });
    expect(events).not.toHaveBeenCalled();
    expect(h.host.getGuestStream(p.invite.peerId)).toBeNull();
  });
});
