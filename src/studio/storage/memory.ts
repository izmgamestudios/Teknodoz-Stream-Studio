// src/studio/storage/memory.ts
// In-memory backends used when IndexedDB is unavailable (Safari private mode, SSR, blocked).
// They implement the same low-level backend interfaces as the IndexedDB code, with hard caps so a
// runaway import cannot exhaust the tab's memory.
import type { AssetMeta, AssetRecord } from "../types";
import { StorageError } from "./errors";

/** Total blob bytes the memory asset backend accepts. */
export const MEMORY_MAX_BYTES = 512 * 1024 * 1024;
/** Max asset records in the memory backend. */
export const MEMORY_MAX_ASSETS = 500;
/** Max keys in the memory KV backend. */
export const MEMORY_MAX_KV_KEYS = 256;

export interface MemoryLimits {
  maxBytes: number;
  maxAssets: number;
  maxKvKeys: number;
}

export function defaultMemoryLimits(): MemoryLimits {
  return {
    maxBytes: MEMORY_MAX_BYTES,
    maxAssets: MEMORY_MAX_ASSETS,
    maxKvKeys: MEMORY_MAX_KV_KEYS,
  };
}

/** Low-level asset persistence; the public AssetStore adds validation and the object-URL cache. */
export interface AssetBackend {
  put(record: AssetRecord): Promise<void>;
  get(id: string): Promise<AssetRecord | undefined>;
  list(): Promise<AssetMeta[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Low-level KV persistence; values are structured-cloneable. */
export interface KvBackend {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export function toMeta(record: AssetMeta): AssetMeta {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    mime: record.mime,
    size: record.size,
    createdAt: record.createdAt,
  };
}

export function sortMetas(metas: AssetMeta[]): AssetMeta[] {
  return metas.sort(
    (a, b) =>
      a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function totalBytes(records: Map<string, AssetRecord>): number {
  let sum = 0;
  for (const record of records.values()) sum += record.size;
  return sum;
}

export function createMemoryAssetBackend(
  records: Map<string, AssetRecord> = new Map(),
  limits: Pick<MemoryLimits, "maxBytes" | "maxAssets"> = defaultMemoryLimits(),
): AssetBackend {
  return {
    put(record) {
      const previous = records.get(record.id);
      if (!previous && records.size >= limits.maxAssets) {
        return Promise.reject(new StorageError("quota", "Çok fazla dosya"));
      }
      const projected =
        totalBytes(records) - (previous?.size ?? 0) + record.size;
      if (projected > limits.maxBytes)
        return Promise.reject(new StorageError("quota"));
      records.set(record.id, record);
      return Promise.resolve();
    },
    // Hand out a shallow copy so callers can never mutate the stored record in place.
    get(id) {
      const record = records.get(id);
      return Promise.resolve(record ? { ...record } : undefined);
    },
    list: () => Promise.resolve(sortMetas([...records.values()].map(toMeta))),
    delete(id) {
      records.delete(id);
      return Promise.resolve();
    },
    clear() {
      records.clear();
      return Promise.resolve();
    },
  };
}

function cloneValue(value: unknown): unknown {
  if (typeof structuredClone !== "function") return value;
  try {
    return structuredClone(value);
  } catch (err) {
    throw new StorageError("invalid", undefined, { cause: err });
  }
}

export function createMemoryKvBackend(
  entries: Map<string, unknown> = new Map(),
  limits: Pick<MemoryLimits, "maxKvKeys"> = defaultMemoryLimits(),
): KvBackend {
  return {
    get(key) {
      try {
        return Promise.resolve(
          entries.has(key) ? cloneValue(entries.get(key)) : undefined,
        );
      } catch (err) {
        return Promise.reject(err);
      }
    },
    set(key, value) {
      if (!entries.has(key) && entries.size >= limits.maxKvKeys) {
        return Promise.reject(new StorageError("quota", "Çok fazla anahtar"));
      }
      try {
        entries.set(key, cloneValue(value));
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    },
    delete(key) {
      entries.delete(key);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...entries.keys()].sort()),
  };
}

/* Shared per-page memory (mirrors "the same DB" semantics across store instances in the
 * browser). On the server each caller gets private memory so requests can never see each other. */
const sharedAssets = new Map<string, AssetRecord>();
const sharedKv = new Map<string, unknown>();

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function sharedAssetRecords(): Map<string, AssetRecord> {
  return isBrowser() ? sharedAssets : new Map();
}

export function sharedKvEntries(): Map<string, unknown> {
  return isBrowser() ? sharedKv : new Map();
}

/** Bytes currently held by the shared memory asset backend (for estimateUsage). */
export function sharedMemoryBytes(): number {
  return isBrowser() ? totalBytes(sharedAssets) : 0;
}
