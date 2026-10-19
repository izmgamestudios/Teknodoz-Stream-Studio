// src/lib/studio/render.ts
import { H, type Item, type Scene, type Sources, W } from "./types";

type Rect = { x: number; y: number; w: number; h: number };

const FONT = '"Space Grotesk", system-ui, sans-serif';

/** Item box in 1280x720 stage pixels (center-based x/y converted to top-left). */
export function itemRect(it: Item, images: Sources["images"]): Rect {
  const w = (it.w / 100) * W;
  const size = it.size ?? 30;
  let h = size * 1.6;
  if (it.kind === "image") {
    const im = it.src ? images[it.src] : undefined;
    h =
      im && im.naturalWidth
        ? (w * im.naturalHeight) / im.naturalWidth
        : w * 0.6;
  } else if (it.kind === "lower") h = size * 2.6;
  return { x: (it.x / 100) * W - w / 2, y: (it.y / 100) * H - h / 2, w, h };
}

/** Same box as percentages, for the editor's drag handles. */
export function itemBoxPct(it: Item, images: Sources["images"]) {
  const r = itemRect(it, images);
  return {
    left: (r.x / W) * 100,
    top: (r.y / H) * 100,
    width: (r.w / W) * 100,
    height: (r.h / H) * 100,
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
) {
  const r = itemRect(it, images);
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

function pipRect(corner: Scene["corner"]): Rect {
  const w = 340,
    h = 191,
    m = 30;
  return {
    x: corner === "bl" || corner === "tl" ? m : W - w - m,
    y: corner === "tl" || corner === "tr" ? m : H - h - m,
    w,
    h,
  };
}

/**
 * Renders a scene onto ctx. The canvas can be any 16:9 size; geometry is
 * authored on a 1280x720 stage and scaled here.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  sc: Scene,
  src: Sources,
  t: number,
  cw: number,
  ch: number,
) {
  const k = cw / W;
  ctx.save();
  ctx.scale(k, ch / H);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, W, H);

  const baseEl =
    sc.base === "screen" ? src.scr : sc.base === "video" ? src.bgv : src.cam;
  const mirrorBase = sc.base === "camera";
  const full: Rect = { x: 0, y: 0, w: W, h: H };
  const frameRects: Rect[] = [];

  if (sc.layout === "split") {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, sc.bg[0]);
    g.addColorStop(1, sc.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const left: Rect = { x: 32, y: 90, w: 800, h: 450 };
    const right: Rect = { x: 856, y: 90, w: 392, h: 450 };
    ctx.filter = sc.filter;
    cover(ctx, baseEl, left, mirrorBase);
    ctx.filter = "none";
    cover(ctx, src.cam, right, true);
    frameRects.push(left, right);
  } else {
    ctx.filter = sc.filter;
    cover(ctx, baseEl, full, mirrorBase);
    ctx.filter = "none";
    if (sc.layout === "pip" && sc.base !== "camera") {
      const p = pipRect(sc.corner);
      cover(ctx, src.cam, p, true);
      frameRects.push(p);
      if (!sc.frame) {
        ctx.strokeStyle = "#f5c04a";
        ctx.lineWidth = 6;
        ctx.strokeRect(p.x, p.y, p.w, p.h);
      }
    }
    if (sc.frame) frameRects.push({ x: 6, y: 6, w: W - 12, h: H - 12 });
  }

  if (sc.frame) {
    ctx.strokeStyle = sc.frame;
    ctx.lineWidth = 8;
    ctx.shadowColor = sc.frame;
    ctx.shadowBlur = 18;
    for (const r of frameRects) ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.shadowBlur = 0;
  }

  for (const it of sc.items) drawItem(ctx, it, src.images, t);
  ctx.restore();
}
