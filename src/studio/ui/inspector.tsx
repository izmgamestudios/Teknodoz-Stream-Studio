// src/studio/ui/inspector.tsx
// Properties of the selected layer: common (opacity, blend, filter, transform), chroma key and
// kind-specific fields.
import { getActiveScene, findLayer, type LayerPatch } from "../project/store";
import { useProject, useStudio } from "../runtime/use-studio";
import type { BlendMode, Layer } from "../types";
import { LAYER_ICON, LAYER_KIND_LABEL } from "./actions";
import {
  Check,
  ColorInput,
  Field,
  INPUT,
  NumInput,
  PANEL,
  PanelTitle,
  RangeInput,
  SelectInput,
} from "./fields";
import { KindFields } from "./inspector-kinds";

const BLEND_OPTIONS: readonly { value: BlendMode; label: string }[] = [
  { value: "source-over", label: "Normal" },
  { value: "multiply", label: "Çarpma (multiply)" },
  { value: "screen", label: "Ekran (screen)" },
  { value: "overlay", label: "Bindirme (overlay)" },
  { value: "darken", label: "Koyulaştır" },
  { value: "lighten", label: "Açıklaştır" },
  { value: "color-dodge", label: "Color dodge" },
  { value: "color-burn", label: "Color burn" },
  { value: "hard-light", label: "Hard light" },
  { value: "soft-light", label: "Soft light" },
  { value: "difference", label: "Fark" },
  { value: "exclusion", label: "Dışlama" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Doygunluk" },
  { value: "color", label: "Renk" },
  { value: "luminosity", label: "Parlaklık" },
];

const FILTERS = [
  { value: "none", label: "Yok" },
  { value: "grayscale(1)", label: "Siyah-beyaz" },
  { value: "sepia(0.8)", label: "Sepya" },
  { value: "contrast(1.4) saturate(1.3)", label: "Kontrast" },
  { value: "sepia(0.3) saturate(1.5) hue-rotate(-10deg)", label: "Sıcak" },
  { value: "saturate(1.2) hue-rotate(20deg) brightness(1.05)", label: "Soğuk" },
  { value: "blur(4px)", label: "Bulanık" },
] as const;

const KEYABLE: ReadonlySet<Layer["kind"]> = new Set([
  "webcam",
  "screen",
  "video",
  "guest",
  "image",
  "web",
]);

export function Inspector({ selectedId }: { selectedId: string | null }) {
  const rt = useStudio();
  const project = useProject();
  const scene = getActiveScene(project);
  const found = selectedId ? findLayer(project, selectedId) : undefined;
  const layer = found && found.scene.id === scene.id ? found.layer : undefined;

  if (!layer) {
    return (
      <section className={PANEL} aria-label="Özellikler">
        <PanelTitle>Özellikler</PanelTitle>
        <p className="text-xs text-muted-foreground">
          Düzenlemek için sahnede veya katman listesinde bir katman seçin.
        </p>
      </section>
    );
  }

  const patch = (p: LayerPatch, key?: string) =>
    rt.project.updateLayer(scene.id, layer.id, p, key);
  const t = layer.transform;
  const filterKnown = FILTERS.some((f) => f.value === layer.filter);

  return (
    <section className={PANEL} aria-label="Özellikler">
      <PanelTitle>
        {LAYER_ICON[layer.kind]} {LAYER_KIND_LABEL[layer.kind]}
      </PanelTitle>
      <div className="space-y-3">
        <Field label="Ad">
          <input
            className={INPUT}
            value={layer.name}
            maxLength={120}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label={`Opaklık: %${Math.round(layer.opacity)}`}>
            <RangeInput
              label="Opaklık"
              min={0}
              max={100}
              value={layer.opacity}
              onChange={(opacity) => patch({ opacity })}
            />
          </Field>
          <Field label="Karışım modu">
            <SelectInput
              value={layer.blend}
              options={BLEND_OPTIONS}
              onChange={(blend) => patch({ blend })}
            />
          </Field>
          <div className="col-span-2">
            <Field label="Görüntü efekti">
              <select
                className={INPUT}
                value={filterKnown ? layer.filter : "custom"}
                onChange={(e) =>
                  e.target.value !== "custom" &&
                  patch({ filter: e.target.value })
                }
              >
                {FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
                {!filterKnown && <option value="custom">Özel</option>}
              </select>
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label="X">
            <NumInput
              value={t.x}
              step={10}
              onChange={(x) => patch({ transform: { x } })}
            />
          </Field>
          <Field label="Y">
            <NumInput
              value={t.y}
              step={10}
              onChange={(y) => patch({ transform: { y } })}
            />
          </Field>
          <Field label="Döndür °">
            <NumInput
              value={t.rotation}
              min={-360}
              max={360}
              onChange={(rotation) => patch({ transform: { rotation } })}
            />
          </Field>
          <Field label="Genişlik">
            <NumInput
              value={t.w}
              min={1}
              step={10}
              onChange={(w) => patch({ transform: { w } })}
            />
          </Field>
          <Field label="Yükseklik">
            <NumInput
              value={t.h}
              min={1}
              step={10}
              onChange={(h) => patch({ transform: { h } })}
            />
          </Field>
          <div className="flex items-end">
            <button
              className="w-full rounded-md bg-secondary px-2 py-1.5 text-xs hover:bg-accent"
              onClick={() =>
                patch({
                  transform: { x: 0, y: 0, w: 1920, h: 1080, rotation: 0 },
                })
              }
            >
              Tam ekran
            </button>
          </div>
        </div>

        <KindFields layer={layer} sceneId={scene.id} patch={patch} />

        {KEYABLE.has(layer.kind) && (
          <fieldset className="space-y-2 rounded-lg border p-2">
            <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Yeşil perde (chroma key)
            </legend>
            <Check
              checked={layer.chroma.enabled}
              onChange={(enabled) => patch({ chroma: { enabled } })}
            >
              Arka planı şeffaf yap
            </Check>
            {layer.chroma.enabled && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Anahtar renk">
                    <select
                      className={INPUT}
                      value={
                        layer.chroma.key === "green" ||
                        layer.chroma.key === "blue"
                          ? layer.chroma.key
                          : "custom"
                      }
                      onChange={(e) =>
                        patch({
                          chroma: {
                            key:
                              e.target.value === "custom"
                                ? "#00ff00"
                                : e.target.value,
                          },
                        })
                      }
                    >
                      <option value="green">Yeşil</option>
                      <option value="blue">Mavi</option>
                      <option value="custom">Özel renk</option>
                    </select>
                  </Field>
                  {layer.chroma.key !== "green" &&
                    layer.chroma.key !== "blue" && (
                      <Field label="Renk">
                        <ColorInput
                          value={layer.chroma.key}
                          onChange={(key) => patch({ chroma: { key } })}
                        />
                      </Field>
                    )}
                </div>
                <Field
                  label={`Benzerlik: ${layer.chroma.similarity.toFixed(2)}`}
                >
                  <RangeInput
                    label="Benzerlik"
                    min={0}
                    max={1}
                    step={0.01}
                    value={layer.chroma.similarity}
                    onChange={(similarity) => patch({ chroma: { similarity } })}
                  />
                </Field>
                <Field
                  label={`Yumuşaklık: ${layer.chroma.smoothness.toFixed(2)}`}
                >
                  <RangeInput
                    label="Yumuşaklık"
                    min={0}
                    max={1}
                    step={0.01}
                    value={layer.chroma.smoothness}
                    onChange={(smoothness) => patch({ chroma: { smoothness } })}
                  />
                </Field>
                <Field
                  label={`Yeşil yansıma: ${layer.chroma.spill.toFixed(2)}`}
                >
                  <RangeInput
                    label="Yansıma azaltma"
                    min={0}
                    max={1}
                    step={0.01}
                    value={layer.chroma.spill}
                    onChange={(spill) => patch({ chroma: { spill } })}
                  />
                </Field>
              </>
            )}
          </fieldset>
        )}
      </div>
    </section>
  );
}
