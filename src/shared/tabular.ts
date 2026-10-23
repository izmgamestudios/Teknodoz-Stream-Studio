// src/shared/tabular.ts
// Flat table form of content rows: column order, cell <-> value conversion, CSV (RFC 4180) with
// the Turkish-Excel conventions (UTF-8 BOM, `;` delimiter on request, auto-detect on import) and
// the spreadsheet-injection guard. Pure, so the browser, the worker and the tests share it.
import type { Block } from "./blocks";
import { blocksToMd, mdToBlocks } from "./markdown";
import {
  SCHEMA_VERSION,
  exposedFields,
  secretFields,
  type EntityType,
  type FieldDef,
} from "./schema-registry";

export const CLEAR = "[[CLEAR]]";
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export interface ColumnDef {
  key: string;
  def: FieldDef;
}

/** Template / export columns for a type: every non-secret field, in registry order. */
export function templateColumns(type: EntityType): ColumnDef[] {
  return exposedFields(type).map((def) => ({ key: def.key, def }));
}

export const templateFilename = (
  type: EntityType,
  ext: "csv" | "xlsx" | "json",
): string => `${type}-template-v${SCHEMA_VERSION}.${ext}`;

/* ------------------------------ cell values ------------------------------ */

export type Cells = Record<string, string>;

/** `body_md` is derived from the blocks; meta fields live under `meta`. */
export function rowToCells(
  type: EntityType,
  row: {
    id: string;
    body_blocks: readonly Block[];
    meta: Record<string, unknown>;
    [k: string]: unknown;
  },
): Cells {
  const out: Cells = {};
  for (const { key, def } of templateColumns(type)) {
    let v: unknown;
    if (key === "body_md") v = blocksToMd(row.body_blocks);
    else if (def.meta) v = row.meta[key];
    else v = row[key];
    out[key] = cellOf(def, v);
  }
  return out;
}

function cellOf(def: FieldDef, v: unknown): string {
  if (v === null || v === undefined) return "";
  switch (def.kind) {
    case "tags":
      return Array.isArray(v) ? v.join(", ") : "";
    case "bool":
      return v ? "true" : "false";
    case "json":
      return typeof v === "string" ? v : JSON.stringify(v);
    default:
      return String(v);
  }
}

const TRUE = new Set([
  "true",
  "1",
  "yes",
  "evet",
  "doğru",
  "dogru",
  "ja",
  "wahr",
  "sí",
  "si",
  "x",
]);
const FALSE = new Set(["false", "0", "no", "hayır", "hayir", "nein", "falsch"]);

export interface CellIssue {
  column: string;
  code: "bad-number" | "bad-bool" | "bad-json" | "bad-date" | "secret-column";
}

