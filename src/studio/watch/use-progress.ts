// src/studio/watch/use-progress.ts
import { useSyncExternalStore } from "react";

import { allProgress, type ProgressMap } from "./progress";

let cache: { raw: string; value: ProgressMap } = { raw: "", value: {} };

function snapshot(): ProgressMap {
  // useSyncExternalStore needs a stable reference while nothing changed
  const raw = JSON.stringify(allProgress());
  if (raw !== cache.raw) cache = { raw, value: JSON.parse(raw) as ProgressMap };
  return cache.value;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener("studio-watch-progress", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("studio-watch-progress", cb);
    window.removeEventListener("storage", cb);
  };
}

const EMPTY: ProgressMap = {};

/** What this device has watched so far (re-renders when it changes). */
export function useProgress(): ProgressMap {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}
