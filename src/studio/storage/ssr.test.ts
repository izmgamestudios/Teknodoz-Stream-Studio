// SSR safety. The shared vitest setup file touches `window`, so a per-file node environment is not
// possible here; instead every browser global is stubbed away and the module graph is
// re-imported from scratch, which is exactly what the server does.
// (Do not write the environment-docblock keyword in this header: vitest would act on it.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../defaults";

type StorageModule = typeof import("./index");

const BROWSER_GLOBALS = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "location",
] as const;

let storage: StorageModule;

beforeEach(async () => {
  for (const name of BROWSER_GLOBALS) vi.stubGlobal(name, undefined);
  vi.resetModules();
  // Importing must not touch any browser API at module top level.
  storage = await import("./index");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("storage module on the server (no window/document/indexedDB)", () => {
  it("imports without touching browser globals", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof storage.createAssetStore).toBe("function");
  });

  it("serves default settings with a stable snapshot identity", () => {
    const snap = storage.getSettingsSnapshot();
    expect(snap).toEqual(defaultSettings());
    expect(storage.getSettingsSnapshot()).toBe(snap);
    expect(storage.getServerSettingsSnapshot()).toBe(snap);
    expect(storage.loadSettings()).toEqual(defaultSettings());
  });

  it("saves, resets and reloads without throwing and without leaking state across requests", () => {
    const custom = { ...defaultSettings(), lang: "en" as const };
    expect(storage.saveSettings(custom)).toEqual(custom);
    expect(storage.getSettingsSnapshot().lang).toBe("tr");
    expect(storage.resetSettings()).toEqual(defaultSettings());
    expect(storage.reloadSettings()).toEqual(defaultSettings());
  });

  it("subscribes safely", () => {
    const cb = vi.fn();
    const unsubscribe = storage.subscribeSettings(cb);
    expect(typeof unsubscribe).toBe("function");
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("has no cookie access", () => {
    expect(storage.readPrefsCookie()).toBeUndefined();
    expect(
      storage.writePrefsCookie({
        shortcuts: defaultSettings().shortcuts,
        lang: "tr",
      }),
    ).toBe(false);
    expect(() => storage.clearPrefsCookie()).not.toThrow();
  });

  it("uses private, isolated memory stores", async () => {
    expect(storage.assetStoreBackend()).toBe("memory");
    expect(await storage.probeStorageBackend()).toBe("memory");
    const a = storage.createAssetStore();
    const b = storage.createAssetStore();
    const meta = await a.put(new Blob(["x"], { type: "image/png" }), {
      name: "a",
      type: "image",
    });
    expect((await a.get(meta.id))?.id).toBe(meta.id);
    // Two server requests must never see each other's data.
    expect(await b.get(meta.id)).toBeUndefined();

    const kvA = storage.createKvStore();
    const kvB = storage.createKvStore();
    await kvA.set("k", 1);
    expect(await kvA.get("k")).toBe(1);
    expect(await kvB.get("k")).toBeUndefined();
  });

  it("returns undefined for object URLs when no Blob URL API exists", async () => {
    const store = storage.createMemoryAssetStore();
    expect(await store.getUrl("nope")).toBeUndefined();
    expect(() => store.dispose()).not.toThrow();
  });

  it("degrades usage/persistence helpers", async () => {
    expect(await storage.requestPersistence()).toBe(false);
    const usage = await storage.estimateUsage();
    expect(usage?.backend).toBe("memory");
  });

  it("keeps autosave and shortcuts working", async () => {
    const saver = storage.createAutosaver(storage.createMemoryKvStore());
    expect(() => storage.flushOnPageHide(saver)()).not.toThrow();
    expect(storage.isEditableTarget(null)).toBe(false);
    expect(storage.normalizeCombo("shift+r")).toBe("Shift+R");
    expect(storage.findConflicts(defaultSettings().shortcuts)).toEqual([]);
  });
});
