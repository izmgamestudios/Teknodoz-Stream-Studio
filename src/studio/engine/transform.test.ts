import { describe, expect, it } from "vitest";
import type { Transform } from "../types";
import {
  HANDLE_IDS,
  ROTATE_HANDLE_OFFSET,
  clamp,
  clamp01,
  clampToStage,
  clientToStage,
  computeStageFit,
  containRect,
  coverSourceRect,
  degToRad,
  handleCursor,
  handlePositions,
  hitTestHandle,
  hitTestLayer,
  isResizeHandle,
  layerBounds,
  layerCenter,
  layerCorners,
  moveLayer,
  normalizeDeg,
  pointInTransform,
  radToDeg,
  resizeFromHandle,
  rotateFromPointer,
  rotatePoint,
  snapToGuides,
  toLocal,
  type HandleId,
  type Point,
  type ResizeHandle,
} from "./transform";

const T = (
  x: number,
  y: number,
  w: number,
  h: number,
  rotation = 0,
): Transform => ({
  x,
  y,
  w,
  h,
  rotation,
});

function expectPoint(actual: Point, expected: Point, digits = 6): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

const OPPOSITE: Record<ResizeHandle, ResizeHandle> = {
  nw: "se",
  n: "s",
  ne: "sw",
  e: "w",
  se: "nw",
  s: "n",
  sw: "ne",
  w: "e",
};
const RESIZE_HANDLES: ResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];
const ANGLES = [0, 30, 45, 90, 137, -60, 180, 271];

describe("angles & scalars", () => {
  it("converts between degrees and radians", () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 10);
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90, 10);
  });

  it("normalizeDeg maps into (-180, 180]", () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(180)).toBe(180);
    expect(normalizeDeg(-180)).toBe(180);
    expect(normalizeDeg(190)).toBe(-170);
    expect(normalizeDeg(-190)).toBe(170);
    expect(normalizeDeg(720 + 45)).toBe(45);
    expect(normalizeDeg(Number.NaN)).toBe(0);
    expect(normalizeDeg(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("clamp / clamp01", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
  });
});

describe("rotatePoint / corners / bounds", () => {
  it("rotates clockwise on screen (y down)", () => {
    expectPoint(rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90), {
      x: 0,
      y: 1,
    });
    expectPoint(rotatePoint({ x: 0, y: -1 }, { x: 0, y: 0 }, 90), {
      x: 1,
      y: 0,
    });
    expectPoint(rotatePoint({ x: 3, y: 4 }, { x: 3, y: 4 }, 77), {
      x: 3,
      y: 4,
    });
  });

  it("rotation by 0 returns a copy", () => {
    const p = { x: 5, y: 6 };
    const r = rotatePoint(p, { x: 0, y: 0 }, 0);
    expect(r).toEqual(p);
    expect(r).not.toBe(p);
  });

  it("360 degrees is the identity", () => {
    expectPoint(rotatePoint({ x: 7, y: -2 }, { x: 1, y: 1 }, 360), {
      x: 7,
      y: -2,
    });
  });

  it("layerCenter and unrotated corners", () => {
    const t = T(100, 50, 200, 100);
    expect(layerCenter(t)).toEqual({ x: 200, y: 100 });
    const c = layerCorners(t);
    expectPoint(c[0], { x: 100, y: 50 });
    expectPoint(c[1], { x: 300, y: 50 });
    expectPoint(c[2], { x: 300, y: 150 });
    expectPoint(c[3], { x: 100, y: 150 });
  });

  it("rotated corners keep the center and distances", () => {
    const t = T(100, 50, 200, 100, 90);
    const c = layerCorners(t);
    // 90 deg clockwise around (200,100): TL (100,50) -> (250,0)
    expectPoint(c[0], { x: 250, y: 0 });
    expectPoint(c[1], { x: 250, y: 200 });
    expectPoint(c[2], { x: 150, y: 200 });
    expectPoint(c[3], { x: 150, y: 0 });
  });

  it("layerBounds of a rotated box", () => {
    const b = layerBounds(T(100, 50, 200, 100, 90));
    expect(b.x).toBeCloseTo(150, 6);
    expect(b.y).toBeCloseTo(0, 6);
    expect(b.w).toBeCloseTo(100, 6);
    expect(b.h).toBeCloseTo(200, 6);
    const b45 = layerBounds(T(0, 0, 100, 100, 45));
    expect(b45.w).toBeCloseTo(Math.SQRT2 * 100, 6);
  });

  it("non-finite rotation is treated as 0", () => {
    const c = layerCorners(T(0, 0, 10, 10, Number.NaN));
    expectPoint(c[0], { x: 0, y: 0 });
    expectPoint(c[2], { x: 10, y: 10 });
  });
});

