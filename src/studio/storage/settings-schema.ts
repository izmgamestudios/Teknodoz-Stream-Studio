// src/studio/storage/settings-schema.ts
// zod schemas that REPAIR (not reject) persisted settings: every field is validated on its own, so
// one bad value falls back to its default / is clamped instead of discarding the whole object.
import { z } from "zod";
import { defaultSettings } from "../defaults";
import type { AppSettings, OutputSettings, ShortcutAction } from "../types";
import { normalizeCombo } from "./shortcuts";

/** Inclusive ranges the output settings are clamped to. Width/height are kept even (encoders). */
export const OUTPUT_LIMITS = {
  width: { min: 320, max: 7680 },
  height: { min: 240, max: 4320 },
  fps: { min: 5, max: 120 },
  videoBitrate: { min: 250_000, max: 100_000_000 },
  audioBitrate: { min: 32_000, max: 512_000 },
} as const;

// Pure data, safe to compute at import time (no browser APIs).
const DEFAULTS = defaultSettings();

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const asRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "" && value.length <= 24) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Number field: non-numbers -> default; numbers are rounded to `step` and clamped to [min, max]. */
function clampedNumber(fallback: number, min: number, max: number, step = 1) {
  return z.unknown().transform((value): number => {
    const n = toFiniteNumber(value);
    if (n === undefined) return fallback;
    const snapped = Math.round(n / step) * step;
    return Math.min(max, Math.max(min, snapped));
  });
}

function booleanField(fallback: boolean) {
  return z
    .unknown()
    .transform((value): boolean =>
      typeof value === "boolean" ? value : fallback,
    );
}

const containerField = z
  .unknown()
  .transform((value): OutputSettings["container"] =>
    value === "auto" || value === "mp4" || value === "webm"
      ? value
      : DEFAULTS.output.container,
  );

export const outputSchema = z.preprocess(
  asRecord,
  z.object({
    width: clampedNumber(
      DEFAULTS.output.width,
      OUTPUT_LIMITS.width.min,
      OUTPUT_LIMITS.width.max,
      2,
    ),
    height: clampedNumber(
      DEFAULTS.output.height,
      OUTPUT_LIMITS.height.min,
      OUTPUT_LIMITS.height.max,
      2,
    ),
    fps: clampedNumber(
      DEFAULTS.output.fps,
      OUTPUT_LIMITS.fps.min,
      OUTPUT_LIMITS.fps.max,
    ),
    videoBitrate: clampedNumber(
      DEFAULTS.output.videoBitrate,
      OUTPUT_LIMITS.videoBitrate.min,
      OUTPUT_LIMITS.videoBitrate.max,
      1000,
    ),
    audioBitrate: clampedNumber(
      DEFAULTS.output.audioBitrate,
      OUTPUT_LIMITS.audioBitrate.min,
      OUTPUT_LIMITS.audioBitrate.max,
      1000,
    ),
    container: containerField,
    usePublicStun: booleanField(DEFAULTS.output.usePublicStun),
  }),
);

/**
 * One shortcut: "" keeps the action unassigned, a valid combo is normalized, anything else
 * (wrong type, unparsable, unknown key name) is replaced by the action's default.
 */
function comboField(action: ShortcutAction) {
  const fallback = DEFAULTS.shortcuts[action];
  return z.unknown().transform((value): string => {
    if (typeof value !== "string") return fallback;
    if (value === "") return "";
    const normalized = normalizeCombo(value);
    return normalized === "" ? fallback : normalized;
  });
}

// Listed explicitly (not generated) so TypeScript proves every ShortcutAction is covered.
export const shortcutsSchema = z.preprocess(
  asRecord,
  z.object({
    "record.toggle": comboField("record.toggle"),
    "marker.add": comboField("marker.add"),
    "prompter.toggle": comboField("prompter.toggle"),
    "prompter.speedUp": comboField("prompter.speedUp"),
    "prompter.speedDown": comboField("prompter.speedDown"),
    "prompter.rewind": comboField("prompter.rewind"),
    "audio.muteMic": comboField("audio.muteMic"),
    "scene.next": comboField("scene.next"),
    "scene.prev": comboField("scene.prev"),
  }),
);

export const langSchema = z
  .unknown()
  .transform((value): AppSettings["lang"] =>
    value === "tr" || value === "en" ? value : DEFAULTS.lang,
  );

export const settingsSchema = z.preprocess(
  asRecord,
  z.object({
    output: outputSchema,
    shortcuts: shortcutsSchema,
    lang: langSchema,
  }),
);

/** Merge arbitrary input over the defaults, repairing/clamping every invalid field. Never throws. */
export function parseSettings(raw: unknown): AppSettings {
  const result = settingsSchema.safeParse(raw);
  return result.success ? result.data : defaultSettings();
}

/** Deep copy of a settings object (plain data only). */
export function cloneSettings(settings: AppSettings): AppSettings {
  return {
    output: { ...settings.output },
    shortcuts: { ...settings.shortcuts },
    lang: settings.lang,
  };
}
