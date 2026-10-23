// src/studio/content/files.ts
// Files of the content engine in the browser: blank templates and exports (CSV / XLSX / JSON) and
// reading an import file into cells. Pure functions return bytes / text; `download` saves them.
import {
  cellsToInput,
  encodeCsv,
  jsonTemplate,
  parseCsv,
  rowToCells,
  tableToCells,
  templateColumns,
  templateFilename,
  MAX_IMPORT_BYTES,
  type Cells,
  type CellIssue,
} from "../../shared/tabular";
import {
  IMPORT_VISIBILITIES,
  LOCALES,
  SCHEMA_VERSION,
  type EntityType,
} from "../../shared/schema-registry";
import { buildWorkbook, readTable, XlsxError } from "../../shared/xlsx";
import type { ContentRow, ImportRowDto } from "./content-client";

const MAX_ROWS_PER_CHUNK = 500;

export type FileFormat = "csv" | "csv-semicolon" | "xlsx" | "json";

const textBlob = (s: string, type: string) => new Blob([s], { type });
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Localised README lines for the template's `readme` sheet. */
export type ReadmeLines = readonly string[];

function listsFor(type: EntityType): Record<string, readonly string[]> {
  const lists: Record<string, readonly string[]> = {};
  for (const { key, def } of templateColumns(type)) {
    if (def.kind !== "select" || !def.options) continue;
    lists[key] =
      key === "visibility"
        ? IMPORT_VISIBILITIES
        : key === "locale"
          ? LOCALES
          : def.options;
  }
  return lists;
}

export function buildTemplate(
  type: EntityType,
  format: FileFormat,
  readme: ReadmeLines,
): { blob: Blob; filename: string } {
  const header = templateColumns(type).map((c) => c.key);
  switch (format) {
    case "xlsx":
      return {
        blob: new Blob(
          [
            buildWorkbook({
              header,
              rows: [],
              lists: listsFor(type),
              readme,
            }) as unknown as BlobPart,
          ],
          { type: XLSX_MIME },
        ),
        filename: templateFilename(type, "xlsx"),
      };
    case "json":
      return {
        blob: textBlob(jsonTemplate(type), "application/json"),
        filename: templateFilename(type, "json"),
      };
    default:
      return {
        blob: textBlob(
          encodeCsv([header], format === "csv-semicolon" ? ";" : ","),
          "text/csv;charset=utf-8",
        ),
        filename: templateFilename(type, "csv"),
      };
  }
}

export function buildExport(
  type: EntityType,
  rows: readonly ContentRow[],
  format: FileFormat,
  readme: ReadmeLines,
  stamp: string,
): { blob: Blob; filename: string } {
  const cols = templateColumns(type).map((c) => c.key);
  const cells = rows.map((r) => rowToCells(type, r));
  const base = `${type}-export-${stamp}`;
  if (format === "json")
    return {
      blob: textBlob(
        JSON.stringify(
          {
            schemaVersion: SCHEMA_VERSION,
            type,
            items: cells.map((c, i) => ({ ...c, id: rows[i]!.id })),
          },
          null,
          2,
        ),
        "application/json",
      ),
      filename: `${base}.json`,
    };
  const table = [
    cols,
    ...cells.map((c, i) =>
      cols.map((k) => (k === "id" ? rows[i]!.id : (c[k] ?? ""))),
    ),
  ];
  if (format === "xlsx")
    return {
      blob: new Blob(
        [
          buildWorkbook({
            header: cols,
            rows: table.slice(1).map((r) => r.map(guardForSheet)),
            lists: listsFor(type),
            readme,
          }) as unknown as BlobPart,
        ],
        { type: XLSX_MIME },
      ),
      filename: `${base}.xlsx`,
    };
  return {
    blob: textBlob(
      encodeCsv(table, format === "csv-semicolon" ? ";" : ","),
      "text/csv;charset=utf-8",
    ),
    filename: `${base}.csv`,
  };
}

/** Spreadsheet-injection guard for XLSX text cells (CSV applies it inside encodeCsv). */
const guardForSheet = (s: string): string =>
  /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;

