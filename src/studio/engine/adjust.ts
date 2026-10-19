// src/studio/engine/adjust.ts
// Image adjustments: structured sliders <-> the layer's CSS `filter` string (which stays the
// stored, sanitized source of truth), plus the presets shown in the inspector.
// Pure functions only (no DOM), so everything here is unit-tested.
import type { LayerFx } from "../types";

export interface FilterParams {
  /** all "percent" values: 100 = unchanged unless noted */
  brightness: number; // 0..200
  contrast: number; // 0..200
  saturate: number; // 0..300
  hue: number; // -180..180 degrees, 0 = unchanged
  blur: number; // 0..20 px, 0 = unchanged
  grayscale: number; // 0..100, 0 = unchanged
  sepia: number; // 0..100, 0 = unchanged
  invert: number; // 0..100, 0 = unchanged
}

export const DEFAULT_PARAMS: Readonly<FilterParams> = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hue: 0,
  blur: 0,
  grayscale: 0,
  sepia: 0,
  invert: 0,
};

export const DEFAULT_FX: Readonly<LayerFx> = {
  sharpen: 0,
  vignette: 0,
  warmth: 0,
};

export const PARAM_RANGE: Readonly<
  Record<keyof FilterParams, readonly [number, number]>
> = {
  brightness: [0, 200],
  contrast: [0, 200],
  saturate: [0, 300],
  hue: [-180, 180],
  blur: [0, 20],
  grayscale: [0, 100],
  sepia: [0, 100],
  invert: [0, 100],
};

const clamp = (n: number, [lo, hi]: readonly [number, number]) =>
  Math.min(hi, Math.max(lo, n));
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Functions this module understands, in the order they are written. */
const ORDER: readonly (keyof FilterParams)[] = [
  "brightness",
  "contrast",
  "saturate",
  "hue",
  "grayscale",
  "sepia",
  "invert",
  "blur",
];

const FN_NAME: Record<keyof FilterParams, string> = {
  brightness: "brightness",
  contrast: "contrast",
  saturate: "saturate",
  hue: "hue-rotate",
  blur: "blur",
  grayscale: "grayscale",
  sepia: "sepia",
  invert: "invert",
};

const KEY_BY_FN: Record<string, keyof FilterParams> = Object.fromEntries(
  Object.entries(FN_NAME).map(([k, v]) => [v, k as keyof FilterParams]),
);

/** Reads `name(arg)` groups; unknown functions (e.g. drop-shadow) are kept verbatim in `rest`. */
export function parseFilter(filter: string): {
  params: FilterParams;
  rest: string;
} {
  const params: FilterParams = { ...DEFAULT_PARAMS };
  const rest: string[] = [];
  const s = filter.trim();
  if (s === "" || s === "none") return { params, rest: "" };
  const re = /([a-z-]+)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gi;
  for (const m of s.matchAll(re)) {
    const name = (m[1] ?? "").toLowerCase();
    const arg = (m[2] ?? "").trim();
    const key = KEY_BY_FN[name];
    if (!key) {
      rest.push(m[0]);
      continue;
    }
    const num = parseFloat(arg);
    if (!Number.isFinite(num)) continue;
    if (key === "hue")
      params.hue = clamp(
        arg.endsWith("rad") ? (num * 180) / Math.PI : num,
        PARAM_RANGE.hue,
      );
    else if (key === "blur") params.blur = clamp(num, PARAM_RANGE.blur);
    else
      params[key] = clamp(
        arg.endsWith("%") ? num : num * 100,
        PARAM_RANGE[key],
      );
  }
  return { params, rest: rest.join(" ") };
}

/** Builds a sanitizer-safe filter string; defaults are omitted; "none" when nothing changes. */
export function buildFilter(params: Partial<FilterParams>, rest = ""): string {
  const p: FilterParams = { ...DEFAULT_PARAMS, ...params };
  const parts: string[] = [];
  for (const key of ORDER) {
    const v = clamp(p[key], PARAM_RANGE[key]);
    if (v === DEFAULT_PARAMS[key]) continue;
    if (key === "hue") parts.push(`hue-rotate(${round(v, 1)}deg)`);
    else if (key === "blur") parts.push(`blur(${round(v, 1)}px)`);
    else parts.push(`${FN_NAME[key]}(${round(v / 100)})`);
  }
  // the sanitizer accepts at most 8 functions: unknown extras only fit if there is room
  const extra = rest.trim();
  const out = extra && parts.length < 8 ? [...parts, extra] : parts;
  return out.length ? out.join(" ") : "none";
}

export const isNeutral = (p: FilterParams, fx: LayerFx | undefined): boolean =>
  ORDER.every((k) => p[k] === DEFAULT_PARAMS[k]) &&
  (!fx || (fx.sharpen === 0 && fx.vignette === 0 && fx.warmth === 0));

export function normalizeFx(fx: Partial<LayerFx> | undefined): LayerFx {
  return {
    sharpen: clamp(fx?.sharpen ?? 0, [0, 100]),
    vignette: clamp(fx?.vignette ?? 0, [0, 100]),
    warmth: clamp(fx?.warmth ?? 0, [-100, 100]),
  };
}

export const hasFx = (fx: LayerFx | undefined): fx is LayerFx =>
  !!fx && (fx.sharpen > 0 || fx.vignette > 0 || fx.warmth !== 0);

export interface AdjustPreset {
  id: string;
  label: string;
  params: Partial<FilterParams>;
  fx?: Partial<LayerFx>;
}

export const ADJUST_PRESETS: readonly AdjustPreset[] = [
  { id: "none", label: "Doğal", params: {} },
  {
    id: "bright",
    label: "Aydınlık",
    params: { brightness: 115, contrast: 105, saturate: 108 },
    fx: { sharpen: 15 },
  },
  {
    id: "vivid",
    label: "Canlı",
    params: { contrast: 115, saturate: 140 },
    fx: { sharpen: 25 },
  },
  {
    id: "cinema",
    label: "Sinema",
    params: { contrast: 118, saturate: 90, brightness: 96 },
    fx: { vignette: 35, warmth: 12 },
  },
  {
    id: "podcast",
    label: "Podcast",
    params: { contrast: 108, saturate: 105, brightness: 104 },
    fx: { sharpen: 20, warmth: 8 },
  },
  {
    id: "soft",
    label: "Yumuşak",
    params: { brightness: 106, contrast: 94, saturate: 104, blur: 0.6 },
    fx: { warmth: 10 },
  },
  {
    id: "warm",
    label: "Sıcak",
    params: { saturate: 118, hue: -6 },
    fx: { warmth: 45 },
  },
  {
    id: "cool",
    label: "Soğuk",
    params: { saturate: 108, hue: 8 },
    fx: { warmth: -45 },
  },
  {
    id: "retro",
    label: "Retro",
    params: { sepia: 45, contrast: 118, saturate: 82, brightness: 96 },
    fx: { vignette: 40 },
  },
  {
    id: "noir",
    label: "Siyah-beyaz",
    params: { grayscale: 100, contrast: 125 },
    fx: { vignette: 30, sharpen: 20 },
  },
  {
    id: "night",
    label: "Gece",
    params: { brightness: 118, contrast: 110, saturate: 92 },
    fx: { sharpen: 18, warmth: -15 },
  },
  {
    id: "lowlight",
    label: "Loş ışık",
    params: { brightness: 130, contrast: 112, saturate: 108 },
    fx: { sharpen: 30 },
  },
];

export const presetFilter = (p: AdjustPreset): string => buildFilter(p.params);
