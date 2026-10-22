// src/server/i18n-store.ts
// JSON file persistence for translation overrides (used when PocketBase is not configured).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { I18nStore, Overrides } from "./i18n";

export function fileI18nStore(path: string): I18nStore {
  let cache: Overrides | null = null;
  const read = (): Overrides => {
    if (cache) return cache;
    try {
      const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
      cache = raw && typeof raw === "object" ? (raw as Overrides) : {};
    } catch {
      cache = {};
    }
    return cache;
  };
  const write = (next: Overrides): void => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
    cache = next;
  };
  return {
    all: async () => structuredClone(read()),
    set: async (lang, key, value) => {
      const next = structuredClone(read());
      (next[lang] ??= {})[key] = value;
      write(next);
    },
    remove: async (lang, key) => {
      const cur = read();
      if (!cur[lang] || !(key in cur[lang])) return false;
      const next = structuredClone(cur);
      delete next[lang]![key];
      write(next);
      return true;
    },
  };
}
