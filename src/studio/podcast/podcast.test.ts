// src/studio/podcast/podcast.test.ts
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROMPTER,
  nextScroll,
  normalizePrompter,
  scrollRatio,
  shouldResync,
  stepSpeed,
  wordCount,
} from "./prompter";
import { openPodcastMic, podcastLink, type MediaDevicesLike } from "./mic";
import { podcastVoicePlan } from "./voice-setup";

describe("prompter maths", () => {
  it("normalises for the wire (text cap, clamped numbers)", () => {
    const p = normalizePrompter({
      text: "x".repeat(30_000),
      speed: -5,
      pos: 4,
      size: 999,
    });
    expect(p.text).toHaveLength(20_000);
    expect(p).toMatchObject({ speed: 0, pos: 1, size: 160, playing: false });
    expect(normalizePrompter({})).toEqual({ ...DEFAULT_PROMPTER });
    expect(normalizePrompter({ speed: Number.NaN }).speed).toBe(0);
  });

  it("scrolls at px/s, stops at the end and ignores pauses", () => {
    expect(nextScroll(0, 1000, 100, 500, true)).toEqual({
      top: 50,
      done: false,
    });
    expect(nextScroll(990, 1000, 100, 500, true)).toEqual({
      top: 1000,
      done: true,
    });
    expect(nextScroll(10, 1000, 100, 500, false)).toEqual({
      top: 10,
      done: false,
    });
    expect(nextScroll(0, 0, 100, 500, true)).toEqual({ top: 0, done: false });
    expect(scrollRatio(250, 1000)).toBe(0.25);
    expect(scrollRatio(5, 0)).toBe(0);
  });

  it("resyncs only on drift while playing, always while paused", () => {
    expect(shouldResync(0.5, 0.51, true)).toBe(false);
    expect(shouldResync(0.5, 0.6, true)).toBe(true);
    expect(shouldResync(0.5, 0.5, false)).toBe(true);
  });

  it("steps the speed inside the list; counts words", () => {
    expect(stepSpeed(40, 1)).toBe(60);
    expect(stepSpeed(40, -1)).toBe(30);
    expect(stepSpeed(10, -1)).toBe(10);
    expect(stepSpeed(160, 1)).toBe(160);
    expect(stepSpeed(45, 1)).toBe(80);
    expect(wordCount("  merhaba  dünya \n evet")).toBe(3);
    expect(wordCount("")).toBe(0);
  });
});

describe("voice plan", () => {
  it("an NVIDIA / RTX / Krisp microphone gets the light 'nvidia' chain without a second suppression", () => {
    for (const label of [
      "Microphone (NVIDIA Broadcast)",
      "Mikrofon (NVIDIA RTX Voice)",
      "Krisp Microphone",
    ]) {
      const p = podcastVoicePlan(label);
      expect(p.ai).not.toBeNull();
      expect(p.summary).toBe("nvidia");
      expect(p.settings).toMatchObject({
        enabled: true,
        preset: "nvidia",
        gate: false,
        ai: false,
      });
      expect(p.constraints).toEqual({
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
      });
    }
  });

  it("any other microphone gets RNNoise + gate + EQ; 'strong' raises the gate and reduction", () => {
    const normal = podcastVoicePlan("Built-in Microphone");
    const strong = podcastVoicePlan("Built-in Microphone", true);
    expect(normal).toMatchObject({ ai: null, summary: "rnnoise" });
    expect(normal.settings).toMatchObject({
      enabled: true,
      ai: true,
      gate: true,
      preset: "podcast",
    });
    expect(strong.summary).toBe("rnnoise-strong");
    expect(strong.settings.gateDb).toBeGreaterThan(normal.settings.gateDb);
    expect(strong.settings.reductionDb).toBeGreaterThan(
      normal.settings.reductionDb,
    );
    expect(podcastVoicePlan(null).summary).toBe("rnnoise");
  });
});

