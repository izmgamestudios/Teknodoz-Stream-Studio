// src/studio/proto/frames.ts
// Device frame geometry + canvas drawing for prototype broadcasts.
// `drawDeviceFrame` paints the BACK of the device (body, toolbar) and returns the inner screen
// rect where captured pixels go; `drawDeviceOverlay` paints what sits IN FRONT of the screen
// (bezel ring that hides square content corners, dynamic island, home indicator).
import type { DeviceFrameKind, Rect } from "../types";

/** Logical phone screen (CSS px) the mobile frame is designed around. */
export const MOBILE_SCREEN = { w: 390, h: 844 } as const;
const BEZEL = 14;
const MOBILE_OUTER = {
  w: MOBILE_SCREEN.w + BEZEL * 2,
  h: MOBILE_SCREEN.h + BEZEL * 2,
};
const DESKTOP_ASPECT = 16 / 9;

export interface FrameGeometry {
  outer: Rect;
  screen: Rect;
  /** corner radius of `outer` */
  radius: number;
  /** corner radius of `screen` */
  screenRadius: number;
  /** desktop only: height of the tab strip + address bar */
  toolbarH: number;
  /** scale factor vs the design size */
  scale: number;
}

function fit(box: Rect, aspect: number): Rect {
  let w = box.w;
  let h = w / aspect;
  if (h > box.h) {
    h = box.h;
    w = h * aspect;
  }
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** Fit the device inside `box` (letterboxed, aspect preserved). Pure. */
export function frameGeometry(kind: DeviceFrameKind, box: Rect): FrameGeometry {
  if (kind === "mobile") {
    const outer = fit(box, MOBILE_OUTER.w / MOBILE_OUTER.h);
    const scale = outer.w / MOBILE_OUTER.w;
    const bz = BEZEL * scale;
    return {
      outer,
      screen: {
        x: outer.x + bz,
        y: outer.y + bz,
        w: outer.w - bz * 2,
        h: outer.h - bz * 2,
      },
      radius: 54 * scale,
      screenRadius: 40 * scale,
      toolbarH: 0,
      scale,
    };
  }
  if (kind === "desktop") {
    const outer = fit(box, DESKTOP_ASPECT);
    const scale = outer.h / 720;
    const toolbarH = Math.max(24, 64 * scale);
    const border = Math.max(1, 1.5 * scale);
    return {
      outer,
      screen: {
        x: outer.x + border,
        y: outer.y + toolbarH,
        w: outer.w - border * 2,
        h: outer.h - toolbarH - border,
      },
      radius: 12 * scale,
      screenRadius: 0,
      toolbarH,
      scale,
    };
  }
  return {
    outer: box,
    screen: box,
    radius: 0,
    screenRadius: 0,
    toolbarH: 0,
    scale: 1,
  };
}

/** Append a rounded-rect subpath (no beginPath); works where ctx.roundRect is missing. */
export function roundRectSubpath(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  radius: number,
): void {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(r.x, r.y, r.w, r.h, rad);
    return;
  }
  ctx.moveTo(r.x + rad, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
  ctx.closePath();
}

/** Start a new path containing one rounded rect. */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  radius: number,
): void {
  ctx.beginPath();
  roundRectSubpath(ctx, r, radius);
}

export interface FrameStyle {
  url?: string;
  title?: string;
  theme?: "dark" | "light";
}

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 60);
  }
}

/** Draw the back of the device. Returns the inner screen rect (== `box` for kind "none"). */
export function drawDeviceFrame(
  ctx: CanvasRenderingContext2D,
  kind: DeviceFrameKind,
  box: Rect,
  style: FrameStyle = {},
): Rect {
  const g = frameGeometry(kind, box);
  if (kind === "none") return g.screen;
  const dark = (style.theme ?? "dark") === "dark";
  ctx.save();
  if (kind === "mobile") {
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 24 * g.scale;
    ctx.shadowOffsetY = 8 * g.scale;
    roundRectPath(ctx, g.outer, g.radius);
    ctx.fillStyle = "#0b0b0f";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#3a3a44";
    ctx.lineWidth = Math.max(1, 2 * g.scale);
    ctx.stroke();
    ctx.fillStyle = "#000";
    ctx.fillRect(g.screen.x, g.screen.y, g.screen.w, g.screen.h);
  } else {
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.shadowBlur = 20 * g.scale;
    roundRectPath(ctx, g.outer, g.radius);
    ctx.fillStyle = dark ? "#1f2026" : "#e9e9ee";
    ctx.fill();
    ctx.shadowColor = "transparent";
    const s = g.scale;
    const top = g.outer.y;
    // traffic lights
    const cy = top + g.toolbarH * 0.3;
    ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(g.outer.x + (18 + i * 20) * s, cy, 6 * s, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    });
    // active tab
    const tab: Rect = {
      x: g.outer.x + 90 * s,
      y: top + 6 * s,
      w: 220 * s,
      h: g.toolbarH * 0.42,
    };
    roundRectPath(ctx, tab, 8 * s);
    ctx.fillStyle = dark ? "#2d2e36" : "#ffffff";
    ctx.fill();
    ctx.fillStyle = dark ? "#d8d8e0" : "#222";
    ctx.font = `${Math.max(9, 13 * s)}px "Space Grotesk", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(
      style.title ?? hostOf(style.url) ?? "",
      tab.x + 12 * s,
      tab.y + tab.h / 2,
      tab.w - 24 * s,
    );
    // address bar
    const bar: Rect = {
      x: g.outer.x + 90 * s,
      y: top + g.toolbarH * 0.55,
      w: g.outer.w - 180 * s,
      h: g.toolbarH * 0.36,
    };
    roundRectPath(ctx, bar, bar.h / 2);
    ctx.fillStyle = dark ? "#14151a" : "#f3f3f7";
    ctx.fill();
    ctx.fillStyle = dark ? "#a9aab6" : "#555";
    ctx.fillText(
      hostOf(style.url),
      bar.x + 16 * s,
      bar.y + bar.h / 2,
      bar.w - 32 * s,
    );
    ctx.fillStyle = "#000";
    ctx.fillRect(g.screen.x, g.screen.y, g.screen.w, g.screen.h);
  }
  ctx.restore();
  return g.screen;
}

/** Draw what sits in front of the screen (call after the captured pixels). */
export function drawDeviceOverlay(
  ctx: CanvasRenderingContext2D,
  kind: DeviceFrameKind,
  box: Rect,
): void {
  if (kind !== "mobile") return;
  const g = frameGeometry(kind, box);
  ctx.save();
  // bezel ring: outer rounded rect minus rounded screen (even-odd) hides square content corners
  ctx.beginPath();
  roundRectSubpath(ctx, g.outer, g.radius);
  roundRectSubpath(ctx, g.screen, g.screenRadius);
  ctx.fillStyle = "#0b0b0f";
  ctx.fill("evenodd");
  // dynamic island
  const w = 120 * g.scale;
  const h = 34 * g.scale;
  roundRectPath(
    ctx,
    {
      x: g.screen.x + (g.screen.w - w) / 2,
      y: g.screen.y + 11 * g.scale,
      w,
      h,
    },
    h / 2,
  );
  ctx.fillStyle = "#000";
  ctx.fill();
  // home indicator
  const hw = 134 * g.scale;
  const hh = 5 * g.scale;
  roundRectPath(
    ctx,
    {
      x: g.screen.x + (g.screen.w - hw) / 2,
      y: g.screen.y + g.screen.h - 12 * g.scale,
      w: hw,
      h: hh,
    },
    hh / 2,
  );
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fill();
  ctx.restore();
}
