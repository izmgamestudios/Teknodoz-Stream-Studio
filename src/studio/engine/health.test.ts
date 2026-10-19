import { describe, expect, it } from "vitest";

import { assessHealth, type HealthInput } from "./health";

const base: HealthInput = {
  fps: 60,
  targetFps: 60,
  frameMs: 6,
  droppedDelta: 0,
  masterPeakDb: -12,
  micPresent: true,
  micMuted: false,
  recording: false,
  width: 1920,
  height: 1080,
  tabHidden: false,
};
const ids = (i: Partial<HealthInput>) =>
  assessHealth({ ...base, ...i }).issues.map((x) => x.id);

describe("assessHealth", () => {
  it("is ok for a healthy session", () => {
    expect(assessHealth(base)).toEqual({ level: "ok", issues: [] });
  });
  it("flags low frame rate by severity", () => {
    expect(assessHealth({ ...base, fps: 45 }).level).toBe("warn");
    expect(assessHealth({ ...base, fps: 20 }).level).toBe("bad");
    expect(ids({ fps: 0 })).not.toContain("fps-low"); // not rendering yet
  });
  it("flags slow frames and dropped frames", () => {
    expect(ids({ frameMs: 20 })).toContain("frame-slow");
    expect(ids({ droppedDelta: 12 })).toContain("dropped");
    expect(ids({ droppedDelta: 2 })).not.toContain("dropped");
  });
  it("flags clipping and loud audio", () => {
    expect(assessHealth({ ...base, masterPeakDb: 0 }).level).toBe("bad");
    expect(ids({ masterPeakDb: -2 })).toEqual(["loud"]);
  });
  it("only complains about the mic while recording", () => {
    expect(ids({ micPresent: false })).toEqual([]);
    expect(ids({ micPresent: false, recording: true })).toEqual(["no-mic"]);
    expect(ids({ micMuted: true, recording: true })).toEqual(["mic-muted"]);
  });
  it("hidden tabs are critical only while recording", () => {
    expect(ids({ tabHidden: true })).toEqual([]);
    expect(
      assessHealth({ ...base, tabHidden: true, recording: true }).level,
    ).toBe("bad");
  });
  it("warns about heavy settings, storage and missing WebGL", () => {
    expect(ids({ width: 3840, height: 2160 })).toContain("heavy");
    expect(ids({ storageUsed: 0.95 })).toContain("storage");
    expect(ids({ webgl: false })).toContain("webgl");
  });
});
