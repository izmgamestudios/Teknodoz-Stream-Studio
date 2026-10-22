// src/studio/watch/audio-state.test.ts
import { describe, expect, it } from "vitest";

import {
  AUDIO_PRESETS,
  DEFAULT_AUDIO,
  audioActive,
  newTrack,
  toAudioSpec,
} from "./audio-state";

describe("audio state", () => {
  it("is inactive by default and sends nothing", () => {
    expect(audioActive(DEFAULT_AUDIO)).toBe(false);
    expect(toAudioSpec(DEFAULT_AUDIO)).toBeUndefined();
  });

  it("converts state to the wire format without UI keys", () => {
    const spec = toAudioSpec({
      ...DEFAULT_AUDIO,
      ...AUDIO_PRESETS.noisy,
      volumeDb: 2.04,
      tracks: [{ ...newTrack("0123456789abcdef", 1500.4), loop: true }],
    });
    expect(spec).toMatchObject({
      voice: true,
      denoise: 3,
      gate: true,
      volumeDb: 2,
    });
    expect(spec?.tracks[0]).toEqual({
      mediaId: "0123456789abcdef",
      startMs: 1500,
      volumeDb: -12,
      loop: true,
      duck: true,
      fadeMs: 0,
    });
  });

  it("a lone track counts as audio work", () => {
    expect(
      audioActive({ ...DEFAULT_AUDIO, tracks: [newTrack("0123456789abcdef")] }),
    ).toBe(true);
  });
});
