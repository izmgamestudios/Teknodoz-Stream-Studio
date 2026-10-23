import { describe, expect, it } from "vitest";

import { chaptersFromCues, mergeChapters, titleFrom } from "./auto-chapters";

const cue = (s: number, e: number, text: string) => ({
  startMs: s * 1000,
  endMs: e * 1000,
  text,
});

describe("titleFrom", () => {
  it("uses the first words, capitalised with Turkish rules, with an ellipsis when cut", () => {
    expect(
      titleFrom("ışık gelince hepimiz sevindik ama sonra olanlar oldu dedi", 5),
    ).toBe("Işık gelince hepimiz sevindik ama…");
    expect(titleFrom("<v Ali>iyi akşamlar</v>", 7)).toBe("İyi akşamlar");
    expect(titleFrom("   ")).toBe("");
  });
});

describe("chaptersFromCues", () => {
  // cues every 10 s for 20 minutes, with a 3 s pause before minute 5, 11 and 12
  const cues = [] as ReturnType<typeof cue>[];
  let t = 0;
  for (let i = 0; i < 120; i++) {
    const pauseBefore = [30, 66, 72].includes(i) ? 3 : 0;
    t += pauseBefore;
    cues.push(cue(t, t + 8, `bölüm ${i} konuşması başlıyor şimdi`));
    t += 10;
  }
  const dur = t * 1000;

  it("starts at 0 and never makes chapters shorter than the minimum", () => {
    const ch = chaptersFromCues(cues, dur);
    expect(ch[0]!.t).toBe(0);
    for (let i = 1; i < ch.length; i++)
      expect(ch[i]!.t - ch[i - 1]!.t).toBeGreaterThanOrEqual(150_000);
    expect(ch.length).toBeGreaterThanOrEqual(2);
  });
  it("cuts at pauses and names the chapter after what is said there", () => {
    const ch = chaptersFromCues(cues, dur);
    const second = ch[1]!;
    expect(cues.some((c) => c.startMs === second.t)).toBe(true);
    expect(second.label).toMatch(/^Bölüm \d+ konuşması/);
  });
  it("returns nothing without cues and one chapter for a short talk", () => {
    expect(chaptersFromCues([], 1000)).toEqual([]);
    expect(chaptersFromCues([cue(0, 5, "kısa konuşma")], 5000)).toEqual([
      { t: 0, label: "Kısa konuşma" },
    ]);
  });
});

describe("mergeChapters", () => {
  it("keeps hand-made markers and drops generated ones next to them", () => {
    const m = mergeChapters(
      [{ t: 100_000, label: "Soru 1" }],
      [
        { t: 105_000, label: "x" },
        { t: 400_000, label: "y" },
      ],
    );
    expect(m).toEqual([
      { t: 100_000, label: "Soru 1" },
      { t: 400_000, label: "y" },
    ]);
  });
});
