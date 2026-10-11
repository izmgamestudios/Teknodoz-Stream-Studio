import { describe, expect, it } from "vitest";
import {
  chunkScript,
  DEFAULT_BURNIN_CHARS,
  drawBurnIn,
  getBurnInView,
  layoutBurnInLines,
  suggestBurnInChars,
  wrapText,
  type BurnInStyle,
  type BurnInView,
} from "./burn-in";
import { parseScript } from "./script";
import type { Rect } from "../types";

/** Every character is 10px wide. */
const measure = (s: string): number => s.length * 10;

describe("wrapText", () => {
  it("wraps greedily at word boundaries", () => {
    expect(wrapText(measure, "aaa bbb ccc ddd", 70)).toEqual([
      "aaa bbb",
      "ccc ddd",
    ]);
    expect(wrapText(measure, "aaa bbb ccc ddd", 149)).toEqual([
      "aaa bbb ccc",
      "ddd",
    ]);
    expect(wrapText(measure, "aaa bbb", 1000)).toEqual(["aaa bbb"]);
  });

  it("fits a line exactly at maxWidth", () => {
    expect(wrapText(measure, "aaaa bbbb", 90)).toEqual(["aaaa bbbb"]);
    expect(wrapText(measure, "aaaa bbbb", 89)).toEqual(["aaaa", "bbbb"]);
  });

  it("collapses whitespace and honours explicit newlines", () => {
    expect(wrapText(measure, "  aa   bb  ", 1000)).toEqual(["aa bb"]);
    expect(wrapText(measure, "aa\nbb cc\n\ndd", 1000)).toEqual([
      "aa",
      "bb cc",
      "dd",
    ]);
  });

  it("hard-breaks a word that is wider than the line", () => {
    expect(wrapText(measure, "abcdefghij", 40)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText(measure, "xx abcdefghij yy", 40)).toEqual([
      "xx",
      "abcd",
      "efgh",
      "ij",
      "yy",
    ]);
  });

  it("never splits a surrogate pair", () => {
    const text = "😀😀😀😀😀";
    const lines = wrapText((s) => Array.from(s).length * 10, text, 20);
    expect(lines).toEqual(["😀😀", "😀😀", "😀"]);
  });

  it("returns [] for empty input", () => {
    expect(wrapText(measure, "", 100)).toEqual([]);
    expect(wrapText(measure, "   \n  ", 100)).toEqual([]);
  });

  it("degrades to one word per line for tiny or invalid widths and always terminates", () => {
    expect(wrapText(measure, "aa bb cc", 0)).toEqual(["aa", "bb", "cc"]);
    expect(wrapText(measure, "aa bb cc", -5)).toEqual(["aa", "bb", "cc"]);
    expect(wrapText(measure, "aa bb cc", Number.NaN)).toEqual([
      "aa",
      "bb",
      "cc",
    ]);
    expect(wrapText(measure, "abc", 1)).toEqual(["a", "b", "c"]);
  });

  it("respects maxLines", () => {
    expect(wrapText(measure, "aa bb cc dd ee", 25, 2)).toEqual(["aa", "bb"]);
    expect(wrapText(measure, "aa\nbb\ncc", 100, 2)).toEqual(["aa", "bb"]);
  });

  it("bounds pathological input", () => {
    const lines = wrapText(measure, "word ".repeat(100_000), 200);
    expect(lines.length).toBeLessThanOrEqual(5000);
  });
});

const TEXT = `Herkese merhaba, podcastimize hoş geldiniz. Bugün oyun geliştirmenin zorluklarını konuşacağız.
İlk olarak küçük bir ekiple nasıl çalıştığımızı anlatacağım.

Daha sonra karşılaştığımız hataları ve çözümleri paylaşacağım. Sonunda sizlere birkaç tavsiye vereceğim.`;

