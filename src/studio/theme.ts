// src/studio/theme.ts
// Light / dark / system theme. Stored per device; `THEME_BOOT_SCRIPT` runs in <head> before
// first paint so there is no flash. Dark is the default token set in styles.css; light
// overrides it under :root[data-theme="light"].
import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "studio.theme.v1";

export const THEME_BOOT_SCRIPT = `try{var c=localStorage.getItem("${THEME_STORAGE_KEY}");var l=c==="light"||(c!=="dark"&&matchMedia("(prefers-color-scheme: light)").matches);document.documentElement.dataset.theme=l?"light":"dark"}catch(e){}`;

const listeners = new Set<() => void>();

export function parseTheme(raw: unknown): ThemeChoice {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function getTheme(): ThemeChoice {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function resolveTheme(
  choice: ThemeChoice,
  prefersLight: boolean,
): "light" | "dark" {
  return choice === "system" ? (prefersLight ? "light" : "dark") : choice;
}

export function applyTheme(choice: ThemeChoice): void {
  if (typeof document === "undefined") return;
  const light =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: light)").matches;
  document.documentElement.dataset["theme"] = resolveTheme(choice, light);
}

export function setTheme(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* storage unavailable: applies for this page only */
  }
  applyTheme(choice);
  for (const l of [...listeners]) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const mq =
    typeof matchMedia === "function"
      ? matchMedia("(prefers-color-scheme: light)")
      : null;
  const onMq = () => {
    if (getTheme() === "system") applyTheme("system");
  };
  mq?.addEventListener("change", onMq);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    mq?.removeEventListener("change", onMq);
    window.removeEventListener("storage", cb);
  };
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const c = useSyncExternalStore(subscribe, getTheme, () => "system" as const);
  return [c, setTheme];
}
