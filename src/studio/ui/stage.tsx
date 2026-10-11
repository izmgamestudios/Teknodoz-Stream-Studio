// src/studio/ui/stage.tsx
// The program canvas plus an SVG selection overlay: click to select, drag to move, handles to
// resize/rotate (Shift = keep aspect / 15° snap, Alt = from center / no snapping).
import { useEffect, useRef, useState } from "react";

import {
  clientToStage,
  handleCursor,
  handlePositions,
  hitTestHandle,
  hitTestLayer,
  layerCorners,
  moveLayer,
  resizeFromHandle,
  rotateFromPointer,
  snapToGuides,
  type Guide,
  type HandleId,
} from "../engine/transform";
import { getActiveScene } from "../project/store";
import { useProject, useStudio } from "../runtime/use-studio";
import { LOGICAL_H, LOGICAL_W, type Transform } from "../types";

interface Drag {
  kind: "move" | "resize" | "rotate";
  handle?: HandleId;
  layerId: string;
  start: Transform;
  p0: { x: number; y: number };
}

const HANDLE_PX = 16;
const SNAP_PX = 10;

export function Stage({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const rt = useStudio();
  const project = useProject();
  const scene = getActiveScene(project);
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [cursor, setCursor] = useState("default");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    rt.mountCanvas(host);
    return () => rt.unmountCanvas(host);
  }, [rt]);

  const selected = scene.layers.find((l) => l.id === selectedId) ?? null;

  function geometry(e: { clientX: number; clientY: number }) {
    const rect = overlayRef.current!.getBoundingClientRect();
    const p = clientToStage(e.clientX, e.clientY, rect, LOGICAL_W, LOGICAL_H);
    const pxPerLogical = rect.width / LOGICAL_W || 1;
    return {
      p,
      handleSize: HANDLE_PX / pxPerLogical,
      snap: SNAP_PX / pxPerLogical,
    };
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    const { p, handleSize } = geometry(e);
    if (selected && !selected.locked && selected.visible) {
      const h = hitTestHandle(selected.transform, p.x, p.y, handleSize);
      if (h) {
        drag.current = {
          kind: h === "rotate" ? "rotate" : "resize",
          handle: h,
          layerId: selected.id,
          start: selected.transform,
          p0: p,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }
    const id = hitTestLayer(scene.layers, p.x, p.y);
    onSelect(id);
    const hit = scene.layers.find((l) => l.id === id);
    if (hit) {
      drag.current = {
        kind: "move",
        layerId: hit.id,
        start: hit.transform,
        p0: p,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const { p, snap, handleSize } = geometry(e);
    const d = drag.current;
    if (!d) {
      if (selected && !selected.locked) {
        const h = hitTestHandle(selected.transform, p.x, p.y, handleSize);
        setCursor(h ? handleCursor(h, selected.transform.rotation) : "default");
      }
      return;
    }
    const dx = p.x - d.p0.x;
    const dy = p.y - d.p0.y;
    let next: Transform;
    if (d.kind === "move") {
      next = moveLayer(d.start, dx, dy, { lockAxis: e.shiftKey });
      if (!e.altKey) {
        const s = snapToGuides(next, { w: LOGICAL_W, h: LOGICAL_H }, snap);
        next = s.transform;
        setGuides(s.guides);
      } else setGuides([]);
    } else if (d.kind === "resize" && d.handle) {
      next = resizeFromHandle(d.start, d.handle, dx, dy, {
        keepAspect: e.shiftKey,
        fromCenter: e.altKey,
      });
    } else {
      next = rotateFromPointer(d.start, p.x, p.y, { shift: e.shiftKey });
    }
    rt.project.updateLayer(
      scene.id,
      d.layerId,
      { transform: next },
      `drag:${d.layerId}`,
    );
  }

  function endDrag() {
    drag.current = null;
    setGuides([]);
  }

  const corners = selected ? layerCorners(selected.transform) : null;
  const handles = selected ? handlePositions(selected.transform) : null;
  const hs = 11;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-black">
      <div ref={hostRef} className="absolute inset-0" />
      <svg
        ref={overlayRef}
        viewBox={`0 0 ${LOGICAL_W} ${LOGICAL_H}`}
        className="absolute inset-0 h-full w-full touch-none select-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label="Sahne düzenleme alanı"
      >
        {guides.map((g, i) =>
          g.axis === "x" ? (
            <line
              key={i}
              x1={g.pos}
              x2={g.pos}
              y1={0}
              y2={LOGICAL_H}
              className="stroke-primary"
              strokeWidth={3}
              strokeDasharray="12 10"
            />
          ) : (
            <line
              key={i}
              y1={g.pos}
              y2={g.pos}
              x1={0}
              x2={LOGICAL_W}
              className="stroke-primary"
              strokeWidth={3}
              strokeDasharray="12 10"
            />
          ),
        )}
        {corners && handles && selected && (
          <g>
            <polygon
              points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
              fill="none"
              className="stroke-speaker-b"
              strokeWidth={3}
              strokeDasharray={selected.locked ? "10 8" : undefined}
            />
            {!selected.locked && (
              <>
                <line
                  x1={handles.n.x}
                  y1={handles.n.y}
                  x2={handles.rotate.x}
                  y2={handles.rotate.y}
                  className="stroke-speaker-b"
                  strokeWidth={3}
                />
                {(Object.keys(handles) as HandleId[]).map((k) => {
                  const h = handles[k];
                  return k === "rotate" ? (
                    <circle
                      key={k}
                      cx={h.x}
                      cy={h.y}
                      r={hs + 2}
                      className="fill-speaker-b"
                    />
                  ) : (
                    <rect
                      key={k}
                      x={h.x - hs}
                      y={h.y - hs}
                      width={hs * 2}
                      height={hs * 2}
                      className="fill-background stroke-speaker-b"
                      strokeWidth={3}
                    />
                  );
                })}
              </>
            )}
          </g>
        )}
      </svg>
      <span className="pointer-events-none absolute bottom-1 right-2 text-[10px] text-white/50">
        Shift: oran/15° · Alt: merkezden
      </span>
    </div>
  );
}
