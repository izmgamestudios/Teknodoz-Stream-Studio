// src/studio/engine/transform.ts
// Pure 2D geometry for the studio stage: hit-testing, resize/rotate handles, snapping and the
// logical -> output mapping used by the compositor. No DOM, no canvas, no side effects, so every
// function here is trivially unit-testable and SSR-safe.
//
// Conventions
//  - All inputs/outputs are in LOGICAL stage pixels (1920x1080, see types.ts) unless a function
//    says otherwise. Callers that work with screen pixels convert before/after calling.
//  - Y grows downwards. Positive rotation is clockwise, in degrees (same as CanvasRenderingContext2D.rotate).
//  - A Transform is a top-left anchored box rotated around its own center.
//  - Every function returns NEW objects and never mutates its arguments.

import type { Layer, Rect, Transform } from "../types";

/* ------------------------------------------------------------------ */
/* Basic types & angle helpers                                         */
/* ------------------------------------------------------------------ */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EPS = 1e-6;

/** Number.isFinite narrowing helper that also treats `undefined`/NaN as 0. */
function finiteOr0(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

export function degToRad(deg: number): number {
  return deg * DEG_TO_RAD;
}

export function radToDeg(rad: number): number {
  return rad * RAD_TO_DEG;
}

/** Normalizes an angle to the half-open range (-180, 180]. Non-finite input yields 0. */
export function normalizeDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const r = ((deg % 360) + 360) % 360; // [0, 360)
  return r > 180 ? r - 360 : r;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0;
}

/* ------------------------------------------------------------------ */
/* Points, corners, bounds                                             */
/* ------------------------------------------------------------------ */