describe("toLocal / pointInTransform", () => {
  it("toLocal inverts the rotation around the center", () => {
    const t = T(0, 0, 100, 40, 90);
    // The TR corner of a 90deg-rotated box is at center + rotate((50,-20)) = (50,20)+(20,50)
    const tr = layerCorners(t)[1];
    const l = toLocal(t, tr.x, tr.y);
    expect(l.x).toBeCloseTo(50, 6);
    expect(l.y).toBeCloseTo(-20, 6);
  });

  it("detects points inside an unrotated box, borders included", () => {
    const t = T(10, 10, 100, 50);
    expect(pointInTransform(t, 10, 10)).toBe(true);
    expect(pointInTransform(t, 110, 60)).toBe(true);
    expect(pointInTransform(t, 60, 35)).toBe(true);
    expect(pointInTransform(t, 9, 35)).toBe(false);
    expect(pointInTransform(t, 60, 61)).toBe(false);
  });

  it("accounts for rotation", () => {
    // Wide, flat box rotated 90deg becomes tall and narrow.
    const t = T(0, 0, 200, 20, 90); // center (100,10)
    expect(pointInTransform(t, 100, 100)).toBe(true); // along the new vertical extent
    expect(pointInTransform(t, 190, 10)).toBe(false); // outside horizontally now
    expect(pointInTransform(t, 100, 205)).toBe(false);
  });

  it("rejects zero / negative sizes", () => {
    expect(pointInTransform(T(0, 0, 0, 10), 0, 0)).toBe(false);
    expect(pointInTransform(T(0, 0, 10, -1), 5, 5)).toBe(false);
    expect(pointInTransform(T(0, 0, Number.NaN, 10), 5, 5)).toBe(false);
  });
});

describe("hitTestLayer", () => {
  const layer = (id: string, t: Transform, visible = true, locked = false) => ({
    id,
    visible,
    locked,
    transform: t,
  });

  it("returns the top-most layer under the point (last = top)", () => {
    const layers = [
      layer("a", T(0, 0, 200, 200)),
      layer("b", T(100, 100, 200, 200)),
    ];
    expect(hitTestLayer(layers, 150, 150)).toBe("b");
    expect(hitTestLayer(layers, 50, 50)).toBe("a");
    expect(hitTestLayer(layers, 500, 500)).toBeNull();
  });

  it("skips invisible and locked layers", () => {
    const layers = [
      layer("bottom", T(0, 0, 100, 100)),
      layer("hidden", T(0, 0, 100, 100), false),
      layer("locked", T(0, 0, 100, 100), true, true),
    ];
    expect(hitTestLayer(layers, 50, 50)).toBe("bottom");
    expect(hitTestLayer([layers[1]!, layers[2]!], 50, 50)).toBeNull();
  });

  it("accounts for rotation", () => {
    const rotated = layer("r", T(0, 0, 200, 20, 90));
    expect(hitTestLayer([rotated], 100, 100)).toBe("r");
    expect(hitTestLayer([rotated], 180, 10)).toBeNull();
  });

  it("ignores zero-size layers and bad coordinates; empty list", () => {
    expect(hitTestLayer([layer("z", T(0, 0, 0, 0))], 0, 0)).toBeNull();
    expect(
      hitTestLayer([layer("a", T(0, 0, 10, 10))], Number.NaN, 5),
    ).toBeNull();
    expect(hitTestLayer([], 5, 5)).toBeNull();
  });
});