describe("chunkScript", () => {
  const model = parseScript(TEXT);

  it("never exceeds maxChars (except for a single over-long word) and never spans lines", () => {
    const chunks = chunkScript(model, 30);
    for (const c of chunks) {
      expect(c.text.length <= 30 || !c.text.includes(" ")).toBe(true);
      const startLine = model.lines.find(
        (l) => l.firstWord <= c.firstWord && c.firstWord <= l.lastWord,
      );
      expect(startLine).toBeDefined();
      expect(c.lastWord).toBeLessThanOrEqual(startLine?.lastWord ?? -1);
    }
  });

  it("covers every word exactly once, in order", () => {
    const chunks = chunkScript(model, 30);
    let expected = 0;
    for (const c of chunks) {
      expect(c.firstWord).toBe(expected);
      expected = c.lastWord + 1;
    }
    expect(expected).toBe(model.wordCount);
  });

  it("closes a chunk at a sentence end once it is reasonably full", () => {
    const chunks = chunkScript(model, 80);
    expect(chunks[0]?.text.endsWith("geldiniz.")).toBe(true);
  });

  it("puts an over-long word in a chunk of its own", () => {
    const m = parseScript("kısa " + "x".repeat(60) + " kısa");
    expect(chunkScript(m, 20).map((c) => c.text)).toEqual([
      "kısa",
      "x".repeat(60),
      "kısa",
    ]);
  });

  it("caches per model and size, and clamps absurd sizes", () => {
    expect(chunkScript(model, 30)).toBe(chunkScript(model, 30));
    expect(chunkScript(model, 30)).not.toBe(chunkScript(model, 31));
    expect(chunkScript(model, 0).length).toBeGreaterThan(0);
    expect(chunkScript(model, Number.NaN).length).toBeGreaterThan(0);
  });

  it("returns no chunks for an empty script", () => {
    expect(chunkScript(parseScript(""), 40)).toEqual([]);
  });
});

