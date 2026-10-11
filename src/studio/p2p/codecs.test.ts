import { describe, expect, it, vi } from "vitest";
import { applyCompactCodecs, selectCompactCodecs } from "./codecs";
import {
  CHROME_LIKE_AUDIO,
  CHROME_LIKE_VIDEO,
  FakeTransceiver,
} from "./__fakes__/fake-rtc";

const mimes = (codecs: readonly { mimeType: string }[] | null) =>
  codecs?.map((c) => c.mimeType);

describe("selectCompactCodecs", () => {
  it("keeps only opus for audio", () => {
    expect(mimes(selectCompactCodecs("audio", CHROME_LIKE_AUDIO))).toEqual([
      "audio/opus",
    ]);
  });

  it("keeps VP8, H264 and rtx for video, preserving the browser's order", () => {
    expect(mimes(selectCompactCodecs("video", CHROME_LIKE_VIDEO))).toEqual([
      "video/VP8",
      "video/H264",
      "video/rtx",
    ]);
    const reordered = [...CHROME_LIKE_VIDEO].reverse();
    expect(mimes(selectCompactCodecs("video", reordered))).toEqual([
      "video/rtx",
      "video/H264",
      "video/VP8",
    ]);
  });

  it("matches mime types case-insensitively", () => {
    const caps = [
      { mimeType: "VIDEO/vp8", clockRate: 90000 },
      { mimeType: "video/vp9", clockRate: 90000 },
    ];
    expect(mimes(selectCompactCodecs("video", caps))).toEqual(["VIDEO/vp8"]);
  });

  it("returns null (leave defaults alone) when no safe restriction exists", () => {
    expect(selectCompactCodecs("video", [])).toBeNull();
    expect(selectCompactCodecs("audio", [])).toBeNull();
    // only codecs we would drop
    expect(
      selectCompactCodecs("video", [
        { mimeType: "video/VP9", clockRate: 90000 },
        { mimeType: "video/AV1", clockRate: 90000 },
      ]),
    ).toBeNull();
    // only rtx is not a usable selection
    expect(
      selectCompactCodecs("video", [
        { mimeType: "video/rtx", clockRate: 90000 },
        { mimeType: "video/VP9", clockRate: 90000 },
      ]),
    ).toBeNull();
    // opus missing
    expect(
      selectCompactCodecs("audio", [
        { mimeType: "audio/PCMU", clockRate: 8000 },
      ]),
    ).toBeNull();
    // nothing to drop
    expect(
      selectCompactCodecs("audio", [
        { mimeType: "audio/opus", clockRate: 48000, channels: 2 },
      ]),
    ).toBeNull();
  });

  it("does not mutate its input", () => {
    const copy = JSON.stringify(CHROME_LIKE_VIDEO);
    selectCompactCodecs("video", CHROME_LIKE_VIDEO);
    expect(JSON.stringify(CHROME_LIKE_VIDEO)).toBe(copy);
  });
});

describe("applyCompactCodecs", () => {
  const caps = (kind: "audio" | "video") =>
    kind === "audio" ? CHROME_LIKE_AUDIO : CHROME_LIKE_VIDEO;

  it("applies the selection per transceiver kind", () => {
    const audio = new FakeTransceiver("audio", "sendrecv");
    const video = new FakeTransceiver("video", "sendrecv");
    expect(applyCompactCodecs([audio, video], caps)).toBe(2);
    expect(mimes(audio.codecPrefs)).toEqual(["audio/opus"]);
    expect(mimes(video.codecPrefs)).toEqual([
      "video/VP8",
      "video/H264",
      "video/rtx",
    ]);
  });

  it("does nothing without a capability source or without data", () => {
    const video = new FakeTransceiver("video", "sendrecv");
    expect(applyCompactCodecs([video], undefined)).toBe(0);
    expect(applyCompactCodecs([video], () => null)).toBe(0);
    expect(video.codecPrefs).toBeNull();
  });

  it("skips transceivers that cannot set codec preferences", () => {
    const video = new FakeTransceiver("video", "sendrecv");
    Object.defineProperty(video, "setCodecPreferences", { value: undefined });
    expect(applyCompactCodecs([video], caps)).toBe(0);
  });

  it("never throws: failures leave defaults and do not stop the other transceivers", () => {
    const bad = new FakeTransceiver("video", "sendrecv");
    bad.throwOnCodecPrefs = true;
    const good = new FakeTransceiver("audio", "sendrecv");
    expect(applyCompactCodecs([bad, good], caps)).toBe(1);
    expect(bad.codecPrefs).toBeNull();
    expect(mimes(good.codecPrefs)).toEqual(["audio/opus"]);
    const throwingSource = vi.fn(() => {
      throw new Error("no capabilities");
    });
    expect(() => applyCompactCodecs([good], throwingSource)).not.toThrow();
  });
});
