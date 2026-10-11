import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioClient, type ClientStatus } from "./client";
import { P2PError } from "./errors";
import { SignalError, decodeSignal, encodeSignal } from "./signaling";
import {
  FakeDataChannel,
  FakeStream,
  FakeTransceiver,
  asFake,
  fakeRtcFactory,
  fakeStream,
  settle,
} from "./__fakes__/fake-rtc";
import { makeHarness, makePair } from "./__fakes__/pair";
import type { RemoteState } from "../types";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const STATE: RemoteState = {
  scenes: [{ id: "a", name: "Solo" }],
  activeSceneId: "a",
  recording: true,
  micMuted: true,
  prompterPlaying: false,
  prompterSpeed: 40,
  recordingMs: 1234,
};

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

function track(client: StudioClient): ClientStatus[] {
  const seen: ClientStatus[] = [];
  client.onStatus((status) => void seen.push(status));
  return seen;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("StudioClient.acceptOffer", () => {
  it("rejects invalid, foreign and wrongly-directed codes", async () => {
    const h = makeHarness();
    const factory = { rtcFactory: fakeRtcFactory(h.net) };
    const bad = await rejection(StudioClient.acceptOffer("nonsense", factory));
    expect(bad).toBeInstanceOf(SignalError);
    expect((bad as SignalError).code).toBe("bad-prefix");
    const corrupt = await rejection(
      StudioClient.acceptOffer("TKZ1.AAAAAAAA", factory),
    );
    expect((corrupt as SignalError).code).toBe("corrupt");
    const p = await makePair(h, "viewer", { connect: false });
    await expect(
      StudioClient.acceptOffer(p.answerCode, factory),
    ).rejects.toMatchObject({
      code: "wrong-direction",
    });
    expect(h.net.pcs.length).toBe(2); // no peer connection leaked by the failed attempts
  });

  it("throws a typed 'unsupported' error when WebRTC is missing and no factory is injected", async () => {
    const h = makeHarness();
    const invite = await h.host.createInvite("viewer");
    expect(typeof RTCPeerConnection).toBe("undefined");
    await expect(StudioClient.acceptOffer(invite.code)).rejects.toMatchObject({
      code: "unsupported",
    });
  });

  it("defaults the role to viewer when the offer has none", async () => {
    const h = makeHarness();
    const invite = await h.host.createInvite("viewer");
    const offer = await decodeSignal(invite.code);
    const code = await encodeSignal({ type: "offer", sdp: offer.sdp });
    const { client, answerCode } = await StudioClient.acceptOffer(code, {
      rtcFactory: fakeRtcFactory(h.net),
    });
    expect(client.role).toBe("viewer");
    expect((await decodeSignal(answerCode)).role).toBe("viewer");
  });

  it("answers with the offer's role and the right directions", async () => {
    const h = makeHarness();
    const viewer = await makePair(h, "viewer", { connect: false });
    const answer = await decodeSignal(viewer.answerCode);
    expect(answer).toMatchObject({ type: "answer", role: "viewer" });
    expect(answer.sdp.match(/^a=recvonly/gm)).toHaveLength(2);
    expect(answer.sdp).toContain("a=candidate:");

    const guest = await makePair(h, "guest", { connect: false });
    const guestAnswer = await decodeSignal(guest.answerCode);
    expect(guestAnswer.role).toBe("guest");
    // pre-negotiated senders: the guest must answer sendrecv so replaceTrack works later
    expect(guestAnswer.sdp.match(/^a=sendrecv/gm)).toHaveLength(2);
  });

  it("maps a browser-rejected offer to bad-sdp and closes the connection", async () => {
    const h = makeHarness();
    const invite = await h.host.createInvite("viewer");
    h.net.options.rejectRemote = true;
    await expect(
      StudioClient.acceptOffer(invite.code, {
        rtcFactory: fakeRtcFactory(h.net),
      }),
    ).rejects.toMatchObject({ code: "bad-sdp" });
    expect(h.net.pcs.at(-1)?.closed).toBe(true);
  });

  it("fails with ice-failed when no candidate was gathered", async () => {
    const h = makeHarness();
    const invite = await h.host.createInvite("viewer");
    h.net.options.noCandidates = true;
    await expect(
      StudioClient.acceptOffer(invite.code, {
        rtcFactory: fakeRtcFactory(h.net),
      }),
    ).rejects.toMatchObject({ code: "ice-failed" });
    expect(h.net.pcs.at(-1)?.closed).toBe(true);
  });

  it("proceeds with partial candidates after the gathering timeout", async () => {
    const h = makeHarness();
    const invite = await h.host.createInvite("viewer");
    h.net.options.neverGather = true;
    const { answerCode } = await StudioClient.acceptOffer(invite.code, {
      rtcFactory: fakeRtcFactory(h.net),
      iceTimeoutMs: 30,
    });
    expect((await decodeSignal(answerCode)).sdp).toContain("a=candidate:");
  });

  it("passes the public STUN preference through (default: none)", async () => {
    const h = makeHarness();
    const invite = await h.host.createInvite("viewer");
    await StudioClient.acceptOffer(invite.code, {
      rtcFactory: fakeRtcFactory(h.net),
    });
    await StudioClient.acceptOffer(invite.code, {
      rtcFactory: fakeRtcFactory(h.net),
      usePublicStun: true,
    });
    expect(h.net.pcs.at(-2)?.config.iceServers).toEqual([]);
    expect(h.net.pcs.at(-1)?.config.iceServers).toHaveLength(1);
  });

  it("stops waiting for ICE immediately when the connection fails mid-gathering", async () => {
    const h = makeHarness();
    const invite = await h.host.createInvite("viewer");
    h.net.options.neverGather = true;
    const pending = StudioClient.acceptOffer(invite.code, {
      rtcFactory: fakeRtcFactory(h.net),
      iceTimeoutMs: 60_000,
    });
    // the client's peer connection only exists once the code has been decoded (async)
    for (
      let i = 0;
      i < 200 && h.net.pcs[1]?.iceGatheringState !== "gathering";
      i++
    )
      await sleep(5);
    expect(h.net.pcs[1]?.iceGatheringState).toBe("gathering");
    const started = Date.now();
    h.net.pcs[1]?.setHealth("failed");
    await expect(pending).rejects.toMatchObject({ code: "disposed" });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(h.net.pcs[1]?.closed).toBe(true);
  });
});

describe("viewer", () => {
  it("delivers one stream with the program tracks, replays it, and allows unsubscribe", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer", { connect: false });
    expect(p.client.status).toBe("connecting");
    const streams: MediaStream[] = [];
    const off = p.client.onStream((s) => void streams.push(s));
    expect(streams).toHaveLength(1); // both pre-negotiated tracks coalesced into one callback
    const fake = streams[0] as unknown as FakeStream;
    expect(fake.tracks).toEqual(
      p.clientPc.transceivers.map((t) => asFake(t.receiver.track)),
    );
    expect(fake.tracks.map((t) => t.kind)).toEqual(["video", "audio"]);
    expect(p.client.stream).toBe(streams[0]);
    const late: MediaStream[] = [];
    p.client.onStream((s) => void late.push(s));
    expect(late).toEqual([streams[0]]);
    off();
    await h.host.acceptAnswer(p.invite.peerId, p.answerCode);
    await settle();
    expect(streams).toHaveLength(1);
  });

  it("gets its stream from the receivers even when no track events fire", async () => {
    const h = makeHarness();
    h.net.options.suppressTrackEvents = true;
    const p = await makePair(h, "viewer", { connect: false });
    const stream = p.client.stream as unknown as FakeStream;
    expect(stream.tracks).toEqual(
      p.clientPc.transceivers.map((t) => t.receiver.track),
    );
  });

  it("goes connecting -> connected and learns its peer id", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer", { connect: false });
    const seen = track(p.client);
    expect(p.client.peerId).toBeNull();
    await h.host.acceptAnswer(p.invite.peerId, p.answerCode);
    await settle();
    expect(seen).toEqual(["connecting", "connected"]);
    expect(p.client.peerId).toBe(p.invite.peerId);
  });

  it("rejects role-specific calls with wrong-role", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer");
    await expect(
      p.client.startGuest(fakeStream("video"), "x"),
    ).rejects.toMatchObject({
      code: "wrong-role",
    });
    await expect(p.client.leaveGuest()).rejects.toMatchObject({
      code: "wrong-role",
    });
    expect(() => p.client.sendCommand({ kind: "marker" })).toThrow(P2PError);
  });

  it("ignores guest decisions and remote state meant for other roles", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer");
    for (const type of [
      "guest-approved",
      "guest-on-air",
      "guest-off-air",
      "guest-rejected",
    ]) {
      p.hostDc.send(JSON.stringify({ type }));
    }
    p.hostDc.send(JSON.stringify({ type: "remote-state", state: STATE }));
    expect(p.client.status).toBe("connected");
    expect(p.client.remoteState).toBeNull();
  });
});

