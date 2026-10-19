// src/studio/ui/template-preview.tsx
// Cheap CSS preview of a template: renders the *same* layers the scene would get
// (see templates/build.ts), so what you pick is what you get.
import { useMemo, type CSSProperties } from "react";

import { buildTemplateScene } from "../templates/build";
import type { TemplateDef, TemplateOptions } from "../templates/types";
import type { Layer } from "../types";
import { LOGICAL_H, LOGICAL_W } from "../types";

type Stage = { w: number; h: number };

const PANEL_ICON = {
  webcam: "📷",
  guest: "👤",
  screen: "🖥",
  web: "📱",
} as const;

function pct(v: number, total: number): string {
  return `${((v / total) * 100).toFixed(3)}%`;
}

function cqw(px: number, stage: Stage): string {
  return `${((px / stage.w) * 100).toFixed(3)}cqw`;
}

function boxStyle(l: Layer, stage: Stage): CSSProperties {
  const t = l.transform;
  return {
    position: "absolute",
    left: pct(t.x, stage.w),
    top: pct(t.y, stage.h),
    width: pct(t.w, stage.w),
    height: pct(t.h, stage.h),
  };
}

function backdropStyle(accent: string): CSSProperties {
  return {
    backgroundImage: [
      "radial-gradient(rgba(255,255,255,0.28) 1px, transparent 1.6px)",
      `radial-gradient(circle at 88% 10%, ${accent}99, transparent 60%)`,
      `radial-gradient(circle at 8% 95%, ${accent}55, transparent 50%)`,
      "linear-gradient(135deg, #050813, #0b1430)",
    ].join(", "),
    backgroundSize: "7px 7px, auto, auto, auto",
  };
}

function PreviewLayer({
  layer,
  urls,
  stage,
}: {
  layer: Layer;
  stage: Stage;
  urls?: Readonly<Record<string, string>>;
}) {
  switch (layer.kind) {
    case "image": {
      const url = urls?.[layer.assetId];
      if (!url) return null; // generated backdrop is drawn with CSS
      return (
        <img
          src={url}
          alt=""
          style={{
            ...boxStyle(layer, stage),
            objectFit: layer.fit === "cover" ? "cover" : "contain",
          }}
        />
      );
    }
    case "webcam":
    case "guest":
    case "screen":
    case "web":
      return (
        <div
          style={{
            ...boxStyle(layer, stage),
            background:
              "linear-gradient(160deg, rgba(120,140,200,0.35), rgba(40,50,90,0.55))",
            fontSize: cqw(layer.transform.h > 400 ? 56 : 36, stage),
          }}
          className="flex flex-col items-center justify-center text-white/80"
        >
          <span>{PANEL_ICON[layer.kind]}</span>
        </div>
      );
    case "shape":
      return (
        <div
          style={{
            ...boxStyle(layer, stage),
            background: layer.fill,
            border:
              layer.strokeWidth > 0
                ? `${cqw(layer.strokeWidth, stage)} solid ${layer.stroke}`
                : undefined,
            boxSizing: "border-box",
            color: layer.textColor,
            fontSize: cqw(Math.min(40, layer.transform.h * 0.3), stage),
          }}
          className="flex items-center justify-center overflow-hidden whitespace-nowrap"
        >
          {layer.text}
        </div>
      );
    case "text":
      return (
        <div
          style={{
            ...boxStyle(layer, stage),
            background:
              layer.background === "transparent" ? undefined : layer.background,
            color: layer.color,
            fontSize: cqw(layer.fontSize, stage),
            fontWeight: layer.bold ? 700 : 400,
            justifyContent: layer.align === "center" ? "center" : "flex-start",
            paddingInline: cqw(layer.fontSize * 0.5, stage),
          }}
          className="flex items-center overflow-hidden whitespace-nowrap leading-none"
        >
          {layer.text}
        </div>
      );
    default:
      return null;
  }
}

export function TemplatePreview({
  def,
  options,
  assetUrls,
  className = "",
}: {
  def: TemplateDef;
  options?: Partial<TemplateOptions>;
  /** asset id -> object URL of uploaded images (logo / background) */
  assetUrls?: Readonly<Record<string, string>>;
  className?: string;
}) {
  const opts = options ?? {};
  const layers = useMemo(
    () => buildTemplateScene(def, opts, "preview").layers,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      def,
      opts.accent,
      opts.title,
      opts.tag,
      opts.ticker,
      opts.logoAssetId,
      opts.backgroundAssetId,
    ],
  );
  const accent = opts.accent ?? def.defaults.accent;
  const stage: Stage = def.stage ?? { w: LOGICAL_W, h: LOGICAL_H };
  const portrait = stage.h > stage.w;
  return (
    <div
      aria-hidden="true"
      className={`relative mx-auto w-full overflow-hidden rounded-md border ${className}`}
      style={{
        aspectRatio: `${stage.w} / ${stage.h}`,
        ...(portrait ? { maxWidth: "9.5rem" } : {}),
        containerType: "inline-size",
        ...(def.backdrop &&
        !(opts.backgroundAssetId && assetUrls?.[opts.backgroundAssetId])
          ? backdropStyle(accent)
          : { background: "#111827" }),
      }}
    >
      {layers.map((l) => (
        <PreviewLayer
          key={l.id}
          layer={l}
          stage={stage}
          {...(assetUrls ? { urls: assetUrls } : {})}
        />
      ))}
    </div>
  );
}
