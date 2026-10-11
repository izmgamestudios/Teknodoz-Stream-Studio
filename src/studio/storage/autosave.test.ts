import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProject } from "../defaults";
import type { KvStore, ProjectState } from "../types";
import {
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_KEY,
  AUTOSAVE_MAX_WAIT_MS,
  createAutosaver,
  flushOnPageHide,
} from "./autosave";
import { StorageError } from "./errors";
import { createMemoryKvStore } from "./kv";

/** A KvStore that records writes and lets a test hold them open or make them fail. */
function spyKv(inner: KvStore = createMemoryKvStore()) {
  const writes: Array<{ key: string; value: unknown }> = [];
  const gate = { hold: null as Promise<void> | null, fail: null as unknown };
  const kv: KvStore = {
    get: (key) => inner.get(key),
    async set(key, value) {
      writes.push({ key, value });
      if (gate.hold) await gate.hold;
      if (gate.fail !== null) throw gate.fail;
      await inner.set(key, value);
    },
    delete: (key) => inner.delete(key),
    keys: () => inner.keys(),
  };
  return { kv, inner, writes, gate };
}

function project(name: string): ProjectState {
  return { ...defaultProject(), name };
}

function savedName(write: { value: unknown } | undefined): unknown {
  const envelope = write?.value as { project?: { name?: unknown } } | undefined;
  return envelope?.project?.name;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createAutosaver: debounce", () => {
  it("uses the documented defaults", () => {
    expect(AUTOSAVE_KEY).toBe("project:autosave");
    expect(AUTOSAVE_DELAY_MS).toBe(800);
  });

  it("writes once, after the delay", async () => {
    const { kv, writes } = spyKv();
    const saver = createAutosaver(kv);
    saver.schedule(project("A"));
    expect(saver.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(799);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.key).toBe("project:autosave");
    expect(savedName(writes[0])).toBe("A");
    expect(saver.hasPending()).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(writes).toHaveLength(1);
  });

  it("collapses rapid schedules into one write of the latest project", async () => {
    const { kv, writes } = spyKv();
    const saver = createAutosaver(kv);
    saver.schedule(project("A"));
    await vi.advanceTimersByTimeAsync(500);
    saver.schedule(project("B"));
    await vi.advanceTimersByTimeAsync(500);
    saver.schedule(project("C"));
    await vi.advanceTimersByTimeAsync(799);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toHaveLength(1);
    expect(savedName(writes[0])).toBe("C");
  });

  it("writes again for a later change", async () => {
    const { kv, writes } = spyKv();
    const saver = createAutosaver(kv);
    saver.schedule(project("A"));
    await vi.advanceTimersByTimeAsync(800);
    saver.schedule(project("B"));
    await vi.advanceTimersByTimeAsync(800);
    expect(writes.map(savedName)).toEqual(["A", "B"]);
  });

  it("honours a custom key and delay", async () => {
    const { kv, writes, inner } = spyKv();
    const saver = createAutosaver(kv, "my-key", 100);
    saver.schedule(project("A"));
    await vi.advanceTimersByTimeAsync(99);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes[0]?.key).toBe("my-key");
    expect(await inner.keys()).toEqual(["my-key"]);
  });

  it("accepts a zero delay and repairs a nonsensical one", async () => {
    const zero = spyKv();
    const saverZero = createAutosaver(zero.kv, "k", 0);
    saverZero.schedule(project("A"));
    await vi.advanceTimersByTimeAsync(0);
    expect(zero.writes).toHaveLength(1);

    for (const bad of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      const { kv, writes } = spyKv();
      const saver = createAutosaver(kv, "k", bad);
      saver.schedule(project("A"));
      await vi.advanceTimersByTimeAsync(799);
      expect(writes).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(writes).toHaveLength(1);
    }
  });

  it("does not let continuous edits postpone saving forever (max wait)", async () => {
    expect(AUTOSAVE_MAX_WAIT_MS).toBe(5000);
    const { kv, writes } = spyKv();
    const saver = createAutosaver(kv);
    // An edit every 500 ms, e.g. dragging a layer: a pure debounce would never write.
    for (let t = 0; t < 12_000; t += 500) {
      saver.schedule(project(`edit-${t}`));
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(writes.length).toBeGreaterThanOrEqual(2);
    // The first write lands by the 5 s mark with the state at that moment.
    expect(savedName(writes[0])).toMatch(/^edit-/);
  });

  it("respects a custom max wait but never below the delay", async () => {
    const { kv, writes } = spyKv();
    const saver = createAutosaver(kv, "k", 800, { maxWaitMs: 1000 });
    saver.schedule(project("A"));
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule(project("B"));
    await vi.advanceTimersByTimeAsync(400);
    expect(writes).toHaveLength(1);

    const tiny = spyKv();
    const saverTiny = createAutosaver(tiny.kv, "k", 800, { maxWaitMs: 10 });
    saverTiny.schedule(project("A"));
    await vi.advanceTimersByTimeAsync(799);
    expect(tiny.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(tiny.writes).toHaveLength(1);
  });
});

