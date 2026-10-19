// src/studio/storage/__fakes__/fake-indexeddb.ts
// A deliberately small IndexedDB fake for unit tests (jsdom has none and fake-indexeddb is not a
// dependency). It models only what the storage module uses:
//   - IDBFactory.open with onupgradeneeded / onsuccess / onerror / onblocked
//   - single-store transactions: put/get/delete/clear/openCursor/getAllKeys, auto-commit,
//     rollback on abort, structured-clone semantics (Blobs are kept by reference)
//   - fault injection (quota errors, failed/blocked opens, versionchange, forced close)
// It is NOT a conformant implementation. Requests run on microtasks, never timers, so it also works
// under vi.useFakeTimers().

interface FakeEvent {
  readonly type: string;
  readonly target: unknown;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

type Handler = ((event: FakeEvent) => void) | null;

function makeEvent(type: string, target: unknown): FakeEvent {
  const event: FakeEvent = {
    type,
    target,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {},
  };
  return event;
}

function domError(name: string, message = name): DOMException {
  return new DOMException(message, name);
}

/** Structured-clone stand-in: plain data is deep-copied, Blobs are kept, functions are rejected. */
function cloneForIdb(value: unknown, depth = 0): unknown {
  if (depth > 64) throw domError("DataCloneError", "too deep");
  if (typeof value === "function" || typeof value === "symbol") {
    throw domError("DataCloneError", "not cloneable");
  }
  if (value === null || typeof value !== "object") return value;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value))
    return value.map((item) => cloneForIdb(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value))
    out[key] = cloneForIdb(item, depth + 1);
  return out;
}

interface StoreState {
  keyPath: string | null;
  data: Map<string, unknown>;
}

interface DatabaseState {
  version: number;
  stores: Map<string, StoreState>;
}

/** Knobs tests flip to provoke failures. */
export interface FakeIdbControls {
  /** How the next `open()` behaves. "blocked" stays pending until `unblock()`. */
  openMode: "ok" | "error" | "blocked" | "throw";
  /** Error used when openMode is "error". */
  openError: DOMException;
  /** Every write request fails with this error (transaction aborts, rolling back). */
  failWrites: DOMException | null;
  /** Every read request fails with this error. */
  failReads: DOMException | null;
  /** The next `db.transaction()` call throws this error once. */
  throwOnNextTransaction: DOMException | null;
}

export class FakeRequest<T> {
  result: T | undefined = undefined;
  error: DOMException | null = null;
  readyState: "pending" | "done" = "pending";
  onsuccess: Handler = null;
  onerror: Handler = null;
  onblocked: Handler = null;
  onupgradeneeded: Handler = null;
  transaction: FakeTransaction | null = null;
}

class FakeCursor {
  constructor(
    readonly key: string,
    readonly value: unknown,
    private readonly advance: () => void,
  ) {}
  continue(): void {
    this.advance();
  }
}

class FakeObjectStore {
  constructor(
    private readonly tx: FakeTransaction,
    private readonly state: StoreState,
  ) {}

  put(value: unknown, key?: string): FakeRequest<string> {
    // DataCloneError / DataError are thrown synchronously by the real API too.
    const clone = cloneForIdb(value);
    let resolvedKey: unknown = key;
    if (this.state.keyPath !== null) {
      if (key !== undefined)
        throw domError("DataError", "key given for in-line store");
      resolvedKey = (clone as Record<string, unknown> | null)?.[
        this.state.keyPath
      ];
    } else if (key === undefined) {
      throw domError("DataError", "key required");
    }
    if (typeof resolvedKey !== "string") throw domError("DataError", "bad key");
    const finalKey = resolvedKey;
    return this.tx.enqueue(() => {
      this.state.data.set(finalKey, clone);
      return finalKey;
    }, "write");
  }

  get(key: string): FakeRequest<unknown> {
    return this.tx.enqueue(() => cloneForIdb(this.state.data.get(key)), "read");
  }

  delete(key: string): FakeRequest<undefined> {
    return this.tx.enqueue(() => {
      this.state.data.delete(key);
      return undefined;
    }, "write");
  }

  clear(): FakeRequest<undefined> {
    return this.tx.enqueue(() => {
      this.state.data.clear();
      return undefined;
    }, "write");
  }

