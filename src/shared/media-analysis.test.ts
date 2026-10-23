import { describe, expect, it } from "vitest";

import {
  adviceFor,
  buildAnalysis,
  parseLoudness,
  parseSilences,
  shortenPauses,
} from "./media-analysis";

const REPORT = `
[Parsed_ebur128_0 @ 0x1] t: 0.1 M: -120.7 S: -120.7 I: -70.0 LUFS LRA: 0.0 LU
[silencedetect @ 0x2] silence_start: 0
[silencedetect @ 0x2] silence_end: 1.5 | silence_duration: 1.5
[silencedetect @ 0x2] silence_start: 5.25
[silencedetect @ 0x2] silence_end: 5.4 | silence_duration: 0.15
[silencedetect @ 0x2] silence_start: 8
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -18.4 LUFS
    Threshold: -28.5 LUFS

  Loudness range:
    LRA:         7.2 LU
    LRA low:   -23.0 LUFS

  True peak:
    Peak:       -0.4 dBFS
`;

describe("ffmpeg report parsing", () => {
  it("reads the last summary block, not the per-frame lines", () => {
    expect(parseLoudness(REPORT)).toEqual({
      integratedLufs: -18.4,
      loudnessRangeLu: 7.2,
      truePeakDb: -0.4,
    });
  });
  it("treats -70 LUFS (nothing measurable) as no loudness", () => {
    expect(
      parseLoudness("I: -70.0 LUFS\nLRA: 0.0 LU\nPeak: -inf dBFS")
        .integratedLufs,
    ).toBeNull();
  });
  it("keeps only pauses of 0.8 s or more and closes an open one at the end", () => {
    expect(parseSilences(REPORT, 10_000)).toEqual([
      { startMs: 0, endMs: 1500 },
      { startMs: 8000, endMs: 10_000 },
    ]);
  });
  it("builds totals and a speech ratio", () => {
    const a = buildAnalysis(REPORT, 10_000, "2026-10-23T10:00:00.000Z");
    expect(a).toMatchObject({
      silenceMs: 3500,
      longestSilenceMs: 2000,
      speechRatio: 0.65,
      durationMs: 10_000,
    });
  });
});

describe("advice", () => {
  const base = buildAnalysis(REPORT, 10_000, "x");
  it("flags clipping and heavy pauses", () => {
    expect(adviceFor(base)).toEqual(["clipping", "pauses"]);
  });
  it("is ok for a clean podcast level, silent for no audio", () => {
    expect(
      adviceFor({
        ...base,
        integratedLufs: -16,
        truePeakDb: -2,
        silenceMs: 0,
        longestSilenceMs: 0,
        loudnessRangeLu: 6,
      }),
    ).toEqual(["ok"]);
    expect(adviceFor({ ...base, integratedLufs: null })).toEqual(["silent"]);
    expect(
      adviceFor({
        ...base,
        integratedLufs: -26,
        truePeakDb: -8,
        silenceMs: 0,
        longestSilenceMs: 0,
      }),
    ).toEqual(["quiet"]);
    expect(
      adviceFor({
        ...base,
        integratedLufs: -9,
        truePeakDb: -3,
        silenceMs: 0,
        longestSilenceMs: 0,
      }),
    ).toEqual(["loud"]);
  });
});

describe("shortenPauses", () => {
  it("keeps speech and leaves a short pause where a long one was", () => {
    const clips = shortenPauses([{ startMs: 2000, endMs: 5000 }], 10_000, {
      keepMs: 400,
    });
    expect(clips).toEqual([
      { startMs: 0, endMs: 2200 },
      { startMs: 4800, endMs: 10_000 },
    ]);
    const kept = clips!.reduce((a, c) => a + c.endMs - c.startMs, 0);
    expect(kept).toBe(10_000 - 3000 + 400);
  });
  it("shortens a pause at the very beginning like any other", () => {
    expect(
      shortenPauses([{ startMs: 0, endMs: 3000 }], 6000, { keepMs: 400 }),
    ).toEqual([
      { startMs: 0, endMs: 200 },
      { startMs: 2800, endMs: 6000 },
    ]);
  });
  it("ignores pauses below the threshold and returns null when nothing is cut", () => {
    expect(shortenPauses([{ startMs: 1000, endMs: 1900 }], 5000)).toBeNull();
    expect(shortenPauses([], 5000)).toBeNull();
  });
  it("gives up when the result would have too many clips", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      startMs: i * 5000,
      endMs: i * 5000 + 2000,
    }));
    expect(shortenPauses(many, 60_000, { maxClips: 5 })).toBeNull();
  });
});
