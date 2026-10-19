import { describe, expect, it } from "vitest";
import {
  estimateWordsPerLine,
  estimateWpm,
  lineIndexForWord,
  normalizeWord,
  parseScript,
  scriptProgress,
  speedForWpm,
} from "./script";

describe("normalizeWord", () => {
  it("lower-cases Turkish dotted/dotless I correctly", () => {
    expect(normalizeWord("Işık", "tr-TR")).toBe("ışık");
    expect(normalizeWord("İstanbul", "tr")).toBe("istanbul");
    expect(normalizeWord("IRMAK", "tr-TR")).toBe("ırmak");
    expect(normalizeWord("İZMİR", "tr-TR")).toBe("izmir");
  });

  it("uses root-locale lower-casing for non-Turkic languages", () => {
    expect(normalizeWord("Isik", "en-US")).toBe("isik");
    expect(normalizeWord("TITLE", "en")).toBe("title");
    // A stray Turkish capital dotted I must not leave a combining dot behind.
    expect(normalizeWord("İstanbul", "en-US")).toBe("istanbul");
  });

  it("strips punctuation, quotes and apostrophes", () => {
    expect(normalizeWord("Merhaba,", "tr")).toBe("merhaba");
    expect(normalizeWord("\u201CHello!\u201D", "en")).toBe("hello");
    expect(normalizeWord("Türkiye'nin", "tr")).toBe("türkiyenin");
    expect(normalizeWord("don\u2019t", "en")).toBe("dont");
    expect(normalizeWord("...", "en")).toBe("");
    expect(normalizeWord("\u2014", "en")).toBe("");
    expect(normalizeWord("", "en")).toBe("");
  });

  it("keeps digits and letters", () => {
    expect(normalizeWord("2024'te", "tr")).toBe("2024te");
    expect(normalizeWord("%50", "tr")).toBe("50");
  });

  it("folds diacritics only when asked", () => {
    expect(normalizeWord("Çağrı", "tr")).toBe("çağrı");
    expect(normalizeWord("Çağrı", "tr", true)).toBe("cagri");
    expect(normalizeWord("ŞÖYLE", "tr", true)).toBe("soyle");
    expect(normalizeWord("café", "en", true)).toBe("cafe");
    expect(normalizeWord("Straße", "en", true)).toBe("strasse");
  });

  it("is idempotent", () => {
    for (const w of ["Işık,", "ÇAĞRI", "Hello!", "yarı-zamanlı"]) {
      const once = normalizeWord(w, "tr", true);
      expect(normalizeWord(once, "tr", true)).toBe(once);
    }
  });
});

