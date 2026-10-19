// src/classic/studio/types.ts
import type { LayerFx } from "@/studio/types";
export const W = 1280;
export const H = 720;

/** Output aspect: the classic stage keeps the short side at 720 px. */
export type Aspect = "16:9" | "9:16" | "4:5" | "1:1";
export type Stage = { w: number; h: number };
export const STAGES: Record<Aspect, Stage> = {
  "16:9": { w: 1280, h: 720 },
  "9:16": { w: 720, h: 1280 },
  "4:5": { w: 720, h: 900 },
  "1:1": { w: 720, h: 720 },
};
export const ASPECTS: { id: Aspect; label: string; hint: string }[] = [
  { id: "16:9", label: "Yatay 16:9", hint: "YouTube, Twitch, toplantı" },
  { id: "9:16", label: "Dikey 9:16", hint: "Reels, Shorts, TikTok" },
  { id: "4:5", label: "Portre 4:5", hint: "Instagram akışı" },
  { id: "1:1", label: "Kare 1:1", hint: "Instagram, LinkedIn" },
];
export const stageOf = (a: Aspect): Stage => STAGES[a];

export type Base = "camera" | "screen" | "video" | "guest";
export type Layout = "full" | "pip" | "split";
export type Corner = "br" | "bl" | "tr" | "tl";
export type ItemKind =
  "image" | "text" | "subtitle" | "lower" | "badge" | "ticker";

export type Item = {
  id: string;
  kind: ItemKind;
  x: number; // center, percent of stage
  y: number;
  w: number; // width, percent of stage
  src?: string;
  text?: string;
  sub?: string; // second line for lower-third
  color?: string; // accent / background
  size?: number; // font px on a 1280 stage
};

export type Scene = {
  base: Base;
  /** extra effects beyond the CSS filter (sharpen, vignette, warmth) */
  fx?: LayerFx;
  layout: Layout;
  corner: Corner;
  filter: string;
  frame: string; // "" = none, else CSS color of the border
  bg: [string, string]; // gradient used behind split / pip layouts
  items: Item[];
};

export type Sources = {
  cam: HTMLVideoElement | null;
  scr: HTMLVideoElement | null;
  bgv: HTMLVideoElement | null;
  guest: HTMLVideoElement | null;
  images: Record<string, HTMLImageElement>;
};

export const uid = () => Math.random().toString(36).slice(2, 9);

export const FILTERS: Record<string, string> = {
  Yok: "none",
  "Siyah-Beyaz": "grayscale(1)",
  Sepya: "sepia(0.8)",
  Kontrast: "contrast(1.4) saturate(1.3)",
  Sıcak: "sepia(0.3) saturate(1.5) hue-rotate(-10deg)",
  Soğuk: "saturate(1.2) hue-rotate(20deg) brightness(1.05)",
  Retro: "sepia(0.5) contrast(1.2) saturate(0.8) brightness(0.95)",
  Neon: "saturate(2) contrast(1.2) hue-rotate(290deg)",
  Bulanık: "blur(4px)",
};

export const emptyScene = (): Scene => ({
  base: "camera",
  layout: "full",
  corner: "br",
  filter: "none",
  frame: "",
  bg: ["#141824", "#0b0d14"],
  items: [],
});
