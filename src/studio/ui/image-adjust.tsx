// src/studio/ui/image-adjust.tsx
// Camera / image adjustments for a layer: sliders edit the layer's CSS filter string and `fx`.
import type { Layer } from "../types";
import type { LayerPatch } from "../project/store";
import { AdjustControls } from "./adjust-controls";

type Patch = (p: LayerPatch, key?: string) => boolean;

export function ImageAdjust({ layer, patch }: { layer: Layer; patch: Patch }) {
  return (
    <fieldset className="space-y-2 rounded-lg border p-2">
      <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Görüntü ayarları
      </legend>
      <AdjustControls
        filter={layer.filter}
        fx={layer.fx}
        onChange={(next, key) =>
          patch(
            { filter: next.filter, fx: next.fx },
            key ? `${key}:${layer.id}` : undefined,
          )
        }
      />
    </fieldset>
  );
}
