// src/lib/studio/render.ts
import { hasFx } from "@/studio/engine/adjust";
import type { FxEngine } from "@/studio/engine/fx";

import { H, type Item, type Scene, type Sources, type Stage, W } from "./types";

const LANDSCAPE: Stage = { w: W, h: H };

type Rect = { x: number; y: number; w: number; h: number };

const FONT = '"Space Grotesk", system-ui, sans-serif';

/** Item box in 1280x720 stage pixels (center-based x/y converted to top-left). */
export function itemRect(
  it: Item,
  images: Sources["images"],
  stage: Stage = LANDSCAPE,
): Rect {
  const w = (it.w / 100) * stage.w;
  const size = it.size ?? 30;
  let h = size * 1.6;
  if (it.kind === "image") {
    const im = it.src ? images[it.src] : undefined;
    h =
      im && im.naturalWidth
        ? (w * im.naturalHeight) / im.naturalWidth
        : w * 0.6;
  } else if (it.kind === "lower") h = size * 2.6;
  return {
    x: (it.x / 100) * stage.w - w / 2,
    y: (it.y / 100) * stage.h - h / 2,
    w,
    h,
  };
}

/** Same box as percentages, for the editor's drag handles. */
export function itemBoxPct(
  it: Item,
  images: Sources["images"],
  stage: Stage = LANDSCAPE,
) {
  const r = itemRect(it, images, stage);
  return {
    left: (r.x / stage.w) * 100,
    top: (r.y / stage.h) * 100,
    width: (r.w / stage.w) * 100,
    height: (r.h / stage.h) * 100,
  };
}

