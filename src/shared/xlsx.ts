// src/shared/xlsx.ts
// Minimal, dependency-free XLSX reader / writer for the content templates and imports.
// Writer: stored (uncompressed) zip, inline strings, header style, frozen header row, dropdown
// data validation (`lists` sheet). Reader: only what Excel / LibreOffice / Google Sheets emit for
// plain tables (shared / inline strings, numbers, booleans). Files are untrusted, so the reader
// refuses DOCTYPE / ENTITY (XXE, billion laughs), zip64, too many entries, and stops inflating at
// a byte cap (zip bombs). Works in the browser, a Web Worker and Node (no DOM needed).

export class XlsxError extends Error {
  constructor(
    readonly code:
      | "not-xlsx"
      | "too-large"
      | "too-many-rows"
      | "too-many-columns"
      | "unsupported"
      | "xml-forbidden"
      | "no-sheet",
  ) {
    super(code);
  }
}

export interface XlsxLimits {
  maxEntries: number;
  /** uncompressed bytes per entry */
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxRows: number;
  maxCols: number;
}
export const DEFAULT_LIMITS: XlsxLimits = {
  maxEntries: 60,
  maxEntryBytes: 20 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxRows: 5001,
  maxCols: 100,
};

/* --------------------------------- zip --------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++)
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** 0 = stored (default), 8 = `data` is already raw-deflated */
  method?: 0 | 8;
  /** uncompressed size when method = 8 */
  rawSize?: number;
  crc?: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8");

export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: DataView, o: number, n: number) => v.setUint16(o, n, true);
  const u32 = (v: DataView, o: number, n: number) =>
    v.setUint32(o, n >>> 0, true);

  for (const e of entries) {
    const name = enc.encode(e.name);
    const method = e.method ?? 0;
    const raw = e.rawSize ?? e.data.length;
    const crc = e.crc ?? crc32(e.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20);
    u16(lv, 6, 0x0800);
    u16(lv, 8, method);
    u16(lv, 10, 0);
    u16(lv, 12, 0x21);
    u32(lv, 14, crc);
    u32(lv, 18, e.data.length);
    u32(lv, 22, raw);
    u16(lv, 26, name.length);
    u16(lv, 28, 0);
    local.set(name, 30);
    chunks.push(local, e.data);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20);
    u16(cv, 6, 20);
    u16(cv, 8, 0x0800);
    u16(cv, 10, method);
    u16(cv, 12, 0);
    u16(cv, 14, 0x21);
    u32(cv, 16, crc);
    u32(cv, 20, e.data.length);
    u32(cv, 24, raw);
    u16(cv, 28, name.length);
    u32(cv, 42, offset);
    cd.set(name, 46);
    central.push(cd);
    offset += local.length + e.data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 8, entries.length);
  u16(ev, 10, entries.length);
  u32(ev, 12, cdSize);
  u32(ev, 16, offset);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

async function inflateRaw(data: Uint8Array, cap: number): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer
    .write(data as unknown as BufferSource)
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = ds.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let r: ReadableStreamReadResult<Uint8Array>;
    try {
      r = await reader.read();
    } catch {
      throw new XlsxError("not-xlsx");
    }
    if (r.done) break;
    total += r.value.length;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw new XlsxError("too-large");
    }
    parts.push(r.value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of parts) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Entry name -> bytes, with every limit enforced. */
