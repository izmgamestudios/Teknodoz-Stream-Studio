// src/studio/p2p/podcast.test.ts
// Podcast seats: audio-only invites, the guest prompter (role-filtered!) and mute control.
import { describe, expect, it } from "vitest";

import { settle, fakeStream } from "./__fakes__/fake-rtc";
import { makeHarness, makePair } from "./__fakes__/pair";
import {
  MAX_PROMPTER_CHARS,
  parseHostMessage,
  parsePeerMessage,
} from "./protocol";
import type { PodcastPrompter } from "../types";

const STATE: PodcastPrompter = {
  text: "Merhaba dinleyiciler",
  playing: false,
  speed: 40,
  pos: 0,
  size: 48,
};

const types = (pair: {
  hostDc: { sentMessages(): Array<Record<string, unknown>> };
}) => pair.hostDc.sentMessages().map((m) => m["type"]);

describe("audio-only invites", () => {
  it("offer only an audio transceiver (no camera, no program video) and are flagged in PeerInfo", async () => {
    const h = makeHarness();
    const g = await makePair(h, "guest", { audioOnly: true });
    const v = await makePair(h, "viewer", { audioOnly: true });
    const normal = await makePair(h, "guest");
    expect(g.hostPc.transceivers.map((t) => t.kind)).toEqual(["audio"]);
    expect(v.hostPc.transceivers.map((t) => t.kind)).toEqual(["audio"]);
    expect(normal.hostPc.transceivers.map((t) => t.kind)).toEqual([
      "video",
      "audio",
    ]);
    expect(h.host.getPeer(g.invite.peerId)).toMatchObject({
      audioOnly: true,
      role: "guest",
    });
    expect(h.host.getPeer(normal.invite.peerId)?.audioOnly).toBeUndefined();
  });

  it("a remote can never be audio-only (it has no media at all)", async () => {
    const h = makeHarness();
    const r = await makePair(h, "remote", { audioOnly: true });
    expect(r.hostPc.transceivers).toHaveLength(0);
    expect(h.host.getPeer(r.invite.peerId)?.audioOnly).toBeUndefined();
  });

  it("an audio-only guest publishes its microphone and joins the green room", async () => {
    const h = makeHarness();
    const events: string[] = [];
    h.host.onGuestStream(
      (id, s) => void events.push(`${id}:${s ? "on" : "off"}`),
    );
    const g = await makePair(h, "guest", { audioOnly: true });
    await g.client.startGuest(fakeStream("audio"), "Ayşe");
    await settle();
    expect(h.host.getPeer(g.invite.peerId)).toMatchObject({
      status: "waiting",
      name: "Ayşe",
    });
    expect(events).toEqual([`${g.invite.peerId}:on`]);
    expect(h.host.bringOnAir(g.invite.peerId)).toBe(true);
    expect(g.client.status).toBe("on-air");
  });
});

