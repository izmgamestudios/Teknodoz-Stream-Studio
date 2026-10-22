// src/server/catalog-store.ts
// JSON file persistence for the catalog (Node only), used when PocketBase is not configured.
// Written via temp file + rename so a crash never leaves a half-written catalog.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { CatalogItem, CatalogStore, RecordStore } from "./catalog";
import { isMediaSource } from "../studio/watch/media-url";

/** Catalog records in a JSON file; records without a valid media source are dropped on load. */
export function fileStore(path: string): CatalogStore {
  return fileRecordStore<CatalogItem>(path, (i) =>
    isMediaSource((i as CatalogItem | null)?.source),
  );
}

/** Any `{ id }` records in one JSON file, written atomically (temp file + rename). */
export function fileRecordStore<T extends { id: string }>(
  path: string,
  accept: (record: unknown) => boolean = () => true,
): RecordStore<T> {
  let cache: T[] | null = null;
  const read = (): T[] => {
    if (cache) return cache;
    try {
      const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
      cache = Array.isArray(raw)
        ? (raw as T[]).filter((i) => i && typeof i.id === "string" && accept(i))
        : [];
    } catch {
      cache = [];
    }
    return cache;
  };
  const write = (items: T[]): void => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(items, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
    cache = items;
  };
  return {
    list: async () => read(),
    upsert: async (item) => {
      const items = [...read()];
      const i = items.findIndex((x) => x.id === item.id);
      if (i >= 0) items[i] = item;
      else items.push(item);
      write(items);
    },
    remove: async (id) => {
      const items = read();
      const next = items.filter((x) => x.id !== id);
      if (next.length === items.length) return false;
      write(next);
      return true;
    },
  };
}
