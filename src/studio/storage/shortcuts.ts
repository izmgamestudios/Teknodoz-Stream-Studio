// src/studio/storage/shortcuts.ts
// Key-combo normalization, matching and conflict detection. Pure logic, no DOM access at import.
//
// Canonical combo grammar:  [Ctrl+][Alt+][Shift+][Meta+]<Key>
//   - modifiers always in the order Ctrl, Alt, Shift, Meta
//   - <Key> is a named key (Space, Enter, Escape, ArrowUp, F1..F24, ...) or ONE character
//   - letters are lowercase when bare ("m") and uppercase with any modifier ("Shift+M"),
//     which is exactly how defaultShortcuts() spells them
//   - "" means "no shortcut" / "invalid"
import type { ShortcutAction, ShortcutMap } from "../types";

/** Every action, in the priority order used to break ties between conflicting bindings. */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  "record.toggle",
  "marker.add",
  "prompter.toggle",
  "prompter.speedUp",
  "prompter.speedDown",
  "prompter.rewind",
  "audio.muteMic",
  "scene.next",
  "scene.prev",
];

// Compile-time guard: adding an action to ShortcutAction without listing it above is an error.
type MissingAction = Exclude<ShortcutAction, (typeof SHORTCUT_ACTIONS)[number]>;
const exhaustive: [MissingAction] extends [never] ? true : never = true;
void exhaustive;

/** Structural subset of KeyboardEvent (also satisfied by React's synthetic KeyboardEvent). */
export interface KeyEventLike {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  readonly target?: EventTarget | null;
  getModifierState?(key: string): boolean;
}

type Modifier = "Ctrl" | "Alt" | "Shift" | "Meta";
const MODIFIER_ORDER: readonly Modifier[] = ["Ctrl", "Alt", "Shift", "Meta"];
/** Longest combo string we are willing to parse. */
const MAX_COMBO_LENGTH = 48;

// Maps (not object literals) so tokens like "constructor" never hit Object.prototype.
const MODIFIER_ALIASES = new Map<string, Modifier>([
  ["ctrl", "Ctrl"],
  ["control", "Ctrl"],
  ["ctl", "Ctrl"],
  ["alt", "Alt"],
  ["option", "Alt"],
  ["opt", "Alt"],
  ["shift", "Shift"],
  ["meta", "Meta"],
  ["cmd", "Meta"],
  ["command", "Meta"],
  ["win", "Meta"],
  ["windows", "Meta"],
  ["super", "Meta"],
]);

/** lowercase token -> canonical named key. */
const NAMED_KEYS = new Map<string, string>();
for (const name of [
  "Space",
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]) {
  NAMED_KEYS.set(name.toLowerCase(), name);
}
for (let n = 1; n <= 24; n++) NAMED_KEYS.set(`f${n}`, `F${n}`);
for (const [alias, name] of [
  ["spacebar", "Space"],
  ["esc", "Escape"],
  ["return", "Enter"],
  ["del", "Delete"],
  ["ins", "Insert"],
  ["pgup", "PageUp"],
  ["pgdn", "PageDown"],
  ["up", "ArrowUp"],
  ["down", "ArrowDown"],
  ["left", "ArrowLeft"],
  ["right", "ArrowRight"],
] as const) {
  NAMED_KEYS.set(alias, name);
}

/** `KeyboardEvent.key` values that are modifiers/IME state, never a shortcut key on their own. */
const NON_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "OS",
  "Super",
  "Hyper",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Fn",
  "FnLock",
  "Dead",
  "Unidentified",
  "Process",
  "Compose",
]);

function codePointLength(text: string): number {
  return Array.from(text).length;
}

function isUsableChar(ch: string): boolean {
  if (codePointLength(ch) !== 1) return false;
  const code = ch.codePointAt(0) ?? 0;
  // C0/C1 control characters are never a key; neither is whitespace (Space has its own name).
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false;
  return !/\s/u.test(ch);
}

/**
 * Case-folds a letter only when the round trip is lossless, so Turkish dotted/dotless i
 * ("i" / "ı" / "İ") never collapse into each other.
 */
function foldLetter(ch: string, upper: boolean): string {
  const target = upper ? ch.toUpperCase() : ch.toLowerCase();
  if (target === ch || codePointLength(target) !== 1) return ch;
  const back = upper ? target.toLowerCase() : target.toUpperCase();
  return back === ch ? target : ch;
}

