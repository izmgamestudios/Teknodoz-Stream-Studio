import { describe, expect, it } from "vitest";

import { createPointerSource, toRipple } from "./interaction";
import { RippleField } from "./ripples";

const rect = { left: 100, top: 100, width: 200, height: 400 };

describe("toRipple", () => {
  it("normalizes coordinates and classifies touch vs click", () => {
    expect(
      toRipple(
        {
          type: "pointerdown",
          clientX: 200,
          clientY: 300,
          pointerType: "touch",
        },
        rect,
      ),
    ).toEqual({
      nx: 0.5,
      ny: 0.5,
      kind: "touch",
    });
    expect(
      toRipple(
        {
          type: "pointerdown",
          clientX: 100,
          clientY: 100,
          pointerType: "mouse",
        },
        rect,
      ),
    ).toEqual({
      nx: 0,
      ny: 0,
      kind: "click",
    });
  });
  it("ignores outside-rect, hover moves and degenerate rects", () => {
    expect(
      toRipple({ type: "pointerdown", clientX: 50, clientY: 300 }, rect),
    ).toBeNull();
    expect(
      toRipple(
        { type: "pointermove", clientX: 150, clientY: 150, buttons: 0 },
        rect,
      ),
    ).toBeNull();
    expect(
      toRipple(
        { type: "pointermove", clientX: 150, clientY: 150, buttons: 1 },
        rect,
      )?.kind,
    ).toBe("drag");
    expect(
      toRipple(
        { type: "pointerdown", clientX: 1, clientY: 1 },
        { left: 0, top: 0, width: 0, height: 0 },
      ),
    ).toBeNull();
    expect(
      toRipple({ type: "pointerdown", clientX: NaN, clientY: 1 }, rect),
    ).toBeNull();
  });
});

describe("createPointerSource", () => {
  it("throttles drag samples but not taps", () => {
    const f = new RippleField();
    let t = 0;
    const src = createPointerSource(
      f,
      () => rect,
      () => t,
    );
    expect(
      src.handle({ type: "pointerdown", clientX: 150, clientY: 150 }),
    ).toBe(true);
    t = 10;
    expect(
      src.handle({
        type: "pointermove",
        clientX: 151,
        clientY: 150,
        buttons: 1,
      }),
    ).toBe(true);
    t = 20;
    expect(
      src.handle({
        type: "pointermove",
        clientX: 152,
        clientY: 150,
        buttons: 1,
      }),
    ).toBe(false);
    t = 80;
    expect(
      src.handle({
        type: "pointermove",
        clientX: 153,
        clientY: 150,
        buttons: 1,
      }),
    ).toBe(true);
    expect(f.count).toBe(3);
  });
});