export async function readZip(
  bytes: Uint8Array,
  limits: XlsxLimits = DEFAULT_LIMITS,
): Promise<Map<string, Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 22 - 65_535);
    i--
  )
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new XlsxError("not-xlsx");
  const count = v.getUint16(eocd + 10, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff)
    throw new XlsxError("unsupported");
  if (count > limits.maxEntries) throw new XlsxError("too-large");

  const out = new Map<string, Uint8Array>();
  let total = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50)
      throw new XlsxError("not-xlsx");
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const comp = v.getUint32(p + 20, true);
    const raw = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new XlsxError("unsupported"); // encrypted
    if (name.endsWith("/")) continue;
    if (raw > limits.maxEntryBytes) throw new XlsxError("too-large");
    if (local + 30 > bytes.length || v.getUint32(local, true) !== 0x04034b50)
      throw new XlsxError("not-xlsx");
    const start =
      local +
      30 +
      v.getUint16(local + 26, true) +
      v.getUint16(local + 28, true);
    if (start + comp > bytes.length) throw new XlsxError("not-xlsx");
    const slice = bytes.subarray(start, start + comp);
    let data: Uint8Array;
    if (method === 0) data = slice;
    else if (method === 8)
      data = await inflateRaw(
        slice,
        Math.min(limits.maxEntryBytes, limits.maxTotalBytes - total),
      );
    else throw new XlsxError("unsupported");
    total += data.length;
    if (total > limits.maxTotalBytes) throw new XlsxError("too-large");
    out.set(name, data);
  }
  return out;
}

/* --------------------------------- xml --------------------------------- */

/** XML 1.0 forbids most control characters, even escaped: they are dropped. */
const xmlClean = (s: string): string => {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) out += ch;
  }
  return out;
};

const xmlEsc = (s: string): string =>
  xmlClean(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function decodeEntities(s: string): string {
  return s.replace(
    /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
    (_, e: string) => {
      if (e === "amp") return "&";
      if (e === "lt") return "<";
      if (e === "gt") return ">";
      if (e === "quot") return '"';
      if (e === "apos") return "'";
      const n =
        e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff
        ? String.fromCodePoint(n)
        : "";
    },
  );
}

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decodeEntities(m[1]!) : undefined;
};

const colLetters = (i: number): string => {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
const colIndex = (letters: string): number => {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/* -------------------------------- writer -------------------------------- */

export interface WorkbookInput {
  header: readonly string[];
  rows: readonly (readonly string[])[];
  /** dropdown choices per header key (validated on rows 2..1001 of that column) */
  lists?: Record<string, readonly string[]>;
  readme?: readonly string[];
}

export function buildWorkbook(input: WorkbookInput): Uint8Array {
  const strCell = (ref: string, s: string, style = 0): string =>
    s === ""
      ? ""
      : `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${xmlEsc(s)}</t></is></c>`;
  const sheetRows = (
    rows: readonly (readonly string[])[],
    headerStyle: boolean,
  ): string =>
    rows
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">${r.map((v, ci) => strCell(`${colLetters(ci)}${ri + 1}`, v, headerStyle && ri === 0 ? 1 : 0)).join("")}</row>`,
      )
      .join("");

  const listKeys = Object.keys(input.lists ?? {}).filter((k) =>
    input.header.includes(k),
  );
  const listRows: string[][] = [];
  const maxList = Math.max(0, ...listKeys.map((k) => input.lists![k]!.length));
  listRows.push(listKeys);
  for (let i = 0; i < maxList; i++)
    listRows.push(listKeys.map((k) => input.lists![k]![i] ?? ""));

  const validations = listKeys
    .map((k) => {
      const col = colLetters(input.header.indexOf(k));
      const lc = colLetters(listKeys.indexOf(k));
      const n = input.lists![k]!.length;
      return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${col}2:${col}1001"><formula1>lists!$${lc}$2:$${lc}$${n + 1}</formula1></dataValidation>`;
    })
    .join("");

  const dataSheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols><col min="1" max="${Math.max(1, input.header.length)}" width="24" customWidth="1"/></cols>` +
    `<sheetData>${sheetRows([input.header, ...input.rows], true)}</sheetData>` +
    (validations
      ? `<dataValidations count="${listKeys.length}">${validations}</dataValidations>`
      : "") +
    `</worksheet>`;
  const plain = (rows: readonly (readonly string[])[], header: boolean) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="30" width="28" customWidth="1"/></cols><sheetData>${sheetRows(rows, header)}</sheetData></worksheet>`;

  const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${NS}><sheets><sheet name="data" sheetId="1" r:id="rId1"/><sheet name="lists" sheetId="2" r:id="rId2"/><sheet name="readme" sheetId="3" r:id="rId3"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": dataSheet,
    "xl/worksheets/sheet2.xml": plain(listRows, true),
    "xl/worksheets/sheet3.xml": plain(
      (input.readme ?? []).map((l) => [l]),
      false,
    ),
  };
  return buildZip(
    Object.entries(files).map(([name, text]) => ({
      name,
      data: enc.encode(text),
    })),
  );
}