function isAsciiAlnum(ch: string): boolean {
  return /^[A-Za-z0-9]$/.test(ch);
}

/* ------------------------------------------------------------------ */
/* normalizeCombo                                                      */
/* ------------------------------------------------------------------ */

function splitCombo(raw: string): { mods: string[]; key: string } | undefined {
  if (raw === "+") return { mods: [], key: "+" };
  let body = raw;
  let key: string | undefined;
  if (raw.endsWith("++")) {
    // "Ctrl++" : the key is the plus sign itself.
    key = "+";
    body = raw.slice(0, -2);
    if (body === "") return undefined;
  } else if (raw.endsWith("+")) {
    return undefined; // "Ctrl+" has no key
  }
  const tokens = body.split("+").map((t) => t.trim());
  if (key === undefined) {
    key = tokens.pop();
    if (key === undefined) return undefined;
  }
  return { mods: tokens, key };
}

function resolveKeyToken(token: string, hasModifiers: boolean): string {
  const lower = token.toLowerCase();
  if (lower === "plus") return "+";
  const named = NAMED_KEYS.get(lower);
  if (named) return named;
  if (!isUsableChar(token)) return "";
  return foldLetter(token, hasModifiers);
}

/**
 * Parses a user/stored combo into its canonical spelling ("shift + r" -> "Shift+R", "esc" ->
 * "Escape", "Cmd+K" -> "Meta+K"). Returns "" when the input is empty or not a valid combo.
 * Idempotent: normalizeCombo(normalizeCombo(x)) === normalizeCombo(x).
 */
export function normalizeCombo(input: string): string {
  if (typeof input !== "string") return "";
  if (input === " ") return "Space";
  const raw = input.trim();
  if (raw === "" || raw.length > MAX_COMBO_LENGTH) return "";
  const parts = splitCombo(raw);
  if (!parts) return "";
  const mods = new Set<Modifier>();
  for (const token of parts.mods) {
    const mod = MODIFIER_ALIASES.get(token.toLowerCase());
    if (!mod) return ""; // unknown modifier, or a second non-modifier key ("A+B")
    mods.add(mod);
  }
  if (MODIFIER_ALIASES.has(parts.key.toLowerCase())) return ""; // modifier-only combo
  const key = resolveKeyToken(parts.key, mods.size > 0);
  if (!key) return "";
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join("+");
}

/** True when `input` parses to a real combo (an empty string is NOT valid). */
export function isValidCombo(input: string): boolean {
  return normalizeCombo(input) !== "";
}

/* ------------------------------------------------------------------ */
/* eventToCombo / matchCombo                                           */
/* ------------------------------------------------------------------ */

function modifierState(e: KeyEventLike, name: string): boolean {
  try {
    return (
      typeof e.getModifierState === "function" &&
      e.getModifierState(name) === true
    );
  } catch {
    return false;
  }
}

function eventKeyToken(
  e: KeyEventLike,
  modified: boolean,
  hasAnyModifier: boolean,
): string {
  const key = e.key;
  if (key === " " || key === "Spacebar") return "Space";
  if (codePointLength(key) > 1) return NAMED_KEYS.get(key.toLowerCase()) ?? "";
  let ch = key;
  const code = typeof e.code === "string" ? e.code : "";
  const letterCode = /^Key([A-Z])$/.exec(code)?.[1];
  const digitCode = /^Digit([0-9])$/.exec(code)?.[1];
  if (
    digitCode !== undefined &&
    e.shiftKey &&
    !modified &&
    !/^[0-9]$/.test(ch)
  ) {
    // Shift+1 reports "!" on most layouts; users think of it as "Shift+1".
    ch = digitCode;
  } else if (modified && !isAsciiAlnum(ch)) {
    // macOS Option / non-Latin layouts report symbols or foreign letters under Alt/Ctrl/Meta:
    // fall back to the physical key so "Alt+S" stays "Alt+S".
    ch = letterCode ?? digitCode ?? ch;
  }
  if (!isUsableChar(ch)) return "";
  return foldLetter(ch, hasAnyModifier);
}

/**
 * Canonical combo for a keyboard event ("Shift+R", "Ctrl+Alt+K", "Space", "ArrowUp", "1", "[").
 * Returns "" for modifier-only presses, dead keys and unsupported keys.
 * AltGr (reported as Ctrl+Alt on Windows) is not counted as a modifier so "]" typed with AltGr+9
 * on a Turkish layout is just "]".
 */