describe("handlePositions / hitTestHandle", () => {
  it("places 8 resize handles and the rotation handle for an unrotated box", () => {
    const h = handlePositions(T(100, 100, 200, 100));
    expectPoint(h.nw, { x: 100, y: 100 });
    expectPoint(h.n, { x: 200, y: 100 });
    expectPoint(h.ne, { x: 300, y: 100 });
    expectPoint(h.e, { x: 300, y: 150 });
    expectPoint(h.se, { x: 300, y: 200 });
    expectPoint(h.s, { x: 200, y: 200 });
    expectPoint(h.sw, { x: 100, y: 200 });
    expectPoint(h.w, { x: 100, y: 150 });
    expectPoint(h.rotate, { x: 200, y: 100 - ROTATE_HANDLE_OFFSET });
    expect(Object.keys(h)).toHaveLength(9);
  });

  it("handles follow the rotation and a custom rotate offset", () => {
    const h = handlePositions(T(0, 0, 100, 100, 90), 40);
    // center (50,50); n handle (50,0) rotated 90deg clockwise -> (100,50)
    expectPoint(h.n, { x: 100, y: 50 });
    expectPoint(h.rotate, { x: 50 + 90, y: 50 });
  });

  it("hit-tests each handle at its position (rotated or not)", () => {
    for (const rot of ANGLES) {
      const t = T(300, 200, 400, 240, rot);
      const pos = handlePositions(t);
      for (const id of HANDLE_IDS) {
        const p = pos[id];
        expect(hitTestHandle(t, p.x, p.y, 16)).toBe(id);
      }
    }
  });

  it("returns null away from the handles and for bad input", () => {
    const t = T(300, 200, 400, 240);
    expect(hitTestHandle(t, 500, 320, 16)).toBeNull(); // box center
    expect(hitTestHandle(t, 306, 206, 0)).toBeNull();
    expect(hitTestHandle(t, Number.NaN, 0, 16)).toBeNull();
  });

  it("respects the handle size", () => {
    const t = T(0, 0, 400, 300);
    expect(hitTestHandle(t, 6, 6, 16)).toBe("nw");
    expect(hitTestHandle(t, 9, 9, 16)).toBeNull();
    expect(hitTestHandle(t, 9, 9, 24)).toBe("nw");
  });

  it("picks the nearest handle on tiny boxes where handles overlap", () => {
    const t = T(100, 100, 6, 6);
    expect(hitTestHandle(t, 100.5, 100.5, 20)).toBe("nw");
    expect(hitTestHandle(t, 105.5, 105.5, 20)).toBe("se");
  });
});

describe("handleCursor", () => {
  it("maps handles to cursors at rotation 0", () => {
    expect(handleCursor("n", 0)).toBe("ns-resize");
    expect(handleCursor("s", 0)).toBe("ns-resize");
    expect(handleCursor("e", 0)).toBe("ew-resize");
    expect(handleCursor("w", 0)).toBe("ew-resize");
    expect(handleCursor("nw", 0)).toBe("nwse-resize");
    expect(handleCursor("se", 0)).toBe("nwse-resize");
    expect(handleCursor("ne", 0)).toBe("nesw-resize");
    expect(handleCursor("sw", 0)).toBe("nesw-resize");
    expect(handleCursor("rotate", 0)).toBe("grab");
  });

  it("rotates the cursor with the box", () => {
    expect(handleCursor("e", 90)).toBe("ns-resize");
    expect(handleCursor("n", 90)).toBe("ew-resize");
    expect(handleCursor("nw", 90)).toBe("nesw-resize");
    expect(handleCursor("e", 180)).toBe("ew-resize");
    expect(handleCursor("e", 45)).toBe("nwse-resize");
  });
});