  getAllKeys(): FakeRequest<string[]> {
    return this.tx.enqueue(() => [...this.state.data.keys()].sort(), "read");
  }

  openCursor(): FakeRequest<FakeCursor | null> {
    const keys = [...this.state.data.keys()].sort();
    let index = 0;
    const request = new FakeRequest<FakeCursor | null>();
    const step = (): void => {
      this.tx.deliver(
        request,
        () => {
          while (
            index < keys.length &&
            !this.state.data.has(keys[index] as string)
          )
            index++;
          if (index >= keys.length) return null;
          const key = keys[index] as string;
          return new FakeCursor(
            key,
            cloneForIdb(this.state.data.get(key)),
            () => {
              index++;
              this.tx.holdOpen();
              queueMicrotask(step);
            },
          );
        },
        "read",
      );
    };
    this.tx.holdOpen();
    queueMicrotask(step);
    return request;
  }
}

export class FakeTransaction {
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  error: DOMException | null = null;
  private pending = 0;
  private finished = false;
  private snapshot: Map<string, unknown> | null = null;

  constructor(
    private readonly connection: FakeConnection,
    private readonly storeName: string,
    readonly mode: IDBTransactionMode,
    private readonly controls: FakeIdbControls,
  ) {
    // A transaction with no requests commits as soon as control returns to the event loop.
    queueMicrotask(() => this.maybeComplete());
  }

  private get state(): StoreState {
    const state = this.connection.database.stores.get(this.storeName);
    if (!state) throw domError("NotFoundError", this.storeName);
    return state;
  }

  objectStore(name: string): FakeObjectStore {
    if (this.finished)
      throw domError("InvalidStateError", "transaction finished");
    if (name !== this.storeName) throw domError("NotFoundError", name);
    return new FakeObjectStore(this, this.state);
  }

  abort(): void {
    if (this.finished)
      throw domError("InvalidStateError", "transaction finished");
    this.rollback(null);
  }

  /** @internal keeps the transaction alive while a cursor still has rows to deliver. */
  holdOpen(): void {
    this.pending++;
  }

  /** @internal */
  enqueue<T>(run: () => T, kind: "read" | "write"): FakeRequest<T> {
    if (this.finished) throw domError("TransactionInactiveError");
    if (kind === "write" && this.mode === "readonly")
      throw domError("ReadOnlyError");
    const request = new FakeRequest<T>();
    this.pending++;
    queueMicrotask(() => this.deliver(request, run, kind));
    return request;
  }

  /** @internal runs one request and fires its success/error events. */
  deliver<T>(
    request: FakeRequest<T>,
    run: () => T,
    kind: "read" | "write",
  ): void {
    if (this.finished) return;
    try {
      const injected =
        kind === "write" ? this.controls.failWrites : this.controls.failReads;
      if (injected) throw injected;
      if (kind === "write" && this.snapshot === null)
        this.snapshot = new Map(this.state.data);
      request.result = run();
      request.readyState = "done";
      request.onsuccess?.(makeEvent("success", request));
    } catch (err) {
      request.error =
        err instanceof DOMException
          ? err
          : domError("UnknownError", String(err));
      request.readyState = "done";
      const event = makeEvent("error", request);
      request.onerror?.(event);
      this.onerror?.(event);
      if (!event.defaultPrevented) {
        this.pending--;
        this.rollback(request.error);
        return;
      }
    }
    this.pending--;
    queueMicrotask(() => this.maybeComplete());
  }

  private maybeComplete(): void {
    if (this.finished || this.pending > 0) return;
    this.finished = true;
    this.oncomplete?.(makeEvent("complete", this));
  }

  private rollback(error: DOMException | null): void {
    if (this.finished) return;
    this.finished = true;
    this.error = error;
    if (this.snapshot) {
      const state = this.state;
      state.data.clear();
      for (const [k, v] of this.snapshot) state.data.set(k, v);
    }
    // Real browsers fire abort asynchronously.
    queueMicrotask(() => this.onabort?.(makeEvent("abort", this)));
  }
}

export class FakeConnection {
  closed = false;
  onversionchange: Handler = null;
  onclose: Handler = null;
  onabort: Handler = null;
  onerror: Handler = null;

  constructor(
    private readonly factory: FakeIndexedDB,
    readonly name: string,
    readonly database: DatabaseState,
  ) {}

