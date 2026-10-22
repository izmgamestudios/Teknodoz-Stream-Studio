// src/studio/workspace/workspace.ts
// Local workspace backup: prompter script, studio scene templates and classic templates, as one
// versioned JSON file. Nothing leaves the browser. Import validates every item through the same
// parsers the pages use, so a hand-edited or hostile file cannot store anything the app would
// not accept itself.
import { z } from "zod";

import {
  TPL_KEY,
  parseSavedTemplates,
} from "../../classic/studio/saved-templates";
import { SCHEMA_VERSION } from "../../shared/schema-registry";
import {
  MY_TEMPLATES_KEY,
  MAX_MY_TEMPLATES,
  parseMyTemplates,
} from "../templates/mine";
import { SCRIPT_KEY, parseScriptMessage } from "../sync/shared";

export type LocalType = "prompter_script" | "studio_scene" | "classic_template";

export interface WorkspaceItem {
  type: LocalType;
  id: string;
  title: string;
  data: unknown;
}

export interface WorkspaceFile {
  schemaVersion: number;
  type: "workspace";
  exportedAt: string;
  items: WorkspaceItem[];
}

/** The part of `Storage` the workspace needs, so tests can use a Map. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MAX_FILE_BYTES = 12_000_000;
const SCRIPT_ID = "script";

export function collectWorkspace(
  store: KeyValueStore,
  now = new Date(),
): WorkspaceFile {
  const items: WorkspaceItem[] = [];
  const script = parseScriptMessage(store.getItem(SCRIPT_KEY));
  if (script && script.text.trim())
    items.push({
      type: "prompter_script",
      id: SCRIPT_ID,
      title: script.text.trim().split("\n")[0]!.slice(0, 80),
      data: script,
    });
  for (const t of parseMyTemplates(store.getItem(MY_TEMPLATES_KEY)))
    items.push({ type: "studio_scene", id: t.id, title: t.name, data: t });
  for (const t of parseSavedTemplates(store.getItem(TPL_KEY)))
    items.push({ type: "classic_template", id: t.id, title: t.name, data: t });
  return {
    schemaVersion: SCHEMA_VERSION,
    type: "workspace",
    exportedAt: now.toISOString(),
    items,
  };
}

const itemSchema = z.object({
  type: z.enum(["prompter_script", "studio_scene", "classic_template"]),
  id: z.string().min(1).max(64),
  title: z.string().max(200),
  data: z.unknown(),
});
const fileSchema = z.object({
  schemaVersion: z.number().int().min(1),
  type: z.literal("workspace"),
  exportedAt: z.string(),
  items: z.array(itemSchema).max(1000),
});

export type ParseResult =
  | { ok: true; file: WorkspaceFile }
  | {
      ok: false;
      error: "too-large" | "not-json" | "invalid" | "newer-version";
    };

export function parseWorkspace(text: string): ParseResult {
  if (text.length > MAX_FILE_BYTES) return { ok: false, error: "too-large" };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: "not-json" };
  }
  const r = fileSchema.safeParse(v);
  if (!r.success) return { ok: false, error: "invalid" };
  if (r.data.schemaVersion > SCHEMA_VERSION)
    return { ok: false, error: "newer-version" };
  return { ok: true, file: r.data as WorkspaceFile };
}

export interface ApplyResult {
  imported: number;
  skipped: number;
}

/**
 * Writes the file into storage. `merge` keeps existing items and overwrites those with the same
 * id; `replace` makes the storage match the file for the three local types.
 */
export function applyWorkspace(
  store: KeyValueStore,
  file: WorkspaceFile,
  mode: "merge" | "replace" = "merge",
): ApplyResult {
  let imported = 0;
  let skipped = 0;

  // scripts: the newest one wins in merge mode
  const scripts = file.items.filter((i) => i.type === "prompter_script");
  for (const it of scripts) {
    const msg = parseScriptMessage(JSON.stringify(it.data));
    if (!msg) {
      skipped++;
      continue;
    }
    const cur = parseScriptMessage(store.getItem(SCRIPT_KEY));
    if (mode === "merge" && cur && cur.at >= msg.at) {
      skipped++;
      continue;
    }
    store.setItem(SCRIPT_KEY, JSON.stringify(msg));
    imported++;
  }

  // studio scene templates (validated through the project schema by the parser)
  const mine = file.items.filter((i) => i.type === "studio_scene");
  const incoming = parseMyTemplates(JSON.stringify(mine.map((i) => i.data)));
  skipped += mine.length - incoming.length;
  const keepMine =
    mode === "merge" ? parseMyTemplates(store.getItem(MY_TEMPLATES_KEY)) : [];
  const mineIds = new Set(incoming.map((t) => t.id));
  const mergedMine = [
    ...keepMine.filter((t) => !mineIds.has(t.id)),
    ...incoming,
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_MY_TEMPLATES);
  if (mine.length > 0 || mode === "replace") {
    store.setItem(MY_TEMPLATES_KEY, JSON.stringify(mergedMine));
    imported += incoming.length;
  }

  // classic templates
  const classic = file.items.filter((i) => i.type === "classic_template");
  const classicIn = parseSavedTemplates(
    JSON.stringify(classic.map((i) => i.data)),
  );
  skipped += classic.length - classicIn.length;
  const keepClassic =
    mode === "merge" ? parseSavedTemplates(store.getItem(TPL_KEY)) : [];
  const classicIds = new Set(classicIn.map((t) => t.id));
  if (classic.length > 0 || mode === "replace") {
    store.setItem(
      TPL_KEY,
      JSON.stringify([
        ...keepClassic.filter((t) => !classicIds.has(t.id)),
        ...classicIn,
      ]),
    );
    imported += classicIn.length;
  }
  return { imported, skipped };
}

/** Stable form for comparisons (drops the export timestamp). */
export const workspaceFingerprint = (f: WorkspaceFile): string =>
  JSON.stringify(
    f.items
      .map((i) => ({ ...i }))
      .sort((a, b) => (a.type + a.id).localeCompare(b.type + b.id)),
  );
