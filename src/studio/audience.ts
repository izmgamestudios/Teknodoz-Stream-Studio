// src/studio/audience.ts
// "Who are you?" choice shown on first visit. Viewers get the end-user pages only (watch,
// community, download); creators get the whole studio. Stored per device; it only changes which
// navigation is shown, it is not an access control.
import { useSyncExternalStore } from "react";

export type Audience = "viewer" | "creator";

export const AUDIENCE_STORAGE_KEY = "studio.audience.v1";

/** Routes a viewer sees in the navigation. */
export const VIEWER_ROUTES: readonly string[] = [
  "/watch",
  "/community",
  "/download",
];

const listeners = new Set<() => void>();

export function parseAudience(raw: unknown): Audience | null {
  return raw === "viewer" || raw === "creator" ? raw : null;
}

export function getAudience(): Audience | null {
  try {
    return parseAudience(localStorage.getItem(AUDIENCE_STORAGE_KEY));
  } catch {
    return null;
  }
}

let memory: Audience | null = null;

export function setAudience(a: Audience): void {
  memory = a;
  try {
    localStorage.setItem(AUDIENCE_STORAGE_KEY, a);
  } catch {
    /* private mode: the choice lasts for this page view */
  }
  for (const l of [...listeners]) l();
}

function snapshot(): Audience | null {
  return getAudience() ?? memory;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** `undefined` during SSR / hydration, `null` = never chosen. */
export function useAudience(): Audience | null | undefined {
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}