describe("guest prompter privacy", () => {
  it("goes to guests only; viewers (listeners) and remotes never receive it", async () => {
    const h = makeHarness();
    const guest = await makePair(h, "guest", { audioOnly: true });
    const listener = await makePair(h, "viewer", { audioOnly: true });
    const remote = await makePair(h, "remote");
    h.host.setPrompter(STATE);
    await settle();
    expect(types(guest)).toContain("prompter");
    expect(types(listener)).not.toContain("prompter");
    expect(types(remote)).not.toContain("prompter");
    // a guest that connects later gets the latest state on channel open; a listener still does not
    const late = await makePair(h, "guest", { audioOnly: true });
    const lateListener = await makePair(h, "viewer", { audioOnly: true });
    await settle();
    expect(
      late.hostDc.sentMessages().find((m) => m["type"] === "prompter"),
    ).toMatchObject({ state: { text: STATE.text } });
    expect(types(lateListener)).not.toContain("prompter");
  });

  it("a guest-specific script replaces the shared text for that guest only", async () => {
    const h = makeHarness();
    const a = await makePair(h, "guest", { audioOnly: true });
    const b = await makePair(h, "guest", { audioOnly: true });
    h.host.setPrompter(STATE);
    expect(h.host.setPrompterText(a.invite.peerId, "Sadece Ayşe için")).toBe(
      true,
    );
    await settle();
    const lastText = (p: typeof a) =>
      (
        p.hostDc
          .sentMessages()
          .filter((m) => m["type"] === "prompter")
          .at(-1) as { state: PodcastPrompter }
      ).state.text;
    expect(lastText(a)).toBe("Sadece Ayşe için");
    expect(lastText(b)).toBe(STATE.text);
    expect(h.host.getPrompterText(a.invite.peerId)).toBe("Sadece Ayşe için");
    h.host.setPrompterText(a.invite.peerId, null);
    expect(lastText(a)).toBe(STATE.text);
    // unknown / non-guest peers are refused
    const listener = await makePair(h, "viewer", { audioOnly: true });
    expect(h.host.setPrompterText(listener.invite.peerId, "x")).toBe(false);
    expect(h.host.setPrompterText("nope", "x")).toBe(false);
  });

  it("does not repeat identical states and follows playback changes", async () => {
    const h = makeHarness();
    const g = await makePair(h, "guest", { audioOnly: true });
    h.host.setPrompter(STATE);
    h.host.setPrompter({ ...STATE });
    h.host.setPrompter({ ...STATE, playing: true });
    await settle();
    expect(
      g.hostDc.sentMessages().filter((m) => m["type"] === "prompter"),
    ).toHaveLength(2);
  });

  it("reaches the client (guest role only) and is replayed to late listeners", async () => {
    const h = makeHarness();
    const g = await makePair(h, "guest", { audioOnly: true });
    const got: PodcastPrompter[] = [];
    h.host.setPrompter(STATE);
    await settle();
    g.client.onPrompter((s) => got.push(s)); // immediate replay of the latest state
    h.host.setPrompter({ ...STATE, playing: true, pos: 0.3 });
    await settle();
    expect(got.map((s) => [s.playing, s.pos])).toEqual([
      [false, 0],
      [true, 0.3],
    ]);
    // a viewer client ignores a prompter even if one were injected
    const v = await makePair(h, "viewer", { audioOnly: true });
    const seen: PodcastPrompter[] = [];
    v.client.onPrompter((s) => seen.push(s));
    v.clientDc().receive(JSON.stringify({ type: "prompter", state: STATE }));
    expect(seen).toEqual([]);
  });

  it("is validated: oversized text, bad numbers and unknown keys are rejected", () => {
    const ok = JSON.stringify({ type: "prompter", state: STATE });
    expect(parseHostMessage(ok)).toMatchObject({ type: "prompter" });
    for (const bad of [
      { ...STATE, text: "x".repeat(MAX_PROMPTER_CHARS + 1) },
      { ...STATE, speed: -1 },
      { ...STATE, pos: 2 },
      { ...STATE, size: 5 },
      { ...STATE, extra: 1 },
    ])
      expect(
        parseHostMessage(JSON.stringify({ type: "prompter", state: bad })),
      ).toBeNull();
    expect(
      parseHostMessage(JSON.stringify({ type: "mute", muted: "yes" })),
    ).toBeNull();
    expect(
      parsePeerMessage(JSON.stringify({ type: "mic", muted: true })),
    ).toEqual({ type: "mic", muted: true });
    expect(parsePeerMessage(JSON.stringify({ type: "mic" }))).toBeNull();
  });
});

describe("mute control", () => {
  it("the guest reports its own mute; the moderator's mute locks the guest and drives PeerInfo.muted", async () => {
    const h = makeHarness();
    const g = await makePair(h, "guest", { audioOnly: true });
    await g.client.startGuest(fakeStream("audio"), "Ayşe");
    await settle();
    expect(g.client.sendMic(true)).toBe(true);
    await settle();
    expect(h.host.getPeer(g.invite.peerId)?.micMuted).toBe(true);
    g.client.sendMic(false);
    await settle();
    expect(h.host.getPeer(g.invite.peerId)?.micMuted).toBe(false);

    const locks: boolean[] = [];
    g.client.onHostMute((m) => locks.push(m));
    expect(h.host.lockGuestMute(g.invite.peerId, true)).toBe(true);
    await settle();
    expect(h.host.getPeer(g.invite.peerId)?.muted).toBe(true);
    expect(g.client.isHostMuted).toBe(true);
    h.host.lockGuestMute(g.invite.peerId, false);
    await settle();
    expect(locks).toEqual([true, false]);
    expect(g.client.isHostMuted).toBe(false);
  });

  it("only guests have mic / mute: viewers' mic reports are ignored, lockGuestMute refuses them", async () => {
    const h = makeHarness();
    const v = await makePair(h, "viewer", { audioOnly: true });
    v.hostDc.receive(JSON.stringify({ type: "mic", muted: true }));
    expect(h.host.getPeer(v.invite.peerId)?.micMuted).toBeUndefined();
    expect(h.host.lockGuestMute(v.invite.peerId, true)).toBe(false);
    expect(() => v.client.sendMic(true)).toThrow();
  });
});
