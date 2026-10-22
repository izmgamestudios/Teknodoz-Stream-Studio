// src/studio/watch/title-card.test.ts
import { describe, expect, it } from "vitest";

import { wrapLines } from "./title-card";

const measure = (s: string) => s.length * 10;

describe("wrapLines", () => {
  it("wraps on words within the width", () => {
    expect(wrapLines(measure, "Teknoloji Podcast Bölüm Onikinci", 150)).toEqual(
      ["Teknoloji", "Podcast", "Bölüm", "Onikinci"].reduce<string[]>(
        (acc, w) => {
          const last = acc[acc.length - 1];
          if (last !== undefined && measure(`${last} ${w}`) <= 150)
            acc[acc.length - 1] = `${last} ${w}`;
          else acc.push(w);
          return acc;
        },
        [],
      ),
    );
  });

  it("keeps explicit newlines and never splits a long word", () => {
    expect(wrapLines(measure, "a b\nc", 1000)).toEqual(["a b", "c"]);
    expect(wrapLines(measure, "Süpercalifragilistik", 50)).toEqual([
      "Süpercalifragilistik",
    ]);
    expect(wrapLines(measure, "", 100)).toEqual([""]);
  });
});