export function download(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ------------------------------- reading ------------------------------- */

export type ParseError =
  | "too-large"
  | "empty"
  | "bad-file"
  | "wrong-type"
  | "newer-version"
  | "too-many-rows"
  | "xlsx-forbidden";

export type ParsedFile =
  { ok: true; cells: Cells[] } | { ok: false; error: ParseError };

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v))
    return v.some((x) => typeof x === "object")
      ? JSON.stringify(v)
      : v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export function parseJsonImport(text: string, type: EntityType): ParsedFile {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: "bad-file" };
  }
  if (typeof v !== "object" || v === null)
    return { ok: false, error: "bad-file" };
  const o = v as { schemaVersion?: unknown; type?: unknown; items?: unknown };
  if (typeof o.schemaVersion === "number" && o.schemaVersion > SCHEMA_VERSION)
    return { ok: false, error: "newer-version" };
  if (o.type !== type) return { ok: false, error: "wrong-type" };
  if (!Array.isArray(o.items)) return { ok: false, error: "bad-file" };
  const cells = (o.items as Record<string, unknown>[])
    .filter((it) => it && typeof it === "object" && it["_example"] !== true)
    .map((it) =>
      Object.fromEntries(
        Object.entries(it).map(([k, val]) => [k, cellText(val)]),
      ),
    );
  return cells.length ? { ok: true, cells } : { ok: false, error: "empty" };
}

export function parseCsvImport(text: string): ParsedFile {
  try {
    const cells = tableToCells(parseCsv(text));
    return cells.length ? { ok: true, cells } : { ok: false, error: "empty" };
  } catch (e) {
    return {
      ok: false,
      error:
        (e as { code?: string }).code === "too-many-rows"
          ? "too-many-rows"
          : "too-large",
    };
  }
}

/** XLSX runs in a Web Worker so a hostile file cannot freeze the page; falls back to this thread. */
export async function parseXlsxImport(bytes: Uint8Array): Promise<ParsedFile> {
  const rows = await readXlsxRows(bytes);
  if (!rows.ok) return rows;
  const cells = tableToCells(rows.table);
  return cells.length ? { ok: true, cells } : { ok: false, error: "empty" };
}

function mapXlsxError(code: string): ParseError {
  if (code === "too-many-rows" || code === "too-many-columns")
    return "too-many-rows";
  if (code === "too-large") return "too-large";
  if (code === "xml-forbidden") return "xlsx-forbidden";
  return "bad-file";
}

async function readXlsxRows(
  bytes: Uint8Array,
): Promise<{ ok: true; table: string[][] } | { ok: false; error: ParseError }> {
  if (typeof Worker !== "undefined") {
    try {
      const worker = new Worker(new URL("./xlsx.worker.ts", import.meta.url), {
        type: "module",
      });
      return await new Promise((resolve) => {
        const done = (
          r: { ok: true; table: string[][] } | { ok: false; error: ParseError },
        ) => {
          worker.terminate();
          resolve(r);
        };
        worker.onmessage = (
          e: MessageEvent<{ table?: string[][]; code?: string }>,
        ) =>
          done(
            e.data.table
              ? { ok: true, table: e.data.table }
              : { ok: false, error: mapXlsxError(e.data.code ?? "") },
          );
        worker.onerror = () => done({ ok: false, error: "bad-file" });
        worker.postMessage({ bytes }, [bytes.buffer]);
      });
    } catch {
      /* no worker support: parse here */
    }
  }
  try {
    return { ok: true, table: await readTable(bytes) };
  } catch (e) {
    return {
      ok: false,
      error: mapXlsxError(e instanceof XlsxError ? e.code : ""),
    };
  }
}

export async function parseImportFile(
  file: File,
  type: EntityType,
): Promise<ParsedFile> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: "too-large" };
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx"))
    return parseXlsxImport(new Uint8Array(await file.arrayBuffer()));
  const text = await file.text();
  if (name.endsWith(".json")) return parseJsonImport(text, type);
  return parseCsvImport(text);
}

/* ------------------------------ import rows ------------------------------ */

export function issueCodes(issues: readonly CellIssue[]): string[] {
  return issues.map((i) => `${i.column}:${i.code}`);
}

/** Cells -> API rows. Row numbers match the spreadsheet (header = row 1). */
export function buildImportRows(
  type: EntityType,
  cells: readonly Cells[],
): ImportRowDto[] {
  return cells.map((c, i) => {
    const { input, issues } = cellsToInput(type, c);
    const id = (c["id"] ?? "").trim();
    return {
      n: i + 2,
      ...(id ? { id } : {}),
      input,
      ...(issues.length ? { clientIssues: issueCodes(issues) } : {}),
    };
  });
}

export function chunkRows<T>(
  rows: readonly T[],
  size = MAX_ROWS_PER_CHUNK,
): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