describe("resizeFromHandle", () => {
  it("returns an unchanged copy for the rotate handle", () => {
    const t = T(1, 2, 30, 40, 15);
    const r = resizeFromHandle(t, "rotate", 100, 100);
    expect(r).toEqual(t);
    expect(r).not.toBe(t);
  });

  it("resizes an unrotated box from each handle", () => {
    const t = T(100, 100, 200, 100);
    expect(resizeFromHandle(t, "e", 50, 99)).toEqual(T(100, 100, 250, 100));
    expect(resizeFromHandle(t, "w", -30, 99)).toEqual(T(70, 100, 230, 100));
    expect(resizeFromHandle(t, "s", 99, 40)).toEqual(T(100, 100, 200, 140));
    expect(resizeFromHandle(t, "n", 99, -20)).toEqual(T(100, 80, 200, 120));
    expect(resizeFromHandle(t, "se", 10, 20)).toEqual(T(100, 100, 210, 120));
    expect(resizeFromHandle(t, "nw", -10, -20)).toEqual(T(90, 80, 210, 120));
    expect(resizeFromHandle(t, "ne", 10, -20)).toEqual(T(100, 80, 210, 120));
    expect(resizeFromHandle(t, "sw", -10, 20)).toEqual(T(90, 100, 210, 120));
  });

  it("keeps the opposite anchor pinned and moves the handle by the delta, for ROTATED boxes", () => {
    for (const rot of ANGLES) {
      for (const handle of RESIZE_HANDLES) {
        const t = T(300, 200, 400, 240, rot);
        const before = handlePositions(t);
        const dx = 37;
        const dy = -23;
        const next = resizeFromHandle(t, handle, dx, dy);
        const after = handlePositions(next);
        const opp = OPPOSITE[handle];
        expectPoint(after[opp], before[opp], 5);
        expect(next.rotation).toBe(t.rotation);
        expect(next.w).toBeGreaterThan(0);
        expect(next.h).toBeGreaterThan(0);

        // The dragged handle moved by the delta projected on the axes the handle controls.
        const rad = degToRad(rot);
        const ax = { x: Math.cos(rad), y: Math.sin(rad) }; // local +x in stage space
        const ay = { x: -Math.sin(rad), y: Math.cos(rad) }; // local +y in stage space
        const lx = dx * ax.x + dy * ax.y;
        const ly = dx * ay.x + dy * ay.y;
        const isCorner = handle.length === 2;
        const movesX = handle.includes("e") || handle.includes("w");
        const movesY = handle.includes("n") || handle.includes("s");
        const px = isCorner || movesX ? lx : 0;
        const py = isCorner || movesY ? ly : 0;
        const expected = {
          x: before[handle].x + px * ax.x + py * ay.x,
          y: before[handle].y + px * ax.y + py * ay.y,
        };
        expectPoint(after[handle], expected, 5);
      }
    }
  });

  it("dragging a rotated east handle along the stage x axis only moves by the projected amount", () => {
    const t = T(0, 0, 100, 100, 90); // local x points down the screen
    const r = resizeFromHandle(t, "e", 50, 0); // horizontal drag is perpendicular to local x
    expect(r.w).toBeCloseTo(100, 6);
    const r2 = resizeFromHandle(t, "e", 0, 50); // vertical drag grows the width
    expect(r2.w).toBeCloseTo(150, 6);
  });

  it("fromCenter resizes symmetrically and keeps the center", () => {
    for (const rot of [0, 33, 90]) {
      const t = T(100, 100, 200, 100, rot);
      const c = layerCenter(t);
      for (const handle of RESIZE_HANDLES) {
        const next = resizeFromHandle(t, handle, 20, 10, { fromCenter: true });
        expectPoint(layerCenter(next), c, 6);
      }
      const next = resizeFromHandle(T(100, 100, 200, 100), "e", 20, 0, {
        fromCenter: true,
      });
      expect(next.w).toBe(240);
      expect(next.x).toBe(80);
    }
  });

  it("keepAspect preserves the ratio for corners and edges and pins the opposite corner", () => {
    for (const rot of ANGLES) {
      for (const handle of RESIZE_HANDLES) {
        const t = T(300, 200, 400, 200, rot);
        const next = resizeFromHandle(t, handle, 45, 12, { keepAspect: true });
        expect(next.w / next.h).toBeCloseTo(2, 6);
        if (handle.length === 2) {
          const before = handlePositions(t);
          const after = handlePositions(next);
          const opp = OPPOSITE[handle];
          expectPoint(after[opp], before[opp], 5);
        }
      }
    }
  });

  it("keepAspect on a corner follows the axis that changed more", () => {
    const t = T(0, 0, 400, 200);
    const wide = resizeFromHandle(t, "se", 200, 1, { keepAspect: true });
    expect(wide.w).toBeCloseTo(600, 6);
    expect(wide.h).toBeCloseTo(300, 6);
    const tall = resizeFromHandle(t, "se", 1, 200, { keepAspect: true });
    expect(tall.h).toBeCloseTo(400, 6);
    expect(tall.w).toBeCloseTo(800, 6);
  });

  it("enforces minSize without flipping and keeps the opposite edge pinned", () => {
    const t = T(100, 100, 200, 100);
    const r = resizeFromHandle(t, "w", 500, 0, { minSize: 20 });
    expect(r.w).toBe(20);
    expect(r.x + r.w).toBeCloseTo(300, 6); // east edge stays
    const r2 = resizeFromHandle(t, "nw", 999, 999, { minSize: 10 });
    expect(r2.w).toBe(10);
    expect(r2.h).toBe(10);
    expect(r2.x + r2.w).toBeCloseTo(300, 6);
    expect(r2.y + r2.h).toBeCloseTo(200, 6);
  });

  it("uses a default minSize of 8", () => {
    const r = resizeFromHandle(T(0, 0, 100, 100), "e", -1000, 0);
    expect(r.w).toBe(8);
  });

  it("keepAspect with minSize never goes below the minimum on either axis", () => {
    const r = resizeFromHandle(T(0, 0, 400, 100), "se", -1000, -1000, {
      keepAspect: true,
      minSize: 20,
    });
    expect(r.w).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(r.h).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(r.w / r.h).toBeCloseTo(4, 6);
  });

  it("treats non-finite deltas as zero", () => {
    const t = T(10, 10, 100, 100);
    expect(
      resizeFromHandle(t, "se", Number.NaN, Number.POSITIVE_INFINITY),
    ).toEqual(t);
  });

  it("does not mutate its input", () => {
    const t = T(10, 10, 100, 100, 20);
    const copy = { ...t };
    resizeFromHandle(t, "se", 30, 30);
    expect(t).toEqual(copy);
  });
});

