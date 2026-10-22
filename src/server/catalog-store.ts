// src/server/catalog-store.ts
// JSON file persistence for the catalog (Node only). Written via temp file + rename so a crash
// never leaves a half-written catalog.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { CatalogItem, CatalogStore } from "./catalog";
import { isMediaSource } from "../studio/watch/media-url";

export function fileStore(path: string): CatalogStore {
  let cache: CatalogItem[] | null = null;
  return {
    load() {
      if (cache) return cache;
      try {
        const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
        cache = Array.isArray(raw)
          ? (raw as CatalogItem[]).filter((i) => isMediaSource(i?.source))
          : [];
      } catch {
        cache = [];
      }
      return cache;
    },
    save(items) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(items, null, 2), { mode: 0o600 });
      renameSync(tmp, path);
      cache = items;
    },
  };
}
