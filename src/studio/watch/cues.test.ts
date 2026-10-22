// src/studio/watch/cues.test.ts
import { describe, expect, it } from "vitest";

import {
  activeCue,
  addCue,
  checkCues,
  mergeWithNext,
  parseCues,
  replaceInCues,
  serializeCues,
  shiftCues,
  splitCue,
} from "./cues";

const VTT = `WEBVTT

00:00:01.000 --> 00:00:03.000
Merhaba dünya

00:00:03.500 --> 00:00:06.000
ikinci satır
devam
`;

describe("cues", () => {
  it("parses and serializes WebVTT", () => {
    const cues = parseCues(VTT);
    expect(cues).toHaveLength(2);
    expect(cues[1]?.text).toBe("ikinci satır\ndevam");
    const back = parseCues(serializeCues(cues));
    expect(back.map((c) => [c.startMs, c.endMs, c.text])).toEqual(
      cues.map((c) => [c.startMs, c.endMs, c.text]),
    );
  });

  it("parses SRT with numeric ids and comma decimals", () => {
    const cues = parseCues(
      "1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:02,500 --> 00:00:04,000\nB\n",
    );
    expect(cues.map((c) => c.text)).toEqual(["A", "B"]);
  });

  it("splits, merges, shifts and adds", () => {
    const cues = parseCues(VTT);
    const first = cues[0]!;
    const split = splitCue(cues, first.id, 2000);
    expect(split).toHaveLength(3);
    expect(split[0]?.text).toBe("Merhaba");
    expect(split[1]?.text).toBe("dünya");
    const merged = mergeWithNext(split, split[0]!.id);
    expect(merged[0]?.text).toBe("Merhaba dünya");
    expect(shiftCues(cues, -2000)[0]?.startMs).toBe(0);
    expect(addCue(cues, 0)[0]?.startMs).toBe(0);
  });

  it("replaces text and counts", () => {
    const r = replaceInCues(parseCues(VTT), "MERHABA", "Selam");
    expect(r.count).toBe(1);
    expect(r.cues[0]?.text).toBe("Selam dünya");
  });

  it("flags problems and finds the active cue", () => {
    const cues = parseCues(
      "WEBVTT\n\n00:00:00.000 --> 00:00:00.300\nx\n\n00:00:00.200 --> 00:00:02.000\n" +
        "a".repeat(100) +
        "\n",
    );
    const issues = checkCues(cues);
    expect(issues.get(cues[0]!.id)).toEqual(
      expect.arrayContaining(["too-short", "overlap"]),
    );
    expect(issues.get(cues[1]!.id)).toEqual(
      expect.arrayContaining(["reading-speed", "line-length"]),
    );
    expect(activeCue(cues, 1000)).toBe(1);
    expect(activeCue(cues, 5000)).toBe(-1);
  });
});