describe("getBurnInView", () => {
  const model = parseScript(TEXT);

  it("subtitle: shows a page of two chunks and marks the active one", () => {
    const chunks = chunkScript(model, DEFAULT_BURNIN_CHARS.subtitle);
    const first = getBurnInView(model, 0, "subtitle");
    expect(first.lines).toEqual([chunks[0]?.text, chunks[1]?.text]);
    expect(first.activeLine).toBe(0);

    const second = getBurnInView(
      model,
      (chunks[1]?.firstWord ?? 0) + 1,
      "subtitle",
    );
    expect(second.lines).toEqual(first.lines); // same page while reading chunk 1
    expect(second.activeLine).toBe(1);

    const next = getBurnInView(model, chunks[2]?.firstWord ?? 0, "subtitle");
    expect(next.lines).toEqual([chunks[2]?.text, chunks[3]?.text]);
    expect(next.activeLine).toBe(0);
  });

  it("subtitle: last page may have a single line", () => {
    const chunks = chunkScript(model, DEFAULT_BURNIN_CHARS.subtitle);
    const lastIdx = chunks.length - 1;
    const view = getBurnInView(model, model.wordCount - 1, "subtitle");
    expect(view.lines.at(-1)).toBe(chunks[lastIdx]?.text);
    expect(view.lines.length).toBeLessThanOrEqual(2);
    expect(view.lines[view.activeLine]).toBe(chunks[lastIdx]?.text);
  });

  it("notch uses smaller chunks than subtitle", () => {
    const sub = getBurnInView(model, 0, "subtitle");
    const notch = getBurnInView(model, 0, "notch");
    expect((notch.lines[0] ?? "").length).toBeLessThanOrEqual(
      DEFAULT_BURNIN_CHARS.notch,
    );
    expect((notch.lines[0] ?? "").length).toBeLessThanOrEqual(
      (sub.lines[0] ?? "").length + 1,
    );
    expect(notch.lines.length).toBeLessThanOrEqual(2);
  });

  it("maxChars overrides the default chunk size", () => {
    const view = getBurnInView(model, 0, "subtitle", { maxChars: 15 });
    expect((view.lines[0] ?? "").length).toBeLessThanOrEqual(15);
  });

  it("reports overall progress and progress within the active line", () => {
    expect(getBurnInView(model, 0, "subtitle").progress).toBe(0);
    expect(getBurnInView(model, model.wordCount - 1, "subtitle").progress).toBe(
      1,
    );
    const mid = getBurnInView(
      model,
      Math.floor(model.wordCount / 2),
      "subtitle",
    );
    expect(mid.progress).toBeGreaterThan(0.4);
    expect(mid.progress).toBeLessThan(0.6);
    expect(getBurnInView(model, 0, "subtitle").lineProgress).toBe(0);
    const chunks = chunkScript(model, DEFAULT_BURNIN_CHARS.subtitle);
    const c0 = chunks[0];
    const end = getBurnInView(model, c0?.lastWord ?? 0, "subtitle");
    expect(end.lineProgress).toBe(1);
  });

  it("ticker: one line of upcoming text, ~200 chars, starting at the current chunk", () => {
    const big = parseScript(
      Array.from({ length: 400 }, (_, i) => `kelime${i}`).join(" "),
    );
    const view = getBurnInView(big, 100, "ticker");
    expect(view.lines).toHaveLength(1);
    expect(view.activeLine).toBe(0);
    const text = view.lines[0] ?? "";
    expect(text.length).toBeGreaterThanOrEqual(DEFAULT_BURNIN_CHARS.ticker);
    expect(text.length).toBeLessThan(DEFAULT_BURNIN_CHARS.ticker + 20);
    const firstWord = Number(/^kelime(\d+)/.exec(text)?.[1]);
    expect(firstWord).toBeLessThanOrEqual(100);
    expect(firstWord).toBeGreaterThan(100 - 12);
    expect(text).toContain("kelime100");
  });

  it("ticker: text is stable between neighbouring words of the same chunk", () => {
    const big = parseScript(
      Array.from({ length: 400 }, (_, i) => `kelime${i}`).join(" "),
    );
    const a = getBurnInView(big, 100, "ticker").lines[0];
    const b = getBurnInView(big, 101, "ticker").lines[0];
    expect(a).toBe(b);
  });

  it("ticker: joins script lines with a separator and stops at the end", () => {
    const m = parseScript("bir iki\nüç dört");
    const view = getBurnInView(m, 0, "ticker");
    expect(view.lines[0]).toBe("bir iki  •  üç dört");
    expect(getBurnInView(m, 3, "ticker").lines[0]).toBe("üç dört");
  });

  it("clamps out-of-range and invalid word indices", () => {
    const last = getBurnInView(model, model.wordCount - 1, "subtitle");
    expect(getBurnInView(model, 99_999, "subtitle")).toEqual(last);
    expect(getBurnInView(model, -10, "subtitle")).toEqual(
      getBurnInView(model, 0, "subtitle"),
    );
    expect(getBurnInView(model, Number.NaN, "subtitle")).toEqual(
      getBurnInView(model, 0, "subtitle"),
    );
    expect(getBurnInView(model, 2.7, "subtitle")).toEqual(
      getBurnInView(model, 2, "subtitle"),
    );
  });

  it("returns an empty view for an empty script in every mode", () => {
    for (const mode of ["subtitle", "ticker", "notch"] as const) {
      expect(getBurnInView(parseScript(""), 5, mode)).toEqual({
        lines: [],
        activeLine: 0,
        progress: 0,
        lineProgress: 0,
      });
    }
  });
});

