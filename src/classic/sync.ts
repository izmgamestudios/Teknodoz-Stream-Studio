// src/classic/sync.ts
// Classic scene -> main Studio scene. The main stage follows the output aspect (1920x1080,
// 1080x1920, 1080x1350, 1080x1080); the classic stage keeps its short side at 720.
import { createLayer, createScene } from "@/studio/defaults";
import { FORMATS, stageFor } from "@/studio/format";
import { hasFx, normalizeFx } from "@/studio/engine/adjust";
import type { Layer, Scene as MainScene } from "@/studio/types";

import { pipRect, splitRects } from "./studio/render";
import {
  type Aspect,
  type Item,
  type Scene,
  STAGES,
  type Stage,
} from "./studio/types";

export interface ConvertResult {
  scene: MainScene;
  /** the main-Studio stage the scene was written for */
  stage: Stage;
  /** things that cannot be carried over (images are in-memory blobs, video needs an asset) */
  skipped: string[];
}

/** Main-Studio stage for a classic aspect. */
export function mainStageFor(aspect: Aspect): Stage {
  const f = FORMATS.find((x) => x.id === aspect) ?? FORMATS[0]!;
  return stageFor(f.width, f.height);
}

const round = (n: number) => Math.round(n);
const box = (x: number, y: number, w: number, h: number) => ({
  x: round(x),
  y: round(y),
  w: round(w),
  h: round(h),
  rotation: 0,
});

interface Ctx {
  K: number;
  main: Stage;
}

function itemHeight(it: Item, K: number): number {
  const size = (it.size ?? 30) * K;
  return it.kind === "lower" ? size * 2.6 : size * 1.6;
}

function itemLayers(it: Item, { K, main }: Ctx): Layer[] {
  const w = (it.w / 100) * main.w;
  const h = itemHeight(it, K);
  const x = (it.x / 100) * main.w - w / 2;
  const y = (it.y / 100) * main.h - h / 2;
  const size = round((it.size ?? 30) * K);
  const color = it.color ?? "#e0483c";
  const text = it.text ?? "";

  switch (it.kind) {
    case "text":
      return [
        createLayer("text", {
          name: "Yazı",
          text,
          fontSize: size,
          background: color,
          transform: box(x, y, w, h),
        }),
      ];
    case "subtitle":
      return [
        createLayer("text", {
          name: "Altyazı",
          text,
          fontSize: size,
          style: "subtitle",
          background: "rgba(10,12,18,0.72)",
          transform: box(x, y, w, h),
        }),
      ];
    case "badge":
      return [
        createLayer("shape", {
          name: "Rozet",
          text,
          fill: color,
          stroke: "#ffffff",
          strokeWidth: 0,
          radius: round(h / 2),
          transform: box(x, y, w, h),
        }),
      ];
    case "ticker":
      return [
        createLayer("text", {
          name: "Kayan yazı",
          text,
          fontSize: size,
          style: "ticker",
          background: color,
          transform: box(x, y, w, h),
        }),
      ];
    case "lower": {
      const top = h * 0.58;
      return [
        createLayer("shape", {
          name: "Alt bant şeridi",
          text: "",
          fill: color,
          stroke: "#ffffff",
          strokeWidth: 0,
          radius: 0,
          transform: box(x, y, 15, h),
        }),
        createLayer("text", {
          name: "Alt bant başlık",
          text,
          fontSize: size,
          align: "left",
          background: "rgba(10,12,20,0.88)",
          transform: box(x + 15, y, w - 15, top),
        }),
        createLayer("text", {
          name: "Alt bant alt satır",
          text: it.sub ?? "",
          fontSize: round(size * 0.62),
          color,
          align: "left",
          background: "rgba(10,12,20,0.88)",
          transform: box(x + 15, y + top, w - 15, h - top),
        }),
      ];
    }
    default:
      return [];
  }
}

export function toMainScene(
  sc: Scene,
  name: string,
  aspect: Aspect = "16:9",
): ConvertResult {
  const skipped: string[] = [];
  const layers: Layer[] = [];
  const cs = STAGES[aspect];
  const main = mainStageFor(aspect);
  const K = main.w / cs.w;
  const ctx: Ctx = { K, main };
  const scale = (r: { x: number; y: number; w: number; h: number }) =>
    box(r.x * K, r.y * K, r.w * K, r.h * K);
  const filter = sc.filter;
  const fx = hasFx(sc.fx) ? normalizeFx(sc.fx) : undefined;
  const split = sc.layout === "split";
  const [splitA, splitB] = splitRects(cs);

  if (split) {
    layers.push(
      createLayer("shape", {
        name: "Arka plan",
        text: "",
        fill: sc.bg[0],
        stroke: "#ffffff",
        strokeWidth: 0,
        radius: 0,
        transform: { x: 0, y: 0, w: main.w, h: main.h, rotation: 0 },
      }),
    );
  }

  const baseBox = split
    ? scale(splitA)
    : { x: 0, y: 0, w: main.w, h: main.h, rotation: 0 };
  const common = { filter, ...(fx ? { fx } : {}), transform: baseBox };
  switch (sc.base) {
    case "camera":
      layers.push(createLayer("webcam", { name: "Kamera", ...common }));
      break;
    case "screen":
      layers.push(createLayer("screen", { name: "Ekran", ...common }));
      break;
    case "guest":
      layers.push(createLayer("guest", { name: "Konuk", ...common }));
      break;
    case "video":
      skipped.push(
        "Arka plan videosu (Ana Stüdyo'da Medya Kütüphanesi'nden ekleyin)",
      );
      break;
  }

  if (split)
    layers.push(
      createLayer("webcam", { name: "Kamera (yan)", transform: scale(splitB) }),
    );
  else if (sc.layout === "pip" && sc.base !== "camera")
    layers.push(
      createLayer("webcam", {
        name: "Kamera (PiP)",
        transform: scale(pipRect(sc.corner, cs)),
      }),
    );

  if (sc.frame) {
    layers.push(
      createLayer("shape", {
        name: "Çerçeve",
        text: "",
        fill: "transparent",
        stroke: sc.frame,
        strokeWidth: 12,
        radius: 0,
        transform: box(9, 9, main.w - 18, main.h - 18),
      }),
    );
  }

  for (const it of sc.items) {
    if (it.kind === "image")
      skipped.push("Logo/görsel (Ana Stüdyo'ya dosyayı yeniden ekleyin)");
    else layers.push(...itemLayers(it, ctx));
  }

  return { scene: createScene(name, layers), stage: main, skipped };
}