/** Excel stores dates as day serials; real dates in 1982-2119 are in this range. */
function excelSerialToIso(n: number): string {
  return new Date(Math.round((n - 25569) * 86400) * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Cells -> the input object of the API. Empty cell = key absent (unchanged on update),
 * `[[CLEAR]]` = null. Unknown columns are ignored; a secret column is an error.
 */
export function cellsToInput(
  type: EntityType,
  cells: Cells,
): { input: Record<string, unknown>; issues: CellIssue[] } {
  const input: Record<string, unknown> = {};
  const issues: CellIssue[] = [];
  const known = new Map(templateColumns(type).map((c) => [c.key, c.def]));
  const secret = new Set(secretFields(type));

  for (const [column, rawValue] of Object.entries(cells)) {
    if (secret.has(column) && rawValue.trim() !== "") {
      issues.push({ column, code: "secret-column" });
      continue;
    }
    const def = known.get(column);
    if (!def || column === "id") continue;
    // undo the export-side injection guard
    let raw = rawValue.replace(/^'(?=[=+\-@])/, "");
    raw = raw.trim();
    if (raw === "") continue;
    if (raw === CLEAR) {
      input[column] = null;
      continue;
    }
    switch (def.kind) {
      case "tags":
        input[column] = raw
          .split(/[,;|]/)
          .map((t) => t.trim())
          .filter(Boolean);
        break;
      case "bool": {
        const l = raw.toLowerCase();
        if (TRUE.has(l)) input[column] = true;
        else if (FALSE.has(l)) input[column] = false;
        else issues.push({ column, code: "bad-bool" });
        break;
      }
      case "number": {
        const n = Number(raw.replace(",", "."));
        if (Number.isFinite(n)) input[column] = n;
        else issues.push({ column, code: "bad-number" });
        break;
      }
      case "date": {
        if (
          /^\d{5}(\.\d+)?$/.test(raw) &&
          Number(raw) > 30000 &&
          Number(raw) < 90000
        )
          input[column] = excelSerialToIso(Number(raw));
        else if (!Number.isNaN(Date.parse(raw))) input[column] = raw;
        else issues.push({ column, code: "bad-date" });
        break;
      }
      case "json":
        try {
          input[column] = JSON.parse(raw);
        } catch {
          issues.push({ column, code: "bad-json" });
        }
        break;
      case "select":
        input[column] = raw.toLowerCase();
        break;
      default:
        input[column] = raw;
    }
  }
  // body_md is converted here so the server receives structured blocks only
  if (typeof input["body_md"] === "string") {
    input["body_blocks"] = mdToBlocks(input["body_md"]);
    delete input["body_md"];
  } else if (input["body_md"] === null) {
    input["body_blocks"] = [];
    delete input["body_md"];
  }
  return { input, issues };
}

/* ---------------------------------- CSV ---------------------------------- */

const BOM = "﻿";
const INJECT = /^[=+\-@\t\r]/;

/** Spreadsheet-injection guard: a text cell that starts with = + - @ is prefixed with `'`. */
export const guardCell = (s: string): string => (INJECT.test(s) ? `'${s}` : s);

export function encodeCsv(
  rows: readonly (readonly string[])[],
  delimiter: "," | ";" = ",",
): string {
  const esc = (s: string): string => {
    const g = guardCell(s);
    return /["\n\r,;]/.test(g) ? `"${g.replace(/"/g, '""')}"` : g;
  };
  return (
    BOM + rows.map((r) => r.map(esc).join(delimiter)).join("\r\n") + "\r\n"
  );
}

/** Delimiter of the first line outside quotes. */
export function detectDelimiter(text: string): "," | ";" | "\t" {
  let inQuotes = false;
  const count = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of text.slice(0, 5000)) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === "\n") break;
      if (ch in count) count[ch as keyof typeof count]++;
    }
  }
  return count[";"] > count[","] && count[";"] >= count["\t"]
    ? ";"
    : count["\t"] > count[","]
      ? "\t"
      : ",";
}

export class ImportLimitError extends Error {
  constructor(readonly code: "too-many-rows" | "too-large") {
    super(code);
  }
}

export function parseCsv(input: string): string[][] {
  if (input.length > MAX_IMPORT_BYTES) throw new ImportLimitError("too-large");
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const d = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const endRow = () => {
    row.push(cell);
    cell = "";
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
    if (rows.length > MAX_IMPORT_ROWS + 1)
      throw new ImportLimitError("too-many-rows");
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === d) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== "" || row.length) endRow();
  return rows;
}

/** Header row + data rows -> objects keyed by header (extra cells dropped, missing = ""). */
export function tableToCells(table: readonly (readonly string[])[]): Cells[] {
  const [header, ...rows] = table;
  if (!header) return [];
  const keys = header.map((h) =>
    (h.charCodeAt(0) === 0xfeff ? h.slice(1) : h).trim(),
  );
  return rows.map((r) => {
    const o: Cells = {};
    keys.forEach((k, i) => {
      if (k) o[k] = r[i] ?? "";
    });
    return o;
  });
}

export const jsonTemplate = (type: EntityType): string =>
  JSON.stringify(
    { schemaVersion: SCHEMA_VERSION, type, items: [{ _example: true }] },
    null,
    2,
  );
