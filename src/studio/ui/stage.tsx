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
import {
  useProject,
  useRuntimeSnapshot,
  useStudio,
} from "../runtime/use-studio";
import { safeZoneFor, stageFor } from "../format";
import { useSafeZones } from "./safe-zones";
import type { Transform } from "../types";

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
  const out = project.settings.output;
  const stage = stageFor(out.width, out.height);
  const LOGICAL_W = stage.w;
  const LOGICAL_H = stage.h;
  const ratio = LOGICAL_W / LOGICAL_H;
  const showZones = useSafeZones();
  const countdown = useRuntimeSnapshot().countdown;
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
    <div
      className="relative mx-auto w-full overflow-hidden rounded-lg border bg-black"
      style={{
        aspectRatio: `${LOGICAL_W} / ${LOGICAL_H}`,
        // tall formats (9:16) must not push the controls off-screen
        width: `min(100%, ${(78 * ratio).toFixed(2)}vh)`,
      }}
    >
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
        {showZones && (
          <g pointerEvents="none" aria-hidden="true">
            {safeZoneFor(stage).unsafe.map((u, i) => (
              <rect
                key={i}
                x={u.x}
                y={u.y}
                width={u.w}
                height={u.h}
                fill="rgba(239,68,68,0.16)"
              />
            ))}
            {(() => {
              const z = safeZoneFor(stage).safe;
              return (
                <rect
                  x={z.x}
                  y={z.y}
                  width={z.w}
                  height={z.h}
                  fill="none"
                  stroke="rgba(34,197,94,0.85)"
                  strokeWidth={3}
                  strokeDasharray="14 10"
                />
              );
            })()}
          </g>
        )}
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
      {countdown > 0 && (
        <div
          role="status"
          aria-live="assertive"
          className="pointer-events-none absolute inset-0 grid place-items-center bg-black/50"
        >
          <span className="text-[min(40vw,16rem)] font-black leading-none text-primary drop-shadow-lg">
            {countdown}
          </span>
        </div>
      )}
      <span className="pointer-events-none absolute bottom-1 right-2 text-[10px] text-white/50">
        Shift: oran/15° · Alt: merkezden
      </span>
    </div>
  );
}
