// src/studio/watch/timecode.test.ts
import { describe, expect, it } from "vitest";

import {
  formatClock,
  formatFrames,
  frameAt,
  frameMs,
  parseClock,
  parseFrames,
  snapToFrame,
} from "./timecode";

describe("clock", () => {
  it("formats and parses round trip", () => {
    expect(formatClock(83_456)).toBe("01:23.456");
    expect(formatClock(3_723_004)).toBe("01:02:03.004");
    expect(formatClock(5_000, true)).toBe("00:00:05.000");
    for (const ms of [0, 1, 999, 61_000, 3_599_999, 7_200_500])
      expect(parseClock(formatClock(ms, true))).toBe(ms);
  });

  it("parses the shapes people type", () => {
    expect(parseClock("90")).toBe(90_000);
    expect(parseClock("1:30")).toBe(90_000);
    expect(parseClock("01:30,5")).toBe(90_500);
    expect(parseClock("1:02:03.25")).toBe(3_723_250);
    expect(parseClock("")).toBeNull();
    expect(parseClock("abc")).toBeNull();
    expect(parseClock("1:75")).toBeNull();
  });
});

describe("frames", () => {
  it("formats timecode at the frame rate and parses it back", () => {
    expect(formatFrames(1000, 25)).toBe("00:00:01:00");
    expect(formatFrames(1040, 25)).toBe("00:00:01:01");
    expect(formatFrames(61_000 + 480, 25)).toBe("00:01:01:12");
    expect(parseFrames("00:00:01:01", 25)).toBe(1040);
    expect(parseFrames("00:01:01:12", 25)).toBe(61_480);
  });

  it("falls back to plain clock text and snaps to frame boundaries", () => {
    expect(parseFrames("1.5", 30)).toBe(1500);
    expect(frameAt(1000, 30)).toBe(30);
    expect(snapToFrame(1010, 30)).toBe(1000);
    expect(snapToFrame(1020, 30)).toBe(1033);
    expect(frameMs(25)).toBe(40);
    expect(frameMs(0)).toBeCloseTo(33.33, 1);
  });
});
