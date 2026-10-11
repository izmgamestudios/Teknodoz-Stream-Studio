import { describe, expect, it } from "vitest";
import type { Marker } from "../types";
import {
  CHAPTER_INTRO_LABEL,
  MAX_CHAPTER_MARKERS,
  MAX_INPUT_MARKERS,
  MAX_LABEL_LENGTH,
  buildChaptersTxt,
  buildSrt,
  chapterWarnings,
  escapeSrtText,
  formatChapterTime,
  formatSrtTime,
  normalizeMarkers,
  replaceControlChars,
  sanitizeLabel,
} from "./chapters";

const LS = String.fromCharCode(0x2028); // LINE SEPARATOR
const PS = String.fromCharCode(0x2029); // PARAGRAPH SEPARATOR
const ZWSP = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);

function m(t: number, label: string): Marker {
  return { t, label };
}

describe("formatChapterTime", () => {
  it.each([
    [0, "0:00"],
    [999, "0:00"],
    [1000, "0:01"],
    [9_000, "0:09"],
    [59_999, "0:59"],
    [60_000, "1:00"],
    [65_000, "1:05"],
    [754_000, "12:34"],
    [3_599_999, "59:59"],
    [3_600_000, "1:00:00"],
    [3_661_000, "1:01:01"],
    [36_000_000, "10:00:00"],
  ])("formats %i ms as %s", (ms, expected) => {
    expect(formatChapterTime(ms)).toBe(expected);
  });

  it("forces the hours field on request", () => {
    expect(formatChapterTime(0, true)).toBe("0:00:00");
    expect(formatChapterTime(65_000, true)).toBe("0:01:05");
    expect(formatChapterTime(3_600_000, true)).toBe("1:00:00");
  });

  it("treats negative and non-finite input as 0:00", () => {
    expect(formatChapterTime(-5)).toBe("0:00");
    expect(formatChapterTime(Number.NaN)).toBe("0:00");
    expect(formatChapterTime(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatChapterTime(Number.NEGATIVE_INFINITY)).toBe("0:00");
    expect(formatChapterTime("12" as unknown as number)).toBe("0:00");
  });
});

describe("formatSrtTime", () => {
  it.each([
    [0, "00:00:00,000"],
    [1, "00:00:00,001"],
    [999, "00:00:00,999"],
    [1000, "00:00:01,000"],
    [61_001, "00:01:01,001"],
    [3_723_456, "01:02:03,456"],
    [360_000_000, "100:00:00,000"],
  ])("formats %i ms as %s", (ms, expected) => {
    expect(formatSrtTime(ms)).toBe(expected);
  });

  it("rounds to whole milliseconds and sanitises bad input", () => {
    expect(formatSrtTime(1500.6)).toBe("00:00:01,501");
    expect(formatSrtTime(-1)).toBe("00:00:00,000");
    expect(formatSrtTime(Number.NaN)).toBe("00:00:00,000");
    expect(formatSrtTime(Number.POSITIVE_INFINITY)).toBe("00:00:00,000");
  });
});

describe("replaceControlChars", () => {
  it("replaces control, separator, zero-width and bidi characters", () => {
    const rlo = String.fromCharCode(0x202e);
    const text = `a\tb\nc${LS}d${PS}e${ZWSP}f${BOM}g${rlo}h${String.fromCharCode(0x7f)}i`;
    expect(replaceControlChars(text)).toBe("a b c d e f g h i");
    expect(replaceControlChars(text, "")).toBe("abcdefghi");
  });

  it("leaves ordinary text, Turkish letters and emoji alone", () => {
    const text = "Çalışma Öğüt İğne \u{1F600} 2026";
    expect(replaceControlChars(text)).toBe(text);
    expect(replaceControlChars("")).toBe("");
  });
});

describe("sanitizeLabel", () => {
  it("trims and collapses whitespace and newlines to single spaces", () => {
    expect(sanitizeLabel("  Merhaba \r\n  dünya\t! ")).toBe("Merhaba dünya !");
  });

  it("strips control, separator, zero-width and BOM characters", () => {
    expect(sanitizeLabel(`a${LS}b${PS}c${ZWSP}d${BOM}e\u0000f`)).toBe(
      "a b c d e f",
    );
  });

  it("returns the fallback for empty / non-string input", () => {
    expect(sanitizeLabel("   ", "x")).toBe("x");
    expect(sanitizeLabel("", "x")).toBe("x");
    expect(sanitizeLabel(42, "x")).toBe("x");
    expect(sanitizeLabel(null)).toBe("");
    expect(sanitizeLabel(undefined, "fb")).toBe("fb");
  });

  it("bounds the length by code points and never splits surrogate pairs", () => {
    const long = "ş".repeat(300);
    const out = sanitizeLabel(long);
    expect(Array.from(out)).toHaveLength(MAX_LABEL_LENGTH);
    expect(out.endsWith("…")).toBe(true);

    const emoji = "😀".repeat(150);
    const out2 = sanitizeLabel(emoji);
    expect(Array.from(out2)).toHaveLength(MAX_LABEL_LENGTH);
    expect(out2.slice(0, -1)).toBe("😀".repeat(MAX_LABEL_LENGTH - 1));
  });

  it("accepts a custom maximum length", () => {
    expect(sanitizeLabel("abcdefghij", "", 5)).toBe("abcd\u2026");
    expect(Array.from(sanitizeLabel("abcdefghij", "", 5))).toHaveLength(5);
    expect(sanitizeLabel("abc", "", 5)).toBe("abc");
    expect(sanitizeLabel("abcdefghij", "", 1)).toBe("\u2026");
  });

  it("keeps labels at exactly the limit untouched", () => {
    const exact = "a".repeat(MAX_LABEL_LENGTH);
    expect(sanitizeLabel(exact)).toBe(exact);
  });
});

describe("escapeSrtText", () => {
  it("normalises every newline flavour to the requested terminator", () => {
    expect(escapeSrtText("a\r\nb\rc\nd")).toBe("a\r\nb\r\nc\r\nd");
    expect(escapeSrtText("a\r\nb\rc\nd", "\n")).toBe("a\nb\nc\nd");
    expect(escapeSrtText(`a${LS}b${PS}c`, "\n")).toBe("a\nb\nc");
  });

  it("drops blank lines because they would end the cue", () => {
    expect(escapeSrtText("a\n\n\n  \nb", "\n")).toBe("a\nb");
    expect(escapeSrtText("\n\n")).toBe("");
  });

  it("neutralises player markup", () => {
    expect(escapeSrtText("<i>x</i> {\\an8} a<b")).toBe("‹i›x‹/i› (\\an8) a‹b");
    expect(escapeSrtText("<font color=red>")).not.toMatch(/[<>]/);
  });

  it("is safe on non-string input", () => {
    expect(escapeSrtText(undefined as unknown as string)).toBe("");
  });
});

describe("normalizeMarkers", () => {
  it("always yields a chapter at 0:00", () => {
    expect(normalizeMarkers([], 60_000)).toEqual([m(0, CHAPTER_INTRO_LABEL)]);
    expect(normalizeMarkers(undefined as unknown as Marker[], 60_000)).toEqual([
      m(0, CHAPTER_INTRO_LABEL),
    ]);
  });

  it("uses a custom intro label", () => {
    expect(normalizeMarkers([], 60_000, { introLabel: "Intro" })).toEqual([
      m(0, "Intro"),
    ]);
    expect(normalizeMarkers([], 60_000, { introLabel: "  " })).toEqual([
      m(0, CHAPTER_INTRO_LABEL),
    ]);
  });

  it("keeps an existing 0:00 marker and does not insert an intro", () => {
    const out = normalizeMarkers([m(0, "Giriş"), m(30_000, "Demo")], 90_000);
    expect(out).toEqual([m(0, "Giriş"), m(30_000, "Demo")]);
  });

  it("inserts the intro when the first marker is later than 1 s", () => {
    const out = normalizeMarkers([m(5_000, "Demo")], 90_000);
    expect(out).toEqual([m(0, CHAPTER_INTRO_LABEL), m(5_000, "Demo")]);
    const edge = normalizeMarkers([m(1_000, "Demo")], 90_000);
    expect(edge).toEqual([m(0, CHAPTER_INTRO_LABEL), m(1_000, "Demo")]);
  });

  it("snaps a first marker inside the first second onto 0:00", () => {
    const out = normalizeMarkers([m(400, "Giriş"), m(30_000, "Demo")], 90_000);
    expect(out).toEqual([m(0, "Giriş"), m(30_000, "Demo")]);
  });

  it("sorts unordered markers and keeps input order for equal timestamps", () => {
    const out = normalizeMarkers(
      [m(40_000, "C"), m(10_000, "A"), m(25_000, "B")],
      90_000,
    );
    expect(out.map((x) => x.label)).toEqual([
      CHAPTER_INTRO_LABEL,
      "A",
      "B",
      "C",
    ]);
    expect(out.map((x) => x.t)).toEqual([0, 10_000, 25_000, 40_000]);
  });

  it("drops markers within 1 s of the previous one (earlier wins, chains vs last kept)", () => {
    const out = normalizeMarkers(
      [m(0, "A"), m(500, "B"), m(1_999, "C"), m(2_500, "D"), m(3_000, "E")],
      60_000,
    );
    expect(out).toEqual([m(0, "A"), m(1_999, "C"), m(3_000, "E")]);
  });

  it("keeps markers exactly 1000 ms apart", () => {
    const out = normalizeMarkers([m(0, "A"), m(1_000, "B")], 60_000);
    expect(out).toHaveLength(2);
  });

  it("clamps to [0, duration]", () => {
    const out = normalizeMarkers(
      [m(-5, "A"), m(10_000, "B"), m(999_999, "C")],
      60_000,
    );
    expect(out).toEqual([m(0, "A"), m(10_000, "B"), m(60_000, "C")]);
  });

  it("rounds fractional timestamps to whole milliseconds", () => {
    const out = normalizeMarkers([m(0, "A"), m(12_345.6, "B")], 60_000);
    expect(out[1]).toEqual(m(12_346, "B"));
  });

  it("collapses everything when the duration is zero or invalid", () => {
    expect(normalizeMarkers([m(0, "A"), m(5_000, "B")], 0)).toEqual([
      m(0, "A"),
    ]);
    expect(normalizeMarkers([m(0, "A"), m(5_000, "B")], Number.NaN)).toEqual([
      m(0, "A"),
    ]);
    expect(normalizeMarkers([m(0, "A"), m(5_000, "B")], -10)).toEqual([
      m(0, "A"),
    ]);
  });

  it("drops malformed entries instead of throwing", () => {
    const bad = [
      null,
      undefined,
      "x",
      42,
      { t: "5", label: "string t" },
      { t: Number.NaN, label: "nan" },
      { t: Number.POSITIVE_INFINITY, label: "inf" },
      { label: "no t" },
      { t: 10_000, label: 42 },
      { t: 20_000, label: "ok" },
    ] as unknown as Marker[];
    const out = normalizeMarkers(bad, 60_000);
    expect(out).toEqual([
      m(0, CHAPTER_INTRO_LABEL),
      m(10_000, "Bölüm 2"),
      m(20_000, "ok"),
    ]);
  });

  it("numbers empty labels by their final position", () => {
    const out = normalizeMarkers(
      [m(0, ""), m(20_000, "   "), m(40_000, "Son")],
      90_000,
    );
    expect(out.map((x) => x.label)).toEqual(["Bölüm 1", "Bölüm 2", "Son"]);
  });

  it("does not mutate its input", () => {
    const input = [m(5_000, "B"), m(100, "A")];
    const snapshot = JSON.parse(JSON.stringify(input)) as Marker[];
    normalizeMarkers(input, 60_000);
    expect(input).toEqual(snapshot);
  });

  it("sanitises labels", () => {
    const out = normalizeMarkers([m(0, "  a\nb  ")], 60_000);
    expect(out[0]?.label).toBe("a b");
  });

  it("caps the number of chapters", () => {
    const many = Array.from({ length: MAX_CHAPTER_MARKERS + 100 }, (_, i) =>
      m(i * 2_000, `M${i}`),
    );
    const out = normalizeMarkers(many, 10_000_000);
    expect(out).toHaveLength(MAX_CHAPTER_MARKERS);
    expect(out[out.length - 1]?.label).toBe(`M${MAX_CHAPTER_MARKERS - 1}`);
  });

  it("bounds the work on huge hostile input", () => {
    const huge = Array.from({ length: MAX_INPUT_MARKERS + 5 }, (_, i) =>
      m(i * 1_000, `M${i}`),
    );
    const out = normalizeMarkers(huge, 100_000_000);
    expect(out.length).toBeLessThanOrEqual(MAX_CHAPTER_MARKERS);
    const w = chapterWarnings(huge, 100_000_000);
    expect(w.find((x) => x.code === "invalid-marker")?.count).toBe(5);
  });

  describe("mergeShort", () => {
    it("absorbs the next marker into a short chapter", () => {
      const out = normalizeMarkers(
        [m(0, "A"), m(5_000, "B"), m(20_000, "C")],
        60_000,
        {
          mergeShort: true,
        },
      );
      expect(out).toEqual([m(0, "A"), m(20_000, "C")]);
    });

    it("absorbs a short tail into the previous chapter", () => {
      const out = normalizeMarkers(
        [m(0, "A"), m(30_000, "B"), m(55_000, "C")],
        60_000,
        {
          mergeShort: true,
        },
      );
      expect(out).toEqual([m(0, "A"), m(30_000, "B")]);
    });

    it("keeps merging until the chapter is long enough", () => {
      const out = normalizeMarkers(
        [
          m(0, "A"),
          m(3_000, "B"),
          m(6_000, "C"),
          m(9_000, "D"),
          m(40_000, "E"),
        ],
        60_000,
        { mergeShort: true },
      );
      expect(out).toEqual([m(0, "A"), m(40_000, "E")]);
    });

    it("merges a short middle chapter forward", () => {
      const out = normalizeMarkers(
        [m(0, "A"), m(30_000, "B"), m(35_000, "C"), m(70_000, "D")],
        100_000,
        { mergeShort: true },
      );
      expect(out).toEqual([m(0, "A"), m(30_000, "B"), m(70_000, "D")]);
    });

    it("removes a zero-length marker at the very end", () => {
      const out = normalizeMarkers(
        [m(0, "A"), m(30_000, "B"), m(60_000, "C")],
        60_000,
        {
          mergeShort: true,
        },
      );
      expect(out).toEqual([m(0, "A"), m(30_000, "B")]);
    });

    it("cannot merge a lone chapter shorter than the minimum", () => {
      expect(normalizeMarkers([], 5_000, { mergeShort: true })).toEqual([
        m(0, CHAPTER_INTRO_LABEL),
      ]);
    });

    it("honours a custom minimum length", () => {
      const markers = [m(0, "A"), m(5_000, "B"), m(10_000, "C")];
      expect(
        normalizeMarkers(markers, 20_000, {
          mergeShort: true,
          minChapterMs: 4_000,
        }),
      ).toEqual([m(0, "A"), m(5_000, "B"), m(10_000, "C")]);
      expect(
        normalizeMarkers(markers, 20_000, {
          mergeShort: true,
          minChapterMs: 0,
        }),
      ).toHaveLength(3);
    });

    it("is off by default", () => {
      expect(normalizeMarkers([m(0, "A"), m(5_000, "B")], 60_000)).toHaveLength(
        2,
      );
    });
  });
});

describe("chapterWarnings", () => {
  const codes = (w: ReturnType<typeof chapterWarnings>): string[] =>
    w.map((x) => x.code);

  it("flags a recording without markers", () => {
    expect(codes(chapterWarnings([], 60_000))).toEqual([
      "no-markers",
      "intro-inserted",
      "too-few-chapters",
    ]);
  });

  it("reports nothing for a valid YouTube chapter list", () => {
    const ok = [m(0, "A"), m(20_000, "B"), m(40_000, "C")];
    expect(chapterWarnings(ok, 60_000)).toEqual([]);
  });

  it("flags fewer than three chapters with the actual count", () => {
    const w = chapterWarnings([m(0, "A"), m(30_000, "B")], 60_000);
    expect(w).toEqual([{ code: "too-few-chapters", count: 2, indices: [] }]);
  });

  it("flags clamped, deduped, invalid and empty-label markers with counts", () => {
    const w = chapterWarnings(
      [
        m(-5, ""),
        m(300, "dup"),
        m(999_999, "late"),
        { t: Number.NaN, label: "x" },
      ],
      60_000,
    );
    expect(w.find((x) => x.code === "marker-clamped")?.count).toBe(2);
    expect(w.find((x) => x.code === "invalid-marker")?.count).toBe(1);
    expect(w.find((x) => x.code === "markers-deduped")?.count).toBe(1);
    expect(w.find((x) => x.code === "label-empty")?.count).toBe(1);
  });

  it("lists too-short chapters by index of the normalized list", () => {
    const w = chapterWarnings(
      [m(0, "A"), m(5_000, "B"), m(30_000, "C")],
      60_000,
    );
    const short = w.find((x) => x.code === "chapter-too-short");
    expect(short).toEqual({
      code: "chapter-too-short",
      count: 1,
      indices: [0],
    });
  });

  it("reports merges when merging is requested", () => {
    const w = chapterWarnings(
      [m(0, "A"), m(5_000, "B"), m(30_000, "C")],
      60_000,
      {
        mergeShort: true,
      },
    );
    expect(w.find((x) => x.code === "chapters-merged")?.count).toBe(1);
    expect(w.find((x) => x.code === "too-few-chapters")?.count).toBe(2);
  });

  it("reports the chapter limit", () => {
    const many = Array.from({ length: MAX_CHAPTER_MARKERS + 3 }, (_, i) =>
      m(i * 2_000, `M${i}`),
    );
    const w = chapterWarnings(many, 10_000_000);
    expect(w.find((x) => x.code === "marker-limit")?.count).toBe(3);
  });
});

describe("buildChaptersTxt", () => {
  it("writes one M:SS line per chapter", () => {
    const txt = buildChaptersTxt(
      [m(0, "Giriş"), m(65_000, "Demo"), m(300_000, "Kapanış")],
      600_000,
    );
    expect(txt).toBe("0:00 Giriş\n1:05 Demo\n5:00 Kapanış\n");
  });

  it("starts with the auto intro when needed", () => {
    const txt = buildChaptersTxt([m(30_000, "Demo")], 90_000);
    expect(txt).toBe("0:00 Başlangıç\n0:30 Demo\n");
  });

  it("outputs the intro alone when there are no markers", () => {
    expect(buildChaptersTxt([], 90_000)).toBe("0:00 Başlangıç\n");
  });

  it("switches to H:MM:SS from one hour", () => {
    const txt = buildChaptersTxt(
      [m(0, "A"), m(3_540_000, "B"), m(3_900_000, "C")],
      4_000_000,
    );
    expect(txt).toBe("0:00 A\n59:00 B\n1:05:00 C\n");
  });

  it("merges chapters shorter than 10 s by default", () => {
    const txt = buildChaptersTxt(
      [m(0, "A"), m(5_000, "B"), m(20_000, "C")],
      60_000,
    );
    expect(txt).toBe("0:00 A\n0:20 C\n");
  });

  it("can keep short chapters", () => {
    const txt = buildChaptersTxt(
      [m(0, "A"), m(5_000, "B"), m(20_000, "C")],
      60_000,
      {
        mergeShort: false,
      },
    );
    expect(txt).toBe("0:00 A\n0:05 B\n0:20 C\n");
  });

  it("is LF only and keeps every label on one line", () => {
    const txt = buildChaptersTxt(
      [m(0, "Satır\r\nsonu"), m(20_000, "x\ry")],
      60_000,
    );
    expect(txt).not.toContain("\r");
    expect(txt.split("\n")).toEqual(["0:00 Satır sonu", "0:20 x y", ""]);
  });

  it("never lets a label start a line before its timestamp", () => {
    const txt = buildChaptersTxt([m(0, "A\n0:05 fake")], 60_000);
    expect(txt).toBe("0:00 A 0:05 fake\n");
  });
});

describe("buildSrt", () => {
  it("shows each label until the next marker, the last until the end (CRLF)", () => {
    const srt = buildSrt([m(0, "Giriş"), m(30_000, "Demo")], 90_000);
    expect(srt).toBe(
      "1\r\n00:00:00,000 --> 00:00:30,000\r\nGiriş\r\n\r\n" +
        "2\r\n00:00:30,000 --> 00:01:30,000\r\nDemo\r\n",
    );
  });

  it("supports LF output", () => {
    const srt = buildSrt([m(0, "A")], 5_000, { newline: "\n" });
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:05,000\nA\n");
    expect(srt).not.toContain("\r");
  });

  it("includes the auto intro cue", () => {
    const srt = buildSrt([m(10_000, "Demo")], 20_000, { newline: "\n" });
    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:10,000\nBaşlangıç\n\n2\n00:00:10,000 --> 00:00:20,000\nDemo\n",
    );
  });

  it("does not merge short chapters (subtitles may be short)", () => {
    const srt = buildSrt([m(0, "A"), m(2_000, "B")], 10_000, { newline: "\n" });
    expect(srt).toContain("2\n00:00:02,000 --> 00:00:10,000\nB");
  });

  it("skips zero-length cues and keeps indices sequential", () => {
    const srt = buildSrt([m(0, "A"), m(30_000, "B"), m(60_000, "C")], 60_000, {
      newline: "\n",
    });
    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:30,000\nA\n\n2\n00:00:30,000 --> 00:01:00,000\nB\n",
    );
  });

  it("returns an empty string when no cue fits", () => {
    expect(buildSrt([m(0, "A")], 0)).toBe("");
    expect(buildSrt([], 0)).toBe("");
  });

  it("formats hours and milliseconds", () => {
    const srt = buildSrt([m(0, "A"), m(3_723_456, "B")], 3_800_000, {
      newline: "\n",
    });
    expect(srt).toContain("00:00:00,000 --> 01:02:03,456");
    expect(srt).toContain("01:02:03,456 --> 01:03:20,000");
  });

  it("keeps Turkish characters intact", () => {
    const srt = buildSrt([m(0, "Çalışma Öğüt İğne")], 5_000, { newline: "\n" });
    expect(srt).toContain("Çalışma Öğüt İğne");
  });

  it("cannot be broken by hostile labels", () => {
    const srt = buildSrt(
      [
        m(0, "A\r\n\r\n2\r\n00:00:00,000 --> 00:00:01,000\r\nINJECTED"),
        m(20_000, "<b>B</b>"),
      ],
      40_000,
    );
    // blank lines only ever separate cues: split on them and check the cue count
    const blocks = srt.trim().split("\r\n\r\n");
    expect(blocks).toHaveLength(2);
    // labels collapsed onto one line: index + timing + one text line, free of markup
    for (const block of blocks) {
      const lines = block.split("\r\n");
      expect(lines).toHaveLength(3);
      expect(lines[2]).not.toMatch(/[<>{}]/);
    }
  });

  it("never mixes line endings", () => {
    const srt = buildSrt([m(0, "A"), m(20_000, "B")], 40_000);
    expect(srt.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });
});