describe("layoutBurnInLines", () => {
  it("returns every wrapped line when they fit", () => {
    const out = layoutBurnInLines(
      measure,
      { lines: ["aaa bbb", "ccc"], activeLine: 0, lineProgress: 0 },
      1000,
      2,
    );
    expect(out).toEqual([
      { text: "aaa bbb", active: true },
      { text: "ccc", active: false },
    ]);
  });

  it("keeps the active line and drops a neighbour that does not fit", () => {
    const view = {
      lines: ["aaa bbb", "ccc ddd"],
      activeLine: 1,
      lineProgress: 0,
    };
    const out = layoutBurnInLines(measure, view, 40, 2);
    // active line wraps into 2 lines and fills the budget; the other line is dropped
    expect(out.map((l) => l.text)).toEqual(["ccc", "ddd"]);
    expect(out.every((l) => l.active)).toBe(true);
  });

  it("adds the following line before the preceding one when room remains", () => {
    const view = { lines: ["aa", "bb", "cc"], activeLine: 1, lineProgress: 0 };
    const out = layoutBurnInLines(measure, view, 1000, 2);
    expect(out.map((l) => l.text)).toEqual(["bb", "cc"]);
  });

  it("pages through an active line that is taller than the budget", () => {
    const view = { lines: ["aa bb cc dd ee ff"], activeLine: 0 };
    const at = (lineProgress: number) =>
      layoutBurnInLines(measure, { ...view, lineProgress }, 25, 2).map(
        (l) => l.text,
      );
    expect(at(0)).toEqual(["aa", "bb"]);
    expect(at(0.4)).toEqual(["cc", "dd"]);
    expect(at(1)).toEqual(["ee", "ff"]);
  });

  it("handles empty input and out-of-range activeLine", () => {
    expect(
      layoutBurnInLines(
        measure,
        { lines: [], activeLine: 0, lineProgress: 0 },
        100,
        2,
      ),
    ).toEqual([]);
    const out = layoutBurnInLines(
      measure,
      { lines: ["aa", "bb", "cc"], activeLine: 9, lineProgress: 0 },
      1000,
      2,
    );
    expect(out.length).toBeLessThanOrEqual(2);
  });
});

describe("suggestBurnInChars", () => {
  it("scales with box width and font size", () => {
    const box: Rect = { x: 0, y: 0, w: 1600, h: 160 };
    const small = suggestBurnInChars("subtitle", box, 30);
    const large = suggestBurnInChars("subtitle", box, 60);
    expect(small).toBeGreaterThan(large);
    expect(suggestBurnInChars("ticker", box, 40)).toBeGreaterThan(
      suggestBurnInChars("subtitle", box, 40),
    );
  });

  it("falls back to the defaults for invalid input", () => {
    expect(suggestBurnInChars("notch", { x: 0, y: 0, w: 0, h: 0 }, 40)).toBe(
      DEFAULT_BURNIN_CHARS.notch,
    );
    expect(suggestBurnInChars("notch", { x: 0, y: 0, w: 100, h: 10 }, 0)).toBe(
      DEFAULT_BURNIN_CHARS.notch,
    );
  });
});

/* ------------------------------------------------------------------ */
/* drawBurnIn                                                          */
/* ------------------------------------------------------------------ */

interface Call {
  op: string;
  args: unknown[];
  alpha: number;
  align: string;
  fill: string;
  font: string;
}

class FakeCtx {
  font = "10px sans-serif";
  fillStyle: string = "#000";
  globalAlpha = 1;
  textAlign = "start";
  textBaseline = "alphabetic";
  calls: Call[] = [];
  private stack: Array<Record<string, unknown>> = [];
  roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;

  constructor(withRoundRect = true) {
    if (withRoundRect) {
      this.roundRect = (...args) => this.rec("roundRect", args);
    }
  }
  private rec(op: string, args: unknown[]): void {
    this.calls.push({
      op,
      args,
      alpha: this.globalAlpha,
      align: this.textAlign,
      fill: this.fillStyle,
      font: this.font,
    });
  }
  save(): void {
    this.stack.push({
      font: this.font,
      fillStyle: this.fillStyle,
      globalAlpha: this.globalAlpha,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
    });
    this.rec("save", []);
  }
  restore(): void {
    const s = this.stack.pop();
    if (s) Object.assign(this, s);
    this.rec("restore", []);
  }
  measureText(text: string): { width: number } {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
    return { width: text.length * size * 0.5 };
  }
  fillText(text: string, x: number, y: number): void {
    this.rec("fillText", [text, x, y]);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rec("fillRect", [x, y, w, h]);
  }
  beginPath(): void {
    this.rec("beginPath", []);
  }
  moveTo(x: number, y: number): void {
    this.rec("moveTo", [x, y]);
  }
  arcTo(...args: number[]): void {
    this.rec("arcTo", args);
  }
  closePath(): void {
    this.rec("closePath", []);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.rec("rect", [x, y, w, h]);
  }
  fill(): void {
    this.rec("fill", []);
  }
  clip(): void {
    this.rec("clip", []);
  }
  get depth(): number {
    return this.stack.length;
  }
  of(op: string): Call[] {
    return this.calls.filter((c) => c.op === op);
  }
  asCtx(): CanvasRenderingContext2D {
    return this as unknown as CanvasRenderingContext2D;
  }
}

