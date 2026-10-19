// src/studio/engine/fx.ts
// Per-layer effects that CSS filters cannot express: sharpen (unsharp mask built from canvas
// compositing), vignette and warmth. Works on small scratch canvases (cached per layer), so the
// compositor only pays for layers that actually use an effect.
import type { LayerFx } from "../types";
import { createScratchCanvas, type ScratchCanvas } from "./chroma";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface Surface {
  canvas: ScratchCanvas;
  ctx: Ctx;
}

interface Entry {
  w: number;
  h: number;
  a: Surface; // the adjusted picture (also the final result)
  b: Surface; // high-pass work surface
}

export interface FxEngine {
  /**
   * Paints the layer through `paint` (which receives a context + the target size), applies
   * `filter` and the fx, and returns the finished canvas (valid until the next call for the
   * same layer), or null when scratch canvases are unavailable.
   */
  process(
    key: string,
    w: number,
    h: number,
    filter: string,
    fx: LayerFx,
    paint: (ctx: Ctx, w: number, h: number) => void,
    supportsFilter: boolean,
  ): CanvasImageSource | null;
  dispose(): void;
}

const MAX_SIDE = 2048;

export class FxProcessor implements FxEngine {
  private entries = new Map<string, Entry>();
  private readonly make: (w: number, h: number) => ScratchCanvas;

  constructor(
    opts: { createCanvas?: (w: number, h: number) => ScratchCanvas } = {},
  ) {
    this.make = opts.createCanvas ?? createScratchCanvas;
  }

  private surface(w: number, h: number): Surface | null {
    const canvas = this.make(w, h);
    const ctx = canvas.getContext("2d") as Ctx | null;
    return ctx ? { canvas, ctx } : null;
  }

  private entry(key: string, w: number, h: number): Entry | null {
    const cur = this.entries.get(key);
    if (cur && cur.w === w && cur.h === h) return cur;
    const a = this.surface(w, h);
    const b = this.surface(w, h);
    if (!a || !b) return null;
    const next: Entry = { w, h, a, b };
    if (this.entries.size > 24) this.entries.clear();
    this.entries.set(key, next);
    return next;
  }

  process(
    key: string,
    width: number,
    height: number,
    filter: string,
    fx: LayerFx,
    paint: (ctx: Ctx, w: number, h: number) => void,
    supportsFilter: boolean,
  ): CanvasImageSource | null {
    // cap the work size: effects are resolution-independent enough, huge boxes are not worth it
    const k = Math.min(1, MAX_SIDE / Math.max(width, height));
    const w = Math.max(2, Math.round(width * k));
    const h = Math.max(2, Math.round(height * k));
    const e = this.entry(key, w, h);
    if (!e) return null;
    const { a, b } = e;

    reset(a.ctx, w, h);
    a.ctx.save();
    if (supportsFilter && filter !== "none") a.ctx.filter = filter;
    paint(a.ctx, w, h);
    a.ctx.restore();

    const mask = !!fx.sharpen || !!fx.vignette || fx.warmth !== 0;
    if (!mask) return a.canvas as CanvasImageSource;

    if (fx.sharpen > 0 && supportsFilter) this.sharpen(e, fx.sharpen / 100);

    const c = a.ctx;
    if (fx.warmth !== 0) {
      const warm = fx.warmth > 0;
      c.save();
      c.globalCompositeOperation = "overlay";
      c.globalAlpha = Math.min(1, (Math.abs(fx.warmth) / 100) * 0.45);
      c.fillStyle = warm ? "#ff9a3c" : "#3c8cff";
      c.fillRect(0, 0, w, h);
      c.restore();
    }
    if (fx.vignette > 0) {
      c.save();
      const g = c.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.25,
        w / 2,
        h / 2,
        Math.hypot(w, h) * 0.55,
      );
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(
        1,
        `rgba(0,0,0,${((fx.vignette / 100) * 0.85).toFixed(3)})`,
      );
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.restore();
    }
    return a.canvas as CanvasImageSource;
  }

  /**
   * Unsharp mask: hp = 0.5*img + 0.5*invert(blur(img)) is a mid-grey picture carrying only the
   * detail; overlaying it on the image boosts local contrast. `amount` 0..1 is the overlay alpha.
   */
  private sharpen(e: Entry, amount: number): void {
    const { a, b, w, h } = e;
    const radius = Math.max(1, Math.min(w, h) / 360);
    reset(b.ctx, w, h);
    b.ctx.drawImage(a.canvas as CanvasImageSource, 0, 0);
    b.ctx.save();
    b.ctx.globalAlpha = 0.5;
    b.ctx.filter = `blur(${radius.toFixed(2)}px) invert(1)`;
    b.ctx.drawImage(a.canvas as CanvasImageSource, 0, 0);
    b.ctx.restore();

    a.ctx.save();
    a.ctx.globalCompositeOperation = "overlay";
    a.ctx.globalAlpha = Math.min(1, amount * 1.2);
    a.ctx.drawImage(b.canvas as CanvasImageSource, 0, 0);
    a.ctx.restore();
  }

  dispose(): void {
    this.entries.clear();
  }
}

function reset(ctx: Ctx, w: number, h: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.clearRect(0, 0, w, h);
}