describe("createAutosaver: flush", () => {
  it("writes pending work immediately and cancels the timer", async () => {
    const { kv, writes } = spyKv();
    const saver = createAutosaver(kv);
    saver.schedule(project("A"));
    await saver.flush();
    expect(writes).toHaveLength(1);
    expect(saver.hasPending()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes).toHaveLength(1);
  });

  it("resolves immediately when nothing is pending", async () => {
    const { kv, writes } = spyKv();
    const saver = createAutosaver(kv);
    await expect(saver.flush()).resolves.toBeUndefined();
    expect(writes).toHaveLength(0);
  });

  it("waits for a write that is already in flight", async () => {
    const { kv, writes, gate } = spyKv();
    let release!: () => void;
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saver = createAutosaver(kv);
    saver.schedule(project("A"));
    await vi.advanceTimersByTimeAsync(800);
    expect(writes).toHaveLength(1);
    let flushed = false;
    const done = saver.flush().then(() => {
      flushed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);
    release();
    await done;
    expect(flushed).toBe(true);
    expect(await saver.loadLatest()).toMatchObject({ name: "A" });
  });

  it("serializes writes so an older snapshot never lands after a newer one", async () => {
    const { kv, writes, gate } = spyKv();
    let release!: () => void;
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saver = createAutosaver(kv);
    saver.schedule(project("old"));
    const first = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    saver.schedule(project("new"));
    const second = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    // The second write must not start while the first is still pending.
    expect(writes.map(savedName)).toEqual(["old"]);
    release();
    await Promise.all([first, second]);
    expect(writes.map(savedName)).toEqual(["old", "new"]);
    expect(await saver.loadLatest()).toMatchObject({ name: "new" });
  });

  it("supports flushing repeatedly", async () => {
    const { kv, writes } = spyKv();
    const saver = createAutosaver(kv);
    saver.schedule(project("A"));
    await Promise.all([saver.flush(), saver.flush()]);
    expect(writes).toHaveLength(1);
  });
});

describe("createAutosaver: loading", () => {
  it("returns undefined when nothing was saved", async () => {
    const saver = createAutosaver(createMemoryKvStore());
    expect(await saver.loadLatest()).toBeUndefined();
    expect(await saver.loadLatestMeta()).toBeUndefined();
  });

  it("returns the last persisted project, transparently unwrapped", async () => {
    const kv = createMemoryKvStore();
    const saver = createAutosaver(kv);
    const p = project("Persisted");
    saver.schedule(p);
    await saver.flush();
    expect(await saver.loadLatest()).toEqual(p);
    // A different autosaver instance on the same store sees it too (e.g. after a reload).
    expect(await createAutosaver(kv).loadLatest()).toEqual(p);
  });

  it("does not return work that has not been written yet", async () => {
    const saver = createAutosaver(createMemoryKvStore());
    saver.schedule(project("pending"));
    expect(await saver.loadLatest()).toBeUndefined();
  });

  it("waits for in-flight writes so it reads its own latest save", async () => {
    const { kv, gate } = spyKv();
    let release!: () => void;
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saver = createAutosaver(kv);
    saver.schedule(project("A"));
    await vi.advanceTimersByTimeAsync(800);
    const loading = saver.loadLatest();
    release();
    expect(await loading).toMatchObject({ name: "A" });
  });

  it("reports when it was saved", async () => {
    const saver = createAutosaver(createMemoryKvStore());
    saver.schedule(project("A"));
    await saver.flush();
    const meta = await saver.loadLatestMeta();
    expect(meta?.savedAt).toBe(1_700_000_000_000);
    expect(meta?.project).toMatchObject({ name: "A" });
  });

  it("hands over values written without the envelope as-is", async () => {
    const kv = createMemoryKvStore();
    await kv.set(AUTOSAVE_KEY, { version: 1, name: "foreign" });
    const saver = createAutosaver(kv);
    expect(await saver.loadLatest()).toEqual({ version: 1, name: "foreign" });
    expect((await saver.loadLatestMeta())?.savedAt).toBeUndefined();
  });

  it("ignores an envelope without a project and a bogus timestamp", async () => {
    const kv = createMemoryKvStore();
    await kv.set(AUTOSAVE_KEY, { __tkzAutosave: 1, savedAt: 5, project: null });
    const saver = createAutosaver(kv);
    expect(await saver.loadLatest()).toBeUndefined();
    await kv.set(AUTOSAVE_KEY, {
      __tkzAutosave: 1,
      savedAt: "yesterday",
      project: { a: 1 },
    });
    const meta = await saver.loadLatestMeta();
    expect(meta?.project).toEqual({ a: 1 });
    expect(meta?.savedAt).toBeUndefined();
  });

  it("returns whatever junk is stored, leaving validation to the caller", async () => {
    const kv = createMemoryKvStore();
    await kv.set(AUTOSAVE_KEY, "garbage");
    expect(await createAutosaver(kv).loadLatest()).toBe("garbage");
    await kv.set(AUTOSAVE_KEY, 42);
    expect(await createAutosaver(kv).loadLatest()).toBe(42);
  });
});

describe("createAutosaver: errors never throw", () => {
  it("reports write failures through onError and keeps working", async () => {
    const { kv, gate, writes } = spyKv();
    const errors: StorageError[] = [];
    const saved: number[] = [];
    const saver = createAutosaver(kv, AUTOSAVE_KEY, AUTOSAVE_DELAY_MS, {
      onError: (e) => errors.push(e),
      onSaved: (t) => saved.push(t),
    });
    gate.fail = new DOMException("full", "QuotaExceededError");
    saver.schedule(project("A"));
    await expect(saver.flush()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(StorageError);
    expect(errors[0]?.code).toBe("quota");
    expect(saved).toEqual([]);

    gate.fail = null;
    saver.schedule(project("B"));
    await saver.flush();
    expect(errors).toHaveLength(1);
    expect(saved).toEqual([1_700_000_000_000]);
    expect(writes).toHaveLength(2);
  });

  it("classifies non-quota failures as 'io'", async () => {
    const { kv, gate } = spyKv();
    const errors: StorageError[] = [];
    const saver = createAutosaver(kv, AUTOSAVE_KEY, AUTOSAVE_DELAY_MS, {
      onError: (e) => errors.push(e),
    });
    gate.fail = new Error("disk exploded");
    saver.schedule(project("A"));
    await saver.flush();
    expect(errors.map((e) => e.code)).toEqual(["io"]);
  });

  it("survives a timer-triggered failure without an unhandled rejection", async () => {
    const { kv, gate } = spyKv();
    gate.fail = new Error("nope");
    const saver = createAutosaver(kv);
    saver.schedule(project("A"));
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(10);
    expect(saver.hasPending()).toBe(false);
  });

  it("survives a store that throws synchronously", async () => {
    const errors: StorageError[] = [];
    const kv: KvStore = {
      get: () => Promise.resolve(undefined),
      set: () => {
        throw new Error("sync boom");
      },
      delete: () => Promise.resolve(),
      keys: () => Promise.resolve([]),
    };
    const saver = createAutosaver(kv, AUTOSAVE_KEY, AUTOSAVE_DELAY_MS, {
      onError: (e) => errors.push(e),
    });
    saver.schedule(project("A"));
    await expect(saver.flush()).resolves.toBeUndefined();
    expect(errors.map((e) => e.code)).toEqual(["io"]);
  });

  it("returns undefined and reports when reading fails", async () => {
    const errors: StorageError[] = [];
    const kv: KvStore = {
      get: () => Promise.reject(new Error("read failed")),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      keys: () => Promise.resolve([]),
    };
    const saver = createAutosaver(kv, AUTOSAVE_KEY, AUTOSAVE_DELAY_MS, {
      onError: (e) => errors.push(e),
    });
    expect(await saver.loadLatest()).toBeUndefined();
    expect(errors.map((e) => e.code)).toEqual(["io"]);
  });

  it("works without an onError handler", async () => {
    const { kv, gate } = spyKv();
    gate.fail = new Error("x");
    const saver = createAutosaver(kv);
    saver.schedule(project("A"));
    await expect(saver.flush()).resolves.toBeUndefined();
    await expect(saver.loadLatest()).resolves.toBeUndefined();
  });

  it("is not broken by throwing onError / onSaved handlers", async () => {
    const { kv, gate, writes } = spyKv();
    const saver = createAutosaver(kv, AUTOSAVE_KEY, AUTOSAVE_DELAY_MS, {
      onError: () => {
        throw new Error("handler bug");
      },
      onSaved: () => {
        throw new Error("handler bug");
      },
    });
    saver.schedule(project("A"));
    await expect(saver.flush()).resolves.toBeUndefined();
    gate.fail = new Error("x");
    saver.schedule(project("B"));
    await expect(saver.flush()).resolves.toBeUndefined();
    gate.fail = null;
    saver.schedule(project("C"));
    await saver.flush();
    expect(writes).toHaveLength(3);
  });

  it("rejects non-object projects with an 'invalid' error and writes nothing", async () => {
    const { kv, writes } = spyKv();
    const errors: StorageError[] = [];
    const saver = createAutosaver(kv, AUTOSAVE_KEY, AUTOSAVE_DELAY_MS, {
      onError: (e) => errors.push(e),
    });
    for (const bad of [null, undefined, "str", 5]) {
      expect(() =>
        saver.schedule(bad as unknown as ProjectState),
      ).not.toThrow();
    }
    await saver.flush();
    expect(writes).toHaveLength(0);
    expect(errors).toHaveLength(4);
    expect(errors.every((e) => e.code === "invalid")).toBe(true);
    expect(saver.hasPending()).toBe(false);
  });

  it("reports an un-cloneable project as 'invalid'", async () => {
    const errors: StorageError[] = [];
    const saver = createAutosaver(
      createMemoryKvStore(),
      AUTOSAVE_KEY,
      AUTOSAVE_DELAY_MS,
      {
        onError: (e) => errors.push(e),
      },
    );
    const bad = { ...defaultProject(), name: (() => 1) as unknown as string };
    saver.schedule(bad);
    await saver.flush();
    expect(errors.map((e) => e.code)).toEqual(["invalid"]);
  });
});

describe("createAutosaver: cancel / clear", () => {
  it("cancel drops pending work", async () => {
    const { kv, writes } = spyKv();
    const saver = createAutosaver(kv);
    saver.schedule(project("A"));
    saver.cancel();
    expect(saver.hasPending()).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clear drops pending work and deletes the stored autosave", async () => {
    const kv = createMemoryKvStore();
    const saver = createAutosaver(kv);
    saver.schedule(project("A"));
    await saver.flush();
    expect(await kv.get(AUTOSAVE_KEY)).toBeDefined();
    saver.schedule(project("B"));
    await saver.clear();
    expect(await kv.get(AUTOSAVE_KEY)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await kv.get(AUTOSAVE_KEY)).toBeUndefined();
    expect(await saver.loadLatest()).toBeUndefined();
  });

  it("clear never rejects", async () => {
    const kv: KvStore = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
      delete: () => Promise.reject(new Error("nope")),
      keys: () => Promise.resolve([]),
    };
    const errors: StorageError[] = [];
    const saver = createAutosaver(kv, AUTOSAVE_KEY, AUTOSAVE_DELAY_MS, {
      onError: (e) => errors.push(e),
    });
    await expect(saver.clear()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});

describe("flushOnPageHide", () => {
  function setVisibility(state: "visible" | "hidden"): void {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state,
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("flushes on pagehide and when the tab becomes hidden", () => {
    const flush = vi.fn(() => Promise.resolve());
    const stop = flushOnPageHide({ flush });
    window.dispatchEvent(new Event("pagehide"));
    expect(flush).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(2);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops listening once cleaned up", () => {
    const flush = vi.fn(() => Promise.resolve());
    const stop = flushOnPageHide({ flush });
    stop();
    stop();
    window.dispatchEvent(new Event("pagehide"));
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flush).not.toHaveBeenCalled();
  });

  it("really saves a pending project", async () => {
    const kv = createMemoryKvStore();
    const saver = createAutosaver(kv);
    const stop = flushOnPageHide(saver);
    saver.schedule(project("before-close"));
    window.dispatchEvent(new Event("pagehide"));
    await saver.flush();
    expect(await saver.loadLatest()).toMatchObject({ name: "before-close" });
    stop();
  });
});
