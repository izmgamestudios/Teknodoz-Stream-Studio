// src/studio/storage/idb.ts
// AssetStore on raw IndexedDB (db "teknodoz-studio", store "assets"), with an in-memory fallback
// of the same interface. Also: storage usage estimate and persistent-storage request.
import { uid } from "../defaults";
import type { AssetMeta, AssetRecord, AssetStore, AssetType } from "../types";
import {
  currentBackend,
  fallbackReason,
  probeBackend,
  runTx,
  STORE_ASSETS,
  withDb,
  type StorageBackend,
} from "./db";
import { StorageError } from "./errors";
import {
  createMemoryAssetBackend,
  defaultMemoryLimits,
  MEMORY_MAX_BYTES,
  sharedAssetRecords,
  sharedMemoryBytes,
  sortMetas,
  toMeta,
  type AssetBackend,
  type MemoryLimits,
} from "./memory";

/** Largest single asset accepted (bytes). */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 256;
const MAX_MIME_LENGTH = 127;
const ASSET_TYPES: readonly AssetType[] = ["image", "video", "audio"];

/** Which backend is (probably) in use. Flips to "memory" once an open attempt has failed. */
export function assetStoreBackend(): StorageBackend {
  return currentBackend();
}

/** Awaits the first open attempt and returns the backend that is really in use. */
export function probeStorageBackend(): Promise<StorageBackend> {
  return probeBackend();
}

/** Why the memory fallback is active (undefined while IndexedDB works). */
export function storageFallbackReason(): StorageError | undefined {
  return fallbackReason();
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function isBlob(value: unknown): value is Blob {
  const tag = Object.prototype.toString.call(value);
  return tag === "[object Blob]" || tag === "[object File]";
}

function sanitizeName(name: unknown): string {
  const text = typeof name === "string" ? name : "";
  // Strip control characters and path separators; the name is only a display label.
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || "adsiz").slice(0, MAX_NAME_LENGTH);
}

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH;
}

function validateId(id: unknown): string {
  if (!isValidId(id))
    throw new StorageError("invalid", "Geçersiz dosya kimliği");
  return id;
}

/** Narrow an arbitrary stored value to an AssetRecord, or undefined if it is malformed. */
function parseRecord(raw: unknown): AssetRecord | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const { id, name, type, mime, size, createdAt, blob } = r;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof mime !== "string"
  )
    return undefined;
  if (typeof type !== "string" || !ASSET_TYPES.includes(type as AssetType))
    return undefined;
  if (typeof size !== "number" || typeof createdAt !== "number")
    return undefined;
  if (!isBlob(blob)) return undefined;
  return { id, name, type: type as AssetType, mime, size, createdAt, blob };
}

/* ------------------------------------------------------------------ */
/* Object URLs                                                         */
/* ------------------------------------------------------------------ */

function createObjectUrl(blob: Blob): string {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new StorageError("unavailable", "Nesne URL'leri desteklenmiyor");
  }
  return URL.createObjectURL(blob);
}

function revokeObjectUrl(url: string): void {
  try {
    if (
      typeof URL !== "undefined" &&
      typeof URL.revokeObjectURL === "function"
    ) {
      URL.revokeObjectURL(url);
    }
  } catch {
    /* revoking is best-effort */
  }
}

/* ------------------------------------------------------------------ */
/* IndexedDB backend                                                   */
/* ------------------------------------------------------------------ */