export function eventToCombo(e: KeyEventLike): string {
  const key = e.key;
  if (typeof key !== "string" || key === "" || NON_KEYS.has(key)) return "";
  const altGr = modifierState(e, "AltGraph");
  const active = new Set<Modifier>();
  if (e.ctrlKey && !altGr) active.add("Ctrl");
  if (e.altKey && !altGr) active.add("Alt");
  if (e.shiftKey) active.add("Shift");
  if (e.metaKey) active.add("Meta");
  const modified =
    active.has("Ctrl") || active.has("Alt") || active.has("Meta");
  const token = eventKeyToken(e, modified, active.size > 0);
  if (!token) return "";
  return [...MODIFIER_ORDER.filter((m) => active.has(m)), token].join("+");
}

/** True when `e` is exactly the key combo `combo` (case/alias-insensitive). Empty combo never matches. */
export function matchCombo(e: KeyEventLike, combo: string): boolean {
  const wanted = normalizeCombo(combo);
  return wanted !== "" && eventToCombo(e) === wanted;
}

/* ------------------------------------------------------------------ */
/* Editable targets / resolveShortcut                                  */
/* ------------------------------------------------------------------ */

const EDITABLE_SELECTOR = [
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"][aria-autocomplete]',
].join(",");

/** True when typing in `target` should NOT trigger global shortcuts (input/textarea/select/contenteditable). */
export function isEditableTarget(
  target: EventTarget | null | undefined,
): boolean {
  if (!target) return false;
  let node = target as Node;
  // Text nodes can be event targets in some browsers: look at their element.
  if (node.nodeType === 3 && node.parentElement) node = node.parentElement;
  const el = node as Partial<HTMLElement>;
  if (typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable === true) return true;
  if (typeof el.closest === "function") {
    try {
      return el.closest(EDITABLE_SELECTOR) !== null;
    } catch {
      return false;
    }
  }
  return false;
}

export interface ResolveOptions {
  /** Let auto-repeating keydown events through (default false). */
  allowRepeat?: boolean;
  /** Fire even while typing in input/textarea/select/contenteditable (default false). */
  allowInEditable?: boolean;
}

/**
 * Which action (if any) does this keydown trigger? Returns null while typing in editable
 * targets, during IME composition, for auto-repeat (unless asked) and for unbound keys.
 * If two actions share a combo the earlier one in SHORTCUT_ACTIONS wins.
 */
export function resolveShortcut(
  e: KeyEventLike,
  map: ShortcutMap,
  options: ResolveOptions = {},
): ShortcutAction | null {
  if (e.isComposing === true || e.keyCode === 229) return null;
  if (e.repeat === true && options.allowRepeat !== true) return null;
  if (options.allowInEditable !== true && isEditableTarget(e.target))
    return null;
  const combo = eventToCombo(e);
  if (combo === "") return null;
  for (const action of SHORTCUT_ACTIONS) {
    const bound = map[action];
    if (typeof bound === "string" && normalizeCombo(bound) === combo)
      return action;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Conflicts                                                           */
/* ------------------------------------------------------------------ */

export interface ComboConflict<Id extends string = string> {
  /** Canonical combo shared by several ids. */
  combo: string;
  ids: Id[];
}

/** Groups ids that share the same (normalized) combo. Empty/invalid combos are ignored. */
export function findComboDuplicates<Id extends string>(
  entries: ReadonlyArray<readonly [Id, string]>,
): ComboConflict<Id>[] {
  const byCombo = new Map<string, Id[]>();
  for (const [id, raw] of entries) {
    const combo = normalizeCombo(raw);
    if (combo === "") continue;
    const ids = byCombo.get(combo);
    if (ids) ids.push(id);
    else byCombo.set(combo, [id]);
  }
  const out: ComboConflict<Id>[] = [];
  for (const [combo, ids] of byCombo)
    if (ids.length > 1) out.push({ combo, ids });
  return out;
}

/** Duplicate bindings inside a shortcut map, e.g. two actions both set to "m". */
export function findConflicts(
  map: ShortcutMap,
): ComboConflict<ShortcutAction>[] {
  const entries: Array<readonly [ShortcutAction, string]> = [];
  for (const action of SHORTCUT_ACTIONS) {
    const combo = map[action];
    if (typeof combo === "string") entries.push([action, combo]);
  }
  return findComboDuplicates(entries);
}