  readonly objectStoreNames = {
    contains: (name: string): boolean => this.database.stores.has(name),
  };

  createObjectStore(name: string, options?: { keyPath?: string }): void {
    if (this.database.stores.has(name)) throw domError("ConstraintError", name);
    this.database.stores.set(name, {
      keyPath: options?.keyPath ?? null,
      data: new Map(),
    });
  }

  transaction(
    storeNames: string | string[],
    mode: IDBTransactionMode = "readonly",
  ): FakeTransaction {
    const controls = this.factory.controls;
    const injected = controls.throwOnNextTransaction;
    if (injected) {
      controls.throwOnNextTransaction = null;
      throw injected;
    }
    if (this.closed)
      throw domError("InvalidStateError", "connection is closing");
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const first = names[0];
    if (first === undefined || names.length !== 1)
      throw domError("NotSupportedError");
    if (!this.database.stores.has(first))
      throw domError("NotFoundError", first);
    return new FakeTransaction(this, first, mode, controls);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.factory.openConnections.delete(this);
  }

  /** Test control: the browser kills the connection (storage cleared, evicted...). */
  forceClose(): void {
    this.close();
    this.onclose?.(makeEvent("close", this));
  }
}

export class FakeIndexedDB {
  readonly controls: FakeIdbControls = {
    openMode: "ok",
    openError: domError("InvalidStateError", "IndexedDB disabled"),
    failWrites: null,
    failReads: null,
    throwOnNextTransaction: null,
  };
  readonly openConnections = new Set<FakeConnection>();
  /** Number of `open()` calls so far. */
  openCalls = 0;
  private readonly databases = new Map<string, DatabaseState>();
  private blockedOpen: (() => void) | null = null;

  open(name: string, version = 1): FakeRequest<FakeConnection> {
    this.openCalls++;
    if (this.controls.openMode === "throw")
      throw domError("SecurityError", "denied");
    const request = new FakeRequest<FakeConnection>();
    const complete = (): void => {
      let database = this.databases.get(name);
      const isNew = database === undefined;
      if (database === undefined) {
        database = { version: 0, stores: new Map() };
        this.databases.set(name, database);
      }
      const connection = new FakeConnection(this, name, database);
      this.openConnections.add(connection);
      request.result = connection;
      if (isNew || database.version < version) {
        database.version = version;
        request.onupgradeneeded?.(makeEvent("upgradeneeded", request));
      }
      request.readyState = "done";
      request.onsuccess?.(makeEvent("success", request));
    };
    queueMicrotask(() => {
      switch (this.controls.openMode) {
        case "error":
          request.error = this.controls.openError;
          request.readyState = "done";
          request.onerror?.(makeEvent("error", request));
          return;
        case "blocked":
          request.onblocked?.(makeEvent("blocked", request));
          this.blockedOpen = complete;
          return;
        default:
          complete();
      }
    });
    return request;
  }

  /** Test control: a blocked open() finally goes through (the other tab closed). */
  unblock(): void {
    const finish = this.blockedOpen;
    this.blockedOpen = null;
    this.controls.openMode = "ok";
    finish?.();
  }

  /** Test control: another tab requests an upgrade; connections receive `versionchange`. */
  simulateVersionChange(): void {
    for (const connection of [...this.openConnections]) {
      connection.onversionchange?.(makeEvent("versionchange", connection));
    }
  }

  /** Test control: raw contents of a store (cloned), or undefined if it does not exist. */
  dump(dbName: string, storeName: string): Map<string, unknown> | undefined {
    const store = this.databases.get(dbName)?.stores.get(storeName);
    return store ? new Map(store.data) : undefined;
  }

  /** Test control: write a raw (possibly malformed) row, bypassing validation. */
  poke(dbName: string, storeName: string, key: string, value: unknown): void {
    const store = this.databases.get(dbName)?.stores.get(storeName);
    if (!store) throw new Error(`no store ${dbName}/${storeName}`);
    store.data.set(key, value);
  }

  /** The value to install as `globalThis.indexedDB`. */
  asFactory(): IDBFactory {
    // The fake implements only the used subset; the cast is the single, intentional lie.
    return this as unknown as IDBFactory;
  }
}

export function createFakeIndexedDB(): FakeIndexedDB {
  return new FakeIndexedDB();
}
