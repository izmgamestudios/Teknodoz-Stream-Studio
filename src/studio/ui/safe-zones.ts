// src/studio/ui/safe-zones.ts
// "Show safe zones" preference (editor-only overlay, never drawn into the output).
import { useSyncExternalStore } from "react";

const KEY = "studio.safeZones.v1";
const EVT = "tkd-safezones";

export function getSafeZones(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSafeZones(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new Event(EVT));
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
};

export const useSafeZones = (): boolean =>
  useSyncExternalStore(subscribe, getSafeZones, () => false);
