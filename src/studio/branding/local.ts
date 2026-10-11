// src/studio/branding/local.ts
// This browser's own brand overrides (UI fields only: name, slogan, badge, colors, radius, scale,
// logo). Stored in localStorage, validated on every read, applied to the DOM as CSS variables.
import { LOCAL_KEYS, parseBrandPatch, type Brand } from "./brand";
import { themeVars } from "./head";

const KEY = "tkz.brand.v1";

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadLocalBrand(
  s: StorageLike | null = storage(),
): Partial<Brand> {
  try {
    const raw = s?.getItem(KEY);
    if (!raw) return {};
    return parseBrandPatch(JSON.parse(raw), {
      allowData: true,
      only: LOCAL_KEYS,
    }).patch;
  } catch {
    return {};
  }
}

export function saveLocalBrand(
  patch: Partial<Brand>,
  s: StorageLike | null = storage(),
): void {
  try {
    const clean = parseBrandPatch(patch, {
      allowData: true,
      only: LOCAL_KEYS,
    }).patch;
    if (Object.keys(clean).length === 0) s?.removeItem(KEY);
    else s?.setItem(KEY, JSON.stringify(clean));
  } catch {
    // storage full or blocked: the override simply is not remembered
  }
}

const THEME_PROPS = [
  "--speaker-b",
  "--speaker-a",
  "--primary",
  "--primary-foreground",
  "--radius",
] as const;

/** Sync CSS variables and the root font size with `brand` (removes what no longer applies). */
export function applyThemeToDom(
  brand: Brand,
  root: HTMLElement = document.documentElement,
): void {
  const t = themeVars(brand);
  for (const p of THEME_PROPS) {
    const v = t.vars[p];
    if (v) root.style.setProperty(p, v);
    else root.style.removeProperty(p);
  }
  if (t.fontScalePercent !== null)
    root.style.fontSize = `${t.fontScalePercent}%`;
  else root.style.removeProperty("font-size");
}