/** Rotates `p` around `center` by `deg` degrees (clockwise on screen). */
export function rotatePoint(p: Point, center: Point, deg: number): Point {
  if (deg === 0) return { x: p.x, y: p.y };
  const rad = degToRad(deg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/** Center of the (unrotated == rotated) box. */
export function layerCenter(t: Transform): Point {
  return { x: t.x + t.w / 2, y: t.y + t.h / 2 };
}

/** The four corners of the rotated box in the order TL, TR, BR, BL. */
export function layerCorners(t: Transform): [Point, Point, Point, Point] {
  const c = layerCenter(t);
  const rot = finiteOr0(t.rotation);
  return [
    rotatePoint({ x: t.x, y: t.y }, c, rot),
    rotatePoint({ x: t.x + t.w, y: t.y }, c, rot),
    rotatePoint({ x: t.x + t.w, y: t.y + t.h }, c, rot),
    rotatePoint({ x: t.x, y: t.y + t.h }, c, rot),
  ];
}

/** Axis-aligned bounding box of the rotated box. */
export function layerBounds(t: Transform): Rect {
  const corners = layerCorners(t);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of corners) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Converts a stage point into the box's local frame (origin at the box center, unrotated). */
export function toLocal(t: Transform, px: number, py: number): Point {
  const c = layerCenter(t);
  const rad = degToRad(finiteOr0(t.rotation));
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - c.x;
  const dy = py - c.y;
  // rotate by -rad
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

/** True if the stage point lies inside (or on the border of) the rotated box. */
export function pointInTransform(
  t: Transform,
  px: number,
  py: number,
): boolean {
  if (!(t.w > 0) || !(t.h > 0)) return false;
  const l = toLocal(t, px, py);
  return Math.abs(l.x) <= t.w / 2 + EPS && Math.abs(l.y) <= t.h / 2 + EPS;
}

/* ------------------------------------------------------------------ */
/* Layer hit-testing                                                   */
/* ------------------------------------------------------------------ */

/** Minimal structural subset of a Layer needed for hit-testing. */
export type HitTestable = Pick<
  Layer,
  "id" | "visible" | "locked" | "transform"
>;

/**
 * Returns the id of the top-most visible, unlocked layer under the point, or null.
 * `layers` is ordered bottom -> top like Scene.layers, so the search runs from the end.
 * Locked layers are click-through. Zero/negative-size layers can never be hit.
 */
export function hitTestLayer(
  layers: readonly HitTestable[],
  px: number,
  py: number,
): string | null {
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer || !layer.visible || layer.locked) continue;
    if (pointInTransform(layer.transform, px, py)) return layer.id;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Handles                                                             */
/* ------------------------------------------------------------------ */

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type HandleId = ResizeHandle | "rotate";

/** Hit-test priority order: corners first, then rotate, then edges. */
export const HANDLE_IDS: readonly HandleId[] = [
  "nw",
  "ne",
  "se",
  "sw",
  "rotate",
  "n",
  "e",
  "s",
  "w",
];

/** Direction signs (x, y) in the local frame: -1 = left/top, +1 = right/bottom, 0 = fixed axis. */
const HANDLE_DIR: Record<ResizeHandle, readonly [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

export function isResizeHandle(h: HandleId): h is ResizeHandle {
  return h !== "rotate";
}

/** Default distance (logical px) of the rotation handle above the top edge. */
export const ROTATE_HANDLE_OFFSET = 28;
/** Snap step used when Shift is held while rotating. */
export const ROTATE_SNAP_DEG = 15;

/**
 * Stage positions of the 8 resize handles plus the rotation handle (above the top-center,
 * `rotateOffset` px away from the edge, following the box rotation).
 */
export function handlePositions(
  t: Transform,
  rotateOffset: number = ROTATE_HANDLE_OFFSET,
): Record<HandleId, Point> {
  const c = layerCenter(t);
  const rot = finiteOr0(t.rotation);
  const hw = t.w / 2;
  const hh = t.h / 2;
  const at = (lx: number, ly: number): Point =>
    rotatePoint({ x: c.x + lx, y: c.y + ly }, c, rot);
  return {
    nw: at(-hw, -hh),
    n: at(0, -hh),
    ne: at(hw, -hh),
    e: at(hw, 0),
    se: at(hw, hh),
    s: at(0, hh),
    sw: at(-hw, hh),
    w: at(-hw, 0),
    rotate: at(0, -hh - Math.max(0, finiteOr0(rotateOffset))),
  };
}

/**
 * Which handle (if any) is under the point. Handles are squares of `handleSizePx` that rotate
 * with the box. When several overlap (tiny boxes) the nearest handle center wins; exact ties
 * follow HANDLE_IDS order (corners before edges).
 */
export function hitTestHandle(
  t: Transform,
  px: number,
  py: number,
  handleSizePx: number,
  rotateOffset: number = ROTATE_HANDLE_OFFSET,
): HandleId | null {
  if (!Number.isFinite(px) || !Number.isFinite(py) || !(handleSizePx > 0))
    return null;
  const half = handleSizePx / 2;
  const local = toLocal(t, px, py);
  const hw = t.w / 2;
  const hh = t.h / 2;
  const off = Math.max(0, finiteOr0(rotateOffset));
  let best: HandleId | null = null;
  let bestDist = Infinity;
  for (const id of HANDLE_IDS) {
    let hx: number;
    let hy: number;
    if (id === "rotate") {
      hx = 0;
      hy = -hh - off;
    } else {
      const dir = HANDLE_DIR[id];
      hx = dir[0] * hw;
      hy = dir[1] * hh;
    }
    const dx = local.x - hx;
    const dy = local.y - hy;
    if (Math.abs(dx) > half || Math.abs(dy) > half) continue;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist - EPS) {
      best = id;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * CSS cursor name for a handle, accounting for the box rotation (so a rotated box shows the
 * resize cursor that matches the visual direction of the handle).
 */
export function handleCursor(handle: HandleId, rotationDeg: number): string {
  if (handle === "rotate") return "grab";
  const [sx, sy] = HANDLE_DIR[handle];
  // angle of the handle direction on screen, 0 = pointing right, clockwise positive
  const angle = normalizeDeg(
    radToDeg(Math.atan2(sy, sx)) + finiteOr0(rotationDeg),
  );
  const a = ((angle % 180) + 180) % 180; // direction is symmetric: 0..180
  // buckets centered on 0 (ew), 45 (nwse), 90 (ns), 135 (nesw)
  if (a < 22.5 || a >= 157.5) return "ew-resize";
  if (a < 67.5) return "nwse-resize";
  if (a < 112.5) return "ns-resize";
  return "nesw-resize";
}

/* ------------------------------------------------------------------ */
/* Resize / rotate / move                                              */
/* ------------------------------------------------------------------ */

export interface ResizeOptions {
  /** Keep the width/height ratio of the starting box (Shift). */
  keepAspect?: boolean;
  /** Resize symmetrically around the box center (Alt). */
  fromCenter?: boolean;
  /** Smallest allowed width/height in logical px (default 8). The box never flips. */
  minSize?: number;
}

/**
 * Resizes a (possibly rotated) box by dragging `handle` with the pointer delta (dx, dy), both in
 * stage coordinates. The delta is projected into the box's local frame, the dragged edges move
 * there, and the opposite edge/corner (or the center with `fromCenter`) stays pinned in the stage.
 * Returns `t` unchanged for the rotation handle. Rotation is preserved.
 */
export function resizeFromHandle(
  t: Transform,
  handle: HandleId,
  dx: number,
  dy: number,
  opts: ResizeOptions = {},
): Transform {
  if (!isResizeHandle(handle)) return { ...t };
  const [sx, sy] = HANDLE_DIR[handle];
  const minSize = Math.max(1e-3, opts.minSize ?? 8);
  const k = opts.fromCenter ? 2 : 1;
  const rot = finiteOr0(t.rotation);
  const rad = degToRad(rot);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ddx = finiteOr0(dx);
  const ddy = finiteOr0(dy);
  // pointer delta in the local (unrotated) frame
  const ldx = ddx * cos + ddy * sin;
  const ldy = -ddx * sin + ddy * cos;

  let w = t.w + sx * ldx * k;
  let h = t.h + sy * ldy * k;

  if (opts.keepAspect && t.w > 0 && t.h > 0) {
    const minScale = Math.max(minSize / t.w, minSize / t.h);
    let scale: number;
    if (sx !== 0 && sy !== 0) {
      // corner: follow whichever axis changed more (relative to its size)
      const rw = w / t.w;
      const rh = h / t.h;
      scale = Math.abs(rw - 1) >= Math.abs(rh - 1) ? rw : rh;
    } else if (sx !== 0) {
      scale = w / t.w;
    } else {
      scale = h / t.h;
    }
    scale = Math.max(scale, minScale);
    w = t.w * scale;
    h = t.h * scale;
  } else {
    if (sx !== 0) w = Math.max(w, minSize);
    if (sy !== 0) h = Math.max(h, minSize);
  }

  // Center displacement in the local frame so the opposite side stays pinned.
  // (Edge handles with keepAspect scale the perpendicular axis around its center line: sx/sy = 0.)
  const lcx = opts.fromCenter ? 0 : (sx * (w - t.w)) / 2;
  const lcy = opts.fromCenter ? 0 : (sy * (h - t.h)) / 2;
  const cx = t.x + t.w / 2 + lcx * cos - lcy * sin;
  const cy = t.y + t.h / 2 + lcx * sin + lcy * cos;
  return { x: cx - w / 2, y: cy - h / 2, w, h, rotation: t.rotation };
}

export interface RotateOptions {
  /** Snap to multiples of this many degrees. */
  snapDeg?: number;
  /** Convenience: when true and `snapDeg` is not given, snap to ROTATE_SNAP_DEG (15). */
  shift?: boolean;
}

/**
 * Rotation that makes the rotation handle (which sits straight above the box center at rotation 0)
 * point towards the pointer. Result is normalized to (-180, 180]. A pointer exactly on the center
 * leaves the rotation unchanged.
 */
export function rotateFromPointer(
  t: Transform,
  px: number,
  py: number,
  opts: RotateOptions = {},
): Transform {
  const c = layerCenter(t);
  const dx = px - c.x;
  const dy = py - c.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0))
    return { ...t };
  let deg = normalizeDeg(radToDeg(Math.atan2(dy, dx)) + 90);
  const step = opts.snapDeg ?? (opts.shift ? ROTATE_SNAP_DEG : 0);
  if (step > 0) deg = normalizeDeg(Math.round(deg / step) * step);
  return { ...t, rotation: deg };
}

export interface MoveOptions {
  /** Constrain movement to the dominant axis (Shift-drag). */
  lockAxis?: boolean;
}

/** Translates a box by (dx, dy). Non-finite deltas count as 0. */
export function moveLayer(
  t: Transform,
  dx: number,
  dy: number,
  opts: MoveOptions = {},
): Transform {
  let mx = finiteOr0(dx);
  let my = finiteOr0(dy);
  if (opts.lockAxis) {
    if (Math.abs(mx) >= Math.abs(my)) my = 0;
    else mx = 0;
  }
  return { ...t, x: t.x + mx, y: t.y + my };
}

/* ------------------------------------------------------------------ */
/* Snapping & clamping                                                 */
/* ------------------------------------------------------------------ */

export interface Guide {
  /** "x" = a vertical line at x = pos, "y" = a horizontal line at y = pos. */
  axis: "x" | "y";
  pos: number;
  kind: "edge" | "center";
}

export interface SnapResult {
  transform: Transform;
  guides: Guide[];
  snappedX: boolean;
  snappedY: boolean;
}

/**
 * Snaps the box (using the bounds of its rotated shape) so its left/center/right and
 * top/middle/bottom align with the stage edges and centers when within `thresholdPx`.
 * Each axis snaps independently to the closest candidate. `guides` lists every stage line the
 * snapped box now touches, ready to be drawn as an overlay.
 */
export function snapToGuides(
  t: Transform,
  stage: Size,
  thresholdPx: number,
): SnapResult {
  const b = layerBounds(t);
  const threshold = Math.max(0, finiteOr0(thresholdPx));
  const xTargets: [number, Guide["kind"]][] = [
    [0, "edge"],
    [stage.w / 2, "center"],
    [stage.w, "edge"],
  ];
  const yTargets: [number, Guide["kind"]][] = [
    [0, "edge"],
    [stage.h / 2, "center"],
    [stage.h, "edge"],
  ];
  const xFeatures = [b.x, b.x + b.w / 2, b.x + b.w];
  const yFeatures = [b.y, b.y + b.h / 2, b.y + b.h];

  const bestShift = (
    features: number[],
    targets: [number, Guide["kind"]][],
  ): number | null => {
    let best: number | null = null;
    for (const f of features) {
      for (const [target] of targets) {
        const d = target - f;
        if (
          Math.abs(d) <= threshold &&
          (best === null || Math.abs(d) < Math.abs(best) - EPS)
        ) {
          best = d;
        }
      }
    }
    return best;
  };

  const sx = bestShift(xFeatures, xTargets);
  const sy = bestShift(yFeatures, yTargets);
  const ox = sx ?? 0;
  const oy = sy ?? 0;

  const guides: Guide[] = [];
  const collect = (
    axis: "x" | "y",
    shift: number | null,
    features: number[],
    targets: [number, Guide["kind"]][],
  ): void => {
    if (shift === null) return;
    for (const [pos, kind] of targets) {
      if (features.some((f) => Math.abs(f + shift - pos) < 1e-4)) {
        if (
          !guides.some((g) => g.axis === axis && Math.abs(g.pos - pos) < 1e-4)
        ) {
          guides.push({ axis, pos, kind });
        }
      }
    }
  };
  collect("x", sx, xFeatures, xTargets);
  collect("y", sy, yFeatures, yTargets);

  return {
    transform: { ...t, x: t.x + ox, y: t.y + oy },
    guides,
    snappedX: sx !== null,
    snappedY: sy !== null,
  };
}

export interface ClampOptions {
  /**
   * When set, the box may leave the stage but at least this many px of its bounds must remain
   * visible on each axis (so a layer can never be dragged out of reach). When omitted the whole
   * bounds are kept inside the stage (centered on an axis if the box is larger than the stage).
   */
  minVisible?: number;
}

/** Translates the box so it stays on stage (see ClampOptions). Size and rotation are kept. */
export function clampToStage(
  t: Transform,
  stage: Size,
  opts: ClampOptions = {},
): Transform {
  const b = layerBounds(t);
  let shiftX = 0;
  let shiftY = 0;
  if (opts.minVisible === undefined) {
    shiftX = fitAxis(b.x, b.w, stage.w);
    shiftY = fitAxis(b.y, b.h, stage.h);
  } else {
    const m = Math.max(0, finiteOr0(opts.minVisible));
    shiftX = keepVisible(b.x, b.w, stage.w, m);
    shiftY = keepVisible(b.y, b.h, stage.h, m);
  }
  return { ...t, x: t.x + shiftX, y: t.y + shiftY };
}

function fitAxis(pos: number, size: number, limit: number): number {
  if (size >= limit) return (limit - size) / 2 - pos;
  if (pos < 0) return -pos;
  if (pos + size > limit) return limit - size - pos;
  return 0;
}

function keepVisible(
  pos: number,
  size: number,
  limit: number,
  minVisible: number,
): number {
  const m = Math.min(minVisible, size, limit);
  if (pos + size < m) return m - (pos + size); // too far left/top
  if (pos > limit - m) return limit - m - pos; // too far right/bottom
  return 0;
}

/* ------------------------------------------------------------------ */
/* Fit helpers (used by the compositor, handy for the UI too)          */
/* ------------------------------------------------------------------ */

/**
 * Source crop rectangle (in source pixels) that makes the source COVER a destination of
 * `destW x destH` (object-fit: cover, centered). Degenerate sizes return the whole source.
 */
export function coverSourceRect(
  srcW: number,
  srcH: number,
  destW: number,
  destH: number,
): Rect {
  if (!(srcW > 0) || !(srcH > 0) || !(destW > 0) || !(destH > 0)) {
    return { x: 0, y: 0, w: Math.max(0, srcW), h: Math.max(0, srcH) };
  }
  const srcAspect = srcW / srcH;
  const destAspect = destW / destH;
  if (srcAspect > destAspect) {
    const w = srcH * destAspect;
    return { x: (srcW - w) / 2, y: 0, w, h: srcH };
  }
  const h = srcW / destAspect;
  return { x: 0, y: (srcH - h) / 2, w: srcW, h };
}

/** Largest rect with the source aspect that fits inside `box` (object-fit: contain, centered). */
export function containRect(srcW: number, srcH: number, box: Rect): Rect {
  if (!(srcW > 0) || !(srcH > 0) || !(box.w > 0) || !(box.h > 0)) {
    return { x: box.x, y: box.y, w: Math.max(0, box.w), h: Math.max(0, box.h) };
  }
  const scale = Math.min(box.w / srcW, box.h / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

export interface StageFit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Maps the logical stage (stageW x stageH, default 1920x1080) onto an output canvas with a
 * UNIFORM scale, centered (letterboxed when the aspect ratios differ so rotations never skew).
 * For 16:9 outputs the offsets are 0 and scale = outW / 1920.
 */
export function computeStageFit(
  outW: number,
  outH: number,
  stageW = 1920,
  stageH = 1080,
): StageFit {
  if (!(outW > 0) || !(outH > 0) || !(stageW > 0) || !(stageH > 0)) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(outW / stageW, outH / stageH);
  return {
    scale,
    offsetX: (outW - stageW * scale) / 2,
    offsetY: (outH - stageH * scale) / 2,
  };
}

/** Converts a pointer position inside a displayed canvas rect to logical stage coordinates. */
export function clientToStage(
  clientX: number,
  clientY: number,
  canvasRect: { left: number; top: number; width: number; height: number },
  stageW = 1920,
  stageH = 1080,
): Point {
  if (!(canvasRect.width > 0) || !(canvasRect.height > 0))
    return { x: 0, y: 0 };
  const fit = computeStageFit(
    canvasRect.width,
    canvasRect.height,
    stageW,
    stageH,
  );
  return {
    x: (clientX - canvasRect.left - fit.offsetX) / fit.scale,
    y: (clientY - canvasRect.top - fit.offsetY) / fit.scale,
  };
}