describe("parseScript", () => {
  it("parses A:/B: dialogue with stable global word indices", () => {
    const m = parseScript("A: Merhaba dünya\nB: Selam herkese bugün");
    expect(m.dialogue).toBe(true);
    expect(m.lines).toHaveLength(2);
    expect(m.lines[0]?.speaker).toBe("A");
    expect(m.lines[0]?.text).toBe("Merhaba dünya");
    expect(m.lines[1]?.speaker).toBe("B");
    expect(m.wordCount).toBe(5);
    expect(m.words.map((w) => w.globalIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(m.lines[0]).toMatchObject({ firstWord: 0, lastWord: 1, index: 0 });
    expect(m.lines[1]).toMatchObject({ firstWord: 2, lastWord: 4, index: 1 });
    expect(m.lines[1]?.words.map((w) => w.globalIndex)).toEqual([2, 3, 4]);
    expect(m.lines[0]?.words[0]).toEqual({
      w: "Merhaba",
      norm: "merhaba",
      globalIndex: 0,
    });
  });

  it("accepts the same prefixes as the original prompter", () => {
    const m = parseScript(
      ["A) bir", "B- iki", "a: üç", "b – dört", "A— beş", "B:altı"].join("\n"),
    );
    expect(m.lines.map((l) => l.speaker)).toEqual([
      "A",
      "B",
      "A",
      "B",
      "A",
      "B",
    ]);
    expect(m.lines.map((l) => l.text)).toEqual([
      "bir",
      "iki",
      "üç",
      "dört",
      "beş",
      "altı",
    ]);
  });

  it("alternates speakers for unprefixed lines inside a dialogue (old behaviour)", () => {
    const m = parseScript("A: bir\niki\nüç\nB: dört\nbeş");
    expect(m.lines.map((l) => l.speaker)).toEqual(["A", "B", "A", "B", "A"]);
  });

  it("starts alternating at A when the first lines have no prefix", () => {
    const m = parseScript("önce\nsonra\nB: üçüncü\ndördüncü");
    expect(m.lines.map((l) => l.speaker)).toEqual(["A", "B", "B", "A"]);
  });

  it("treats a script without prefixes as single-speaker", () => {
    const m = parseScript("Birinci satır\nİkinci satır");
    expect(m.dialogue).toBe(false);
    expect(m.lines.every((l) => l.speaker === undefined)).toBe(true);
    expect("speaker" in (m.lines[0] ?? {})).toBe(false);
  });

  it("speakers: 'alternate' always alternates, 'none' never parses prefixes", () => {
    const alt = parseScript("bir\niki\nüç", { speakers: "alternate" });
    expect(alt.lines.map((l) => l.speaker)).toEqual(["A", "B", "A"]);
    const none = parseScript("A: bir\nB: iki", { speakers: "none" });
    expect(none.dialogue).toBe(false);
    expect(none.lines[0]?.text).toBe("A: bir");
    expect(none.wordCount).toBe(4);
  });

  it("does not mistake words that merely start with a/b for speakers", () => {
    const m = parseScript("A-ha dedi\nB)evet\nBir şey\nAnlat bana");
    expect(m.dialogue).toBe(false);
    expect(m.lines).toHaveLength(4);
    expect(m.lines[0]?.text).toBe("A-ha dedi");
  });

  it("handles Windows and old-Mac newlines and extra whitespace", () => {
    const m = parseScript("A: bir   iki\r\nB: üç\r\n\r\nA: dört\rB: beş\n");
    expect(m.lines.map((l) => l.text)).toEqual([
      "bir iki",
      "üç",
      "dört",
      "beş",
    ]);
    expect(m.wordCount).toBe(5);
  });

  it("marks paragraph breaks from blank lines", () => {
    const m = parseScript("bir iki\nüç\n\n\ndört\n\nbeş");
    expect(m.lines.map((l) => l.paragraph)).toEqual([0, 0, 1, 2]);
    expect(m.lines.map((l) => l.paragraphStart)).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });

  it("applies a label-only speaker line to the next line", () => {
    const m = parseScript("B:\nMerhaba dünya\nA: selam");
    expect(m.lines[0]).toMatchObject({ speaker: "B", text: "Merhaba dünya" });
    expect(m.lines[1]).toMatchObject({ speaker: "A", text: "selam" });
  });

  it("keeps punctuation-only tokens as words with an empty norm", () => {
    const m = parseScript("Bir — iki ...");
    expect(m.words.map((w) => w.norm)).toEqual(["bir", "", "iki", ""]);
    expect(m.wordCount).toBe(4);
  });

  it("returns an empty model for empty or blank input", () => {
    for (const raw of ["", "   \n\r\n \t", "A:", "A:\nB:"]) {
      const m = parseScript(raw);
      expect(m.lines).toEqual([]);
      expect(m.wordCount).toBe(0);
      expect(m.dialogue).toBe(false);
    }
  });

  it("tolerates non-string input", () => {
    expect(parseScript(undefined as unknown as string).wordCount).toBe(0);
    expect(parseScript(null as unknown as string).wordCount).toBe(0);
  });

  it("strips control and zero-width characters", () => {
    const zw = String.fromCharCode(0x200b);
    const nul = String.fromCharCode(0);
    const bom = String.fromCharCode(0xfeff);
    const m = parseScript(`${bom}Mer${zw}haba${nul} dünya`);
    expect(m.words.map((w) => w.w)).toEqual(["Merhaba", "dünya"]);
  });

  it("splits on Unicode line separators", () => {
    const ls = String.fromCharCode(0x2028);
    const m = parseScript(`bir${ls}iki`);
    expect(m.lines.map((l) => l.text)).toEqual(["bir", "iki"]);
  });

  it("uses the requested language for norm", () => {
    expect(parseScript("Işık", { lang: "tr-TR" }).words[0]?.norm).toBe("ışık");
    expect(parseScript("Işık", { lang: "en-US" }).words[0]?.norm).toBe("işık");
    expect(parseScript("Işık", { lang: "en-US" }).lang).toBe("en-US");
  });

  it("bounds size: truncates by words and chars and reports it", () => {
    const words = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
    const byWords = parseScript(words, { maxWords: 10 });
    expect(byWords.wordCount).toBe(10);
    expect(byWords.truncated).toBe(true);
    expect(byWords.lines[0]?.text.split(" ")).toHaveLength(10);

    const multi = parseScript("a b c\nd e f\ng h i", { maxWords: 4 });
    expect(multi.wordCount).toBe(4);
    expect(multi.lines).toHaveLength(2);
    expect(multi.lines[1]?.words).toHaveLength(1);

    const byChars = parseScript("abc def ghi", { maxChars: 7 });
    expect(byChars.truncated).toBe(true);
    expect(byChars.lines[0]?.text).toBe("abc def");

    expect(parseScript("a b c", { maxWords: 3 }).truncated).toBe(false);
  });

  it("handles a large script quickly", () => {
    const raw = Array.from(
      { length: 20000 },
      (_, i) => `Satır ${i} içinde birkaç kelime var.`,
    ).join("\n");
    const t = Date.now();
    const m = parseScript(raw);
    expect(m.wordCount).toBe(20000 * 6);
    expect(Date.now() - t).toBeLessThan(3000);
  });
});

describe("lineIndexForWord / scriptProgress", () => {
  const m = parseScript("a b c\nd e\nf");
  it("finds the line containing a word", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => lineIndexForWord(m, i))).toEqual([
      0, 0, 0, 1, 1, 2,
    ]);
  });
  it("clamps out-of-range and invalid indices", () => {
    expect(lineIndexForWord(m, -5)).toBe(0);
    expect(lineIndexForWord(m, 999)).toBe(2);
    expect(lineIndexForWord(m, Number.NaN)).toBe(0);
    expect(lineIndexForWord(parseScript(""), 3)).toBe(-1);
  });
  it("computes progress 0..1", () => {
    expect(scriptProgress(m, 0)).toBe(0);
    expect(scriptProgress(m, 5)).toBe(1);
    expect(scriptProgress(m, 2.5)).toBeCloseTo(0.5);
    expect(scriptProgress(m, 99)).toBe(1);
    expect(scriptProgress(parseScript("tek"), 0)).toBe(0);
  });
});