const style: BurnInStyle = {
  fontFamily: "Inter, sans-serif",
  fontSize: 40,
  color: "#ffffff",
  contrast: 1,
};
const box: Rect = { x: 100, y: 800, w: 1600, h: 200 };
const view: BurnInView = {
  lines: [
    "Herkese merhaba, podcastimize hoş geldiniz.",
    "Bugün oyun geliştirmeyi konuşacağız.",
  ],
  activeLine: 0,
  progress: 0.2,
  lineProgress: 0,
};

describe("drawBurnIn: subtitle", () => {
  it("draws a rounded translucent box at the bottom with centered text, then restores state", () => {
    const ctx = new FakeCtx();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#123456";
    ctx.textAlign = "left";
    drawBurnIn(ctx.asCtx(), "subtitle", box, view, style);

    expect(ctx.depth).toBe(0);
    expect(ctx.globalAlpha).toBe(0.8);
    expect(ctx.fillStyle).toBe("#123456");
    expect(ctx.textAlign).toBe("left");
    expect(ctx.of("save")).toHaveLength(1);
    expect(ctx.of("restore")).toHaveLength(1);

    const [rr] = ctx.of("roundRect");
    expect(rr).toBeDefined();
    const [x, y, w, h] = rr?.args as number[];
    expect(x).toBeGreaterThanOrEqual(box.x);
    expect((x ?? 0) + (w ?? 0)).toBeLessThanOrEqual(box.x + box.w);
    expect((y ?? 0) + (h ?? 0)).toBeGreaterThan(box.y + box.h - style.fontSize); // hugs the bottom edge
    expect((y ?? 0) + (h ?? 0)).toBeLessThanOrEqual(box.y + box.h);
    expect((x ?? 0) + (w ?? 0) / 2).toBeCloseTo(box.x + box.w / 2, 5); // centered
    expect(rr?.alpha).toBeLessThan(0.8); // translucent, multiplied with the inherited alpha
    expect(rr?.alpha).toBeGreaterThan(0);

    const texts = ctx.of("fillText");
    expect(texts.length).toBe(2);
    expect(texts[0]?.args[0]).toBe(view.lines[0]);
    for (const t of texts) {
      expect(t.align).toBe("center");
      expect(t.args[1]).toBeCloseTo(box.x + box.w / 2, 5);
      expect(t.font).toContain("40px");
      expect(t.font).toContain("Inter");
    }
    // active line is brighter than the inactive one
    expect(texts[0]?.alpha).toBeGreaterThan(texts[1]?.alpha ?? 1);
  });

  it("wraps long lines but never draws more than two lines", () => {
    const ctx = new FakeCtx();
    const long: BurnInView = {
      lines: ["kelime ".repeat(40).trim(), "ikinci ".repeat(40).trim()],
      activeLine: 0,
      progress: 0,
      lineProgress: 0,
    };
    drawBurnIn(ctx.asCtx(), "subtitle", box, long, style);
    expect(ctx.of("fillText").length).toBeLessThanOrEqual(2);
    for (const t of ctx.of("fillText")) {
      expect(ctx.measureText(String(t.args[0])).width).toBeLessThanOrEqual(
        box.w,
      );
    }
  });

  it("lower contrast makes the panel and text fainter", () => {
    const strong = new FakeCtx();
    const faint = new FakeCtx();
    drawBurnIn(strong.asCtx(), "subtitle", box, view, {
      ...style,
      contrast: 1,
    });
    drawBurnIn(faint.asCtx(), "subtitle", box, view, { ...style, contrast: 0 });
    expect(faint.of("fillText")[0]?.alpha).toBeLessThan(
      strong.of("fillText")[0]?.alpha ?? 0,
    );
    expect(faint.of("roundRect")[0]?.alpha).toBeLessThan(
      strong.of("roundRect")[0]?.alpha ?? 0,
    );
    expect(faint.of("fillText")[0]?.alpha).toBeGreaterThan(0);
  });

  it("uses the configured background colour", () => {
    const ctx = new FakeCtx();
    drawBurnIn(ctx.asCtx(), "subtitle", box, view, {
      ...style,
      background: "#102030",
    });
    expect(ctx.of("roundRect")[0]?.fill).toBe("#102030");
  });

  it("falls back to arcTo paths when roundRect is unavailable", () => {
    const ctx = new FakeCtx(false);
    drawBurnIn(ctx.asCtx(), "subtitle", box, view, style);
    expect(ctx.of("arcTo")).toHaveLength(4);
    expect(ctx.of("fill")).toHaveLength(1);
    expect(ctx.depth).toBe(0);
  });
});

