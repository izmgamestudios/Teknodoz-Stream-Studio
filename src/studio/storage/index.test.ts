import { describe, expect, it } from "vitest";
import * as storage from "./index";

describe("storage public surface", () => {
  it.each([
    // errors
    "StorageError",
    "isStorageError",
    "isQuotaError",
    "toStorageError",
    // asset store / kv
    "createAssetStore",
    "createMemoryAssetStore",
    "assetStoreBackend",
    "probeStorageBackend",
    "storageFallbackReason",
    "estimateUsage",
    "requestPersistence",
    "createKvStore",
    "createMemoryKvStore",
    "closeDatabase",
    // settings
    "loadSettings",
    "saveSettings",
    "resetSettings",
    "reloadSettings",
    "parseSettings",
    "getSettingsSnapshot",
    "getServerSettingsSnapshot",
    "subscribeSettings",
    "readPrefsCookie",
    "writePrefsCookie",
    "clearPrefsCookie",
    "serializePrefsCookie",
    // shortcuts
    "eventToCombo",
    "matchCombo",
    "normalizeCombo",
    "isValidCombo",
    "isEditableTarget",
    "resolveShortcut",
    "findConflicts",
    "findComboDuplicates",
    // autosave
    "createAutosaver",
    "flushOnPageHide",
  ])("exports the function %s", (name) => {
    expect(typeof (storage as Record<string, unknown>)[name]).toBe("function");
  });

  it.each([
    ["SETTINGS_STORAGE_KEY", "tkz.settings.v1"],
    ["PREFS_COOKIE_NAME", "tkz_prefs"],
    ["AUTOSAVE_KEY", "project:autosave"],
    ["AUTOSAVE_DELAY_MS", 800],
    ["DB_NAME", "teknodoz-studio"],
  ])("exports the constant %s = %j", (name, value) => {
    expect((storage as Record<string, unknown>)[name]).toBe(value);
  });

  it("exports the data constants", () => {
    expect(storage.OUTPUT_LIMITS.fps.max).toBeGreaterThan(
      storage.OUTPUT_LIMITS.fps.min,
    );
    expect(storage.SHORTCUT_ACTIONS).toHaveLength(9);
    expect(storage.MAX_ASSET_BYTES).toBeGreaterThan(0);
    expect(storage.PREFS_COOKIE_MAX_LENGTH).toBeLessThanOrEqual(3500);
    expect(storage.PREFS_COOKIE_MAX_AGE_SECONDS).toBe(31_536_000);
    expect(storage.DB_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("exports a reusable zod schema that repairs untrusted settings", () => {
    const parsed = storage.settingsSchema.safeParse({
      lang: "en",
      output: { fps: 9999 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.lang).toBe("en");
      expect(parsed.data.output.fps).toBe(120);
      expect(parsed.data.output.width).toBe(1920);
    }
    expect(storage.settingsSchema.safeParse(null).success).toBe(true);
  });
});
