// src/studio/storage/errors.ts
// Typed storage errors. UI code should branch on `code`, never on `message`.

export type StorageErrorCode =
  /** The browser refused to store more data (QuotaExceededError). */
  | "quota"
  /** IndexedDB / the requested browser API does not exist or cannot be opened. */
  | "unavailable"
  /** Another tab holds an old connection and blocks the database upgrade. */
  | "blocked"
  /** The connection was closed underneath us (versionchange, eviction). */
  | "closed"
  /** The caller passed data that cannot be stored (bad id, not a Blob, not cloneable...). */
  | "invalid"
  /** Any other I/O failure. */
  | "io";

/** Short Turkish default messages. The `code` is the stable contract. */
const MESSAGES: Record<StorageErrorCode, string> = {
  quota: "Depolama alanı dolu",
  unavailable: "Tarayıcı depolaması kullanılamıyor",
  blocked: "Depolama başka bir sekme tarafından engelleniyor",
  closed: "Depolama bağlantısı kapandı",
  invalid: "Geçersiz veri",
  io: "Depolama hatası",
};

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(
    code: StorageErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? MESSAGES[code], options);
    this.name = "StorageError";
    this.code = code;
  }
}

export function isStorageError(value: unknown): value is StorageError {
  return value instanceof StorageError;
}

function errorName(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

/** True for the many spellings of "out of space" (Chromium, Safari, old Firefox). */
export function isQuotaError(err: unknown): boolean {
  if (err instanceof StorageError) return err.code === "quota";
  const name = errorName(err);
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED")
    return true;
  if (typeof err === "object" && err !== null) {
    const code = (err as { code?: unknown }).code;
    // DOMException.QUOTA_EXCEEDED_ERR (22) and Firefox NS_ERROR_DOM_QUOTA_REACHED (1014).
    if (code === 22 || code === 1014) return true;
  }
  return false;
}

/**
 * Normalizes anything thrown by a browser storage API into a StorageError.
 * `fallback` is used when the failure is not a recognised special case.
 */
export function toStorageError(
  err: unknown,
  fallback: StorageErrorCode = "io",
): StorageError {
  if (err instanceof StorageError) return err;
  if (isQuotaError(err))
    return new StorageError("quota", undefined, { cause: err });
  const name = errorName(err);
  if (name === "DataCloneError" || name === "DataError") {
    return new StorageError("invalid", undefined, { cause: err });
  }
  return new StorageError(fallback, undefined, { cause: err });
}