function cover(
  ctx: CanvasRenderingContext2D,
  el: HTMLVideoElement | null,
  r: Rect,
  mirror: boolean,
) {
  if (!el || el.readyState < 2) return;
  const vw = el.videoWidth || r.w,
    vh = el.videoHeight || r.h;
  const s = Math.max(r.w / vw, r.h / vh);
  const sw = r.w / s,
    sh = r.h / s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  if (mirror) {
    ctx.translate(r.x + r.w, r.y);
    ctx.scale(-1, 1);
    ctx.drawImage(el, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, r.w, r.h);
  } else
    ctx.drawImage(el, (vw - sw) / 2, (vh - sh) / 2, sw, sh, r.x, r.y, r.w, r.h);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, rad: number) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, rad);
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  it: Item,
  images: Sources["images"],
  t: number,
  stage: Stage,
) {
  const r = itemRect(it, images, stage);
  const size = it.size ?? 30;
  const color = it.color ?? "#e0483c";
  ctx.save();
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textBaseline = "middle";

  switch (it.kind) {
    case "image": {
      const im = it.src ? images[it.src] : undefined;
      if (im?.complete && im.naturalWidth)
        ctx.drawImage(im, r.x, r.y, r.w, r.h);
      break;
    }
    case "subtitle": {
      ctx.fillStyle = "rgba(10,12,18,0.72)";
      roundRect(ctx, r, 10);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(it.text ?? "", r.x + r.w / 2, r.y + r.h / 2, r.w - 24);
      break;
    }
    case "text": {
      ctx.fillStyle = color;
      roundRect(ctx, r, 8);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(it.text ?? "", r.x + r.w / 2, r.y + r.h / 2, r.w - 20);
      break;
    }
    case "badge": {
      ctx.fillStyle = color;
      roundRect(ctx, r, r.h / 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.45 * Math.sin(t * 5)})`;
      ctx.beginPath();
      ctx.arc(r.x + r.h / 2, r.y + r.h / 2, size * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "left";
      ctx.fillText(
        it.text ?? "",
        r.x + r.h / 2 + size * 0.45,
        r.y + r.h / 2 + 1,
        r.w - r.h,
      );
      break;
    }
    case "lower": {
      ctx.fillStyle = "rgba(10,12,20,0.88)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = color;
      ctx.fillRect(r.x, r.y, 10, r.h);
      ctx.textAlign = "left";
      ctx.fillStyle = "#fff";
      ctx.fillText(it.text ?? "", r.x + 28, r.y + r.h * 0.37, r.w - 44);
      ctx.font = `600 ${size * 0.62}px ${FONT}`;
      ctx.fillStyle = color;
      ctx.fillText(it.sub ?? "", r.x + 28, r.y + r.h * 0.74, r.w - 44);
      break;
    }
    case "ticker": {
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      const text = `${it.text ?? ""}      ✦      `;
      const tw = Math.max(ctx.measureText(text).width, 1);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "left";
      const off = (t * 110) % tw;
      for (let x = r.x - off; x < r.x + r.w; x += tw)
        ctx.fillText(text, x, r.y + r.h / 2 + 1);
      break;
    }
  }
  ctx.restore();
}

export function pipRect(corner: Scene["corner"], stage: Stage): Rect {
  // about a quarter of the stage width, 16:9 (3:4 would crop faces in tall formats)
  const w = Math.round(Math.min(340, stage.w * 0.34)),
    h = Math.round((w * 9) / 16),
    m = 30;
  return {
    x: corner === "bl" || corner === "tl" ? m : stage.w - w - m,
    y: corner === "tl" || corner === "tr" ? m : stage.h - h - m,
    w,
    h,
  };
}

/** Split layout: base + camera side by side (wide stage) or stacked (tall / square stage). */
export function splitRects(stage: Stage): [Rect, Rect] {
  const SW = stage.w;
  const SH = stage.h;
  if (SW >= SH) {
    const m = SW * 0.025;
    const bw = SW * 0.625;
    const a: Rect = { x: m, y: SH * 0.125, w: bw, h: (bw * 9) / 16 };
    return [a, { x: m * 2 + bw, y: a.y, w: SW - m * 3 - bw, h: a.h }];
  }
  const m = SW * 0.04;
  const bw = SW - m * 2;
  const bh = Math.min((bw * 9) / 16, SH * 0.38);
  const a: Rect = { x: m, y: SH * 0.07, w: bw, h: bh };
  const y2 = a.y + bh + m;
  return [a, { x: m, y: y2, w: bw, h: Math.min(SH - y2 - m, bw * 0.95) }];
}

/**
 * Renders a scene onto ctx. Geometry is authored on `stage` (1280x720 for 16:9, 720x1280 for
 * 9:16...) and scaled to the canvas size; `fxp` (optional) renders sharpen / vignette / warmth.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  sc: Scene,
  src: Sources,
  t: number,
  cw: number,
  ch: number,
  stage: Stage = LANDSCAPE,
  fxp?: FxEngine | null,
) {
  const kx = cw / stage.w;
  const ky = ch / stage.h;
  const SW = stage.w;
  const SH = stage.h;
  ctx.save();
  ctx.scale(kx, ky);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, SW, SH);

  const baseEl =
    sc.base === "screen"
      ? src.scr
      : sc.base === "video"
        ? src.bgv
        : sc.base === "guest"
          ? src.guest
          : src.cam;
  const mirrorBase = sc.base === "camera";
  const full: Rect = { x: 0, y: 0, w: SW, h: SH };
  const frameRects: Rect[] = [];

  /** Draws the base picture with the scene's filter (+ fx when set). */
  const drawBase = (r: Rect) => {
    if (fxp && hasFx(sc.fx) && baseEl && baseEl.readyState >= 2) {
      const out = fxp.process(
        "classic-base",
        r.w * kx,
        r.h * ky,
        sc.filter,
        sc.fx,
        (c, w, h) =>
          cover(
            c as CanvasRenderingContext2D,
            baseEl,
            { x: 0, y: 0, w, h },
            mirrorBase,
          ),
        true,
      );
      if (out) {
        ctx.drawImage(out, r.x, r.y, r.w, r.h);
        return;
      }
    }
    ctx.filter = sc.filter;
    cover(ctx, baseEl, r, mirrorBase);
    ctx.filter = "none";
  };

  if (sc.layout === "split") {
    const g = ctx.createLinearGradient(0, 0, SW, SH);
    g.addColorStop(0, sc.bg[0]);
    g.addColorStop(1, sc.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SW, SH);
    const [a, b] = splitRects(stage);
    drawBase(a);
    cover(ctx, src.cam, b, true);
    frameRects.push(a, b);
  } else {
    drawBase(full);
    if (sc.layout === "pip" && sc.base !== "camera") {
      const p = pipRect(sc.corner, stage);
      cover(ctx, src.cam, p, true);
      frameRects.push(p);
      if (!sc.frame) {
        ctx.strokeStyle = "#f5c04a";
        ctx.lineWidth = 6;
        ctx.strokeRect(p.x, p.y, p.w, p.h);
      }
    }
    if (sc.frame) frameRects.push({ x: 6, y: 6, w: SW - 12, h: SH - 12 });
  }

  if (sc.frame) {
    ctx.strokeStyle = sc.frame;
    ctx.lineWidth = 8;
    ctx.shadowColor = sc.frame;
    ctx.shadowBlur = 18;
    for (const r of frameRects) ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.shadowBlur = 0;
  }

  for (const it of sc.items) drawItem(ctx, it, src.images, t, stage);
  ctx.restore();
}
