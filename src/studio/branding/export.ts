// src/studio/branding/export.ts
// Turns a brand patch into the three ways an owner can deploy it (config.ts, BRAND_* environment,
// BRAND_JSON) and reads those formats back. Pure, so the round trip is unit-tested.
import {
  BRAND_KEYS,
  DEFAULT_BRAND,
  brandFromEnv,
  envNameFor,
  parseBrandPatch,
  type Brand,
  type ParsedBrand,
} from "./brand";

export type ExportFormat = "json" | "env" | "config";

/** Keys of `next` that differ from `base`, in the canonical field order. */
export function diffBrand(base: Brand, next: Brand): Partial<Brand> {
  const out: Record<string, unknown> = {};
  for (const k of BRAND_KEYS) if (next[k] !== base[k]) out[k] = next[k];
  return out as Partial<Brand>;
}

/** What to deploy: only the differences from the built-in defaults. */
export function patchFromDefaults(next: Brand): Partial<Brand> {
  return diffBrand(DEFAULT_BRAND, next);
}

const ordered = (patch: Partial<Brand>): [keyof Brand, string | number][] =>
  BRAND_KEYS.flatMap((k) => {
    const v = patch[k];
    return v === undefined ? [] : [[k, v] as [keyof Brand, string | number]];
  });

export function toJson(patch: Partial<Brand>, pretty = true): string {
  return JSON.stringify(
    Object.fromEntries(ordered(patch)),
    null,
    pretty ? 2 : 0,
  );
}

/** Single quotes keep `$` and backticks literal; a value with `'` falls back to escaped double quotes. */
function envQuote(v: string): string {
  if (!v.includes("'")) return `'${v}'`;
  return `"${v.replace(/[\\"$`]/g, "\\$&")}"`;
}

export function toEnv(patch: Partial<Brand>): string {
  return ordered(patch)
    .map(
      ([k, v]) => `${envNameFor(k)}=${typeof v === "number" ? v : envQuote(v)}`,
    )
    .join("\n");
}

export function toConfigTs(patch: Partial<Brand>): string {
  const body = ordered(patch)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join("\n");
  return [
    'import type { Brand } from "./brand";',
    "",
    `export const BRAND_CONFIG: Partial<Brand> = {${body ? `\n${body}\n` : ""}};`,
    "",
  ].join("\n");
}

export function exportBrand(
  patch: Partial<Brand>,
  format: ExportFormat,
): string {
  if (format === "env") return toEnv(patch);
  if (format === "config") return toConfigTs(patch);
  return toJson(patch);
}

/* ------------------------------------------------------------------ */
/* import                                                              */
/* ------------------------------------------------------------------ */

function unquoteEnv(v: string): string {
  const s = v.trim();
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'"))
    return s.slice(1, -1);
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"'))
    return s.slice(1, -1).replace(/\\(.)/g, "$1");
  return s;
}

/** `.env`-style text -> variables. Ignores blank lines, comments and `export `. */
export function parseEnvText(textInput: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of textInput.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(line);
    if (m) env[m[1] as string] = unquoteEnv(m[2] as string);
  }
  return env;
}

export type ImportResult =
  ({ ok: true } & ParsedBrand & { source: "json" | "env" }) | { ok: false };

/** Accepts a JSON object, `BRAND_*` lines, or a `BRAND_JSON=…` line. */
export function importBrand(textInput: string): ImportResult {
  const src = textInput.trim();
  if (!src) return { ok: false };
  if (src.startsWith("{")) {
    try {
      return { ok: true, source: "json", ...parseBrandPatch(JSON.parse(src)) };
    } catch {
      return { ok: false };
    }
  }
  const env = parseEnvText(src);
  if (!Object.keys(env).some((k) => k.startsWith("BRAND_")))
    return { ok: false };
  return { ok: true, source: "env", ...brandFromEnv(env) };
}
