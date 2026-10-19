// src/studio/storage/autosave.ts
// Debounced project autosave on top of a KvStore. Never throws: failures go to `onError`.
// The stored value is the project object itself (wrapped in a tiny envelope carrying the save
// time); the caller must validate whatever `loadLatest()` returns.
import type { KvStore, ProjectState } from "../types";
import { StorageError, toStorageError } from "./errors";

export const AUTOSAVE_KEY = "project:autosave";
export const AUTOSAVE_DELAY_MS = 800;
/** Upper bound on how long continuous edits may postpone a save. */
export const AUTOSAVE_MAX_WAIT_MS = 5000;

const ENVELOPE_MARK = "__tkzAutosave";

export interface AutosaverOptions {
  /** Called with every save/load failure (a StorageError, "quota" when the disk is full). */
  onError?: (error: StorageError) => void;
  /** Called after each successful write with its timestamp (ms since epoch). */
  onSaved?: (savedAt: number) => void;
  /** Max time continuous schedule() calls can delay a write. Default 5000, never below delayMs. */
  maxWaitMs?: number;
}

export interface AutosaveSnapshot {
  /** Unvalidated stored project (validate/migrate before use). */
  project: unknown;
  /** When it was saved, if known (older/foreign values carry no timestamp). */
  savedAt: number | undefined;
}

export interface Autosaver {
  /** Queue `project` for saving; the latest call within the debounce window wins. */
  schedule(project: ProjectState): void;
  /** Write any pending project now and wait for all in-flight writes. Never rejects. */
  flush(): Promise<void>;
  /** The last persisted project (unvalidated), or undefined if none / on error. */
  loadLatest(): Promise<unknown | undefined>;
  /** Like loadLatest() but with the save timestamp. */
  loadLatestMeta(): Promise<AutosaveSnapshot | undefined>;
  /** Drop the pending (unsaved) project without writing it. */
  cancel(): void;
  /** Cancel pending work and delete the stored autosave. Never rejects. */
  clear(): Promise<void>;
  /** True while a scheduled save has not been written yet. */
  hasPending(): boolean;
}

function unwrap(raw: unknown): AutosaveSnapshot | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (
    typeof raw === "object" &&
    (raw as Record<string, unknown>)[ENVELOPE_MARK] === 1
  ) {
    const env = raw as Record<string, unknown>;
    if (env["project"] === undefined || env["project"] === null)
      return undefined;
    const savedAt = env["savedAt"];
    return {
      project: env["project"],
      savedAt:
        typeof savedAt === "number" && Number.isFinite(savedAt)
          ? savedAt
          : undefined,
    };
  }
  // Value written without our envelope: hand it over as-is.
  return { project: raw, savedAt: undefined };
}

function sanitizeDelay(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function createAutosaver(
  kv: KvStore,
  key: string = AUTOSAVE_KEY,
  delayMs: number = AUTOSAVE_DELAY_MS,
  options: AutosaverOptions = {},
): Autosaver {
  const delay = sanitizeDelay(delayMs, AUTOSAVE_DELAY_MS);
  const maxWait = Math.max(
    delay,
    sanitizeDelay(
      options.maxWaitMs ?? AUTOSAVE_MAX_WAIT_MS,
      AUTOSAVE_MAX_WAIT_MS,
    ),
  );

  let pending: ProjectState | undefined;
  let hasPendingValue = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** When the oldest unsaved change was scheduled (drives maxWait). */
  let firstScheduledAt: number | undefined;
  /** Serializes writes so an older snapshot can never land after a newer one. */
  let chain: Promise<void> = Promise.resolve();

  function report(err: unknown): void {
    try {
      options.onError?.(toStorageError(err, "io"));
    } catch {
      /* a throwing error handler must not break autosave */
    }
  }

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function drop(): void {
    clearTimer();
    pending = undefined;
    hasPendingValue = false;
    firstScheduledAt = undefined;
  }

  function startWrite(): Promise<void> {
    if (!hasPendingValue) return chain;
    const project = pending;
    drop();
    chain = chain.then(async () => {
      const savedAt = Date.now();
      try {
        await kv.set(key, { [ENVELOPE_MARK]: 1, savedAt, project });
      } catch (err) {
        report(err);
        return;
      }
      try {
        options.onSaved?.(savedAt);
      } catch {
        /* ignore listener failures */
      }
    });
    return chain;
  }

  function schedule(project: ProjectState): void {
    try {
      if (typeof project !== "object" || project === null) {
        report(new StorageError("invalid", "Geçersiz proje"));
        return;
      }
      pending = project;
      hasPendingValue = true;
      const now = Date.now();
      firstScheduledAt ??= now;
      clearTimer();
      const wait = Math.max(
        0,
        Math.min(delay, firstScheduledAt + maxWait - now),
      );
      timer = setTimeout(() => {
        timer = undefined;
        void startWrite();
      }, wait);
    } catch (err) {
      report(err);
    }
  }

  async function flush(): Promise<void> {
    try {
      await startWrite();
    } catch (err) {
      report(err);
    }
  }

  async function loadLatestMeta(): Promise<AutosaveSnapshot | undefined> {
    try {
      await chain; // let in-flight writes land first so we read our own latest save
      return unwrap(await kv.get(key));
    } catch (err) {
      report(err);
      return undefined;
    }
  }

  async function loadLatest(): Promise<unknown | undefined> {
    return (await loadLatestMeta())?.project;
  }

  async function clear(): Promise<void> {
    drop();
    try {
      await chain;
      await kv.delete(key);
    } catch (err) {
      report(err);
    }
  }

  return {
    schedule,
    flush,
    loadLatest,
    loadLatestMeta,
    cancel: drop,
    clear,
    hasPending: () => hasPendingValue,
  };
}

/**
 * Flushes `autosaver` when the page is hidden or being closed (pagehide / visibilitychange).
 * Returns a function that removes the listeners. No-op outside the browser.
 */
export function flushOnPageHide(
  autosaver: Pick<Autosaver, "flush">,
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined")
    return () => {};
  const onHide = (): void => {
    void autosaver.flush();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") onHide();
  };
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
