// src/studio/sync/shared.ts
// Cross-tab / cross-UI data sync through same-origin localStorage (+ the "storage" event, which
// fires in every OTHER tab). Used by the main Studio and the Classic studio so a script typed in
// one shows up in the other, and scenes built in Classic can be handed to the main Studio.
// Everything here is SSR-safe (guards on window) and never throws (storage may be blocked).

export const SCRIPT_KEY = "studio.sync.script.v1";
export const HANDOFF_KEY = "studio.sync.handoff.v1";
export const MAX_SCRIPT_CHARS = 200_000;
export const MAX_HANDOFF_BYTES = 2_000_000;

export type SyncSource = "main" | "classic";

export interface ScriptMessage {
  text: string;
  /** epoch ms, last writer wins */
  at: number;
  from: SyncSource;
}

export interface Handoff {
  id: string;
  at: number;
  from: SyncSource;
  /** scene objects in the main Studio's format; validated again by the importer */
  scenes: unknown[];
}

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function parseScriptMessage(raw: string | null): ScriptMessage | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ScriptMessage> | null;
    if (!v || typeof v.text !== "string" || typeof v.at !== "number") return null;
    if (v.from !== "main" && v.from !== "classic") return null;
    return { text: v.text.slice(0, MAX_SCRIPT_CHARS), at: v.at, from: v.from };
  } catch {
    return null;
  }
}

export function readSharedScript(): ScriptMessage | null {
  return parseScriptMessage(store()?.getItem(SCRIPT_KEY) ?? null);
}

export function publishScript(text: string, from: SyncSource, at = Date.now()): boolean {
  const s = store();
  if (!s) return false;
  try {
    const msg: ScriptMessage = { text: text.slice(0, MAX_SCRIPT_CHARS), at, from };
    s.setItem(SCRIPT_KEY, JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

/** Calls `cb` when ANOTHER tab publishes a script. Returns an unsubscribe function. */
export function subscribeScript(cb: (m: ScriptMessage) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const on = (e: StorageEvent) => {
    if (e.key !== SCRIPT_KEY) return;
    const m = parseScriptMessage(e.newValue);
    if (m) cb(m);
  };
  window.addEventListener("storage", on);
  return () => window.removeEventListener("storage", on);
}

export function parseHandoff(raw: string | null): Handoff | null {
  if (!raw || raw.length > MAX_HANDOFF_BYTES) return null;
  try {
    const v = JSON.parse(raw) as Partial<Handoff> | null;
    if (!v || typeof v.id !== "string" || !Array.isArray(v.scenes)) return null;
    return {
      id: v.id,
      at: typeof v.at === "number" ? v.at : 0,
      from: v.from === "main" ? "main" : "classic",
      scenes: v.scenes.slice(0, 50),
    };
  } catch {
    return null;
  }
}

/** Queue scenes for the main Studio (picked up on its next start or immediately if open). */
export function sendHandoff(scenes: unknown[], from: SyncSource = "classic"): boolean {
  const s = store();
  if (!s || scenes.length === 0) return false;
  try {
    const h: Handoff = { id: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), from, scenes };
    const json = JSON.stringify(h);
    if (json.length > MAX_HANDOFF_BYTES) return false;
    s.setItem(HANDOFF_KEY, json);
    return true;
  } catch {
    return false;
  }
}

/** Reads and removes the pending handoff (so it is imported exactly once). */
export function takeHandoff(): Handoff | null {
  const s = store();
  if (!s) return null;
  try {
    const h = parseHandoff(s.getItem(HANDOFF_KEY));
    s.removeItem(HANDOFF_KEY);
    return h;
  } catch {
    return null;
  }
}

/** Calls `cb` when another tab queues a handoff. */
export function subscribeHandoff(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const on = (e: StorageEvent) => {
    if (e.key === HANDOFF_KEY && e.newValue) cb();
  };
  window.addEventListener("storage", on);
  return () => window.removeEventListener("storage", on);
}