/* -------------------------------- reader -------------------------------- */

const forbid = (xml: string): void => {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new XlsxError("xml-forbidden");
};
const text = (b: Uint8Array | undefined): string => (b ? dec.decode(b) : "");

function sharedStrings(xml: string): string[] {
  forbid(xml);
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const body = m[1]!.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
    let s = "";
    for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
      s += decodeEntities(t[1]!);
    out.push(s);
  }
  return out;
}

function sheetRowsOf(
  xml: string,
  shared: readonly string[],
  limits: XlsxLimits,
): string[][] {
  forbid(xml);
  const rows: string[][] = [];
  let nextRow = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = attr(rm[1]!, "r");
    const ri = rAttr ? Number(rAttr) - 1 : nextRow;
    nextRow = ri + 1;
    if (ri >= limits.maxRows) throw new XlsxError("too-many-rows");
    const cells: string[] = [];
    let seq = 0;
    for (const cm of (rm[2] ?? "").matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const ref = attr(cm[1]!, "r");
      const col = ref ? colIndex(/^[A-Z]+/.exec(ref)?.[0] ?? "A") : seq;
      seq = col + 1;
      if (col >= limits.maxCols) throw new XlsxError("too-many-columns");
      const t = attr(cm[1]!, "t");
      const body = cm[2] ?? "";
      let value = "";
      if (t === "inlineStr") {
        for (const x of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
          value += decodeEntities(x[1]!);
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v !== undefined) {
          if (t === "s") value = shared[Number(v)] ?? "";
          else if (t === "b") value = v.trim() === "1" ? "true" : "false";
          else if (t === "e") value = "";
          else value = decodeEntities(v);
        }
      }
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    while (rows.length < ri) rows.push([]);
    rows[ri] = cells;
  }
  return rows;
}

export async function readWorkbook(
  bytes: Uint8Array,
  limits: XlsxLimits = DEFAULT_LIMITS,
): Promise<{ sheets: Record<string, string[][]> }> {
  const zip = await readZip(bytes, limits);
  const wb = text(zip.get("xl/workbook.xml"));
  if (!wb) throw new XlsxError("not-xlsx");
  forbid(wb);
  const rels = text(zip.get("xl/_rels/workbook.xml.rels"));
  forbid(rels);
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const t = attr(m[0], "Target");
    if (id && t) target.set(id, t.startsWith("/") ? t.slice(1) : `xl/${t}`);
  }
  const shared = zip.has("xl/sharedStrings.xml")
    ? sharedStrings(text(zip.get("xl/sharedStrings.xml")))
    : [];
  const sheets: Record<string, string[][]> = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], "name");
    const rid = attr(m[0], "r:id");
    const path = rid ? target.get(rid) : undefined;
    if (!name || !path || !zip.has(path)) continue;
    sheets[name] = sheetRowsOf(text(zip.get(path)), shared, limits);
  }
  if (Object.keys(sheets).length === 0) throw new XlsxError("no-sheet");
  return { sheets };
}

/** Rows of the `data` sheet (or the first one) as a table with blank rows removed. */
export async function readTable(
  bytes: Uint8Array,
  limits: XlsxLimits = DEFAULT_LIMITS,
): Promise<string[][]> {
  const { sheets } = await readWorkbook(bytes, limits);
  const rows = sheets["data"] ?? Object.values(sheets)[0] ?? [];
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
