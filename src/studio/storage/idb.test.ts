import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProject } from "../defaults";
import { createAutosaver } from "./autosave";
import { closeDatabase, DB_NAME } from "./db";
import { isStorageError, type StorageError } from "./errors";
import {
  createFakeIndexedDB,
  type FakeIndexedDB,
} from "./__fakes__/fake-indexeddb";
import {
  assetStoreBackend,
  createAssetStore,
  estimateUsage,
  probeStorageBackend,
  requestPersistence,
  storageFallbackReason,
} from "./idb";
import { createKvStore } from "./kv";
import { MEMORY_MAX_BYTES } from "./memory";

let fake: FakeIndexedDB;
let urlCounter = 0;

function png(content = "pixels"): Blob {
  return new File([content], "a.png", { type: "image/png" });
}

function blobText(blob: Blob | undefined): Promise<string | undefined> {
  if (!blob) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return isStorageError(err)
      ? (err as StorageError).code
      : `non-storage:${String(err)}`;
  }
}

/** Lets queued microtasks and zero-delay timers run. */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  closeDatabase();
  fake = createFakeIndexedDB();
  vi.stubGlobal("indexedDB", fake.asFactory());
  urlCounter = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:idb/${++urlCounter}`,
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  closeDatabase();
  // Fallback tests write into the page-wide memory backend: leave it empty for the next test.
  await createAssetStore().clear();
  const kv = createKvStore();
  for (const key of await kv.keys()) await kv.delete(key);
});

describe("IndexedDB AssetStore", () => {
  it("reports the indexeddb backend while a factory exists", async () => {
    expect(assetStoreBackend()).toBe("indexeddb");
    expect(await probeStorageBackend()).toBe("indexeddb");
    expect(storageFallbackReason()).toBeUndefined();
  });

  it("creates the database with both object stores on first use", async () => {
    await createAssetStore().list();
    expect(fake.openCalls).toBe(1);
    expect(fake.dump(DB_NAME, "assets")).toBeDefined();
    expect(fake.dump(DB_NAME, "kv")).toBeDefined();
  });

  it("round-trips an asset including its blob", async () => {
    const store = createAssetStore();
    const meta = await store.put(png("hello"), {
      name: "logo.png",
      type: "image",
    });
    expect(meta.size).toBe(5);
    expect(meta.mime).toBe("image/png");
    const record = await store.get(meta.id);
    expect(record).toMatchObject({
      id: meta.id,
      name: "logo.png",
      type: "image",
      size: 5,
    });
    expect(await blobText(record?.blob)).toBe("hello");
    const raw = fake.dump(DB_NAME, "assets")?.get(meta.id) as Record<
      string,
      unknown
    >;
    expect(raw["id"]).toBe(meta.id);
    expect(raw["blob"]).toBeInstanceOf(Blob);
  });

  it("lists metadata only, sorted by creation time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const store = createAssetStore();
    vi.setSystemTime(3000);
    await store.put(png(), { name: "third", type: "image" }, "c");
    vi.setSystemTime(1000);
    await store.put(png(), { name: "first", type: "video" }, "a");
    vi.setSystemTime(2000);
    await store.put(png(), { name: "second", type: "audio" }, "b");
    const list = await store.list();
    expect(list.map((m) => m.name)).toEqual(["first", "second", "third"]);
    for (const meta of list) expect("blob" in meta).toBe(false);
  });

  it("overwrites by id, deletes and clears", async () => {
    const store = createAssetStore();
    await store.put(png("one"), { name: "one", type: "image" }, "x");
    await store.put(png("three"), { name: "two", type: "image" }, "x");
    expect((await store.list()).map((m) => m.name)).toEqual(["two"]);
    expect((await store.get("x"))?.size).toBe(5);
    await store.put(png(), { name: "other", type: "image" }, "y");
    await store.delete("x");
    await store.delete("x");
    expect((await store.list()).map((m) => m.id)).toEqual(["y"]);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it("persists across a reload (fresh connection, fresh store instance)", async () => {
    const meta = await createAssetStore().put(png("kept"), {
      name: "kept",
      type: "image",
    });
    closeDatabase();
    const record = await createAssetStore().get(meta.id);
    expect(await blobText(record?.blob)).toBe("kept");
    expect(fake.openCalls).toBe(2);
  });

  it("shares one connection between stores and operations", async () => {
    const a = createAssetStore();
    const b = createAssetStore();
    const kv = createKvStore();
    await Promise.all([
      a.put(png(), { name: "a", type: "image" }, "a"),
      b.put(png(), { name: "b", type: "image" }, "b"),
      kv.set("k", 1),
    ]);
    expect(fake.openCalls).toBe(1);
    expect((await a.list()).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("handles many concurrent writes", async () => {
    const store = createAssetStore();
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        store.put(png(`n${i}`), { name: `n${i}`, type: "image" }),
      ),
    );
    expect(await store.list()).toHaveLength(25);
  });

  it("serves cached object URLs and revokes them on delete", async () => {
    const store = createAssetStore();
    const { id } = await store.put(png("u"), { name: "u", type: "image" });
    const url = await store.getUrl(id);
    expect(url).toBe("blob:idb/1");
    expect(await store.getUrl(id)).toBe(url);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    await store.delete(id);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(await store.getUrl(id)).toBeUndefined();
  });

  it("revokes cached URLs on dispose", async () => {
    const store = createAssetStore();
    const { id } = await store.put(png(), { name: "u", type: "image" });
    const url = await store.getUrl(id);
    store.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it("ignores malformed rows when listing and reading", async () => {
    const store = createAssetStore();
    await store.put(png(), { name: "good", type: "image" }, "good");
    fake.poke(DB_NAME, "assets", "bad1", { id: "bad1" });
    fake.poke(DB_NAME, "assets", "bad2", "not an object");
    fake.poke(DB_NAME, "assets", "bad3", {
      id: "bad3",
      name: "n",
      type: "weird",
      mime: "x",
      size: 1,
      createdAt: 1,
      blob: png(),
    });
    fake.poke(DB_NAME, "assets", "bad4", {
      id: "bad4",
      name: "n",
      type: "image",
      mime: "x",
      size: 1,
      createdAt: 1,
      blob: "not a blob",
    });
    expect((await store.list()).map((m) => m.id)).toEqual(["good"]);
    expect(await store.get("bad1")).toBeUndefined();
    expect(await store.get("bad4")).toBeUndefined();
    expect(await store.getUrl("bad4")).toBeUndefined();
  });
});

describe("IndexedDB error handling", () => {
  it("surfaces QuotaExceededError as StorageError 'quota' and rolls back", async () => {
    const store = createAssetStore();
    await store.put(png("keep"), { name: "keep", type: "image" }, "a");
    fake.controls.failWrites = new DOMException(
      "disk full",
      "QuotaExceededError",
    );
    expect(
      await codeOf(store.put(png("new"), { name: "new", type: "image" }, "b")),
    ).toBe("quota");
    expect(
      await codeOf(
        store.put(png("zzzzzz"), { name: "changed", type: "image" }, "a"),
      ),
    ).toBe("quota");
    fake.controls.failWrites = null;
    const list = await store.list();
    expect(list.map((m) => m.id)).toEqual(["a"]);
    expect(list[0]?.name).toBe("keep");
    expect(await blobText((await store.get("a"))?.blob)).toBe("keep");
  });

  it("maps quota failures on kv writes too", async () => {
    const kv = createKvStore();
    fake.controls.failWrites = new DOMException(
      "disk full",
      "QuotaExceededError",
    );
    expect(await codeOf(kv.set("k", { a: 1 }))).toBe("quota");
  });

  it("maps other I/O failures to 'io'", async () => {
    const store = createAssetStore();
    await store.put(png(), { name: "a", type: "image" }, "a");
    fake.controls.failReads = new DOMException("disk on fire", "UnknownError");
    expect(await codeOf(store.get("a"))).toBe("io");
    expect(await codeOf(store.list())).toBe("io");
    fake.controls.failReads = null;
    expect((await store.get("a"))?.id).toBe("a");
  });

  it("maps uncloneable kv values to 'invalid'", async () => {
    const kv = createKvStore();
    expect(await codeOf(kv.set("k", { fn: () => 1 }))).toBe("invalid");
    expect(await kv.get("k")).toBeUndefined();
  });

  it("reconnects once when the connection turned out to be closed", async () => {
    const store = createAssetStore();
    await store.put(png(), { name: "a", type: "image" }, "a");
    expect(fake.openCalls).toBe(1);
    fake.controls.throwOnNextTransaction = new DOMException(
      "closing",
      "InvalidStateError",
    );
    expect((await store.get("a"))?.id).toBe("a");
    expect(fake.openCalls).toBe(2);
    expect(fake.openConnections.size).toBe(1);
  });

  it("closes its connection when another tab asks for a version change, then reopens", async () => {
    const store = createAssetStore();
    await store.put(png("v"), { name: "v", type: "image" }, "a");
    fake.simulateVersionChange();
    expect(fake.openConnections.size).toBe(0);
    expect(await blobText((await store.get("a"))?.blob)).toBe("v");
    expect(fake.openCalls).toBe(2);
  });

  it("reopens after the browser force-closes the connection", async () => {
    const store = createAssetStore();
    await store.put(png(), { name: "a", type: "image" }, "a");
    [...fake.openConnections][0]?.forceClose();
    expect((await store.get("a"))?.id).toBe("a");
    expect(fake.openCalls).toBe(2);
  });

  it("does not leak the old handle when two operations race a reconnect", async () => {
    const store = createAssetStore();
    await store.put(png(), { name: "a", type: "image" }, "a");
    fake.simulateVersionChange();
    await Promise.all([store.get("a"), store.get("a"), store.list()]);
    expect(fake.openCalls).toBe(2);
    expect(fake.openConnections.size).toBe(1);
  });
});

describe("memory fallback", () => {
  it("is used when indexedDB does not exist", async () => {
    vi.unstubAllGlobals();
    expect(assetStoreBackend()).toBe("memory");
    expect(storageFallbackReason()?.code).toBe("unavailable");
    expect(await probeStorageBackend()).toBe("memory");
    const store = createAssetStore();
    const meta = await store.put(png("mem"), { name: "mem", type: "image" });
    expect(await blobText((await store.get(meta.id))?.blob)).toBe("mem");
  });

  it("is used when opening fails (Safari private mode, blocked site data)", async () => {
    fake.controls.openMode = "error";
    const store = createAssetStore();
    const meta = await store.put(png("mem"), { name: "mem", type: "image" });
    expect(assetStoreBackend()).toBe("memory");
    expect(storageFallbackReason()?.code).toBe("unavailable");
    expect((await store.get(meta.id))?.name).toBe("mem");
    expect(fake.dump(DB_NAME, "assets")).toBeUndefined();
  });

  it("remembers the failure instead of retrying every call", async () => {
    fake.controls.openMode = "error";
    const store = createAssetStore();
    await store.list();
    await store.list();
    await createKvStore().get("k");
    expect(fake.openCalls).toBe(1);
  });

  it("retries IndexedDB after closeDatabase()", async () => {
    fake.controls.openMode = "error";
    await createAssetStore().list();
    expect(assetStoreBackend()).toBe("memory");
    fake.controls.openMode = "ok";
    closeDatabase();
    expect(assetStoreBackend()).toBe("indexeddb");
    await createAssetStore().put(
      png(),
      { name: "now-persistent", type: "image" },
      "p",
    );
    expect(fake.dump(DB_NAME, "assets")?.has("p")).toBe(true);
  });

  it("is used when indexedDB.open() throws synchronously", async () => {
    fake.controls.openMode = "throw";
    const store = createAssetStore();
    await expect(store.list()).resolves.toEqual([]);
    expect(assetStoreBackend()).toBe("memory");
    expect(storageFallbackReason()?.code).toBe("unavailable");
  });

  it("is used when the upgrade is blocked, and drops the late connection", async () => {
    fake.controls.openMode = "blocked";
    const store = createAssetStore();
    await store.put(png(), { name: "mem", type: "image" }, "m");
    expect(assetStoreBackend()).toBe("memory");
    expect(storageFallbackReason()?.code).toBe("blocked");
    fake.unblock();
    await settle();
    expect(fake.openConnections.size).toBe(0);
  });

  it("serves kv from memory too", async () => {
    fake.controls.openMode = "error";
    const kv = createKvStore();
    await kv.set("k", { a: 1 });
    expect(await kv.get("k")).toEqual({ a: 1 });
    expect(await kv.keys()).toEqual(["k"]);
  });

  it("survives indexedDB getter throwing", async () => {
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    try {
      expect(assetStoreBackend()).toBe("memory");
      await expect(createAssetStore().list()).resolves.toBeDefined();
    } finally {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  });
});

describe("IndexedDB KvStore", () => {
  it("round-trips structured data and lists keys sorted", async () => {
    const kv = createKvStore();
    await kv.set("b", {
      nested: { list: [1, 2, { x: true }] },
      when: new Date(5),
    });
    await kv.set("a", "text");
    expect(await kv.get("b")).toEqual({
      nested: { list: [1, 2, { x: true }] },
      when: new Date(5),
    });
    expect(await kv.get("a")).toBe("text");
    expect(await kv.keys()).toEqual(["a", "b"]);
  });

  it("overwrites, deletes, and treats undefined as delete", async () => {
    const kv = createKvStore();
    await kv.set("k", 1);
    await kv.set("k", 2);
    expect(await kv.get("k")).toBe(2);
    await kv.set("k", undefined);
    expect(await kv.get("k")).toBeUndefined();
    await kv.set("j", 1);
    await kv.delete("j");
    await kv.delete("missing");
    expect(await kv.keys()).toEqual([]);
  });

  it("persists across a reload and is separate from assets", async () => {
    await createKvStore().set("project:autosave", { name: "p" });
    await createAssetStore().put(png(), { name: "a", type: "image" }, "a");
    closeDatabase();
    expect(await createKvStore().get("project:autosave")).toEqual({
      name: "p",
    });
    expect(await createKvStore().keys()).toEqual(["project:autosave"]);
    expect((await createAssetStore().list()).map((m) => m.id)).toEqual(["a"]);
  });

  it("isolates stored values from later mutation", async () => {
    const kv = createKvStore();
    const value = { list: [1] };
    await kv.set("k", value);
    value.list.push(2);
    expect(await kv.get("k")).toEqual({ list: [1] });
  });
});

describe("autosave on IndexedDB (integration)", () => {
  it("persists a real project across a reload", async () => {
    const project = defaultProject();
    const saver = createAutosaver(createKvStore());
    saver.schedule(project);
    await saver.flush();
    closeDatabase();
    const restored = await createAutosaver(createKvStore()).loadLatest();
    expect(restored).toEqual(project);
  });

  it("reports quota errors through onError and never throws", async () => {
    const errors: StorageError[] = [];
    const saver = createAutosaver(createKvStore(), "project:autosave", 800, {
      onError: (error) => errors.push(error),
    });
    fake.controls.failWrites = new DOMException(
      "disk full",
      "QuotaExceededError",
    );
    saver.schedule(defaultProject());
    await expect(saver.flush()).resolves.toBeUndefined();
    expect(errors.map((e) => e.code)).toEqual(["quota"]);
    fake.controls.failWrites = null;
    const retry = defaultProject();
    saver.schedule(retry);
    await saver.flush();
    expect(await saver.loadLatest()).toEqual(retry);
    expect(errors).toHaveLength(1);
  });
});

describe("estimateUsage", () => {
  it("uses navigator.storage.estimate on the IndexedDB backend", async () => {
    vi.stubGlobal("navigator", {
      storage: { estimate: () => Promise.resolve({ usage: 50, quota: 200 }) },
    });
    expect(await estimateUsage()).toEqual({
      usage: 50,
      quota: 200,
      ratio: 0.25,
      backend: "indexeddb",
    });
  });

  it("clamps the ratio and sanitizes odd numbers", async () => {
    vi.stubGlobal("navigator", {
      storage: { estimate: () => Promise.resolve({ usage: 500, quota: 100 }) },
    });
    expect((await estimateUsage())?.ratio).toBe(1);
    vi.stubGlobal("navigator", {
      storage: {
        estimate: () => Promise.resolve({ usage: Number.NaN, quota: -5 }),
      },
    });
    expect(await estimateUsage()).toMatchObject({
      usage: 0,
      quota: 0,
      ratio: 0,
    });
    vi.stubGlobal("navigator", {
      storage: { estimate: () => Promise.resolve({}) },
    });
    expect(await estimateUsage()).toMatchObject({
      usage: 0,
      quota: 0,
      ratio: 0,
    });
  });

  it("returns undefined when estimate is missing or fails", async () => {
    vi.stubGlobal("navigator", { storage: {} });
    expect(await estimateUsage()).toBeUndefined();
    vi.stubGlobal("navigator", {});
    expect(await estimateUsage()).toBeUndefined();
    vi.stubGlobal("navigator", {
      storage: { estimate: () => Promise.reject(new Error("no")) },
    });
    expect(await estimateUsage()).toBeUndefined();
  });

  it("reports in-memory usage on the memory backend", async () => {
    vi.unstubAllGlobals();
    const store = createAssetStore();
    await store.put(png("12345"), { name: "a", type: "image" });
    const usage = await estimateUsage();
    expect(usage?.backend).toBe("memory");
    expect(usage?.quota).toBe(MEMORY_MAX_BYTES);
    expect(usage?.usage).toBe(5);
    expect(usage?.ratio).toBeCloseTo(5 / MEMORY_MAX_BYTES);
  });
});

describe("requestPersistence", () => {
  it("returns true without asking again when storage is already persistent", async () => {
    const persist = vi.fn(() => Promise.resolve(false));
    vi.stubGlobal("navigator", {
      storage: { persisted: () => Promise.resolve(true), persist },
    });
    expect(await requestPersistence()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("asks the browser and reports its answer", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        persisted: () => Promise.resolve(false),
        persist: () => Promise.resolve(true),
      },
    });
    expect(await requestPersistence()).toBe(true);
    vi.stubGlobal("navigator", {
      storage: {
        persisted: () => Promise.resolve(false),
        persist: () => Promise.resolve(false),
      },
    });
    expect(await requestPersistence()).toBe(false);
  });

  it("works without persisted()", async () => {
    vi.stubGlobal("navigator", {
      storage: { persist: () => Promise.resolve(true) },
    });
    expect(await requestPersistence()).toBe(true);
  });

  it("returns false when unsupported or when the browser throws", async () => {
    vi.stubGlobal("navigator", {});
    expect(await requestPersistence()).toBe(false);
    vi.stubGlobal("navigator", { storage: {} });
    expect(await requestPersistence()).toBe(false);
    vi.stubGlobal("navigator", {
      storage: { persist: () => Promise.reject(new Error("no")) },
    });
    expect(await requestPersistence()).toBe(false);
    vi.stubGlobal("navigator", {
      storage: {
        persist: () => {
          throw new Error("sync boom");
        },
      },
    });
    expect(await requestPersistence()).toBe(false);
  });
});
