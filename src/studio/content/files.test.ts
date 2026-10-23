// src/studio/content/files.test.ts
import { describe, expect, it } from "vitest";

import { blankRow } from "../../server/content-model";
import { parseCsv } from "../../shared/tabular";
import { readTable } from "../../shared/xlsx";
import {
  buildExport,
  buildImportRows,
  buildTemplate,
  chunkRows,
  parseCsvImport,
  parseJsonImport,
} from "./files";

const bytesOf = (b: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(b);
  });
const readBlob = async (b: Blob): Promise<string> =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(await bytesOf(b));

describe("templates", () => {
  it("CSV: BOM, header only, chosen delimiter, no secret columns", async () => {
    const t = buildTemplate("live_event", "csv-semicolon", []);
    expect(t.filename).toBe("live_event-template-v1.csv");
    const text = await readBlob(t.blob);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const [header] = parseCsv(text);
    expect(header).toContain("title");
    expect(header).toContain("starts_at");
    expect(header).not.toContain("stream_key");
    expect(text).toContain(";");
  });

  it("JSON skeleton and XLSX with data / lists / readme sheets", async () => {
    expect(
      JSON.parse(await readBlob(buildTemplate("story", "json", []).blob)),
    ).toEqual({ schemaVersion: 1, type: "story", items: [{ _example: true }] });
    const x = buildTemplate("podcast", "xlsx", ["Nasıl doldurulur"]);
    expect(x.filename).toBe("podcast-template-v1.xlsx");
    const bytes = await bytesOf(x.blob);
    const table = await readTable(bytes);
    expect(table).toHaveLength(1);
    expect(table[0]).toContain("duration_sec");
  });
});

describe("export -> import round trip", () => {
  const row = blankRow("video", "=HYPERLINK(1)", "2026-10-22T10:00:00Z", {
    slug: "x",
    tags: ["a", "b"],
    body_blocks: [{ type: "paragraph", text: "Gövde" }],
    meta: { duration_sec: 90 },
  });

  it("CSV export is injection-guarded and re-imports to the same input", async () => {
    const e = buildExport("video", [row], "csv", [], "2026-10-22");
    const text = await readBlob(e.blob);
    expect(text).toContain("'=HYPERLINK(1)");
    const parsed = parseCsvImport(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [r] = buildImportRows("video", parsed.cells);
    expect(r).toMatchObject({ n: 2, id: row.id });
    expect(r!.input).toMatchObject({
      title: "=HYPERLINK(1)",
      slug: "x",
      tags: ["a", "b"],
      duration_sec: 90,
      locale: "tr",
      visibility: "draft",
    });
    expect(r!.input["body_blocks"]).toEqual([
      { type: "paragraph", text: "Gövde" },
    ]);
  });

  it("XLSX export re-imports; JSON export keeps ids", async () => {
    const x = buildExport("video", [row], "xlsx", [], "d");
    const table = await readTable(await bytesOf(x.blob));
    expect(table[1]![table[0]!.indexOf("title")]).toBe("'=HYPERLINK(1)");
    const j = JSON.parse(
      await readBlob(buildExport("video", [row], "json", [], "d").blob),
    );
    expect(j.items[0].id).toBe(row.id);
    const back = parseJsonImport(JSON.stringify(j), "video");
    expect(back.ok).toBe(true);
  });
});

describe("parsing", () => {
  it("JSON: skips _example, checks type and version", () => {
    expect(
      parseJsonImport(
        JSON.stringify({
          schemaVersion: 1,
          type: "story",
          items: [{ _example: true }],
        }),
        "story",
      ),
    ).toEqual({ ok: false, error: "empty" });
    expect(
      parseJsonImport(
        JSON.stringify({
          schemaVersion: 1,
          type: "video",
          items: [{ title: "x" }],
        }),
        "story",
      ),
    ).toEqual({ ok: false, error: "wrong-type" });
    expect(
      parseJsonImport(
        JSON.stringify({ schemaVersion: 9, type: "story", items: [] }),
        "story",
      ),
    ).toEqual({ ok: false, error: "newer-version" });
    expect(parseJsonImport("{", "story")).toEqual({
      ok: false,
      error: "bad-file",
    });
    const ok = parseJsonImport(
      JSON.stringify({
        schemaVersion: 1,
        type: "story",
        items: [
          {
            title: "x",
            tags: ["a", "b"],
            noindex: true,
            faq: [{ q: "q", a: "a" }],
          },
        ],
      }),
      "story",
    );
    expect(ok).toEqual({
      ok: true,
      cells: [
        {
          title: "x",
          tags: "a, b",
          noindex: "true",
          faq: '[{"q":"q","a":"a"}]',
        },
      ],
    });
  });

  it("import rows carry spreadsheet row numbers, ids and cell issues", () => {
    const rows = buildImportRows("video", [
      { title: "A", id: "abc" },
      { title: "B", duration_sec: "x" },
    ]);
    expect(rows[0]).toMatchObject({ n: 2, id: "abc" });
    expect(rows[1]).toMatchObject({
      n: 3,
      clientIssues: ["duration_sec:bad-number"],
    });
  });

  it("chunks at 500 rows", () => {
    expect(
      chunkRows(Array.from({ length: 1201 }, (_, i) => i)).map((c) => c.length),
    ).toEqual([500, 500, 201]);
  });
});