describe("guest", () => {
  it("validates what it is asked to publish", async () => {
    const h = makeHarness();
    const p = await makePair(h, "guest");
    await expect(p.client.startGuest(fakeStream(), "x")).rejects.toMatchObject({
      code: "no-device",
    });
    expect(p.client.status).toBe("connected");
  });

  it("publishes tracks into the pre-negotiated senders and walks through the host's decisions", async () => {
    const h = makeHarness();
    const p = await makePair(h, "guest");
    const seen = track(p.client);
    const local = fakeStream("video", "audio") as unknown as FakeStream;
    await p.client.startGuest(local as unknown as MediaStream, "  Ayşe  ");
    await settle();
    expect(p.client.name).toBe("Ayşe");
    const [video, audio] = p.clientPc.transceivers;
    expect(video?.sender.track).toBe(local.getVideoTracks()[0]);
    expect(audio?.sender.track).toBe(local.getAudioTracks()[0]);
    h.host.bringOnAir(p.invite.peerId);
    h.host.takeOffAir(p.invite.peerId);
    h.host.rejectGuest(p.invite.peerId);
    expect(seen).toEqual([
      "connected",
      "requesting",
      "waiting",
      "on-air",
      "waiting",
      "rejected",
    ]);
    // refused: nothing is sent any more, and late decisions for a finished request are ignored
    expect(p.clientPc.transceivers.every((t) => t.sender.track === null)).toBe(
      true,
    );
    p.hostDc.send(JSON.stringify({ type: "guest-on-air" }));
    expect(p.client.status).toBe("rejected");
    // the local tracks are the caller's: the client never stops them
    expect(local.tracks.every((t) => t.stopCalls === 0)).toBe(true);
  });

  it("announces itself on connect and sends the join request exactly once", async () => {
    const h = makeHarness();
    const p = await makePair(h, "guest", { clientName: "Ayşe" });
    await p.client.startGuest(fakeStream("video", "audio"), "Ayşe");
    const types = p
      .clientDc()
      .sentMessages()
      .map((m) => m["type"]);
    expect(types).toEqual(["role", "join-request"]);
    expect(p.clientDc().sentMessages()[0]).toEqual({
      type: "role",
      role: "guest",
      name: "Ayşe",
    });
  });

  it("queues the join request when asked before the connection is up", async () => {
    const h = makeHarness();
    const p = await makePair(h, "guest", { connect: false });
    const seen = track(p.client);
    await p.client.startGuest(fakeStream("video", "audio"), "Ayşe");
    expect(p.client.status).toBe("requesting");
    expect(h.host.getPeer(p.invite.peerId)?.status).toBe("connecting");
    await h.host.acceptAnswer(p.invite.peerId, p.answerCode);
    await settle();
    expect(h.host.getPeer(p.invite.peerId)).toMatchObject({
      status: "waiting",
      name: "Ayşe",
    });
    expect(seen).toEqual(["connecting", "requesting", "waiting"]);
  });

  it("can publish audio only", async () => {
    const h = makeHarness();
    const p = await makePair(h, "guest");
    await p.client.startGuest(fakeStream("audio"), "Radyo");
    const [video, audio] = p.clientPc.transceivers;
    expect(video?.sender.replaced).toEqual([]);
    expect(audio?.sender.track).not.toBeNull();
  });

  it("leaves the green room but keeps watching", async () => {
    const h = makeHarness();
    const p = await makePair(h, "guest");
    await p.client.startGuest(fakeStream("video", "audio"), "Ayşe");
    await settle();
    await p.client.leaveGuest();
    await settle();
    expect(p.client.status).toBe("connected");
    expect(p.clientPc.transceivers.every((t) => t.sender.track === null)).toBe(
      true,
    );
    expect(p.clientDc().sentMessages().at(-1)).toEqual({
      type: "role",
      role: "viewer",
      name: "Ayşe",
    });
    // late approval of the abandoned request is ignored
    p.hostDc.send(JSON.stringify({ type: "guest-approved" }));
    expect(p.client.status).toBe("connected");
    // and joining again works
    await p.client.startGuest(fakeStream("video", "audio"), "Ayşe");
    await settle();
    expect(p.client.status).toBe("waiting");
  });

  it("ignores guest decisions before it asked to join", async () => {
    const h = makeHarness();
    const p = await makePair(h, "guest");
    p.hostDc.send(JSON.stringify({ type: "guest-on-air" }));
    expect(p.client.status).toBe("connected");
  });

  it("rolls back a half-applied publish when only one sender fails", async () => {
    const h = makeHarness();
    const p = await makePair(h, "guest");
    const [video, audio] = p.clientPc.transceivers;
    (audio as FakeTransceiver).sender.failReplace = true;
    await expect(
      p.client.startGuest(fakeStream("video", "audio"), "x"),
    ).rejects.toThrow("replace failed");
    expect((video as FakeTransceiver).sender.track).toBeNull(); // no media left attached
    expect(p.client.status).toBe("connected");
    expect(h.host.getPeer(p.invite.peerId)?.status).toBe("connected");
  });

  it("surfaces replaceTrack failures from startGuest without joining", async () => {
    const h = makeHarness();
    const p = await makePair(h, "guest");
    for (const t of p.clientPc.transceivers) t.sender.failReplace = true;
    await expect(
      p.client.startGuest(fakeStream("video", "audio"), "x"),
    ).rejects.toThrow("replace failed");
    expect(p.client.status).toBe("connected");
    expect(h.host.getPeer(p.invite.peerId)?.status).toBe("connected");
  });
});

