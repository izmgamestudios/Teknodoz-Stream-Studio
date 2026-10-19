// src/studio/storage/settings.ts
// AppSettings persistence in localStorage ("tkz.settings.v1") + a tiny external store for React's
// useSyncExternalStore. Shortcuts and language are mirrored to the "tkz_prefs" cookie, which also
// serves as the fallback when localStorage is empty or blocked. Nothing here ever throws.
import { defaultSettings } from "../defaults";
import type { AppSettings } from "../types";
import {
  clearPrefsCookie,
  readPrefsCookie,
  writePrefsCookie,
} from "./prefs-cookie";
import { cloneSettings, isRecord, parseSettings } from "./settings-schema";

export {
  PREFS_COOKIE_MAX_AGE_SECONDS,
  PREFS_COOKIE_MAX_LENGTH,
  PREFS_COOKIE_NAME,
  clearPrefsCookie,
  readPrefsCookie,
  serializePrefsCookie,
  writePrefsCookie,
  type PrefsCookieData,
} from "./prefs-cookie";
export { OUTPUT_LIMITS, parseSettings } from "./settings-schema";

export const SETTINGS_STORAGE_KEY = "tkz.settings.v1";
/** A stored settings blob larger than this is treated as corrupt. */
const MAX_STORED_LENGTH = 64 * 1024;

/* ------------------------------------------------------------------ */
/* localStorage access (every touch wrapped: it can throw)             */
/* ------------------------------------------------------------------ */

function getLocalStorage(): Storage | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    return window.localStorage ?? undefined;
  } catch {
    return undefined; // SecurityError when site data is blocked
  }
}

function readStoredJson(): Record<string, unknown> | undefined {
  try {
    const raw = getLocalStorage()?.getItem(SETTINGS_STORAGE_KEY);
    if (typeof raw !== "string" || raw === "" || raw.length > MAX_STORED_LENGTH)
      return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(settings: AppSettings): boolean {
  try {
    const storage = getLocalStorage();
    if (!storage) return false;
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false; // quota or blocked: the in-memory snapshot and the cookie still carry the values
  }
}

function removeStored(): void {
  try {
    getLocalStorage()?.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    /* nothing to remove */
  }
}

/* ------------------------------------------------------------------ */
/* Load / save / reset                                                 */
/* ------------------------------------------------------------------ */

/**
 * Reads settings: localStorage first (merged over defaults, invalid values repaired/clamped),
 * else the cookie mirror (shortcuts + lang only), else defaults. Returns a fresh mutable object.
 */
export function loadSettings(): AppSettings {
  const stored = readStoredJson();
  if (stored) return parseSettings(stored);
  const settings = defaultSettings();
  const prefs = readPrefsCookie();
  if (prefs) {
    settings.shortcuts = prefs.shortcuts;
    settings.lang = prefs.lang;
  }
  return settings;
}

/**
 * Validates/repairs `next`, persists it (localStorage + cookie mirror), updates the shared snapshot
 * and notifies subscribers. Returns the repaired settings that were actually stored.
 */
export function saveSettings(next: AppSettings): AppSettings {
  const clean = parseSettings(next);
  writeStored(clean);
  writePrefsCookie({ shortcuts: clean.shortcuts, lang: clean.lang });
  setSnapshot(clean);
  return clean;
}

/** Removes persisted settings (localStorage + cookie) and restores defaults. Returns the defaults. */
export function resetSettings(): AppSettings {
  removeStored();
  clearPrefsCookie();
  const defaults = defaultSettings();
  setSnapshot(defaults);
  return defaults;
}

/* ------------------------------------------------------------------ */
/* External store (useSyncExternalStore)                               */
/* ------------------------------------------------------------------ */

function deepFreeze(settings: AppSettings): AppSettings {
  Object.freeze(settings.output);
  Object.freeze(settings.shortcuts);
  return Object.freeze(settings);
}

/** Returned during SSR/hydration; one stable object for the whole process. */
const SERVER_SNAPSHOT: AppSettings = deepFreeze(defaultSettings());

let snapshot: AppSettings | null = null;
const listeners = new Set<() => void>();
let storageListenerAttached = false;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* one broken subscriber must not starve the others */
    }
  }
}

/** Replaces the snapshot only when the content changed, so identity is stable between changes. */
function setSnapshot(next: AppSettings): void {
  if (!isBrowser()) return;
  const frozen = deepFreeze(cloneSettings(next));
  if (snapshot !== null && JSON.stringify(snapshot) === JSON.stringify(frozen))
    return;
  snapshot = frozen;
  notify();
}

/**
 * Current settings for useSyncExternalStore. Deeply frozen and referentially stable until the
 * settings change (via saveSettings/resetSettings/reloadSettings or another tab). On the server it
 * returns the default settings. Treat it as immutable: copy before editing, then saveSettings().
 */
export function getSettingsSnapshot(): AppSettings {
  if (!isBrowser()) return SERVER_SNAPSHOT;
  if (snapshot === null) snapshot = deepFreeze(loadSettings());
  return snapshot;
}

/** Pass as the third argument of useSyncExternalStore (hydration-safe constant defaults). */
export function getServerSettingsSnapshot(): AppSettings {
  return SERVER_SNAPSHOT;
}

/** Re-reads storage and updates the snapshot if it differs (notifies subscribers on change). */
export function reloadSettings(): AppSettings {
  if (!isBrowser()) return SERVER_SNAPSHOT;
  setSnapshot(loadSettings());
  return getSettingsSnapshot();
}

function onStorageEvent(event: StorageEvent): void {
  // key === null means localStorage.clear() in another tab.
  if (event.key === null || event.key === SETTINGS_STORAGE_KEY)
    reloadSettings();
}

function attachStorageListener(): void {
  if (storageListenerAttached || !isBrowser()) return;
  window.addEventListener("storage", onStorageEvent);
  storageListenerAttached = true;
}

function detachStorageListener(): void {
  if (!storageListenerAttached || !isBrowser()) return;
  window.removeEventListener("storage", onStorageEvent);
  storageListenerAttached = false;
}

/**
 * Subscribe to settings changes (including changes made in other tabs). Returns an idempotent
 * unsubscribe function. The callback takes no arguments: read getSettingsSnapshot() inside it.
 */
export function subscribeSettings(callback: () => void): () => void {
  // Wrap so subscribing the same function twice yields two independent subscriptions.
  const entry = (): void => callback();
  listeners.add(entry);
  attachStorageListener();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    listeners.delete(entry);
    if (listeners.size === 0) detachStorageListener();
  };
}