describe("rotateFromPointer", () => {
  const t = T(100, 100, 200, 100); // center (200,150)

  it("points the rotation handle at the pointer", () => {
    expect(rotateFromPointer(t, 200, 0).rotation).toBeCloseTo(0, 6); // above
    expect(rotateFromPointer(t, 400, 150).rotation).toBeCloseTo(90, 6); // right
    expect(rotateFromPointer(t, 200, 400).rotation).toBeCloseTo(180, 6); // below
    expect(rotateFromPointer(t, 0, 150).rotation).toBeCloseTo(-90, 6); // left
  });

  it("round-trips with handlePositions().rotate", () => {
    for (const rot of [-170, -75, -10, 0, 12, 90, 135, 179]) {
      const rotated = { ...t, rotation: rot };
      const h = handlePositions(rotated).rotate;
      expect(rotateFromPointer(t, h.x, h.y).rotation).toBeCloseTo(rot, 5);
    }
  });

  it("snaps to 15 degrees with shift and to a custom step with snapDeg", () => {
    // 22 degrees clockwise from "up"
    const rad = degToRad(22);
    const px = 200 + Math.sin(rad) * 100;
    const py = 150 - Math.cos(rad) * 100;
    expect(rotateFromPointer(t, px, py, { shift: true }).rotation).toBe(15);
    expect(rotateFromPointer(t, px, py, { snapDeg: 45 }).rotation).toBe(0);
    expect(rotateFromPointer(t, px, py, { snapDeg: 10 }).rotation).toBe(20);
    expect(rotateFromPointer(t, px, py).rotation).toBeCloseTo(22, 6);
    // explicit snapDeg wins over shift
    expect(
      rotateFromPointer(t, px, py, { shift: true, snapDeg: 30 }).rotation,
    ).toBe(30);
  });

  it("snapped angles land exactly on multiples of 15 and stay normalized", () => {
    for (let a = -179; a <= 180; a += 7) {
      const rad = degToRad(a);
      const r = rotateFromPointer(
        t,
        200 + Math.sin(rad) * 80,
        150 - Math.cos(rad) * 80,
        {
          shift: true,
        },
      ).rotation;
      expect(Math.abs(r % 15)).toBeLessThan(1e-9);
      expect(r).toBeGreaterThan(-180);
      expect(r).toBeLessThanOrEqual(180);
    }
  });

  it("keeps the current rotation when the pointer is exactly on the center or non-finite", () => {
    const rotated = { ...t, rotation: 33 };
    expect(rotateFromPointer(rotated, 200, 150).rotation).toBe(33);
    expect(rotateFromPointer(rotated, Number.NaN, 150).rotation).toBe(33);
  });

  it("only changes the rotation", () => {
    const r = rotateFromPointer(t, 400, 150);
    expect({ ...r, rotation: 0 }).toEqual({ ...t, rotation: 0 });
  });
});

