// src/studio/pwa/use-install.ts
// "Install app" state: the browser's install prompt (Chromium), standalone detection, and the
// detected platform / browser. Everything browser-specific is read after mount (SSR-safe).
import { useCallback, useEffect, useState } from "react";

import {
  detectBrowser,
  detectPlatform,
  type BrowserId,
  type PlatformId,
} from "./platform";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallState {
  /** false until mounted in the browser */
  ready: boolean;
  platform: PlatformId;
  browser: BrowserId;
  /** running as an installed app right now */
  standalone: boolean;
  /** the browser offers a one-click install */
  canPrompt: boolean;
  /** just installed through the prompt */
  installed: boolean;
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: window-controls-overlay)").matches ===
      true ||
    nav.standalone === true
  );
}

export function useInstall(): InstallState {
  const [ready, setReady] = useState(false);
  const [platform, setPlatform] = useState<PlatformId>("other");
  const [browser, setBrowser] = useState<BrowserId>("other");
  const [standalone, setStandalone] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );

  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent, navigator.maxTouchPoints));
    setBrowser(detectBrowser(navigator.userAgent));
    setStandalone(isStandalone());
    setReady(true);
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep it for our own button
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return "unavailable" as const;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null); // a prompt can only be used once
    return outcome;
  }, [deferred]);

  return {
    ready,
    platform,
    browser,
    standalone,
    canPrompt: deferred !== null,
    installed,
    install,
  };
}