describe("estimateWpm / speedForWpm", () => {
  it("converts with a known words-per-line", () => {
    // 40px * 1.5 = 60px per line; 60 px/s = 1 line/s; 8 words/line => 480 wpm
    expect(estimateWpm(60, 40, 1.5, 1000, 8)).toBeCloseTo(480, 6);
    expect(speedForWpm(480, 40, 1.5, 1000, 8)).toBeCloseTo(60, 6);
  });

  it("estimates words per line from font size and width when not given", () => {
    const wpl = estimateWordsPerLine(40, 1000);
    expect(wpl).toBeGreaterThan(5);
    expect(wpl).toBeLessThan(10);
    expect(estimateWpm(60, 40, 1.5, 1000)).toBeCloseTo(wpl * 60, 6);
  });

  it("round-trips", () => {
    for (const wpm of [90, 130, 180, 250]) {
      const speed = speedForWpm(wpm, 44, 1.4, 900);
      expect(estimateWpm(speed, 44, 1.4, 900)).toBeCloseTo(wpm, 6);
    }
  });

  it("scales linearly with speed and inversely with font size", () => {
    const a = estimateWpm(60, 40, 1.4, 1200);
    expect(estimateWpm(120, 40, 1.4, 1200)).toBeCloseTo(a * 2, 6);
    expect(estimateWpm(60, 80, 1.4, 1200)).toBeLessThan(a);
  });

  it("returns 0 for invalid input instead of NaN/Infinity", () => {
    expect(estimateWpm(0, 40, 1.4, 1000)).toBe(0);
    expect(estimateWpm(-5, 40, 1.4, 1000)).toBe(0);
    expect(estimateWpm(60, 0, 1.4, 1000)).toBe(0);
    expect(estimateWpm(60, 40, 0, 1000)).toBe(0);
    expect(estimateWpm(60, 40, 1.4, 0)).toBe(0);
    expect(estimateWpm(Number.NaN, 40, 1.4, 1000)).toBe(0);
    expect(speedForWpm(0, 40, 1.4, 1000)).toBe(0);
    expect(speedForWpm(150, 40, 1.4, 0)).toBe(0);
    expect(speedForWpm(150, Number.POSITIVE_INFINITY, 1.4, 1000)).toBe(0);
  });

  it("falls back to the estimate when avgWordsPerLine is invalid", () => {
    expect(estimateWpm(60, 40, 1.4, 1000, 0)).toBeCloseTo(
      estimateWpm(60, 40, 1.4, 1000),
      6,
    );
    expect(estimateWpm(60, 40, 1.4, 1000, Number.NaN)).toBeCloseTo(
      estimateWpm(60, 40, 1.4, 1000),
      6,
    );
  });

  it("never estimates fewer than one word per line", () => {
    expect(estimateWordsPerLine(200, 100)).toBe(1);
    expect(estimateWordsPerLine(0, 100)).toBe(0);
  });
});
