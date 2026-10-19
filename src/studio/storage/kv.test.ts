import { describe, expect, it } from "vitest";
import { isStorageError, type StorageError } from "./errors";
import { createKvStore, createMemoryKvStore } from "./kv";

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

describe("memory KvStore", () => {
  it("stores, reads, lists and deletes values", async () => {
    const kv = createMemoryKvStore();
    expect(await kv.get("a")).toBeUndefined();
    await kv.set("b", { n: 1 });
    await kv.set("a", "text");
    await kv.set("c", [1, 2, 3]);
    expect(await kv.get("a")).toBe("text");
    expect(await kv.get("b")).toEqual({ n: 1 });
    expect(await kv.get<number[]>("c")).toEqual([1, 2, 3]);
    expect(await kv.keys()).toEqual(["a", "b", "c"]);
    await kv.delete("b");
    await kv.delete("b");
    expect(await kv.get("b")).toBeUndefined();
    expect(await kv.keys()).toEqual(["a", "c"]);
  });

  it("round-trips falsy values", async () => {
    const kv = createMemoryKvStore();
    for (const value of [0, "", false, null]) {
      await kv.set("k", value);
      expect(await kv.get("k")).toBe(value);
    }
  });

  it("overwrites existing keys", async () => {
    const kv = createMemoryKvStore();
    await kv.set("k", 1);
    await kv.set("k", 2);
    expect(await kv.get("k")).toBe(2);
    expect(await kv.keys()).toEqual(["k"]);
  });

  it("isolates stored values from later mutation (structured clone)", async () => {
    const kv = createMemoryKvStore();
    const value = { list: [1], nested: { deep: true } };
    await kv.set("k", value);
    value.list.push(2);
    value.nested.deep = false;
    expect(await kv.get("k")).toEqual({ list: [1], nested: { deep: true } });
    const read = (await kv.get<typeof value>("k"))!;
    read.list.push(99);
    expect(await kv.get("k")).toEqual({ list: [1], nested: { deep: true } });
  });

  it("treats setting undefined as a delete", async () => {
    const kv = createMemoryKvStore();
    await kv.set("k", 1);
    await kv.set("k", undefined);
    expect(await kv.get("k")).toBeUndefined();
    expect(await kv.keys()).toEqual([]);
  });

  it("rejects malformed keys on write with an 'invalid' error", async () => {
    const kv = createMemoryKvStore();
    expect(await codeOf(kv.set("", 1))).toBe("invalid");
    expect(await codeOf(kv.set("k".repeat(257), 1))).toBe("invalid");
    expect(await codeOf(kv.set(5 as unknown as string, 1))).toBe("invalid");
    expect(await kv.keys()).toEqual([]);
  });

  it("treats malformed keys on read/delete as missing", async () => {
    const kv = createMemoryKvStore();
    expect(await kv.get("")).toBeUndefined();
    expect(await kv.get("k".repeat(257))).toBeUndefined();
    expect(await kv.get(undefined as unknown as string)).toBeUndefined();
    await expect(kv.delete("")).resolves.toBeUndefined();
    await expect(kv.delete(null as unknown as string)).resolves.toBeUndefined();
  });

  it("rejects values that cannot be cloned with an 'invalid' error", async () => {
    const kv = createMemoryKvStore();
    expect(await codeOf(kv.set("k", () => 1))).toBe("invalid");
    expect(await codeOf(kv.set("k", { fn: () => 1 }))).toBe("invalid");
    expect(await kv.get("k")).toBeUndefined();
  });

  it("caps the number of keys but still allows overwrites", async () => {
    const kv = createMemoryKvStore({ maxKvKeys: 2 });
    await kv.set("a", 1);
    await kv.set("b", 2);
    expect(await codeOf(kv.set("c", 3))).toBe("quota");
    await kv.set("a", 10);
    expect(await kv.get("a")).toBe(10);
    await kv.delete("a");
    await kv.set("c", 3);
    expect(await kv.keys()).toEqual(["b", "c"]);
  });

  it("keeps independent stores independent", async () => {
    const a = createMemoryKvStore();
    const b = createMemoryKvStore();
    await a.set("k", 1);
    expect(await b.get("k")).toBeUndefined();
  });

  it("handles a project-sized document", async () => {
    const kv = createMemoryKvStore();
    const big = {
      scenes: Array.from({ length: 200 }, (_, i) => ({
        id: `s${i}`,
        layers: [],
      })),
    };
    await kv.set("project", big);
    expect(await kv.get("project")).toEqual(big);
  });
});

describe("createKvStore without IndexedDB (jsdom has none)", () => {
  it("falls back to shared in-page memory", async () => {
    const a = createKvStore();
    const b = createKvStore();
    await a.set("shared-key", { ok: true });
    expect(await b.get("shared-key")).toEqual({ ok: true });
    await a.delete("shared-key");
    expect(await b.get("shared-key")).toBeUndefined();
  });
});