describe("moveLayer", () => {
  it("translates and keeps the other fields", () => {
    expect(moveLayer(T(10, 20, 30, 40, 5), 7, -3)).toEqual(
      T(17, 17, 30, 40, 5),
    );
  });

  it("lockAxis keeps only the dominant axis", () => {
    expect(moveLayer(T(0, 0, 1, 1), 10, 3, { lockAxis: true })).toEqual(
      T(10, 0, 1, 1),
    );
    expect(moveLayer(T(0, 0, 1, 1), 2, -9, { lockAxis: true })).toEqual(
      T(0, -9, 1, 1),
    );
  });

  it("ignores non-finite deltas and does not mutate", () => {
    const t = T(1, 1, 1, 1);
    expect(moveLayer(t, Number.NaN, Number.POSITIVE_INFINITY)).toEqual(t);
    expect(moveLayer(t, 5, 5)).not.toBe(t);
    expect(t).toEqual(T(1, 1, 1, 1));
  });
});

describe("snapToGuides", () => {
  const stage = { w: 1920, h: 1080 };

  it("snaps the left edge and top edge to the stage edges", () => {
    const r = snapToGuides(T(6, 4, 300, 200), stage, 10);
    expect(r.transform.x).toBe(0);
    expect(r.transform.y).toBe(0);
    expect(r.snappedX && r.snappedY).toBe(true);
    expect(r.guides).toEqual(
      expect.arrayContaining([
        { axis: "x", pos: 0, kind: "edge" },
        { axis: "y", pos: 0, kind: "edge" },
      ]),
    );
  });

  it("snaps the right and bottom edges", () => {
    const r = snapToGuides(
      T(1920 - 300 - 5, 1080 - 200 + 7, 300, 200),
      stage,
      10,
    );
    expect(r.transform.x).toBe(1620);
    expect(r.transform.y).toBe(880);
    expect(r.guides).toEqual(
      expect.arrayContaining([
        { axis: "x", pos: 1920, kind: "edge" },
        { axis: "y", pos: 1080, kind: "edge" },
      ]),
    );
  });

  it("snaps the box center to the stage center", () => {
    const r = snapToGuides(
      T(960 - 150 + 4, 540 - 100 - 6, 300, 200),
      stage,
      10,
    );
    expect(r.transform.x).toBe(810);
    expect(r.transform.y).toBe(440);
    expect(r.guides).toEqual(
      expect.arrayContaining([
        { axis: "x", pos: 960, kind: "center" },
        { axis: "y", pos: 540, kind: "center" },
      ]),
    );
  });

  it("does not snap outside the threshold and returns an equal transform", () => {
    const t = T(100, 100, 300, 200);
    const r = snapToGuides(t, stage, 10);
    expect(r.transform).toEqual(t);
    expect(r.guides).toEqual([]);
    expect(r.snappedX).toBe(false);
    expect(r.snappedY).toBe(false);
  });

  it("snaps each axis independently", () => {
    const r = snapToGuides(T(5, 300, 300, 200), stage, 10);
    expect(r.snappedX).toBe(true);
    expect(r.snappedY).toBe(false);
    expect(r.transform).toEqual(T(0, 300, 300, 200));
  });

  it("picks the closest candidate when several are in range", () => {
    // Left edge 8 px from 0, center 3 px from the stage center -> center wins.
    const r = snapToGuides(
      T(8, 540 - 100 + 3, 2 * (960 - 8) - 6 + 6, 200),
      stage,
      10,
    );
    expect(r.snappedY).toBe(true);
    expect(r.transform.y).toBe(440);
  });

  it("uses the bounds of the rotated shape", () => {
    // A 100x100 box rotated 45deg has half-diagonal 70.71; put its bounds 4px from the left edge.
    const half = (100 * Math.SQRT2) / 2;
    const t = T(half + 4 - 50, 400, 100, 100, 45); // center x = half + 4
    const r = snapToGuides(t, stage, 10);
    expect(layerBounds(r.transform).x).toBeCloseTo(0, 6);
  });

  it("threshold 0 only snaps exact alignment; negative / NaN thresholds are treated as 0", () => {
    expect(snapToGuides(T(1, 1, 10, 10), stage, 0).snappedX).toBe(false);
    expect(snapToGuides(T(0, 0, 10, 10), stage, 0).snappedX).toBe(true);
    expect(snapToGuides(T(1, 1, 10, 10), stage, -5).snappedX).toBe(false);
    expect(snapToGuides(T(1, 1, 10, 10), stage, Number.NaN).snappedX).toBe(
      false,
    );
  });

  it("does not mutate the input and works on a different stage size", () => {
    const t = T(3, 3, 10, 10);
    snapToGuides(t, { w: 100, h: 100 }, 5);
    expect(t).toEqual(T(3, 3, 10, 10));
    const r = snapToGuides(T(47, 47, 10, 10), { w: 100, h: 100 }, 5);
    expect(r.transform).toEqual(T(45, 45, 10, 10));
  });
});

