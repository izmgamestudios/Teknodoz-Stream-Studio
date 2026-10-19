// src/studio/pwa/register.ts
// Service worker lifecycle. Production only: in development a stale worker would hide changes, so
// any existing one is removed instead.

export const SW_URL = "/sw.js";

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

export async function unregisterServiceWorkers(): Promise<void> {
  if (!serviceWorkerSupported()) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    // blocked by browser settings: nothing to clean up
  }
}

/** Register `/sw.js` after load (so it never competes with the first render). */
export function registerServiceWorker(prod: boolean): void {
  if (!serviceWorkerSupported()) return;
  if (!prod) {
    void unregisterServiceWorkers();
    return;
  }
  const go = () => {
    navigator.serviceWorker.register(SW_URL, { scope: "/" }).catch(() => {
      // http (not localhost), private mode or a blocked worker: the site works without it
    });
  };
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}
