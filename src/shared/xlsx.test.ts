// src/shared/xlsx.test.ts
import { describe, expect, it } from "vitest";

import {
  XlsxError,
  buildWorkbook,
  buildZip,
  crc32,
  readTable,
  readWorkbook,
  readZip,
} from "./xlsx";

const enc = new TextEncoder();

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const w = cs.writable.getWriter();
  void w.write(data as unknown as BufferSource).then(() => w.close());
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}

describe("xlsx writer + reader", () => {
  const header = ["id", "title", "visibility", "body_md"];
  const rows = [
    ["", 'Çağrı & "Röportaj" <1>', "draft", "satır bir\nsatır iki"],
    ["", "  boşluklu  ", "private", ""],
  ];

  it("round-trips strings, unicode, quotes, markup characters and newlines", async () => {
    const bytes = buildWorkbook({
      header,
      rows,
      lists: { visibility: ["draft", "private"] },
      readme: ["Nasıl doldurulur", "satır 2"],
    });
    const table = await readTable(bytes);
    expect(table[0]).toEqual(header);
    expect(table[1]).toEqual(rows[0]);
    expect(table[2]).toEqual(["", "  boşluklu  ", "private"]);
    const wb = await readWorkbook(bytes);
    expect(Object.keys(wb.sheets)).toEqual(["data", "lists", "readme"]);
    expect(wb.sheets["lists"]).toEqual([
      ["visibility"],
      ["draft"],
      ["private"],
    ]);
    expect(wb.sheets["readme"]).toEqual([["Nasıl doldurulur"], ["satır 2"]]);
  });

  it("contains dropdown validation, a frozen header row and a valid zip layout", async () => {
    const bytes = buildWorkbook({
      header,
      rows: [],
      lists: { visibility: ["draft", "private"] },
    });
    const zip = await readZip(bytes);
    const sheet = new TextDecoder().decode(zip.get("xl/worksheets/sheet1.xml"));
    expect(sheet).toContain('<dataValidation type="list"');
    expect(sheet).toContain('sqref="C2:C1001"');
    expect(sheet).toContain("lists!$A$2:$A$3");
    expect(sheet).toContain('state="frozen"');
    expect([...zip.keys()]).toContain("[Content_Types].xml");
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
  });

  it("reads Excel-style files: shared strings, numbers, booleans, sparse cells, deflate", async () => {
    const files: [string, string][] = [
      [
        "xl/workbook.xml",
        '<workbook xmlns:r="x"><sheets><sheet name="Sayfa1" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ],
      [
        "xl/_rels/workbook.xml.rels",
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      ],
      [
        "xl/sharedStrings.xml",
        "<sst><si><t>baş&amp;lık</t></si><si><r><t>ça</t></r><r><t>ğrı</t></r></si></sst>",
      ],
      [
        "xl/worksheets/sheet1.xml",
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="3"><c r="A3"><v>42.5</v></c><c r="B3" t="b"><v>1</v></c></row></sheetData></worksheet>',
      ],
    ];
    const entries = await Promise.all(
      files.map(async ([name, t]) => {
        const raw = enc.encode(t);
        return {
          name,
          data: await deflateRaw(raw),
          method: 8 as const,
          rawSize: raw.length,
          crc: crc32(raw),
        };
      }),
    );
    const table = await readTable(buildZip(entries));
    expect(table).toEqual([
      ["baş&lık", "", "çağrı"],
      ["42.5", "true"],
    ]);
  });

  it("rejects non-xlsx input, DOCTYPE / ENTITY and encrypted or odd zips", async () => {
    await expect(
      readTable(enc.encode("not a zip at all")),
    ).rejects.toMatchObject({ code: "not-xlsx" });
    const evil = buildZip([
      {
        name: "xl/workbook.xml",
        data: enc.encode('<!DOCTYPE x [<!ENTITY a "aaaa">]><workbook/>'),
      },
    ]);
    await expect(readTable(evil)).rejects.toMatchObject({
      code: "xml-forbidden",
    });
    const noSheet = buildZip([
      {
        name: "xl/workbook.xml",
        data: enc.encode("<workbook><sheets/></workbook>"),
      },
    ]);
    await expect(readTable(noSheet)).rejects.toBeInstanceOf(XlsxError);
  });

  it("stops a zip bomb at the byte cap instead of inflating it", async () => {
    const zeros = new Uint8Array(30 * 1024 * 1024);
    const packed = await deflateRaw(zeros);
    expect(packed.length).toBeLessThan(200_000); // a tiny file that would expand to 30 MB
    const bomb = buildZip([
      {
        name: "xl/workbook.xml",
        data: packed,
        method: 8,
        rawSize: 1000,
        crc: 0,
      },
    ]);
    await expect(
      readTable(bomb, {
        maxEntries: 10,
        maxEntryBytes: 1024 * 1024,
        maxTotalBytes: 2 * 1024 * 1024,
        maxRows: 100,
        maxCols: 10,
      }),
    ).rejects.toMatchObject({ code: "too-large" });
  });

  it("enforces row and column limits", async () => {
    const many = buildWorkbook({
      header: ["a"],
      rows: Array.from({ length: 12 }, (_, i) => [String(i)]),
    });
    await expect(
      readTable(many, {
        maxEntries: 60,
        maxEntryBytes: 1e7,
        maxTotalBytes: 1e7,
        maxRows: 10,
        maxCols: 5,
      }),
    ).rejects.toMatchObject({ code: "too-many-rows" });
    const wide = buildWorkbook({
      header: Array.from({ length: 8 }, (_, i) => `c${i}`),
      rows: [],
    });
    await expect(
      readTable(wide, {
        maxEntries: 60,
        maxEntryBytes: 1e7,
        maxTotalBytes: 1e7,
        maxRows: 100,
        maxCols: 5,
      }),
    ).rejects.toMatchObject({ code: "too-many-columns" });
  });
});
