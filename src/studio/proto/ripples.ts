// src/studio/proto/ripples.ts
// Animated touch/click ripples. Time is always passed in, so everything is testable.
import type { Rect } from "../types";

export type RippleKind = "touch" | "click" | "drag";

export interface Ripple {
  /** normalized 0..1 inside the screen rect */
  nx: number;
  ny: number;
  t0: number;
  kind: RippleKind;
}

export const MAX_RIPPLES = 24;
export const LIFETIME_MS: Record<RippleKind, number> = {
  touch: 700,
  click: 550,
  drag: 350,
};

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export class RippleField {
  private items: Ripple[] = [];

  get count(): number {
    return this.items.length;
  }

  add(nx: number, ny: number, nowMs: number, kind: RippleKind = "touch"): void {
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nowMs))
      return;
    this.items.push({ nx: clamp01(nx), ny: clamp01(ny), t0: nowMs, kind });
    if (this.items.length > MAX_RIPPLES) {
      this.items.splice(0, this.items.length - MAX_RIPPLES);
    }
  }

  /** Drop expired ripples. Returns how many are still alive. */
  prune(nowMs: number): number {
    this.items = this.items.filter((r) => nowMs - r.t0 < LIFETIME_MS[r.kind]);
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }

  snapshot(): readonly Ripple[] {
    return this.items;
  }

  draw(ctx: CanvasRenderingContext2D, screen: Rect, nowMs: number): void {
    if (this.prune(nowMs) === 0) return;
    const unit = Math.min(screen.w, screen.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(screen.x, screen.y, screen.w, screen.h);
    ctx.clip();
    let prev: Ripple | undefined;
    for (const r of this.items) {
      const p = clamp01((nowMs - r.t0) / LIFETIME_MS[r.kind]);
      const e = easeOutCubic(p);
      const x = screen.x + r.nx * screen.w;
      const y = screen.y + r.ny * screen.h;
      const alpha = 1 - p;
      if (r.kind === "touch") {
        const rad = unit * (0.02 + 0.06 * e);
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(120,200,255,${(0.35 * alpha).toFixed(3)})`;
        ctx.fill();
        ctx.lineWidth = Math.max(2, unit * 0.004);
        ctx.strokeStyle = `rgba(255,255,255,${(0.8 * alpha).toFixed(3)})`;
        ctx.stroke();
      } else if (r.kind === "click") {
        for (const k of [0, 0.35]) {
          const pe = clamp01(e - k);
          ctx.beginPath();
          ctx.arc(x, y, unit * (0.01 + 0.05 * pe), 0, Math.PI * 2);
          ctx.lineWidth = Math.max(2, unit * 0.004);
          ctx.strokeStyle = `rgba(255,200,80,${(0.9 * alpha * (1 - pe * 0.5)).toFixed(3)})`;
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.arc(x, y, unit * 0.012, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(120,200,255,${(0.6 * alpha).toFixed(3)})`;
        ctx.fill();
        if (prev && prev.kind === "drag" && r.t0 - prev.t0 < 120) {
          ctx.beginPath();
          ctx.moveTo(
            screen.x + prev.nx * screen.w,
            screen.y + prev.ny * screen.h,
          );
          ctx.lineTo(x, y);
          ctx.lineWidth = Math.max(3, unit * 0.008);
          ctx.lineCap = "round";
          ctx.strokeStyle = `rgba(120,200,255,${(0.5 * alpha).toFixed(3)})`;
          ctx.stroke();
        }
      }
      prev = r;
    }
    ctx.restore();
  }
}

const registry = new Map<string, RippleField>();
export function getRippleField(layerId: string): RippleField {
  let f = registry.get(layerId);
  if (!f) {
    f = new RippleField();
    registry.set(layerId, f);
  }
  return f;
}
export function releaseRippleField(layerId: string): void {
  registry.delete(layerId);
}