describe("remote", () => {
  it("sends commands over the control channel and receives state", async () => {
    const h = makeHarness();
    const p = await makePair(h, "remote");
    expect(p.client.sendCommand({ kind: "record", action: "toggle" })).toBe(
      true,
    );
    expect(p.clientDc().sentMessages().at(-1)).toEqual({
      type: "remote-cmd",
      cmd: { kind: "record", action: "toggle" },
    });
    const states: RemoteState[] = [];
    p.client.onRemoteState((s) => void states.push(s));
    p.hostDc.send(JSON.stringify({ type: "remote-state", state: STATE }));
    expect(states).toEqual([STATE]);
    expect(p.client.remoteState).toEqual(STATE);
  });

  it("refuses malformed commands and unsent commands return false", async () => {
    const h = makeHarness();
    const p = await makePair(h, "remote", { connect: false });
    expect(p.client.sendCommand({ kind: "marker" })).toBe(false); // channel not open yet
    await h.host.acceptAnswer(p.invite.peerId, p.answerCode);
    await settle();
    const before = p.clientDc().sent.length;
    expect(p.client.sendCommand({ kind: "scene-index", index: -1 })).toBe(
      false,
    );
    expect(p.client.sendCommand({ kind: "nuke" } as never)).toBe(false);
    expect(p.client.sendCommand(null as never)).toBe(false);
    expect(p.clientDc().sent.length).toBe(before);
    p.clientDc().bufferedAmount = 10 * 1024 * 1024;
    expect(p.client.sendCommand({ kind: "marker" })).toBe(false); // backed up
    p.clientDc().bufferedAmount = 0;
    p.clientDc().throwOnSend = true;
    expect(p.client.sendCommand({ kind: "marker" })).toBe(false); // send failure is not an exception
  });

  it("drops invalid frames from the host", async () => {
    const h = makeHarness();
    const p = await makePair(h, "remote");
    const states = vi.fn();
    p.client.onRemoteState(states);
    p.hostDc.send("garbage");
    p.hostDc.send(
      JSON.stringify({
        type: "remote-state",
        state: { ...STATE, scenes: "x" },
      }),
    );
    p.hostDc.send(
      JSON.stringify({ type: "remote-state", state: STATE, extra: 1 }),
    );
    p.hostDc.send(JSON.stringify({ type: "hello", peerId: "" }));
    p.hostDc.send(
      JSON.stringify({
        type: "sdp",
        description: { type: "offer", sdp: "v=0" },
      }),
    ); // reserved
    expect(states).not.toHaveBeenCalled();
    expect(p.client.peerId).toBe(p.invite.peerId);
    expect(p.client.status).toBe("connected");
  });

  it("does not receive media transceivers", async () => {
    const h = makeHarness();
    const p = await makePair(h, "remote");
    expect(p.clientPc.transceivers).toHaveLength(0);
    expect(p.client.stream).toBeNull();
  });
});

