// src/studio/watch/clips.test.ts
import { describe, expect, it } from "vitest";

import {
  appendClip,
  layout,
  makeClip,
  moveClip,
  removeClip,
  splitClipAt,
  toSpecClips,
  totalMs,
  trimClip,
} from "./clips";

describe("clips", () => {
  const a = makeClip("m1", 1000, 3000);
  const b = makeClip("m2", 0, 1500);

  it("appends valid clips only and totals the length", () => {
    expect(appendClip([], makeClip("m1", 0, 10))).toEqual([]);
    const list = appendClip(appendClip([], a), b);
    expect(totalMs(list)).toBe(3500);
    expect(layout(list).map((r) => r.atMs)).toEqual([0, 2000]);
  });

  it("moves and removes", () => {
    const list = [a, b];
    expect(moveClip(list, a.key, 1).map((c) => c.key)).toEqual([b.key, a.key]);
    expect(moveClip(list, a.key, -1)).toEqual(list);
    expect(removeClip(list, a.key)).toEqual([b]);
  });

  it("trims within bounds and keeps a minimum length", () => {
    expect(trimClip([a], a.key, "start", 5000, 10_000)[0]?.startMs).toBe(2960);
    expect(trimClip([a], a.key, "end", 99_000, 10_000)[0]?.endMs).toBe(10_000);
    expect(trimClip([a], a.key, "end", 0, 10_000)[0]?.endMs).toBe(1040);
  });

  it("splits at a point inside the clip", () => {
    const out = splitClipAt([a, b], a.key, 2000);
    expect(out.map((c) => [c.startMs, c.endMs])).toEqual([
      [1000, 2000],
      [2000, 3000],
      [0, 1500],
    ]);
    expect(splitClipAt([a], a.key, 1010)).toEqual([a]);
  });

  it("omits mediaId for the main video in the wire format", () => {
    expect(toSpecClips([a, b], "m1")).toEqual([
      { startMs: 1000, endMs: 3000 },
      { mediaId: "m2", startMs: 0, endMs: 1500 },
    ]);
  });
});