function fakeDevices(
  labels: { id: string; label: string }[],
  failOn?: string,
): MediaDevicesLike & { opened: string[] } {
  const opened: string[] = [];
  const mk = (id: string) => {
    const stopped = { v: false };
    const track = {
      getSettings: () => ({ deviceId: id }),
      label: labels.find((l) => l.id === id)?.label ?? "",
      stop: () => (stopped.v = true),
    } as unknown as MediaStreamTrack;
    return {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream;
  };
  return {
    opened,
    async getUserMedia(c) {
      const exact = (
        (c.audio as MediaTrackConstraints)?.deviceId as
          { exact?: string } | undefined
      )?.exact;
      if (exact && exact === failOn) throw new Error("busy");
      const id = exact ?? labels[0]!.id;
      opened.push(id);
      return mk(id);
    },
    async enumerateDevices() {
      return labels.map(
        (l) =>
          ({
            kind: "audioinput",
            deviceId: l.id,
            label: l.label,
            groupId: "",
            toJSON: () => ({}),
          }) as MediaDeviceInfo,
      );
    },
  };
}

describe("openPodcastMic", () => {
  const devs = [
    { id: "a", label: "Built-in Microphone" },
    { id: "n", label: "Microphone (NVIDIA Broadcast)" },
  ];

  it("switches to the NVIDIA Broadcast microphone when one exists", async () => {
    const d = fakeDevices(devs);
    const m = await openPodcastMic(d);
    expect(d.opened).toEqual(["a", "n"]);
    expect(m.deviceId).toBe("n");
    expect(m.plan.summary).toBe("nvidia");
    expect(m.choices[0]?.ai).toBe("nvidia-broadcast");
  });

  it("keeps the default microphone when there is no AI device, or the AI device is busy", async () => {
    const plain = fakeDevices([devs[0]!]);
    expect((await openPodcastMic(plain)).plan.summary).toBe("rnnoise");
    const busy = fakeDevices(devs, "n");
    const m = await openPodcastMic(busy);
    expect(m.deviceId).toBe("a");
    expect(m.plan.summary).toBe("rnnoise");
  });

  it("honours a chosen device and the strong option", async () => {
    const d = fakeDevices(devs);
    const m = await openPodcastMic(d, { deviceId: "a", strong: true });
    expect(m.deviceId).toBe("a");
    expect(m.plan.summary).toBe("rnnoise-strong");
  });
});

describe("links", () => {
  it("guests and listeners get the podcast view of the room page", () => {
    expect(podcastLink("https://studio.example.org/", "k7m2qx", "guest")).toBe(
      "https://studio.example.org/r/K7M2QX?as=guest&mode=podcast",
    );
    expect(
      podcastLink("https://studio.example.org", "K7M2QX", "listener"),
    ).toBe("https://studio.example.org/r/K7M2QX?as=viewer&mode=podcast");
  });
});

import { mixTargets, prefixedStorage } from "./host";
import type { PeerInfo } from "../types";

const peer = (o: Partial<PeerInfo>): PeerInfo => ({
  id: "a",
  role: "guest",
  name: "A",
  status: "on-air",
  gain: 1,
  muted: false,
  ...o,
});

describe("podcast mix", () => {
  it("only on-air, un-muted guests are heard", () => {
    const m = mixTargets([
      peer({ id: "1" }),
      peer({ id: "2", status: "waiting" }),
      peer({ id: "3", muted: true }),
      peer({ id: "4", gain: 0.5 }),
      peer({ id: "5", role: "viewer" }),
    ]);
    expect(m.get("1")).toBe(1);
    expect(m.get("2")).toBe(0);
    expect(m.get("3")).toBe(0);
    expect(m.get("4")).toBe(0.5);
    expect(m.has("5")).toBe(false);
  });

  it("prefixed storage keeps the podcast room apart", () => {
    const base = new Map<string, string>();
    const st = prefixedStorage("podcast:", {
      getItem: (k: string) => base.get(k) ?? null,
      setItem: (k: string, v: string) => void base.set(k, v),
      removeItem: (k: string) => void base.delete(k),
      length: 0,
      clear: () => undefined,
      key: () => null,
    } as Storage);
    st?.setItem("tkz.room.v1", "x");
    expect([...base.keys()]).toEqual(["podcast:tkz.room.v1"]);
    expect(prefixedStorage("p:", null)).toBeNull();
  });
});
