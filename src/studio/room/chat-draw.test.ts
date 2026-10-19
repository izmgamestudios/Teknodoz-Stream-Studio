import { describe, expect, it } from "vitest";

import { createLayer } from "../defaults";
import { drawChat, wrapText } from "./chat-draw";

const measure = (s: string) => s.length * 10;

describe("wrapText", () => {
  it("wraps on word boundaries", () => {
    expect(wrapText(measure, "bir iki üç dört beş", 80, 5)).toEqual([
      "bir iki",
      "üç dört",
      "beş",
    ]);
  });
  it("splits words wider than the line", () => {
    expect(wrapText(measure, "abcdefghij", 40, 5)).toEqual([
      "abcd",
      "efgh",
      "ij",
    ]);
  });
  it("cuts with an ellipsis past the line limit", () => {
    const out = wrapText(measure, "bir iki üç dört beş altı yedi", 60, 2);
    expect(out).toHaveLength(2);
    expect(out[1]?.endsWith("…")).toBe(true);
    expect((out[1] as string).length * 10).toBeLessThanOrEqual(60);
  });
  it("handles empty text and tiny widths without looping forever", () => {
    expect(wrapText(measure, "   ", 100, 3)).toEqual([]);
    expect(wrapText(measure, "x".repeat(50), 1, 2).length).toBeLessThanOrEqual(
      2,
    );
  });
});

function fakeCtx() {
  const calls: string[] = [];
  let saves = 0;
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: s.length * 10 }),
    save: () => void saves++,
    restore: () => void saves--,
  };
  const ctx = new Proxy(target, {
    get(t, k: string) {
      if (k in t) return t[k];
      return (...a: unknown[]) => void calls.push(`${k}(${a.join(",")})`);
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, balanced: () => saves === 0 };
}

const box = { x: 100, y: 100, w: 800, h: 200 };

describe("drawChat", () => {
  it("draws nothing for an empty spotlight", () => {
    const { ctx, calls, balanced } = fakeCtx();
    drawChat(ctx, createLayer("chat"), box, { spotlight: null, feed: [] });
    expect(calls.filter((c) => c.startsWith("fill"))).toEqual([]);
    expect(balanced()).toBe(true);
  });

  it("draws author tag + message for the on-air message and restores state", () => {
    const { ctx, calls, balanced } = fakeCtx();
    drawChat(
      ctx,
      createLayer("chat", {
        transform: { x: 0, y: 0, w: 800, h: 200, rotation: 0 },
      }),
      box,
      {
        spotlight: { author: "Ayşe", text: "Fiyat ne kadar?" },
        feed: [],
      },
    );
    const text = calls.filter((c) => c.startsWith("fillText"));
    expect(text.some((c) => c.includes("AYŞE"))).toBe(true);
    expect(text.some((c) => c.includes("Fiyat"))).toBe(true);
    expect(balanced()).toBe(true);
  });

  it("feed mode stacks the newest messages and respects maxMessages", () => {
    const { ctx, calls, balanced } = fakeCtx();
    const feed = Array.from({ length: 6 }, (_, i) => ({
      author: `K${i}`,
      text: `mesaj ${i}`,
    }));
    drawChat(
      ctx,
      createLayer("chat", {
        mode: "feed",
        maxMessages: 2,
        fontSize: 30,
        transform: { x: 0, y: 0, w: 800, h: 200, rotation: 0 },
      }),
      box,
      { spotlight: null, feed },
    );
    const text = calls.filter((c) => c.startsWith("fillText")).join("|");
    expect(text).toContain("mesaj 5");
    expect(text).toContain("mesaj 4");
    expect(text).not.toContain("mesaj 3");
    expect(balanced()).toBe(true);
  });

  it("ignores degenerate boxes", () => {
    const { ctx, calls } = fakeCtx();
    drawChat(
      ctx,
      createLayer("chat"),
      { x: 0, y: 0, w: 0, h: 10 },
      {
        spotlight: { author: "a", text: "b" },
        feed: [],
      },
    );
    expect(calls).toEqual([]);
  });
});