describe("clampToStage", () => {
  const stage = { w: 1920, h: 1080 };

  it("leaves boxes already on stage untouched", () => {
    const t = T(100, 100, 300, 200, 20);
    expect(clampToStage(t, stage)).toEqual(t);
  });

  it("pulls boxes back inside on every side", () => {
    expect(clampToStage(T(-50, 10, 100, 100), stage).x).toBe(0);
    expect(clampToStage(T(10, -50, 100, 100), stage).y).toBe(0);
    expect(clampToStage(T(1900, 10, 100, 100), stage).x).toBe(1820);
    expect(clampToStage(T(10, 1050, 100, 100), stage).y).toBe(980);
  });

  it("uses the rotated bounds", () => {
    const t = T(-10, 400, 200, 100, 90); // bounds x = 40 - ... compute via helper
    const c = clampToStage(t, stage);
    const b = layerBounds(c);
    expect(b.x).toBeGreaterThanOrEqual(-1e-9);
    expect(b.x + b.w).toBeLessThanOrEqual(1920 + 1e-9);
    expect(c.rotation).toBe(90);
  });

  it("centers boxes bigger than the stage", () => {
    const c = clampToStage(T(500, 500, 3000, 2000), stage);
    expect(c.x).toBeCloseTo((1920 - 3000) / 2, 6);
    expect(c.y).toBeCloseTo((1080 - 2000) / 2, 6);
  });

  it("minVisible keeps a sliver of the box reachable but allows overhang", () => {
    const left = clampToStage(T(-500, 10, 200, 100), stage, { minVisible: 40 });
    expect(left.x).toBeCloseTo(-160, 6); // 40 px remain on stage
    const right = clampToStage(T(1900, 10, 200, 100), stage, {
      minVisible: 40,
    });
    expect(right.x).toBe(1880);
    const inside = clampToStage(T(-100, 10, 200, 100), stage, {
      minVisible: 40,
    });
    expect(inside.x).toBe(-100); // already has 100px visible
    const tiny = clampToStage(T(-500, 10, 20, 100), stage, { minVisible: 40 });
    expect(tiny.x).toBeCloseTo(0, 6); // cannot show more than its own width
  });
});

