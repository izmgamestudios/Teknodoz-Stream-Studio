// src/studio/ui/adjust-controls.tsx
// Shared image-adjustment controls (see image-adjust.tsx for the Studio inspector wrapper).
import {
  ADJUST_PRESETS,
  buildFilter,
  DEFAULT_PARAMS,
  type FilterParams,
  isNeutral,
  normalizeFx,
  PARAM_RANGE,
  parseFilter,
  presetFilter,
} from "../engine/adjust";
import type { LayerFx } from "../types";
import { RangeInput } from "./fields";

interface Row {
  key: keyof FilterParams | keyof LayerFx;
  group: "filter" | "fx";
  label: string;
  unit: string;
  step: number;
  min: number;
  max: number;
  /** value shown when the layer has none */
  neutral: number;
}

const ROWS: readonly Row[] = [
  {
    key: "brightness",
    group: "filter",
    label: "Parlaklık",
    unit: "%",
    step: 1,
    ...r("brightness"),
  },
  {
    key: "contrast",
    group: "filter",
    label: "Kontrast",
    unit: "%",
    step: 1,
    ...r("contrast"),
  },
  {
    key: "saturate",
    group: "filter",
    label: "Doygunluk",
    unit: "%",
    step: 1,
    ...r("saturate"),
  },
  {
    key: "hue",
    group: "filter",
    label: "Ton (renk kaydır)",
    unit: "°",
    step: 1,
    ...r("hue"),
  },
  {
    key: "sharpen",
    group: "fx",
    label: "Netlik / keskinlik",
    unit: "",
    step: 1,
    min: 0,
    max: 100,
    neutral: 0,
  },
  {
    key: "blur",
    group: "filter",
    label: "Bulanıklık",
    unit: "px",
    step: 0.5,
    ...r("blur"),
  },
  {
    key: "warmth",
    group: "fx",
    label: "Sıcaklık (soğuk ⇄ sıcak)",
    unit: "",
    step: 1,
    min: -100,
    max: 100,
    neutral: 0,
  },
  {
    key: "vignette",
    group: "fx",
    label: "Vinyet (kenar karartma)",
    unit: "",
    step: 1,
    min: 0,
    max: 100,
    neutral: 0,
  },
  {
    key: "grayscale",
    group: "filter",
    label: "Siyah-beyaz",
    unit: "%",
    step: 1,
    ...r("grayscale"),
  },
  {
    key: "sepia",
    group: "filter",
    label: "Sepya",
    unit: "%",
    step: 1,
    ...r("sepia"),
  },
];

function r(k: keyof FilterParams) {
  const [min, max] = PARAM_RANGE[k];
  return { min, max, neutral: DEFAULT_PARAMS[k] };
}

export interface AdjustValue {
  filter: string;
  fx: LayerFx;
}

/**
 * Presets + sliders for brightness, contrast, saturation, hue, blur, sharpness, vignette and
 * warmth. Presentational: used by the Studio inspector (per layer) and the Classic studio (per scene).
 */
export function AdjustControls({
  filter,
  fx: fxIn,
  onChange,
}: {
  filter: string;
  fx: LayerFx | undefined;
  onChange: (next: AdjustValue, coalesceKey?: string) => void;
}) {
  const { params, rest } = parseFilter(filter);
  const fx = normalizeFx(fxIn);
  const neutral = isNeutral(params, fxIn);

  const setRow = (row: Row, v: number) => {
    const key = `adj:${row.key}`;
    if (row.group === "fx")
      onChange({ filter, fx: { ...fx, [row.key]: v } }, key);
    else
      onChange(
        { filter: buildFilter({ ...params, [row.key]: v }, rest), fx },
        key,
      );
  };

  const applyPreset = (id: string) => {
    const p = ADJUST_PRESETS.find((x) => x.id === id);
    if (p) onChange({ filter: presetFilter(p), fx: normalizeFx(p.fx) });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {ADJUST_PRESETS.map((p) => (
          <button
            key={p.id}
            className="rounded bg-secondary px-2 py-1 text-[11px] hover:bg-accent"
            onClick={() => applyPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {ROWS.map((row) => {
          const value =
            row.group === "fx"
              ? fx[row.key as keyof LayerFx]
              : params[row.key as keyof FilterParams];
          const changed = value !== row.neutral;
          return (
            <label key={row.key} className="block text-[11px]">
              <span className="flex justify-between">
                <span
                  className={
                    changed
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {row.label}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {Math.round(value * 10) / 10}
                  {row.unit}
                </span>
              </span>
              <RangeInput
                label={row.label}
                min={row.min}
                max={row.max}
                step={row.step}
                value={value}
                onChange={(v) => setRow(row, v)}
              />
            </label>
          );
        })}
      </div>
      <button
        className="w-full rounded-md bg-secondary px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-40"
        disabled={neutral}
        onClick={() =>
          onChange({
            filter: "none",
            fx: { sharpen: 0, vignette: 0, warmth: 0 },
          })
        }
      >
        Ayarları sıfırla
      </button>
    </div>
  );
}