function createIdbAssetBackend(memory: AssetBackend): AssetBackend {
  return {
    put: (record) =>
      withDb(
        (db) =>
          runTx<void>(db, STORE_ASSETS, "readwrite", (store, setResult) => {
            const request = store.put(record);
            request.onsuccess = () => setResult(undefined);
          }),
        () => memory.put(record),
      ),
    get: (id) =>
      withDb(
        (db) =>
          runTx<AssetRecord | undefined>(
            db,
            STORE_ASSETS,
            "readonly",
            (store, setResult) => {
              const request = store.get(id);
              request.onsuccess = () => setResult(parseRecord(request.result));
            },
          ),
        () => memory.get(id),
      ),
    list: () =>
      withDb(
        (db) =>
          runTx<AssetMeta[]>(
            db,
            STORE_ASSETS,
            "readonly",
            (store, setResult) => {
              const metas: AssetMeta[] = [];
              // A cursor keeps only the metadata of each row; Blob handles are dropped at once.
              const request = store.openCursor();
              request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                  // Full validation (incl. the Blob) so list() never shows an asset get() cannot read.
                  const record = parseRecord(cursor.value);
                  if (record) metas.push(toMeta(record));
                  cursor.continue();
                } else {
                  setResult(sortMetas(metas));
                }
              };
            },
          ),
        () => memory.list(),
      ),
    delete: (id) =>
      withDb(
        (db) =>
          runTx<void>(db, STORE_ASSETS, "readwrite", (store, setResult) => {
            const request = store.delete(id);
            request.onsuccess = () => setResult(undefined);
          }),
        () => memory.delete(id),
      ),
    clear: () =>
      withDb(
        (db) =>
          runTx<void>(db, STORE_ASSETS, "readwrite", (store, setResult) => {
            const request = store.clear();
            request.onsuccess = () => setResult(undefined);
          }),
        () => memory.clear(),
      ),
  };
}

/* ------------------------------------------------------------------ */
/* Public store                                                        */
/* ------------------------------------------------------------------ */

function buildAssetStore(backend: AssetBackend): AssetStore {
  /** id -> cached object URL. */
  const urls = new Map<string, string>();
  const inflight = new Map<string, Promise<string | undefined>>();
  /** Bumped around every mutation so a racing getUrl() can notice and re-read. */
  let epoch = 0;

  function revoke(id: string): void {
    const url = urls.get(id);
    if (url === undefined) return;
    urls.delete(id);
    revokeObjectUrl(url);
  }

  function revokeAll(): void {
    for (const url of urls.values()) revokeObjectUrl(url);
    urls.clear();
  }

  async function put(
    blob: Blob,
    meta: { name: string; type: AssetType },
    id?: string,
  ): Promise<AssetMeta> {
    if (!isBlob(blob))
      throw new StorageError("invalid", "Dosya bir Blob olmalı");
    if (!meta || !ASSET_TYPES.includes(meta.type)) {
      throw new StorageError("invalid", "Geçersiz dosya türü");
    }
    if (blob.size > MAX_ASSET_BYTES)
      throw new StorageError("quota", "Dosya çok büyük");
    const assetId = id === undefined ? uid("as") : validateId(id);
    const record: AssetRecord = {
      id: assetId,
      name: sanitizeName(meta.name),
      type: meta.type,
      mime: (blob.type || "application/octet-stream").slice(0, MAX_MIME_LENGTH),
      size: blob.size,
      createdAt: Date.now(),
      blob,
    };
    epoch++;
    try {
      await backend.put(record);
    } finally {
      epoch++;
    }
    // Overwritten asset: the cached URL points at the old blob.
    revoke(assetId);
    return toMeta(record);
  }

  // Reads treat a malformed/empty id (e.g. a fresh image layer with assetId "") as "not found".
  async function get(id: string): Promise<AssetRecord | undefined> {
    return isValidId(id) ? backend.get(id) : undefined;
  }

  function getUrl(assetId: string): Promise<string | undefined> {
    if (!isValidId(assetId)) return Promise.resolve(undefined);
    const cached = urls.get(assetId);
    if (cached !== undefined) return Promise.resolve(cached);
    const running = inflight.get(assetId);
    if (running) return running;
    const task = (async (): Promise<string | undefined> => {
      const maxAttempts = 3;
      for (let attempt = 1; ; attempt++) {
        const startEpoch = epoch;
        const record = await backend.get(assetId);
        if (!record) return undefined;
        // A put/delete raced our read: read again (after the last attempt, accept the result).
        if (epoch !== startEpoch && attempt < maxAttempts) continue;
        const existing = urls.get(assetId);
        if (existing !== undefined) return existing;
        const url = createObjectUrl(record.blob);
        urls.set(assetId, url);
        return url;
      }
    })().finally(() => {
      inflight.delete(assetId);
    });
    inflight.set(assetId, task);
    return task;
  }

  async function list(): Promise<AssetMeta[]> {
    return backend.list();
  }

  async function remove(assetId: string): Promise<void> {
    if (!isValidId(assetId)) return;
    epoch++;
    try {
      await backend.delete(assetId);
    } finally {
      epoch++;
      revoke(assetId);
    }
  }

  async function clear(): Promise<void> {
    epoch++;
    try {
      await backend.clear();
    } finally {
      epoch++;
      revokeAll();
    }
  }

  function dispose(): void {
    epoch++;
    revokeAll();
  }

  return { put, get, getUrl, list, delete: remove, clear, dispose };
}

