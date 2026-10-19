// src/studio/storage/index.ts
// Public surface of the storage module. Import from "@/studio/storage", not from the files.
export {
  StorageError,
  isStorageError,
  isQuotaError,
  toStorageError,
  type StorageErrorCode,
} from "./errors";

export { closeDatabase, DB_NAME, DB_VERSION, type StorageBackend } from "./db";

export {
  assetStoreBackend,
  createAssetStore,
  createMemoryAssetStore,
  estimateUsage,
  MAX_ASSET_BYTES,
  probeStorageBackend,
  requestPersistence,
  storageFallbackReason,
  type StorageUsage,
} from "./idb";

export { createKvStore, createMemoryKvStore } from "./kv";

export {
  MEMORY_MAX_ASSETS,
  MEMORY_MAX_BYTES,
  MEMORY_MAX_KV_KEYS,
  type MemoryLimits,
} from "./memory";

export {
  clearPrefsCookie,
  getServerSettingsSnapshot,
  getSettingsSnapshot,
  loadSettings,
  OUTPUT_LIMITS,
  parseSettings,
  PREFS_COOKIE_MAX_AGE_SECONDS,
  PREFS_COOKIE_MAX_LENGTH,
  PREFS_COOKIE_NAME,
  readPrefsCookie,
  reloadSettings,
  resetSettings,
  saveSettings,
  serializePrefsCookie,
  SETTINGS_STORAGE_KEY,
  subscribeSettings,
  writePrefsCookie,
  type PrefsCookieData,
} from "./settings";

export { settingsSchema } from "./settings-schema";

export {
  eventToCombo,
  findComboDuplicates,
  findConflicts,
  isEditableTarget,
  isValidCombo,
  matchCombo,
  normalizeCombo,
  resolveShortcut,
  SHORTCUT_ACTIONS,
  type ComboConflict,
  type KeyEventLike,
  type ResolveOptions,
} from "./shortcuts";

export {
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_KEY,
  AUTOSAVE_MAX_WAIT_MS,
  createAutosaver,
  flushOnPageHide,
  type Autosaver,
  type AutosaverOptions,
  type AutosaveSnapshot,
} from "./autosave";
