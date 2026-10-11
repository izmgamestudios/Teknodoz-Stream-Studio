// src/studio/storage/kv.ts
// Tiny async key-value store on the "kv" object store of the shared DB, with a memory fallback.
// Used for project autosave. Values must be structured-cloneable (plain JSON-ish data is fine).
import type { KvStore } from "../types";
import { runTx, STORE_KV, withDb } from "./db";
import { StorageError } from "./errors";
import {
  createMemoryKvBackend,
  defaultMemoryLimits,
  sharedKvEntries,
  type KvBackend,
  type MemoryLimits,
} from "./memory";

const MAX_KEY_LENGTH = 256;

function validateKey(key: unknown): string {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > MAX_KEY_LENGTH
  ) {
    throw new StorageError("invalid", "Geçersiz anahtar");
  }
  return key;
}

function createIdbKvBackend(memory: KvBackend): KvBackend {
  return {
    get: (key) =>
      withDb(
        (db) =>
          runTx<unknown>(db, STORE_KV, "readonly", (store, setResult) => {
            const request = store.get(key);
            request.onsuccess = () => setResult(request.result as unknown);
          }),
        () => memory.get(key),
      ),
    set: (key, value) =>
      withDb(
        (db) =>
          runTx<void>(db, STORE_KV, "readwrite", (store, setResult) => {
            const request = store.put(value, key);
            request.onsuccess = () => setResult(undefined);
          }),
        () => memory.set(key, value),
      ),
    delete: (key) =>
      withDb(
        (db) =>
          runTx<void>(db, STORE_KV, "readwrite", (store, setResult) => {
            const request = store.delete(key);
            request.onsuccess = () => setResult(undefined);
          }),
        () => memory.delete(key),
      ),
    keys: () =>
      withDb(
        (db) =>
          runTx<string[]>(db, STORE_KV, "readonly", (store, setResult) => {
            const request = store.getAllKeys();
            request.onsuccess = () => {
              const keys = request.result.filter(
                (k): k is string => typeof k === "string",
              );
              setResult(keys.sort());
            };
          }),
        () => memory.keys(),
      ),
  };
}

function buildKvStore(backend: KvBackend): KvStore {
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      // A malformed key can never have been stored, so reads report "missing".
      if (
        typeof key !== "string" ||
        key.length === 0 ||
        key.length > MAX_KEY_LENGTH
      ) {
        return undefined;
      }
      return (await backend.get(key)) as T | undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      const validKey = validateKey(key);
      // `undefined` cannot round-trip through IndexedDB; treat it as a delete on every backend.
      if (value === undefined) {
        await backend.delete(validKey);
        return;
      }
      await backend.set(validKey, value);
    },
    async delete(key: string): Promise<void> {
      if (
        typeof key !== "string" ||
        key.length === 0 ||
        key.length > MAX_KEY_LENGTH
      )
        return;
      await backend.delete(key);
    },
    keys: () => backend.keys(),
  };
}

/**
 * KV store on IndexedDB ("teknodoz-studio" / "kv"); falls back to in-memory storage (shared per
 * page, private per call on the server) when IndexedDB cannot be opened.
 */
export function createKvStore(): KvStore {
  const memory = createMemoryKvBackend(sharedKvEntries());
  return buildKvStore(createIdbKvBackend(memory));
}

/** Isolated in-memory KvStore (own data). Used by tests and as a manual fallback. */
export function createMemoryKvStore(limits?: Partial<MemoryLimits>): KvStore {
  return buildKvStore(
    createMemoryKvBackend(new Map(), { ...defaultMemoryLimits(), ...limits }),
  );
}