describe("drawBurnIn: notch", () => {
  it("draws a compact pill centered at the top of the box", () => {
    const ctx = new FakeCtx();
    drawBurnIn(ctx.asCtx(), "notch", box, view, { ...style, fontSize: 30 });
    const [rr] = ctx.of("roundRect");
    const [x, y, w, h] = rr?.args as number[];
    expect(y).toBeLessThan(box.y + box.h / 2);
    expect(y).toBeGreaterThanOrEqual(box.y);
    expect((x ?? 0) + (w ?? 0) / 2).toBeCloseTo(box.x + box.w / 2, 5);
    expect(w).toBeLessThan(box.w);
    expect(h).toBeLessThanOrEqual(30 * 1.25 * 2 + 30);
    expect(ctx.of("fillText").length).toBeGreaterThan(0);
    expect(ctx.depth).toBe(0);
  });

  it("is narrower than the subtitle panel for the same short text", () => {
    const short: BurnInView = {
      lines: ["Merhaba dünya"],
      activeLine: 0,
      progress: 0,
      lineProgress: 0,
    };
    const a = new FakeCtx();
    const b = new FakeCtx();
    drawBurnIn(a.asCtx(), "notch", box, short, style);
    drawBurnIn(b.asCtx(), "subtitle", box, short, style);
    expect(
      (a.of("roundRect")[0]?.args[2] as number) <=
        (b.of("roundRect")[0]?.args[2] as number),
    ).toBe(true);
  });
});

