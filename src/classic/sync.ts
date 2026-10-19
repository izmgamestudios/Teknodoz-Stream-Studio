// src/classic/sync.ts
// Classic scene -> main Studio scene (1920x1080 logical px, layer based).
import { createLayer, createScene } from "@/studio/defaults";
import type { Layer, Scene as MainScene } from "@/studio/types";

import type { Corner, Item, Scene } from "./studio/types";

const K = 1920 / 1280; // classic stage is 1280x720
const FULL = { x: 0, y: 0, w: 1920, h: 1080, rotation: 0 };

export interface ConvertResult {
  scene: MainScene;
  /** things that cannot be carried over (images are in-memory blobs, video needs an asset) */
  skipped: string[];
}

const round = (n: number) => Math.round(n);
const box = (x: number, y: number, w: number, h: number) => ({ x: round(x), y: round(y), w: round(w), h: round(h), rotation: 0 });

function pipBox(corner: Corner) {
  const w = 510, h = 287, m = 45;
  return box(corner === "bl" || corner === "tl" ? m : 1920 - w - m, corner === "tl" || corner === "tr" ? m : 1080 - h - m, w, h);
}

function itemHeight(it: Item): number {
  const size = (it.size ?? 30) * K;
  return it.kind === "lower" ? size * 2.6 : size * 1.6;
}

function itemLayers(it: Item): Layer[] {
  const w = (it.w / 100) * 1920;
  const h = itemHeight(it);
  const x = (it.x / 100) * 1920 - w / 2;
  const y = (it.y / 100) * 1080 - h / 2;
  const size = round((it.size ?? 30) * K);
  const color = it.color ?? "#e0483c";
  const text = it.text ?? "";

  switch (it.kind) {
    case "text":
      return [createLayer("text", { name: "Yazı", text, fontSize: size, background: color, transform: box(x, y, w, h) })];
    case "subtitle":
      return [createLayer("text", { name: "Altyazı", text, fontSize: size, style: "subtitle", background: "rgba(10,12,18,0.72)", transform: box(x, y, w, h) })];
    case "badge":
      return [createLayer("shape", { name: "Rozet", text, fill: color, stroke: "#ffffff", strokeWidth: 0, radius: round(h / 2), transform: box(x, y, w, h) })];
    case "ticker":
      return [createLayer("text", { name: "Kayan yazı", text, fontSize: size, style: "ticker", background: color, transform: box(x, y, w, h) })];
    case "lower": {
      const top = h * 0.58;
      return [
        createLayer("shape", { name: "Alt bant şeridi", text: "", fill: color, stroke: "#ffffff", strokeWidth: 0, radius: 0, transform: box(x, y, 15, h) }),
        createLayer("text", { name: "Alt bant başlık", text, fontSize: size, align: "left", background: "rgba(10,12,20,0.88)", transform: box(x + 15, y, w - 15, top) }),
        createLayer("text", { name: "Alt bant alt satır", text: it.sub ?? "", fontSize: round(size * 0.62), color, align: "left", background: "rgba(10,12,20,0.88)", transform: box(x + 15, y + top, w - 15, h - top) }),
      ];
    }
    default:
      return [];
  }
}

export function toMainScene(sc: Scene, name: string): ConvertResult {
  const skipped: string[] = [];
  const layers: Layer[] = [];
  const split = sc.layout === "split";

  if (split) {
    layers.push(createLayer("shape", { name: "Arka plan", text: "", fill: sc.bg[0], stroke: "#ffffff", strokeWidth: 0, radius: 0, transform: { ...FULL } }));
  }

  const baseBox = split ? box(48, 135, 1200, 675) : { ...FULL };
  switch (sc.base) {
    case "camera":
      layers.push(createLayer("webcam", { name: "Kamera", filter: sc.filter, transform: baseBox }));
      break;
    case "screen":
      layers.push(createLayer("screen", { name: "Ekran", filter: sc.filter, transform: baseBox }));
      break;
    case "guest":
      layers.push(createLayer("guest", { name: "Konuk", filter: sc.filter, transform: baseBox }));
      break;
    case "video":
      skipped.push("Arka plan videosu (Ana Stüdyo'da Medya Kütüphanesi'nden ekleyin)");
      break;
  }

  if (split) layers.push(createLayer("webcam", { name: "Kamera (yan)", transform: box(1284, 135, 588, 675) }));
  else if (sc.layout === "pip" && sc.base !== "camera") layers.push(createLayer("webcam", { name: "Kamera (PiP)", transform: pipBox(sc.corner) }));

  if (sc.frame) {
    layers.push(createLayer("shape", { name: "Çerçeve", text: "", fill: "transparent", stroke: sc.frame, strokeWidth: 12, radius: 0, transform: box(9, 9, 1902, 1062) }));
  }

  for (const it of sc.items) {
    if (it.kind === "image") skipped.push("Logo/görsel (Ana Stüdyo'ya dosyayı yeniden ekleyin)");
    else layers.push(...itemLayers(it));
  }

  return { scene: createScene(name, layers), skipped };
}
