// src/studio/ui/image-adjust.tsx
// Camera / image adjustments for a layer: presets plus brightness, contrast, saturation, hue,
// blur, sharpness, vignette and warmth. Sliders edit the layer's CSS filter string and `fx`.
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
import type { Layer, LayerFx } from "../types";
import type { LayerPatch } from "../project/store";
import { RangeInput } from "./fields";

type Patch = (p: LayerPatch, key?: string) => boolean;

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

export function ImageAdjust({ layer, patch }: { layer: Layer; patch: Patch }) {
  const { params, rest } = parseFilter(layer.filter);
  const fx = normalizeFx(layer.fx);
  const neutral = isNeutral(params, layer.fx);

  const setRow = (row: Row, v: number) => {
    const key = `adj:${layer.id}:${row.key}`;
    if (row.group === "fx")
      patch({ fx: { [row.key]: v } as Partial<LayerFx> }, key);
    else patch({ filter: buildFilter({ ...params, [row.key]: v }, rest) }, key);
  };

  const applyPreset = (id: string) => {
    const p = ADJUST_PRESETS.find((x) => x.id === id);
    if (!p) return;
    patch({ filter: presetFilter(p), fx: normalizeFx(p.fx) });
  };

  return (
    <fieldset className="space-y-2 rounded-lg border p-2">
      <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Görüntü ayarları
      </legend>
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
          patch({ filter: "none", fx: { sharpen: 0, vignette: 0, warmth: 0 } })
        }
      >
        Ayarları sıfırla
      </button>
    </fieldset>
  );
}