describe("fit helpers", () => {
  it("coverSourceRect crops the longer axis, centered", () => {
    expect(coverSourceRect(1920, 1080, 100, 100)).toEqual({
      x: (1920 - 1080) / 2,
      y: 0,
      w: 1080,
      h: 1080,
    });
    expect(coverSourceRect(1000, 2000, 200, 100)).toEqual({
      x: 0,
      y: 750,
      w: 1000,
      h: 500,
    });
    expect(coverSourceRect(1600, 900, 1920, 1080)).toEqual({
      x: 0,
      y: 0,
      w: 1600,
      h: 900,
    });
  });

  it("coverSourceRect handles degenerate sizes", () => {
    expect(coverSourceRect(0, 0, 10, 10)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(coverSourceRect(100, 50, 0, 10)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 50,
    });
    expect(coverSourceRect(-1, 5, 10, 10)).toEqual({ x: 0, y: 0, w: 0, h: 5 });
  });

  it("containRect letterboxes / pillarboxes inside the box", () => {
    expect(containRect(1920, 1080, { x: 10, y: 20, w: 100, h: 100 })).toEqual({
      x: 10,
      y: 20 + (100 - 56.25) / 2,
      w: 100,
      h: 56.25,
    });
    const tall = containRect(1080, 1920, { x: 0, y: 0, w: 200, h: 200 });
    expect(tall.h).toBe(200);
    expect(tall.w).toBeCloseTo(112.5, 6);
    expect(tall.x).toBeCloseTo((200 - 112.5) / 2, 6);
    expect(containRect(100, 100, { x: 5, y: 5, w: 100, h: 100 })).toEqual({
      x: 5,
      y: 5,
      w: 100,
      h: 100,
    });
  });

  it("containRect handles degenerate input", () => {
    expect(containRect(0, 10, { x: 1, y: 2, w: 30, h: 40 })).toEqual({
      x: 1,
      y: 2,
      w: 30,
      h: 40,
    });
    expect(containRect(10, 10, { x: 1, y: 2, w: 0, h: 40 })).toEqual({
      x: 1,
      y: 2,
      w: 0,
      h: 40,
    });
  });

  it("computeStageFit scales uniformly and letterboxes other aspect ratios", () => {
    expect(computeStageFit(1920, 1080)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    expect(computeStageFit(1280, 720)).toEqual({
      scale: 1280 / 1920,
      offsetX: 0,
      offsetY: 0,
    });
    const square = computeStageFit(1000, 1000);
    expect(square.scale).toBeCloseTo(1000 / 1920, 9);
    expect(square.offsetX).toBeCloseTo(0, 6);
    expect(square.offsetY).toBeCloseTo((1000 - 1080 * (1000 / 1920)) / 2, 6);
    const ultra = computeStageFit(3840, 1080);
    expect(ultra.scale).toBe(1);
    expect(ultra.offsetX).toBe(960);
    expect(computeStageFit(0, 100)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("clientToStage inverts the stage fit", () => {
    const rect = { left: 100, top: 50, width: 960, height: 540 };
    expect(clientToStage(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(clientToStage(100 + 960, 50 + 540, rect)).toEqual({
      x: 1920,
      y: 1080,
    });
    expect(clientToStage(580, 320, rect)).toEqual({ x: 960, y: 540 });
    // letterboxed display: 1000x1000 canvas, stage centered vertically
    const sq = { left: 0, top: 0, width: 1000, height: 1000 };
    const fit = computeStageFit(1000, 1000);
    const p = clientToStage(500, 500, sq);
    expect(p.x).toBeCloseTo(960, 6);
    expect(p.y).toBeCloseTo(540, 6);
    expect(clientToStage(0, fit.offsetY, sq).y).toBeCloseTo(0, 6);
    expect(
      clientToStage(5, 5, { left: 0, top: 0, width: 0, height: 0 }),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe("misc exports", () => {
  it("isResizeHandle distinguishes rotate", () => {
    expect(isResizeHandle("rotate")).toBe(false);
    for (const h of RESIZE_HANDLES)
      expect(isResizeHandle(h as HandleId)).toBe(true);
  });

  it("HANDLE_IDS lists corners first and has 9 unique entries", () => {
    expect(HANDLE_IDS).toHaveLength(9);
    expect(new Set(HANDLE_IDS).size).toBe(9);
    expect(HANDLE_IDS.slice(0, 4)).toEqual(["nw", "ne", "se", "sw"]);
  });
});
