// src/studio/proto/interaction.ts
// Turns pointer events into ripple adds. Ripple sources (see README): same-origin iframe
// listeners, or a transparent "demo overlay" that intercepts pointer events.
import type { RippleField, RippleKind } from "./ripples";

export interface PointerLike {
  type: string;
  clientX: number;
  clientY: number;
  pointerType?: string;
  buttons?: number;
}
export interface ElementRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const DRAG_THROTTLE_MS = 40;

/** Pure: normalized coords + kind for an event, or null when it should be ignored. */
export function toRipple(
  e: PointerLike,
  rect: ElementRect,
): { nx: number; ny: number; kind: RippleKind } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  if (
    e.type === "pointerdown" ||
    e.type === "mousedown" ||
    e.type === "touchstart"
  ) {
    return {
      nx,
      ny,
      kind:
        e.pointerType === "touch" || e.type === "touchstart"
          ? "touch"
          : "click",
    };
  }
  if (
    (e.type === "pointermove" || e.type === "mousemove") &&
    (e.buttons ?? 0) > 0
  ) {
    return { nx, ny, kind: "drag" };
  }
  return null;
}

/** Stateful converter that throttles drag samples. */
export function createPointerSource(
  field: RippleField,
  getRect: () => ElementRect,
  now: () => number = () => performance.now(),
) {
  let lastDrag = -Infinity;
  return {
    handle(e: PointerLike): boolean {
      const r = toRipple(e, getRect());
      if (!r) return false;
      const t = now();
      if (r.kind === "drag") {
        if (t - lastDrag < DRAG_THROTTLE_MS) return false;
        lastDrag = t;
      }
      field.add(r.nx, r.ny, t, r.kind);
      return true;
    },
  };
}

/**
 * Listen to pointer events INSIDE a same-origin iframe. Returns a detach function, or null
 * when the frame is cross-origin (SecurityError) so the UI can fall back to overlay mode.
 */
export function attachSameOriginListener(
  iframe: HTMLIFrameElement,
  onPointer: (e: PointerEvent) => void,
): (() => void) | null {
  let detach: (() => void) | null = null;
  const attach = (): boolean => {
    detach?.();
    detach = null;
    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument;
    } catch {
      return false;
    }
    if (!doc) return false;
    const types = ["pointerdown", "pointermove"] as const;
    for (const t of types)
      doc.addEventListener(t, onPointer as EventListener, true);
    detach = () => {
      for (const t of types)
        doc.removeEventListener(t, onPointer as EventListener, true);
    };
    return true;
  };
  if (!attach()) return null;
  const onLoad = () => {
    attach();
  };
  iframe.addEventListener("load", onLoad);
  return () => {
    iframe.removeEventListener("load", onLoad);
    detach?.();
    detach = null;
  };
}
