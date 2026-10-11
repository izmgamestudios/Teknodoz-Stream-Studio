// src/studio/storage/db.ts
// Shared IndexedDB connection for the "assets" and "kv" object stores.
// SSR-safe: nothing here touches indexedDB until a function is called.
import { StorageError, toStorageError } from "./errors";

export const DB_NAME = "teknodoz-studio";
export const DB_VERSION = 1;
export const STORE_ASSETS = "assets";
export const STORE_KV = "kv";

export type StorageBackend = "indexeddb" | "memory";

/** Single shared connection promise; `null` result means "use the in-memory fallback". */
let dbPromise: Promise<IDBDatabase | null> | null = null;
/** The open connection behind `dbPromise` once it has resolved (compared by identity). */
let liveDb: IDBDatabase | null = null;
/** Why we are on the memory backend (only set once opening failed or IDB is missing). */
let fallbackError: StorageError | undefined;

function getFactory(): IDBFactory | undefined {
  try {
    // Reading `indexedDB` can itself throw (Firefox with blocked site data, sandboxed iframes).
    const factory = (globalThis as { indexedDB?: IDBFactory | null }).indexedDB;
    return factory ?? undefined;
  } catch {
    return undefined;
  }
}

/** Synchronous best guess; flips to "memory" after the first failed open. */
export function currentBackend(): StorageBackend {
  if (fallbackError) return "memory";
  return getFactory() ? "indexeddb" : "memory";
}

/** Why the memory fallback is active, or undefined while IndexedDB is (or may be) usable. */
export function fallbackReason(): StorageError | undefined {
  if (fallbackError) return fallbackError;
  if (!getFactory()) return new StorageError("unavailable", "IndexedDB yok");
  return undefined;
}

/** Forgets `db` if it is still the cached connection, so the next call reconnects. */
function forget(db: IDBDatabase): void {
  if (liveDb !== db) return;
  liveDb = null;
  dbPromise = null;
}

function openDatabase(
  factory: IDBFactory,
  onLost: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(toStorageError(err, "unavailable"));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        // We already gave up (blocked): do not leak a connection nobody owns.
        db.close();
        return;
      }
      settled = true;
      // Another tab wants to upgrade/delete the DB: release it immediately.
      db.onversionchange = () => {
        db.close();
        onLost(db);
      };
      // Fired when the browser closes the connection abnormally (storage cleared/evicted).
      db.onclose = () => onLost(db);
      resolve(db);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(toStorageError(request.error, "unavailable"));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new StorageError("blocked"));
    };
  });
}

/**
 * Resolves the shared connection, or `null` when IndexedDB is missing / cannot be opened
 * (Safari private mode, SSR, blocked site data). A failure is remembered, so every later call
 * resolves to `null` immediately until `closeDatabase()` resets the state.
 */
export function getDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  if (fallbackError) return Promise.resolve(null);
  const factory = getFactory();
  if (!factory) return Promise.resolve(null);
  const attempt: Promise<IDBDatabase | null> = openDatabase(
    factory,
    forget,
  ).then(
    (db) => {
      // If closeDatabase() ran while we were opening, it closes this connection itself; callers
      // then see a closed connection and reconnect (see withDb). Only cache a connection we own.
      if (dbPromise === attempt) liveDb = db;
      return db;
    },
    (err: unknown) => {
      // A failure from an attempt that closeDatabase() already discarded must not poison the
      // fresh state.
      if (dbPromise === attempt)
        fallbackError = toStorageError(err, "unavailable");
      return null;
    },
  );
  dbPromise = attempt;
  return attempt;
}

/** Awaits the open attempt and reports the backend that is really in use. */
export async function probeBackend(): Promise<StorageBackend> {
  await getDb();
  return currentBackend();
}

/**
 * Closes the shared connection and forgets any cached open failure, so the next operation
 * retries IndexedDB. Safe to call at any time (also used to release the DB before wiping it).
 */
export function closeDatabase(): void {
  const pending = dbPromise;
  dbPromise = null;
  liveDb = null;
  fallbackError = undefined;
  if (pending) {
    void pending.then((db) => {
      try {
        db?.close();
      } catch {
        /* already closed */
      }
    });
  }
}

/**
 * Runs one transaction on `storeName` and resolves once it has COMMITTED (oncomplete), so a
 * resolved write is durable. `work` issues requests and reports its value through `setResult`.
 */
export function runTx<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, setResult: (value: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let result: T | undefined;
    let tx: IDBTransaction | undefined;
    let requestError: unknown;
    try {
      tx = db.transaction(storeName, mode);
      const active = tx;
      active.oncomplete = () => resolve(result as T);
      active.onerror = (event) => {
        // Request errors bubble here before the transaction aborts; tx.error is still null.
        const target = event.target as IDBRequest | null;
        requestError = target?.error ?? requestError;
      };
      active.onabort = () =>
        reject(toStorageError(active.error ?? requestError, "io"));
      work(active.objectStore(storeName), (value) => {
        result = value;
      });
    } catch (err) {
      try {
        tx?.abort();
      } catch {
        /* already finished */
      }
      const name = (err as { name?: unknown } | null)?.name;
      // transaction() on a closing connection throws InvalidStateError: let callers reconnect.
      reject(
        name === "InvalidStateError"
          ? new StorageError("closed", undefined, { cause: err })
          : toStorageError(err, "io"),
      );
    }
  });
}

/**
 * Runs `run` with the live connection. If the connection was closed underneath us
 * (versionchange, eviction) it reconnects and retries once. When IndexedDB is unusable,
 * `fallback` serves the call from memory.
 */
export async function withDb<T>(
  run: (db: IDBDatabase) => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  const db = await getDb();
  if (!db) return fallback();
  try {
    return await run(db);
  } catch (err) {
    if (!(err instanceof StorageError) || err.code !== "closed") throw err;
    // Release and drop the dead connection (if it is still the cached one), retry on a fresh one.
    try {
      db.close();
    } catch {
      /* already closed */
    }
    forget(db);
    const fresh = await getDb();
    if (!fresh) return fallback();
    return run(fresh);
  }
}