/**
 * The app's asset store: IndexedDB when it opens, otherwise (SSR, Safari private mode, blocked
 * site data) an in-memory store with the same interface. The decision is made lazily on the first
 * operation; see `assetStoreBackend()` / `probeStorageBackend()`.
 *
 * `dispose()` revokes every cached object URL; the store stays usable afterwards (URLs are
 * simply recreated on demand), so React StrictMode double-mounting is harmless.
 */
export function createAssetStore(): AssetStore {
  const memory = createMemoryAssetBackend(sharedAssetRecords());
  return buildAssetStore(createIdbAssetBackend(memory));
}

/** Isolated in-memory AssetStore (own data, own limits). Used by tests and as a manual fallback. */
export function createMemoryAssetStore(
  limits?: Partial<MemoryLimits>,
): AssetStore {
  return buildAssetStore(
    createMemoryAssetBackend(new Map(), {
      ...defaultMemoryLimits(),
      ...limits,
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Usage / persistence                                                 */
/* ------------------------------------------------------------------ */

export interface StorageUsage {
  /** Bytes used. */
  usage: number;
  /** Bytes available to this origin (or the memory cap on the memory backend). */
  quota: number;
  /** usage / quota, clamped to 0..1. */
  ratio: number;
  backend: StorageBackend;
}

function makeUsage(
  usage: number,
  quota: number,
  backend: StorageBackend,
): StorageUsage {
  const safeUsage = Number.isFinite(usage) && usage > 0 ? usage : 0;
  const safeQuota = Number.isFinite(quota) && quota > 0 ? quota : 0;
  const ratio = safeQuota > 0 ? Math.min(1, safeUsage / safeQuota) : 0;
  return { usage: safeUsage, quota: safeQuota, ratio, backend };
}

function storageManager(): StorageManager | undefined {
  try {
    if (typeof navigator === "undefined") return undefined;
    return navigator.storage ?? undefined;
  } catch {
    return undefined;
  }
}

/** Storage usage/quota. `undefined` when the browser cannot tell (no navigator.storage.estimate). */
export async function estimateUsage(): Promise<StorageUsage | undefined> {
  const backend = await probeBackend();
  if (backend === "memory")
    return makeUsage(sharedMemoryBytes(), MEMORY_MAX_BYTES, "memory");
  const manager = storageManager();
  if (!manager || typeof manager.estimate !== "function") return undefined;
  try {
    const estimate = await manager.estimate();
    return makeUsage(estimate.usage ?? 0, estimate.quota ?? 0, "indexeddb");
  } catch {
    return undefined;
  }
}

/**
 * Asks the browser not to evict our data under storage pressure. Resolves to whether storage is
 * now persistent. Never throws; `false` when unsupported or refused.
 */
export async function requestPersistence(): Promise<boolean> {
  const manager = storageManager();
  if (!manager || typeof manager.persist !== "function") return false;
  try {
    if (typeof manager.persisted === "function" && (await manager.persisted()))
      return true;
    return await manager.persist();
  } catch {
    return false;
  }
}
