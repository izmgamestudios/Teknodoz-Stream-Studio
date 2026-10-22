// src/studio/i18n/overrides.ts
// Translation overrides fetched from the server (/api/i18n). They win over the built-in texts.
// Failure to load is silent: the built-in messages are always a complete fallback.
import { useSyncExternalStore } from "react";

export type Overrides = Record<string, Record<string, string>>;

let current: Overrides = {};
let version = 0;
const listeners = new Set<() => void>();

export function getOverrides(): Overrides {
  return current;
}

export function setOverrides(next: Overrides): void {
  current = next;
  version++;
  for (const l of [...listeners]) l();
}

/** Re-render subscribers when overrides change (bumps with every set). */
export function useOverridesVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => 0,
  );
}

function clean(raw: unknown): Overrides {
  const out: Overrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [lang, map] of Object.entries(raw as Record<string, unknown>)) {
    if (!map || typeof map !== "object") continue;
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(map as Record<string, unknown>))
      if (typeof v === "string" && v.length <= 4000) m[k] = v;
    out[lang] = m;
  }
  return out;
}

export async function loadOverrides(): Promise<void> {
  try {
    const res = await fetch("/api/i18n", { cache: "no-cache" });
    if (!res.ok) return;
    const data = (await res.json()) as { overrides?: unknown };
    setOverrides(clean(data.overrides));
  } catch {
    /* static hosting / offline: built-in texts only */
  }
}
