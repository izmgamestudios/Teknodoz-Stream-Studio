// src/lib/studio/types.ts
export const W = 1280;
export const H = 720;

export type Base = "camera" | "screen" | "video";
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
