// src/shared/tabular.test.ts
import { describe, expect, it } from "vitest";

import { mdToBlocks, blocksToMd } from "./markdown";
import {
  CLEAR,
  ImportLimitError,
  cellsToInput,
  detectDelimiter,
  encodeCsv,
  guardCell,
  jsonTemplate,
  parseCsv,
  rowToCells,
  tableToCells,
  templateColumns,
  templateFilename,
} from "./tabular";

describe("markdown", () => {
  it("parses headings, paragraphs, lists, links, images, embeds", () => {
    const blocks = mdToBlocks(
      "# Başlık\n\nİlk **kalın** paragraf\nikinci satır\n\n- bir\n- iki\n\n1. a\n2. b\n\n[Site](https://example.org)\n\n![Alt](https://example.org/a.png)\n\nhttps://www.youtube.com/watch?v=abc",
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "link",
      "image",
      "embed",
    ]);
    expect(blocks[1]).toEqual({
      type: "paragraph",
      text: "İlk kalın paragraf ikinci satır",
    });
    expect(blocks[3]).toEqual({
      type: "list",
      ordered: true,
      items: ["a", "b"],
    });
  });

  it("never keeps HTML or unsafe urls", () => {
    const blocks = mdToBlocks(
      "<script>alert(1)</script>Merhaba <b>dünya</b>\n\n[x](javascript:alert(1))\n\nhttps://evil.example/embed",
    );
    expect(JSON.stringify(blocks)).not.toMatch(/<|script>/);
    expect(blocks.some((b) => b.type === "link")).toBe(false);
    expect(blocks.some((b) => b.type === "embed")).toBe(false);
  });

  it("round-trips through blocksToMd", () => {
    const md =
      "## Konu\n\nMetin.\n\n- a\n- b\n\nhttps://www.youtube.com/watch?v=abc";
    expect(blocksToMd(mdToBlocks(md))).toBe(md);
  });
});

describe("csv", () => {
  it("encodes with BOM, quoting and the injection guard", () => {
    const csv = encodeCsv(
      [
        ["a", 'b"c', "=SUM(1)"],
        ["x,y", "satır\nsonu", "-5"],
      ],
      ";",
    );
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('a;"b""c";\'=SUM(1)');
    expect(csv).toContain('"x,y";"satır\nsonu";\'-5');
    expect(guardCell("hello")).toBe("hello");
  });

  it("detects the delimiter and parses quotes, CRLF and BOM", () => {
    expect(detectDelimiter("a;b;c\n1,2,3")).toBe(";");
    expect(detectDelimiter('"a,b",c\n')).toBe(",");
    const t = parseCsv('﻿a;b\r\n"x;1";"he said ""hi"""\r\n\r\n3;4');
    expect(t).toEqual([
      ["a", "b"],
      ["x;1", 'he said "hi"'],
      ["3", "4"],
    ]);
  });

  it("round-trips what it writes (both delimiters)", () => {
    const rows = [
      ["başlık", "açıklama"],
      ["Çok, özel", 'dört "tırnak"\niki satır'],
      ["", "son"],
    ];
    for (const d of [",", ";"] as const)
      expect(parseCsv(encodeCsv(rows, d))).toEqual([rows[0], rows[1], rows[2]]);
  });

  it("enforces the row limit", () => {
    const big = "a\n" + "1\n".repeat(5002);
    expect(() => parseCsv(big)).toThrow(ImportLimitError);
  });

  it("maps header + rows to objects", () => {
    expect(tableToCells([["a", "b"], ["1"], ["2", "3", "extra"]])).toEqual([
      { a: "1", b: "" },
      { a: "2", b: "3" },
    ]);
  });
});

describe("cells <-> input", () => {
  it("converts kinds, empty = unchanged, [[CLEAR]] = null, body_md -> blocks", () => {
    const { input, issues } = cellsToInput("podcast", {
      id: "",
      title: " Bölüm 1 ",
      slug: "",
      tags: "a, b;c",
      duration_sec: "90,5",
      explicit: "Evet",
      season: CLEAR,
      faq: '[{"q":"S?","a":"C."}]',
      body_md: "Merhaba\n\n- x",
      visibility: "DRAFT",
      media_url: "",
    });
    expect(issues).toEqual([]);
    expect(input).toEqual({
      title: "Bölüm 1",
      tags: ["a", "b", "c"],
      duration_sec: 90.5,
      explicit: true,
      season: null,
      faq: [{ q: "S?", a: "C." }],
      body_blocks: [
        { type: "paragraph", text: "Merhaba" },
        { type: "list", ordered: false, items: ["x"] },
      ],
      visibility: "draft",
    });
  });

  it("reports bad cells, rejects secret columns, converts Excel date serials", () => {
    const r = cellsToInput("live_event", {
      title: "x",
      stream_key: "abc",
      starts_at: "46000",
      platform: "youtube",
    });
    expect(r.issues).toEqual([{ column: "stream_key", code: "secret-column" }]);
    expect(r.input["starts_at"]).toBe("2025-12-09");
    const bad = cellsToInput("video", {
      title: "x",
      duration_sec: "abc",
      noindex: "maybe",
      faq: "{",
    });
    expect(bad.issues.map((i) => i.code).sort()).toEqual([
      "bad-bool",
      "bad-json",
      "bad-number",
    ]);
    // the export guard prefix is removed again
    expect(cellsToInput("video", { title: "'=1+1" }).input["title"]).toBe(
      "=1+1",
    );
  });

  it("row -> cells covers every exposed column and never a secret one", () => {
    const cols = templateColumns("room").map((c) => c.key);
    expect(cols).not.toContain("join_code");
    const cells = rowToCells("video", {
      id: "abc",
      external_id: "",
      slug: "s",
      title: "T",
      summary: "",
      body_blocks: [{ type: "paragraph", text: "Gövde" }],
      locale: "tr",
      visibility: "draft",
      tags: ["a", "b"],
      noindex: false,
      meta: { duration_sec: 5, faq: [{ q: "q", a: "a" }] },
    });
    expect(cells["body_md"]).toBe("Gövde");
    expect(cells["tags"]).toBe("a, b");
    expect(cells["duration_sec"]).toBe("5");
    expect(cells["faq"]).toBe('[{"q":"q","a":"a"}]');
    expect(cells["noindex"]).toBe("false");
  });

  it("names templates and builds the JSON skeleton", () => {
    expect(templateFilename("story", "csv")).toBe("story-template-v1.csv");
    expect(JSON.parse(jsonTemplate("story"))).toEqual({
      schemaVersion: 1,
      type: "story",
      items: [{ _example: true }],
    });
  });
});
