// src/studio/watch/progress.test.ts
import { beforeEach, describe, expect, it } from "vitest";

import {
  allProgress,
  clearProgress,
  fractionOf,
  getProgress,
  saveProgress,
} from "./progress";

describe("watch progress", () => {
  beforeEach(() => localStorage.clear());

  it("remembers where you stopped", () => {
    saveProgress("a", 120, 600, 1000);
    expect(getProgress("a")).toEqual({ t: 120, d: 600, at: 1000 });
    expect(fractionOf(getProgress("a"))).toBeCloseTo(0.2);
    expect(fractionOf(null)).toBeNull();
  });

  it("forgets items that are barely started or finished", () => {
    saveProgress("a", 120, 600);
    saveProgress("a", 2, 600); // restarted
    expect(getProgress("a")).toBeNull();
    saveProgress("b", 300, 600);
    saveProgress("b", 595, 600); // finished
    expect(getProgress("b")).toBeNull();
  });

  it("ignores nonsense and survives corrupted storage", () => {
    saveProgress("a", Number.NaN, 600);
    saveProgress("a", 50, 0);
    expect(allProgress()).toEqual({});
    localStorage.setItem("studio.watch.progress.v1", "{not json");
    expect(allProgress()).toEqual({});
    localStorage.setItem(
      "studio.watch.progress.v1",
      JSON.stringify({ x: { t: "a" }, y: { t: 10, d: 100, at: 1 } }),
    );
    expect(Object.keys(allProgress())).toEqual(["y"]);
  });

  it("keeps only the most recent 100 entries and can clear one", () => {
    for (let i = 0; i < 120; i++) saveProgress(`id${i}`, 50, 600, i);
    const all = allProgress();
    expect(Object.keys(all)).toHaveLength(100);
    expect(all["id119"]).toBeDefined();
    expect(all["id0"]).toBeUndefined();
    clearProgress("id119");
    expect(getProgress("id119")).toBeNull();
  });
});
