// src/studio/guide/shortcuts.ts
// The default keyboard shortcuts as the guide shows them (single source: defaultShortcuts()).
import { defaultShortcuts } from "../defaults";
import { MESSAGES, type Lang } from "../i18n/messages";
import { SHORTCUT_ACTIONS } from "../storage/shortcuts";

export interface GuideShortcut {
  keys: string;
  label: string;
}

const NAMES: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

export function prettyCombo(combo: string): string {
  return combo
    .split("+")
    .map((k) => NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k))
    .join("+");
}

export function guideShortcuts(lang: Lang): GuideShortcut[] {
  const map = defaultShortcuts();
  const msgs = MESSAGES[lang];
  const rows = SHORTCUT_ACTIONS.map((a) => ({
    keys: prettyCombo(map[a]),
    label: msgs[`action.${a}` as keyof typeof msgs],
  }));
  rows.push({
    keys: "1–9",
    label:
      lang === "tr"
        ? "Sahneye geç (sahne numarası)"
        : "Switch to scene (scene number)",
  });
  return rows;
}
