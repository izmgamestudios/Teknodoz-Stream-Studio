import { describe, expect, it } from "vitest";

import { aiDeviceKind, audioConstraints, listChoices } from "./audio-devices";

const dev = (
  kind: MediaDeviceKind,
  label: string,
  deviceId = label,
): MediaDeviceInfo =>
  ({
    kind,
    label,
    deviceId,
    groupId: "",
    toJSON: () => ({}),
  }) as MediaDeviceInfo;

describe("aiDeviceKind", () => {
  it("recognises the common AI audio devices", () => {
    expect(aiDeviceKind("Microphone (NVIDIA Broadcast)")).toBe(
      "nvidia-broadcast",
    );
    expect(aiDeviceKind("Mikrofon (NVIDIA  Broadcast)")).toBe(
      "nvidia-broadcast",
    );
    expect(aiDeviceKind("Speakers (NVIDIA RTX Voice)")).toBe("rtx-voice");
    expect(aiDeviceKind("Krisp Microphone")).toBe("krisp");
  });
  it("ignores everything else", () => {
    for (const l of [
      "Microphone (Realtek)",
      "Logitech C920",
      "",
      undefined,
      null,
      "NVIDIA GeForce",
    ])
      expect(aiDeviceKind(l)).toBeNull();
  });
});

describe("listChoices", () => {
  const devices = [
    dev("audioinput", "Microphone (Realtek)", "a"),
    dev("audioinput", "Microphone (NVIDIA Broadcast)", "b"),
    dev("videoinput", "Webcam", "c"),
    dev("audiooutput", "Speakers", "d"),
    dev("audioinput", "", "e"),
  ];
  it("filters by kind and puts AI devices first", () => {
    const mics = listChoices(devices, "audioinput");
    expect(mics.map((m) => m.deviceId)).toEqual(["b", "a", "e"]);
    expect(mics[0]!.ai).toBe("nvidia-broadcast");
    expect(mics[2]!.label).toBe("Mikrofon 3"); // unlabeled (no permission yet)
    expect(listChoices(devices, "videoinput")).toHaveLength(1);
  });
  it("skips devices without an id", () => {
    expect(listChoices([dev("audioinput", "x", "")], "audioinput")).toEqual([]);
  });
});

describe("audioConstraints", () => {
  it("keeps the browser processing for normal mics and turns it off for AI devices", () => {
    expect(audioConstraints("m", false)).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      deviceId: { exact: "m" },
    });
    const ai = audioConstraints("m", true);
    expect(ai).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(audioConstraints(undefined, false)).not.toHaveProperty("deviceId");
  });
});
