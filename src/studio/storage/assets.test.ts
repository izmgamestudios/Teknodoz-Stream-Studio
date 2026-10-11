import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageError, isStorageError } from "./errors";
import {
  createAssetStore,
  createMemoryAssetStore,
  assetStoreBackend,
  MAX_ASSET_BYTES,
} from "./idb";
import { MEMORY_MAX_ASSETS, MEMORY_MAX_BYTES } from "./memory";

let counter = 0;
let created: string[] = [];
let revoked: string[] = [];

/** jsdom's Blob has no .text(); FileReader works everywhere. */
function blobText(blob: Blob | undefined): Promise<string | undefined> {
  if (!blob) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function png(content = "pixels", name = "a.png"): Blob {
  return new File([content], name, { type: "image/png" });
}

async function expectCode(
  promise: Promise<unknown>,
  code: StorageError["code"],
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(isStorageError(error)).toBe(true);
  expect((error as StorageError).code).toBe(code);
}

beforeEach(() => {
  counter = 0;
  created = [];
  revoked = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:test/${++counter}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
    revoked.push(url);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("memory AssetStore: put / get / list / delete / clear", () => {
  it("stores a blob and returns metadata without the blob", async () => {
    const store = createMemoryAssetStore();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_700_000_000_000);
    const meta = await store.put(png("hello"), {
      name: "logo.png",
      type: "image",
    });
    expect(meta).toEqual({
      id: expect.stringMatching(/^as_/) as string,
      name: "logo.png",
      type: "image",
      mime: "image/png",
      size: 5,
      createdAt: 1_700_000_000_000,
    });
    expect("blob" in meta).toBe(false);
  });

  it("returns the record, including a readable blob", async () => {
    const store = createMemoryAssetStore();
    const meta = await store.put(png("hello"), {
      name: "logo.png",
      type: "image",
    });
    const record = await store.get(meta.id);
    expect(record?.id).toBe(meta.id);
    expect(record?.name).toBe("logo.png");
    expect(await blobText(record?.blob)).toBe("hello");
  });

  it("does not expose the stored record to mutation", async () => {
    const store = createMemoryAssetStore();
    const meta = await store.put(png(), { name: "a.png", type: "image" });
    const record = await store.get(meta.id);
    if (record) record.name = "hacked";
    expect((await store.get(meta.id))?.name).toBe("a.png");
  });

  it("uses an explicit id and overwrites in place", async () => {
    const store = createMemoryAssetStore();
    const first = await store.put(
      png("one"),
      { name: "one.png", type: "image" },
      "fixed",
    );
    const second = await store.put(
      png("twotwo"),
      { name: "two.png", type: "image" },
      "fixed",
    );
    expect(first.id).toBe("fixed");
    expect(second.id).toBe("fixed");
    expect(await store.list()).toHaveLength(1);
    const record = await store.get("fixed");
    expect(record?.name).toBe("two.png");
    expect(record?.size).toBe(6);
  });

  it("generates unique ids", async () => {
    const store = createMemoryAssetStore();
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add((await store.put(png(), { name: "a", type: "image" })).id);
    }
    expect(ids.size).toBe(50);
  });

  it("falls back to octet-stream when the blob has no type", async () => {
    const store = createMemoryAssetStore();
    const meta = await store.put(new Blob(["x"]), {
      name: "raw",
      type: "audio",
    });
    expect(meta.mime).toBe("application/octet-stream");
  });

  it("sanitizes display names", async () => {
    const store = createMemoryAssetStore();
    const dirty = await store.put(png(), {
      name: "  we\u0000ird\nna\tme.png  ",
      type: "image",
    });
    expect(dirty.name).toBe("weirdname.png");
    const empty = await store.put(png(), {
      name: "\u0000\u0001",
      type: "image",
    });
    expect(empty.name).toBe("adsiz");
    const long = await store.put(png(), {
      name: "x".repeat(1000),
      type: "image",
    });
    expect(long.name).toHaveLength(256);
    const notString = await store.put(png(), {
      name: 42 as unknown as string,
      type: "image",
    });
    expect(notString.name).toBe("adsiz");
  });

  it("keeps markup-looking names as inert text", async () => {
    const store = createMemoryAssetStore();
    const meta = await store.put(png(), {
      name: "<img src=x onerror=alert(1)>",
      type: "image",
    });
    expect(meta.name).toBe("<img src=x onerror=alert(1)>");
  });

  it("lists in creation order, ties broken by id", async () => {
    const store = createMemoryAssetStore();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(2000);
    await store.put(png(), { name: "late", type: "image" }, "b");
    vi.setSystemTime(1000);
    await store.put(png(), { name: "early", type: "image" }, "z");
    vi.setSystemTime(2000);
    await store.put(png(), { name: "late2", type: "image" }, "a");
    const names = (await store.list()).map((m) => m.name);
    expect(names).toEqual(["early", "late2", "late"]);
  });

  it("supports all three asset types", async () => {
    const store = createMemoryAssetStore();
    for (const type of ["image", "video", "audio"] as const) {
      expect(
        (
          await store.put(new Blob(["x"], { type: "x/y" }), {
            name: type,
            type,
          })
        ).type,
      ).toBe(type);
    }
    expect((await store.list()).map((m) => m.type).sort()).toEqual([
      "audio",
      "image",
      "video",
    ]);
  });

  it("returns undefined for unknown and malformed ids", async () => {
    const store = createMemoryAssetStore();
    expect(await store.get("nope")).toBeUndefined();
    expect(await store.get("")).toBeUndefined();
    expect(await store.get("x".repeat(500))).toBeUndefined();
    expect(await store.get(undefined as unknown as string)).toBeUndefined();
    expect(await store.getUrl("")).toBeUndefined();
    expect(await store.getUrl("nope")).toBeUndefined();
  });

  it("deletes one asset and tolerates unknown ids", async () => {
    const store = createMemoryAssetStore();
    const a = await store.put(png(), { name: "a", type: "image" });
    const b = await store.put(png(), { name: "b", type: "image" });
    await store.delete(a.id);
    await store.delete("never-existed");
    await store.delete("");
    expect(await store.get(a.id)).toBeUndefined();
    expect((await store.list()).map((m) => m.id)).toEqual([b.id]);
  });

  it("clears everything", async () => {
    const store = createMemoryAssetStore();
    await store.put(png(), { name: "a", type: "image" });
    await store.put(png(), { name: "b", type: "image" });
    await store.clear();
    expect(await store.list()).toEqual([]);
    await store.clear();
  });

  it("keeps independent stores independent", async () => {
    const a = createMemoryAssetStore();
    const b = createMemoryAssetStore();
    await a.put(png(), { name: "only-a", type: "image" }, "x");
    expect(await b.get("x")).toBeUndefined();
  });
});

describe("memory AssetStore: validation and limits", () => {
  it("rejects things that are not Blobs", async () => {
    const store = createMemoryAssetStore();
    await expectCode(
      store.put("text" as unknown as Blob, { name: "a", type: "image" }),
      "invalid",
    );
    await expectCode(
      store.put(null as unknown as Blob, { name: "a", type: "image" }),
      "invalid",
    );
    await expectCode(
      store.put({ size: 1, type: "image/png" } as unknown as Blob, {
        name: "a",
        type: "image",
      }),
      "invalid",
    );
  });

  it("rejects unknown asset types and missing meta", async () => {
    const store = createMemoryAssetStore();
    await expectCode(
      store.put(png(), { name: "a", type: "doc" as never }),
      "invalid",
    );
    await expectCode(store.put(png(), undefined as never), "invalid");
  });

  it("rejects empty and over-long ids on write", async () => {
    const store = createMemoryAssetStore();
    await expectCode(
      store.put(png(), { name: "a", type: "image" }, ""),
      "invalid",
    );
    await expectCode(
      store.put(png(), { name: "a", type: "image" }, "x".repeat(129)),
      "invalid",
    );
    expect(await store.list()).toEqual([]);
  });

  it("reports a quota error for a single file above the hard limit", async () => {
    const store = createMemoryAssetStore();
    const huge = png();
    Object.defineProperty(huge, "size", { value: MAX_ASSET_BYTES + 1 });
    await expectCode(store.put(huge, { name: "huge", type: "video" }), "quota");
    expect(await store.list()).toEqual([]);
  });

  it("enforces the total byte budget and leaves existing data untouched", async () => {
    const store = createMemoryAssetStore({ maxBytes: 10 });
    await store.put(png("123456"), { name: "a", type: "image" }, "a");
    await expectCode(
      store.put(png("123456"), { name: "b", type: "image" }, "b"),
      "quota",
    );
    expect((await store.list()).map((m) => m.id)).toEqual(["a"]);
    expect(await blobText((await store.get("a"))?.blob)).toBe("123456");
  });

  it("counts an overwrite against the budget only by the size difference", async () => {
    const store = createMemoryAssetStore({ maxBytes: 10 });
    await store.put(png("123456"), { name: "a", type: "image" }, "a");
    await store.put(png("12345678"), { name: "a", type: "image" }, "a");
    await expectCode(
      store.put(png("123456789012"), { name: "a", type: "image" }, "a"),
      "quota",
    );
    expect((await store.get("a"))?.size).toBe(8);
  });

  it("enforces the asset-count cap", async () => {
    const store = createMemoryAssetStore({ maxAssets: 2 });
    await store.put(png(), { name: "1", type: "image" }, "1");
    await store.put(png(), { name: "2", type: "image" }, "2");
    await expectCode(
      store.put(png(), { name: "3", type: "image" }, "3"),
      "quota",
    );
    // Replacing an existing id is not a new asset.
    await store.put(png("new"), { name: "2b", type: "image" }, "2");
    expect(await store.list()).toHaveLength(2);
  });

  it("exposes sane default caps", () => {
    expect(MEMORY_MAX_BYTES).toBeGreaterThan(0);
    expect(MEMORY_MAX_ASSETS).toBeGreaterThan(0);
  });

  it("frees budget after delete", async () => {
    const store = createMemoryAssetStore({ maxBytes: 6 });
    await store.put(png("123456"), { name: "a", type: "image" }, "a");
    await store.delete("a");
    await store.put(png("123456"), { name: "b", type: "image" }, "b");
    expect(await store.list()).toHaveLength(1);
  });
});

describe("memory AssetStore: object URLs", () => {
  it("creates a URL once and caches it", async () => {
    const store = createMemoryAssetStore();
    const { id } = await store.put(png(), { name: "a", type: "image" });
    const first = await store.getUrl(id);
    const second = await store.getUrl(id);
    expect(first).toBe("blob:test/1");
    expect(second).toBe(first);
    expect(created).toHaveLength(1);
  });

  it("shares one URL between concurrent callers", async () => {
    const store = createMemoryAssetStore();
    const { id } = await store.put(png(), { name: "a", type: "image" });
    const urls = await Promise.all([
      store.getUrl(id),
      store.getUrl(id),
      store.getUrl(id),
    ]);
    expect(new Set(urls).size).toBe(1);
    expect(created).toHaveLength(1);
  });

  it("gives each asset its own URL", async () => {
    const store = createMemoryAssetStore();
    const a = await store.put(png(), { name: "a", type: "image" });
    const b = await store.put(png(), { name: "b", type: "image" });
    expect(await store.getUrl(a.id)).not.toBe(await store.getUrl(b.id));
  });

  it("revokes the URL on delete and never serves it again", async () => {
    const store = createMemoryAssetStore();
    const { id } = await store.put(png(), { name: "a", type: "image" });
    const url = await store.getUrl(id);
    await store.delete(id);
    expect(revoked).toEqual([url]);
    expect(await store.getUrl(id)).toBeUndefined();
  });

  it("revokes every URL on clear", async () => {
    const store = createMemoryAssetStore();
    const a = await store.put(png(), { name: "a", type: "image" });
    const b = await store.put(png(), { name: "b", type: "image" });
    const urls = [await store.getUrl(a.id), await store.getUrl(b.id)];
    await store.clear();
    expect([...revoked].sort()).toEqual([...(urls as string[])].sort());
  });

  it("revokes the stale URL when an asset is overwritten", async () => {
    const store = createMemoryAssetStore();
    await store.put(png("old"), { name: "a", type: "image" }, "a");
    const oldUrl = await store.getUrl("a");
    await store.put(png("new"), { name: "a", type: "image" }, "a");
    expect(revoked).toContain(oldUrl);
    const newUrl = await store.getUrl("a");
    expect(newUrl).toBeDefined();
    expect(newUrl).not.toBe(oldUrl);
  });

  it("keeps the old URL when an overwrite fails", async () => {
    const store = createMemoryAssetStore({ maxBytes: 5 });
    await store.put(png("1234"), { name: "a", type: "image" }, "a");
    const url = await store.getUrl("a");
    await expectCode(
      store.put(png("123456789"), { name: "a", type: "image" }, "a"),
      "quota",
    );
    expect(revoked).toEqual([]);
    expect(await store.getUrl("a")).toBe(url);
  });

  it("revokes everything on dispose and stays usable afterwards", async () => {
    const store = createMemoryAssetStore();
    const { id } = await store.put(png(), { name: "a", type: "image" });
    const url = await store.getUrl(id);
    store.dispose();
    store.dispose();
    expect(revoked).toEqual([url]);
    const again = await store.getUrl(id);
    expect(again).toBeDefined();
    expect(again).not.toBe(url);
  });

  it("raises an 'unavailable' error when object URLs are not supported", async () => {
    const store = createMemoryAssetStore();
    const { id } = await store.put(png(), { name: "a", type: "image" });
    Object.defineProperty(URL, "createObjectURL", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    await expectCode(store.getUrl(id), "unavailable");
    // A failed attempt must not wedge later calls.
    vi.restoreAllMocks();
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => "blob:test/recovered",
    );
    expect(await store.getUrl(id)).toBe("blob:test/recovered");
  });

  it("does not throw if revokeObjectURL throws", async () => {
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {
      throw new Error("boom");
    });
    const store = createMemoryAssetStore();
    const { id } = await store.put(png(), { name: "a", type: "image" });
    await store.getUrl(id);
    await expect(store.delete(id)).resolves.toBeUndefined();
    store.dispose();
  });
});

describe("createAssetStore without IndexedDB (jsdom has none)", () => {
  it("reports the memory backend", () => {
    expect(assetStoreBackend()).toBe("memory");
  });

  it("works end to end and shares data between instances in the same page", async () => {
    const a = createAssetStore();
    const b = createAssetStore();
    const meta = await a.put(png("shared"), { name: "s.png", type: "image" });
    expect(await blobText((await b.get(meta.id))?.blob)).toBe("shared");
    expect((await b.list()).map((m) => m.id)).toContain(meta.id);
    await b.clear();
    expect(await a.get(meta.id)).toBeUndefined();
    a.dispose();
    b.dispose();
  });
});

describe("StorageError", () => {
  it("carries a stable code, name and a short message", () => {
    const err = new StorageError("quota");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("StorageError");
    expect(err.code).toBe("quota");
    expect(err.message.length).toBeGreaterThan(0);
    expect(isStorageError(err)).toBe(true);
    expect(isStorageError(new Error("x"))).toBe(false);
  });

  it("keeps a custom message and cause", () => {
    const cause = new Error("root");
    const err = new StorageError("io", "özel", { cause });
    expect(err.message).toBe("özel");
    expect(err.cause).toBe(cause);
  });
});