describe("lifecycle", () => {
  it("dispose is idempotent, closes everything and silences listeners", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer");
    const statuses = track(p.client);
    const stream = vi.fn();
    p.client.onStream(stream);
    stream.mockClear();
    const inbound = p.clientPc.transceivers.map((t) =>
      asFake(t.receiver.track),
    );
    p.client.dispose();
    p.client.dispose();
    expect(statuses).toEqual(["connected", "disconnected"]);
    expect(p.client.status).toBe("disconnected");
    expect(p.clientPc.closed).toBe(true);
    expect(p.clientDc().readyState).toBe("closed");
    expect(inbound.every((t) => t.stopCalls === 1)).toBe(true);
    expect(p.clientPc.listenerCount("track")).toBe(0);
    expect(p.clientDc().listenerCount("message")).toBe(0);
    // the host notices through the channel
    expect(h.host.getPeer(p.invite.peerId)?.status).toBe("disconnected");
    expect(stream).not.toHaveBeenCalled();
  });

  it("rejects use after dispose with a typed error", async () => {
    const h = makeHarness();
    const guest = await makePair(h, "guest");
    guest.client.dispose();
    await expect(
      guest.client.startGuest(fakeStream("video"), "x"),
    ).rejects.toMatchObject({
      code: "disposed",
    });
    await expect(guest.client.leaveGuest()).rejects.toMatchObject({
      code: "disposed",
    });
    const remote = await makePair(h, "remote");
    remote.client.dispose();
    expect(() => remote.client.sendCommand({ kind: "marker" })).toThrow(
      P2PError,
    );
  });

  it("turns terminal connection failures into 'disconnected'", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer");
    const statuses = track(p.client);
    p.clientPc.setHealth("failed");
    expect(statuses).toEqual(["connected", "disconnected"]);
    expect(p.clientPc.closed).toBe(true);
  });

  it("gives transient ICE 'disconnected' a grace period", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer", {
      client: { disconnectGraceMs: 40 },
    });
    p.clientPc.setHealth("disconnected");
    expect(p.client.status).toBe("connected");
    p.clientPc.setHealth("connected");
    await sleep(80);
    expect(p.client.status).toBe("connected");
    p.clientPc.setHealth("disconnected");
    await sleep(80);
    expect(p.client.status).toBe("disconnected");
  });

  it("disconnects when the host closes the control channel (kick)", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer");
    h.host.kick(p.invite.peerId);
    expect(p.client.status).toBe("disconnected");
  });

  it("only attaches the 'ctl' channel and ignores impostors", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer", { connect: false });
    const evil = new FakeDataChannel("evil");
    p.clientPc.bus.emit("datachannel", { channel: evil });
    expect(evil.listenerCount("message")).toBe(0);
    expect(evil.listenerCount("open")).toBe(0);
  });

  it("isolates throwing status listeners", async () => {
    const h = makeHarness();
    const p = await makePair(h, "viewer", { connect: false });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    p.client.onStatus(() => {
      throw new Error("ui bug");
    });
    const seen = track(p.client);
    await h.host.acceptAnswer(p.invite.peerId, p.answerCode);
    await settle();
    expect(seen).toEqual(["connecting", "connected"]);
    expect(spy).toHaveBeenCalled();
  });
});
