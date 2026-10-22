// src/studio/i18n/use-t.ts
import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  getSettingsSnapshot,
  subscribeSettings,
  SETTINGS_STORAGE_KEY,
} from "../storage/settings";
import {
  contentLang,
  translate,
  type ContentLang,
  type Lang,
  type MessageKey,
} from "./messages";

/** Browser language when the user never chose one (guests on their own device). */
export function detectLang(): Lang {
  if (typeof navigator === "undefined") return "tr";
  const l = (navigator.language || "tr").toLowerCase();
  if (l.startsWith("tr")) return "tr";
  if (l.startsWith("de")) return "de";
  if (l.startsWith("es")) return "es";
  return "en";
}

function hasStoredChoice(): boolean {
  try {
    return localStorage.getItem(SETTINGS_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function currentLang(): Lang {
  const s = getSettingsSnapshot();
  return hasStoredChoice() ? s.lang : detectLang();
}

export function useLang(): Lang {
  const lang = useSyncExternalStore(
    subscribeSettings,
    currentLang,
    () => "tr" as Lang,
  );
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return lang;
}

export function useT(): (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string {
  const lang = useLang();
  return useCallback((key, vars) => translate(lang, key, vars), [lang]);
}

/** tr for Turkish, en for every other language (long-form content has no de/es yet). */
export function useContentLang(): ContentLang {
  return contentLang(useLang());
}