describe("drawBurnIn: ticker", () => {
  const tickerView: BurnInView = {
    lines: [
      "Bugün oyun geliştirmenin zorluklarını konuşacağız ve çözümleri paylaşacağız",
    ],
    activeLine: 0,
    progress: 0.1,
    lineProgress: 0,
  };

  it("draws a clipped strip with the text repeated to fill the width", () => {
    const ctx = new FakeCtx();
    drawBurnIn(ctx.asCtx(), "ticker", box, tickerView, style, 0);
    expect(ctx.of("fillRect")).toHaveLength(1);
    const [sx, sy, sw, sh] = ctx.of("fillRect")[0]?.args as number[];
    expect(sx).toBe(box.x);
    expect(sw).toBe(box.w);
    expect((sy ?? 0) + (sh ?? 0)).toBeLessThanOrEqual(box.y + box.h);
    expect(ctx.of("clip")).toHaveLength(1);
    const texts = ctx.of("fillText");
    expect(texts.length).toBeGreaterThanOrEqual(2);
    expect(texts[0]?.align).toBe("left");
    expect(texts[0]?.args[0]).toBe(tickerView.lines[0]);
    // copies are spaced by one loop width and cover the right edge
    const loop =
      texts[1]?.args[0] === texts[0]?.args[0]
        ? (texts[1]?.args[1] as number) - (texts[0]?.args[1] as number)
        : 0;
    expect(loop).toBeGreaterThan(0);
    const lastX = texts.at(-1)?.args[1] as number;
    expect(lastX).toBeGreaterThanOrEqual(box.x + box.w - loop);
    expect(ctx.depth).toBe(0);
  });

  it("scrolls right to left with nowMs and loops seamlessly", () => {
    const first = (ms: number): number => {
      const ctx = new FakeCtx();
      drawBurnIn(ctx.asCtx(), "ticker", box, tickerView, style, ms);
      return ctx.of("fillText")[0]?.args[1] as number;
    };
    const x0 = first(0);
    const x1 = first(1000);
    const x2 = first(2000);
    expect(x0).toBe(box.x);
    expect(x1).toBeLessThan(x0);
    expect(x2).toBeLessThan(x1);
    expect(x0 - x1).toBeCloseTo(style.fontSize * 5, 5); // default speed: fontSize * 5 px/s

    // after exactly one loop the picture repeats
    const textW = tickerView.lines[0]!.length * style.fontSize * 0.5;
    const loopPx = textW + style.fontSize * 3;
    const periodMs = (loopPx / (style.fontSize * 5)) * 1000;
    expect(first(periodMs)).toBeCloseTo(first(0), 3);
    expect(first(periodMs * 7 + 123)).toBeCloseTo(first(123), 3);
  });

  it("honours tickerSpeedPx and treats invalid nowMs as 0", () => {
    const at = (ms: number, speed?: number): number => {
      const ctx = new FakeCtx();
      drawBurnIn(
        ctx.asCtx(),
        "ticker",
        box,
        tickerView,
        { ...style, tickerSpeedPx: speed },
        ms,
      );
      return ctx.of("fillText")[0]?.args[1] as number;
    };
    expect(at(0) - at(1000, 100)).toBeCloseTo(100, 5);
    expect(at(Number.NaN)).toBe(box.x);
    expect(at(-5000)).toBe(box.x);
  });

  it("caps the number of text copies for tiny text", () => {
    const ctx = new FakeCtx();
    drawBurnIn(
      ctx.asCtx(),
      "ticker",
      { x: 0, y: 0, w: 100_000, h: 100 },
      { ...tickerView, lines: ["a"] },
      style,
      0,
    );
    expect(ctx.of("fillText").length).toBeLessThanOrEqual(64);
  });
});

describe("drawBurnIn: invalid input", () => {
  it("draws nothing for empty views, non-positive sizes or boxes", () => {
    const cases: Array<[Rect, BurnInView, BurnInStyle]> = [
      [box, { lines: [], activeLine: 0, progress: 0, lineProgress: 0 }, style],
      [box, view, { ...style, fontSize: 0 }],
      [box, view, { ...style, fontSize: Number.NaN }],
      [{ ...box, w: 0 }, view, style],
      [{ ...box, h: -4 }, view, style],
    ];
    for (const mode of ["subtitle", "notch", "ticker"] as const) {
      for (const [b, v, s] of cases) {
        const ctx = new FakeCtx();
        drawBurnIn(ctx.asCtx(), mode, b, v, s);
        expect(ctx.calls).toEqual([]);
      }
    }
  });

  it("restores state even when drawing throws", () => {
    const ctx = new FakeCtx();
    ctx.fillText = () => {
      throw new Error("boom");
    };
    expect(() => drawBurnIn(ctx.asCtx(), "subtitle", box, view, style)).toThrow(
      "boom",
    );
    expect(ctx.depth).toBe(0);
  });

  it("treats non-finite contrast as full contrast", () => {
    const ctx = new FakeCtx();
    drawBurnIn(ctx.asCtx(), "subtitle", box, view, {
      ...style,
      contrast: Number.NaN,
    });
    expect(ctx.of("fillText")[0]?.alpha).toBeGreaterThan(0.9);
  });
});

describe("end to end: model -> view -> draw", () => {
  it("draws the text around the current word for every mode", () => {
    const model = parseScript(TEXT);
    for (const mode of ["subtitle", "notch", "ticker"] as const) {
      const ctx = new FakeCtx();
      const v = getBurnInView(model, 12, mode);
      drawBurnIn(ctx.asCtx(), mode, box, v, style, 1234);
      expect(ctx.of("fillText").length).toBeGreaterThan(0);
      expect(ctx.depth).toBe(0);
    }
  });
});
