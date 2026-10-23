// src/studio/templates/types.ts
// Declarative broadcast-frame templates. A template is pure data: `buildTemplateScene`
// turns it into a normal Scene made of the existing layer kinds, so everything stays
// editable in the layer panel / inspector afterwards.
import type { AudioVizStyle, DeviceFrameKind } from "../types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PanelKind = "webcam" | "guest" | "screen" | "web" | "viz";

export interface PanelSpec {
  /** Stable within a template; used for layer names. */
  id: string;
  kind: PanelKind;
  /** Placeholder / caption text (also the layer name). */
  label: string;
  rect: Rect;
  /** Only for `web` panels. */
  frame?: DeviceFrameKind;
  /** Only for `viz` panels: how the voices are drawn. */
  viz?: AudioVizStyle;
}

export interface LowerThirdSpec {
  /** Left edge / top edge of the red "tag" bar; the banner sits right below it. */
  x: number;
  y: number;
  w: number;
}

export interface TemplateOptions {
  /** Main theme color (banner, bars, glow). `#rrggbb`. */
  accent: string;
  /** Big banner text, e.g. "BREAKING NEWS". */
  title: string;
  /** Small tag above the banner, e.g. "EXCLUSIVE coverage". */
  tag: string;
  /** Scrolling ticker text (only when the template has a ticker). */
  ticker: string;
  /** Uploaded logo (image asset id), drawn in the template's logo slot. */
  logoAssetId?: string;
  /** Uploaded full-frame background (image asset id) replacing the generated one. */
  backgroundAssetId?: string;
}

export type TemplateGroup =
  "news" | "talk" | "demo" | "learn" | "social" | "podcast";

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  group: TemplateGroup;
  /** output format id (see format.ts); absent = "16:9" */
  format?: string;
  /** logical stage the rects are written for; absent = 1920x1080 */
  stage?: { w: number; h: number };
  panels: readonly PanelSpec[];
  /** Draw the generated dotted backdrop (skipped for full-bleed layouts). */
  backdrop: boolean;
  /** Give every panel a white frame, like the reference news layout. */
  frames: boolean;
  /** Small label bar below every panel (multi-person layouts). */
  captions: boolean;
  /** Full-width title strip at the very top. */
  topTitle: boolean;
  lowerThird?: LowerThirdSpec;
  /** Where an uploaded logo goes (image is contained, aspect preserved). */
  logo: Rect;
  ticker: boolean;
  defaults: TemplateOptions;
}

export type TemplateMode = "new-scene" | "replace-active";
