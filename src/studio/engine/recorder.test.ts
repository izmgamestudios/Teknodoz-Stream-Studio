import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RecorderError,
  RecordingClock,
  StudioRecorder,
  type RecorderOptions,
  type RecorderWarning,
} from "./recorder";

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

class FakeTrack {
  readyState: "live" | "ended" = "live";
  stopCalls = 0;
  constructor(readonly kind: "audio" | "video") {}
  stop(): void {
    this.stopCalls++;
    this.readyState = "ended";
  }
}

class FakeStream {
  private readonly tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === "audio");
  }
}

interface DataEvent {
  data: Blob;
}

class FakeMediaRecorder {
  static supported = new Set<string>();
  static instances: FakeMediaRecorder[] = [];
  /** when true, stop() fires the `stop` event on a microtask */
  static autoStop = true;
  /** mimeTypes for which the constructor throws (NotSupportedError) */
  static rejectMime = new Set<string>();
  static rejectAll = false;
  static startThrows = false;

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.has(type);
  }
  static reset(): void {
    FakeMediaRecorder.supported = new Set();
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.autoStop = true;
    FakeMediaRecorder.rejectMime = new Set();
    FakeMediaRecorder.rejectAll = false;
    FakeMediaRecorder.startThrows = false;
  }

  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType: string;
  timeslice: number | undefined;
  ondataavailable: ((ev: DataEvent) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onstop: (() => void) | null = null;
  stopCalls = 0;

  constructor(
    readonly stream: FakeStream,
    readonly options: {
      mimeType?: string;
      videoBitsPerSecond?: number;
      audioBitsPerSecond?: number;
    } = {},
  ) {
    if (FakeMediaRecorder.rejectAll) throw new Error("NotSupportedError");
    if (
      options.mimeType &&
      FakeMediaRecorder.rejectMime.has(options.mimeType)
    ) {
      throw new Error("NotSupportedError");
    }
    this.mimeType = options.mimeType ?? "video/webm";
    FakeMediaRecorder.instances.push(this);
  }

  start(timeslice?: number): void {
    if (FakeMediaRecorder.startThrows) throw new Error("InvalidStateError");
    this.state = "recording";
    this.timeslice = timeslice;
  }
  pause(): void {
    this.state = "paused";
  }
  resume(): void {
    this.state = "recording";
  }
  stop(): void {
    this.stopCalls++;
    this.state = "inactive";
    if (FakeMediaRecorder.autoStop) queueMicrotask(() => this.fireStop());
  }

  emitData(bytes: number): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
  fireStop(): void {
    this.onstop?.();
  }
  fireError(message = "boom"): void {
    this.onerror?.({ error: { message } });
  }
}

const MP4 = "video/mp4;codecs=avc1.640034,mp4a.40.2";
const VP9 = "video/webm;codecs=vp9,opus";
const VP8 = "video/webm;codecs=vp8,opus";

function lastRecorder(): FakeMediaRecorder {
  const r = FakeMediaRecorder.instances[FakeMediaRecorder.instances.length - 1];
  if (!r) throw new Error("no MediaRecorder was created");
  return r;
}

interface Rig {
  rec: StudioRecorder;
  videoTrack: FakeTrack;
  audioTrack: FakeTrack;
  audio: FakeStream;
  canvas: { captureStream: ReturnType<typeof vi.fn> };
  warnings: RecorderWarning[];
  setNow(ms: number): void;
}

function makeRig(over: Partial<RecorderOptions> = {}, withAudio = true): Rig {
  let t = 0;
  const videoTrack = new FakeTrack("video");
  const audioTrack = new FakeTrack("audio");
  const audio = new FakeStream(withAudio ? [audioTrack] : []);
  const canvas = { captureStream: vi.fn(() => new FakeStream([videoTrack])) };
  const warnings: RecorderWarning[] = [];
  const rec = new StudioRecorder(
    canvas as unknown as HTMLCanvasElement,
    audio as unknown as MediaStream,
    {
      fps: 60,
      videoBitrate: 12_000_000,
      audioBitrate: 192_000,
      container: "auto",
      now: () => t,
      onWarning: (w) => warnings.push(w),
      ...over,
    },
  );
  return {
    rec,
    videoTrack,
    audioTrack,
    audio,
    canvas,
    warnings,
    setNow: (ms) => {
      t = ms;
    },
  };
}

beforeEach(() => {
  FakeMediaRecorder.reset();
  FakeMediaRecorder.supported = new Set([MP4, VP9, VP8, "video/webm"]);
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("MediaStream", FakeStream);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* pickMimeType                                                        */
/* ------------------------------------------------------------------ */

describe("StudioRecorder.pickMimeType", () => {
  it("prefers mp4 (avc1 + AAC) for auto and mp4", () => {
    expect(StudioRecorder.pickMimeType("auto")).toEqual({
      mimeType: MP4,
      ext: "mp4",
    });
    expect(StudioRecorder.pickMimeType("mp4")).toEqual({
      mimeType: MP4,
      ext: "mp4",
    });
  });

  it("walks the mp4 ladder in order", () => {
    FakeMediaRecorder.supported = new Set([
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
    ]);
    expect(StudioRecorder.pickMimeType("auto").mimeType).toBe(
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    );
    FakeMediaRecorder.supported = new Set(["video/mp4"]);
    expect(StudioRecorder.pickMimeType("auto")).toEqual({
      mimeType: "video/mp4",
      ext: "mp4",
    });
  });

  it("falls back to webm vp9, then vp8, then bare webm", () => {
    FakeMediaRecorder.supported = new Set([VP9, VP8, "video/webm"]);
    expect(StudioRecorder.pickMimeType("auto")).toEqual({
      mimeType: VP9,
      ext: "webm",
    });
    FakeMediaRecorder.supported = new Set([VP8, "video/webm"]);
    expect(StudioRecorder.pickMimeType("auto").mimeType).toBe(VP8);
    FakeMediaRecorder.supported = new Set(["video/webm"]);
    expect(StudioRecorder.pickMimeType("auto")).toEqual({
      mimeType: "video/webm",
      ext: "webm",
    });
  });

  it("honours an explicit webm container even when mp4 is available", () => {
    expect(StudioRecorder.pickMimeType("webm")).toEqual({
      mimeType: VP9,
      ext: "webm",
    });
  });

  it("falls back to the other container when the preference is unsupported", () => {
    FakeMediaRecorder.supported = new Set([VP9]);
    expect(StudioRecorder.pickMimeType("mp4")).toEqual({
      mimeType: VP9,
      ext: "webm",
    });
    FakeMediaRecorder.supported = new Set([MP4]);
    expect(StudioRecorder.pickMimeType("webm")).toEqual({
      mimeType: MP4,
      ext: "mp4",
    });
  });

  it("lets the browser choose when nothing matches", () => {
    FakeMediaRecorder.supported = new Set();
    expect(StudioRecorder.pickMimeType("auto")).toEqual({
      mimeType: "",
      ext: "webm",
    });
  });

  it("degrades gracefully without MediaRecorder or isTypeSupported", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(StudioRecorder.pickMimeType("auto")).toEqual({
      mimeType: "",
      ext: "webm",
    });
    vi.stubGlobal("MediaRecorder", class NoProbe {});
    expect(StudioRecorder.pickMimeType("auto")).toEqual({
      mimeType: "",
      ext: "webm",
    });
  });

  it("treats a throwing isTypeSupported as unsupported", () => {
    vi.stubGlobal(
      "MediaRecorder",
      class Throwing {
        static isTypeSupported(type: string): boolean {
          if (type === MP4) throw new Error("boom");
          return type === VP9;
        }
      },
    );
    expect(StudioRecorder.pickMimeType("auto")).toEqual({
      mimeType: VP9,
      ext: "webm",
    });
  });
});

/* ------------------------------------------------------------------ */
/* RecordingClock (pause-exclusion math)                               */
/* ------------------------------------------------------------------ */

describe("RecordingClock", () => {
  function clock(): { c: RecordingClock; set(ms: number): void } {
    let t = 1000; // non-zero origin: only differences matter
    return {
      c: new RecordingClock(() => t),
      set: (ms) => {
        t = 1000 + ms;
      },
    };
  }

  it("is 0 before start", () => {
    const { c } = clock();
    expect(c.elapsed()).toBe(0);
    expect(c.isRunning).toBe(false);
  });

  it("counts wall time while running", () => {
    const { c, set } = clock();
    c.start();
    set(2500);
    expect(c.elapsed()).toBe(2500);
  });

  it("excludes paused intervals", () => {
    const { c, set } = clock();
    c.start();
    set(5000);
    expect(c.pause()).toBe(true);
    set(9000);
    expect(c.elapsed()).toBe(5000); // frozen while paused
    expect(c.resume()).toBe(true);
    set(10_000);
    expect(c.elapsed()).toBe(6000);
    c.pause();
    set(12_000);
    c.resume();
    set(15_000);
    expect(c.elapsed()).toBe(9000); // 15000 - (4000 + 2000)
  });

  it("ignores redundant pause / resume calls", () => {
    const { c, set } = clock();
    c.start();
    set(1000);
    expect(c.resume()).toBe(false);
    expect(c.pause()).toBe(true);
    expect(c.pause()).toBe(false);
    set(3000);
    expect(c.elapsed()).toBe(1000);
  });

  it("stop() while paused freezes at the pause start", () => {
    const { c, set } = clock();
    c.start();
    set(4000);
    c.pause();
    set(9000);
    expect(c.stop()).toBe(4000);
    set(20_000);
    expect(c.elapsed()).toBe(4000);
    expect(c.stop()).toBe(4000);
    expect(c.pause()).toBe(false);
    expect(c.resume()).toBe(false);
  });

  it("never goes negative when the clock steps backwards", () => {
    const { c, set } = clock();
    c.start();
    set(-50);
    expect(c.elapsed()).toBe(0);
  });

  it("start() resets everything", () => {
    const { c, set } = clock();
    c.start();
    set(1000);
    c.pause();
    set(2000);
    c.stop();
    c.start();
    expect(c.elapsed()).toBe(0); // the new origin is "now"; the old pause is forgotten
    set(2500);
    expect(c.elapsed()).toBe(500);
    expect(c.isRunning).toBe(true);
    expect(c.isPaused).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* StudioRecorder lifecycle                                            */
/* ------------------------------------------------------------------ */

describe("StudioRecorder start", () => {
  it("builds one MediaStream with video + audio and starts a 1 s timeslice", () => {
    const { rec, videoTrack, audioTrack, canvas } = makeRig();
    rec.start();
    expect(canvas.captureStream).toHaveBeenCalledWith(60);
    const mr = lastRecorder();
    expect(mr.stream.getTracks()).toEqual([videoTrack, audioTrack]);
    expect(mr.timeslice).toBe(1000);
    expect(mr.options).toEqual({
      mimeType: MP4,
      videoBitsPerSecond: 12_000_000,
      audioBitsPerSecond: 192_000,
    });
    expect(rec.getState().status).toBe("recording");
    expect(rec.getState().ext).toBe("mp4");
    expect(rec.getState().mimeType).toBe(MP4);
    expect(rec.getState().startedAt).toBeTypeOf("number");
  });

  it("omits invalid bitrates", () => {
    const { rec } = makeRig({ videoBitrate: Number.NaN, audioBitrate: -5 });
    rec.start();
    expect(lastRecorder().options).toEqual({ mimeType: MP4 });
  });

  it("clamps absurd fps and falls back for invalid fps", () => {
    const a = makeRig({ fps: 5000 });
    a.rec.start();
    expect(a.canvas.captureStream).toHaveBeenCalledWith(240);
    const b = makeRig({ fps: Number.NaN });
    b.rec.start();
    expect(b.canvas.captureStream).toHaveBeenCalledWith(30);
  });

  it("works without an audio stream and does not warn", () => {
    const videoTrack = new FakeTrack("video");
    const warnings: RecorderWarning[] = [];
    const rec = new StudioRecorder(
      {
        captureStream: () => new FakeStream([videoTrack]),
      } as unknown as HTMLCanvasElement,
      null,
      {
        fps: 30,
        videoBitrate: 1,
        audioBitrate: 1,
        container: "webm",
        onWarning: (w) => warnings.push(w),
      },
    );
    rec.start();
    expect(lastRecorder().stream.getTracks()).toEqual([videoTrack]);
    expect(warnings).toEqual([]);
  });

  it("warns when the audio stream has no live track", () => {
    const { rec, warnings } = makeRig({}, false);
    rec.start();
    expect(warnings.map((w) => w.code)).toEqual(["no-audio"]);
  });

  it("skips ended audio tracks", () => {
    const { rec, audioTrack, warnings } = makeRig();
    audioTrack.readyState = "ended";
    rec.start();
    expect(lastRecorder().stream.getAudioTracks()).toEqual([]);
    expect(warnings.map((w) => w.code)).toContain("no-audio");
  });

  it("warns when the requested container is not available", () => {
    FakeMediaRecorder.supported = new Set([VP9]);
    const { rec, warnings } = makeRig({ container: "mp4" });
    rec.start();
    expect(rec.getState().ext).toBe("webm");
    expect(warnings.map((w) => w.code)).toEqual(["container-fallback"]);
  });

  it("derives the extension from the recorder's actual mimeType", () => {
    FakeMediaRecorder.supported = new Set();
    const { rec } = makeRig();
    rec.start();
    expect(rec.getState().ext).toBe("webm");
    expect(rec.getState().mimeType).toBe("video/webm");
  });

  it("retries without a mimeType when the browser rejects the chosen one", () => {
    FakeMediaRecorder.rejectMime = new Set([MP4]);
    const { rec, warnings } = makeRig();
    rec.start();
    expect(lastRecorder().options.mimeType).toBeUndefined();
    expect(warnings.map((w) => w.code)).toContain("mime-fallback");
    expect(rec.getState().status).toBe("recording");
  });

  it("throws start-failed and releases the canvas tracks when MediaRecorder cannot be built", () => {
    FakeMediaRecorder.rejectAll = true;
    const { rec, videoTrack } = makeRig();
    expect(() => rec.start()).toThrowError(RecorderError);
    try {
      rec.start();
    } catch (e) {
      expect((e as RecorderError).code).toBe("start-failed");
    }
    expect(videoTrack.stopCalls).toBeGreaterThan(0);
    expect(rec.getState().status).toBe("idle");
  });

  it("throws start-failed when MediaRecorder.start throws", () => {
    FakeMediaRecorder.startThrows = true;
    const { rec, videoTrack } = makeRig();
    expect(() => rec.start()).toThrowError(
      expect.objectContaining({ code: "start-failed" }),
    );
    expect(videoTrack.stopCalls).toBe(1);
    expect(rec.getState().status).toBe("idle");
  });

  it("throws unsupported without MediaRecorder", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const { rec } = makeRig();
    expect(() => rec.start()).toThrowError(
      expect.objectContaining({ code: "unsupported" }),
    );
  });

  it("throws unsupported when the canvas cannot be captured", () => {
    const rec = new StudioRecorder({} as unknown as HTMLCanvasElement, null, {
      fps: 30,
      videoBitrate: 1,
      audioBitrate: 1,
      container: "auto",
    });
    expect(() => rec.start()).toThrowError(
      expect.objectContaining({ code: "unsupported" }),
    );
  });

  it("throws start-failed when captureStream throws", () => {
    const rec = new StudioRecorder(
      {
        captureStream: () => {
          throw new Error("tainted");
        },
      } as unknown as HTMLCanvasElement,
      null,
      { fps: 30, videoBitrate: 1, audioBitrate: 1, container: "auto" },
    );
    expect(() => rec.start()).toThrowError(
      expect.objectContaining({ code: "start-failed" }),
    );
  });

  it("throws no-video-track when the canvas yields no video", () => {
    const rec = new StudioRecorder(
      {
        captureStream: () => new FakeStream([]),
      } as unknown as HTMLCanvasElement,
      null,
      { fps: 30, videoBitrate: 1, audioBitrate: 1, container: "auto" },
    );
    expect(() => rec.start()).toThrowError(
      expect.objectContaining({ code: "no-video-track" }),
    );
  });

  it("cannot be started twice", () => {
    const { rec } = makeRig();
    rec.start();
    expect(() => rec.start()).toThrowError(
      expect.objectContaining({ code: "invalid-state" }),
    );
  });
});

describe("StudioRecorder stop", () => {
  it("resolves with the blob, metadata and releases only its own tracks", async () => {
    const { rec, videoTrack, audioTrack, setNow } = makeRig();
    rec.start();
    const mr = lastRecorder();
    mr.emitData(100);
    mr.emitData(250);
    setNow(7500);
    const result = await rec.stop();
    expect(result.blob.size).toBe(350);
    expect(result.mimeType).toBe(MP4);
    expect(result.ext).toBe("mp4");
    expect(result.durationMs).toBe(7500);
    expect(result.markers).toEqual([]);
    expect(Math.abs(result.startedAt - Date.now())).toBeLessThan(5000);
    expect(videoTrack.stopCalls).toBe(1);
    expect(audioTrack.stopCalls).toBe(0); // owned by the audio bus
    expect(rec.getState().status).toBe("stopped");
    expect(mr.ondataavailable).toBeNull();
    expect(mr.onstop).toBeNull();
    expect(mr.onerror).toBeNull();
  });

  it("keeps data that arrives between stop() and the stop event", async () => {
    const { rec } = makeRig();
    rec.start();
    const mr = lastRecorder();
    mr.emitData(10);
    const p = rec.stop();
    mr.emitData(5);
    const result = await p;
    expect(result.blob.size).toBe(15);
  });

  it("ignores empty chunks", async () => {
    const { rec } = makeRig();
    rec.start();
    lastRecorder().emitData(0);
    expect(rec.getState().bytes).toBe(0);
    const result = await rec.stop();
    expect(result.blob.size).toBe(0);
  });

  it("is idempotent", async () => {
    const { rec } = makeRig();
    rec.start();
    const a = rec.stop();
    const b = rec.stop();
    expect(b).toBe(a);
    await a;
    expect(rec.stop()).toBe(a);
    expect(lastRecorder().stopCalls).toBe(1);
  });

  it("rejects before start", async () => {
    const { rec } = makeRig();
    await expect(rec.stop()).rejects.toMatchObject({ code: "invalid-state" });
  });

  it("finalizes after the watchdog when the stop event never arrives", async () => {
    vi.useFakeTimers();
    FakeMediaRecorder.autoStop = false;
    const { rec } = makeRig({ stopTimeoutMs: 2000 });
    rec.start();
    lastRecorder().emitData(42);
    const p = rec.stop();
    vi.advanceTimersByTime(1999);
    expect(rec.getState().status).toBe("stopping");
    vi.advanceTimersByTime(2);
    const result = await p;
    expect(result.blob.size).toBe(42);
    expect(rec.getState().status).toBe("stopped");
  });

  it("clears the watchdog when the stop event arrives", async () => {
    vi.useFakeTimers();
    FakeMediaRecorder.autoStop = false;
    const { rec } = makeRig({ stopTimeoutMs: 2000 });
    rec.start();
    const p = rec.stop();
    lastRecorder().fireStop();
    await p;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("finalizes when the browser ends the recording on its own", async () => {
    const { rec, setNow } = makeRig();
    rec.start();
    const mr = lastRecorder();
    mr.emitData(9);
    setNow(3000);
    mr.state = "inactive";
    mr.fireStop();
    expect(rec.getState().status).toBe("stopped");
    const result = await rec.stop();
    expect(result.blob.size).toBe(9);
    expect(result.durationMs).toBe(3000);
  });
});

describe("pause / resume and markers", () => {
  it("excludes paused time from marker timestamps and the duration", async () => {
    const { rec, setNow } = makeRig();
    rec.start();
    setNow(5000);
    expect(rec.addMarker("A")).toEqual({ t: 5000, label: "A" });
    setNow(8000);
    rec.pause();
    expect(rec.getState().status).toBe("paused");
    expect(lastRecorder().state).toBe("paused");
    setNow(20_000);
    rec.resume();
    expect(rec.getState().status).toBe("recording");
    setNow(23_000);
    expect(rec.addMarker("B")).toEqual({ t: 11_000, label: "B" }); // 23000 - 12000 paused
    setNow(24_000);
    rec.pause();
    setNow(27_000);
    expect(rec.addMarker("C")).toEqual({ t: 12_000, label: "C" }); // frozen while paused
    expect(rec.getElapsedMs()).toBe(12_000);
    setNow(30_000);
    rec.resume();
    setNow(40_000);
    expect(rec.getElapsedMs()).toBe(22_000);
    const result = await rec.stop();
    expect(result.durationMs).toBe(22_000);
    expect(result.markers.map((m) => m.t)).toEqual([5000, 11_000, 12_000]);
  });

  it("stopping while paused ends at the pause start", async () => {
    const { rec, setNow } = makeRig();
    rec.start();
    setNow(4000);
    rec.pause();
    setNow(60_000);
    const result = await rec.stop();
    expect(result.durationMs).toBe(4000);
  });

  it("pause and resume are no-ops outside their state", () => {
    const { rec } = makeRig();
    rec.pause();
    rec.resume();
    expect(rec.getState().status).toBe("idle");
    rec.start();
    rec.resume(); // not paused
    expect(rec.getState().status).toBe("recording");
    rec.pause();
    rec.pause();
    expect(rec.getState().status).toBe("paused");
  });

  it("names markers 'Bölüm N' by default", () => {
    const { rec, setNow } = makeRig();
    rec.start();
    setNow(1000);
    expect(rec.addMarker()?.label).toBe("Bölüm 1");
    setNow(2000);
    expect(rec.addMarker("")?.label).toBe("Bölüm 2");
    setNow(3000);
    expect(rec.addMarker("  Özel \n bölüm ")?.label).toBe("Özel bölüm");
    expect(rec.getState().markers.map((m) => m.label)).toEqual([
      "Bölüm 1",
      "Bölüm 2",
      "Özel bölüm",
    ]);
  });

  it("bounds marker labels", () => {
    const { rec } = makeRig();
    rec.start();
    const marker = rec.addMarker("x".repeat(500));
    expect(Array.from(marker?.label ?? "")).toHaveLength(100);
  });

  it("refuses markers when not recording", async () => {
    const { rec } = makeRig();
    expect(rec.addMarker("x")).toBeNull();
    rec.start();
    await rec.stop();
    expect(rec.addMarker("x")).toBeNull();
  });

  it("returns copies so callers cannot corrupt the recorder", async () => {
    const { rec } = makeRig();
    rec.start();
    const marker = rec.addMarker("A");
    if (marker) marker.label = "hacked";
    const result = await rec.stop();
    expect(result.markers[0]?.label).toBe("A");
    result.markers[0]!.label = "changed";
    expect(rec.getState().markers[0]?.label).toBe("A");
  });
});

describe("state and subscriptions", () => {
  it("keeps the snapshot identity until something changes", () => {
    const { rec } = makeRig();
    const a = rec.getState();
    expect(rec.getState()).toBe(a);
    rec.start();
    const b = rec.getState();
    expect(b).not.toBe(a);
    expect(rec.getState()).toBe(b);
  });

  it("notifies subscribers and supports unsubscribe", () => {
    const { rec } = makeRig();
    const cb = vi.fn();
    const off = rec.subscribe(cb);
    rec.start();
    expect(cb).toHaveBeenCalledTimes(1);
    rec.addMarker("a");
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    rec.addMarker("b");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("getState / subscribe are bound so they can be passed to useSyncExternalStore directly", () => {
    const { rec } = makeRig();
    const { getState, subscribe } = rec;
    const cb = vi.fn();
    const off = subscribe(cb);
    rec.start();
    expect(cb).toHaveBeenCalled();
    expect(getState().status).toBe("recording");
    off();
  });

  it("isolates faulty subscribers", () => {
    const { rec } = makeRig();
    const good = vi.fn();
    rec.subscribe(() => {
      throw new Error("bad subscriber");
    });
    rec.subscribe(good);
    expect(() => rec.start()).not.toThrow();
    expect(good).toHaveBeenCalled();
  });

  it("publishes byte counts per chunk without touching the markers array", () => {
    const { rec } = makeRig();
    rec.start();
    rec.addMarker("a");
    const markers = rec.getState().markers;
    lastRecorder().emitData(64);
    expect(rec.getState().bytes).toBe(64);
    expect(rec.getState().markers).toBe(markers);
  });

  it("isolates a throwing onWarning", () => {
    const { rec } = makeRig(
      {
        onWarning: () => {
          throw new Error("nope");
        },
      },
      false,
    );
    expect(() => rec.start()).not.toThrow();
  });
});

describe("size guard", () => {
  it("warns once at warnBytes and auto-stops at maxBytes", async () => {
    const { rec, warnings } = makeRig({ warnBytes: 100, maxBytes: 250 });
    rec.start();
    const mr = lastRecorder();
    mr.emitData(60);
    expect(warnings).toEqual([]);
    mr.emitData(60); // 120 >= 100
    mr.emitData(60); // 180
    expect(warnings.map((w) => w.code)).toEqual(["size-warning"]);
    expect(warnings[0]?.bytes).toBe(120);
    mr.emitData(100); // 280 >= 250 -> stop
    expect(warnings.map((w) => w.code)).toEqual(["size-warning", "size-limit"]);
    expect(mr.stopCalls).toBe(1);
    const result = await rec.stop(); // the result stays retrievable
    expect(result.blob.size).toBe(340 - 60);
    expect(rec.getState().status).toBe("stopped");
  });

  it("does not stop twice when more data arrives after the limit", async () => {
    const { rec, warnings } = makeRig({ warnBytes: 10, maxBytes: 20 });
    rec.start();
    const mr = lastRecorder();
    mr.emitData(30);
    mr.emitData(30);
    expect(warnings.filter((w) => w.code === "size-limit")).toHaveLength(1);
    expect(mr.stopCalls).toBe(1);
    await rec.stop();
  });
});

describe("errors", () => {
  it("rejects stop() with RecorderError and salvages a partial result", async () => {
    const { rec, videoTrack } = makeRig();
    rec.start();
    const mr = lastRecorder();
    mr.emitData(77);
    mr.fireError("encoder died");
    expect(rec.getState().status).toBe("error");
    expect(rec.getState().error).toBe("media-recorder-error");
    expect(videoTrack.stopCalls).toBe(1);
    const err = await rec.stop().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RecorderError);
    const typed = err as RecorderError;
    expect(typed.code).toBe("media-recorder-error");
    expect(typed.message).toBe("encoder died");
    expect(typed.partial?.blob.size).toBe(77);
    expect(rec.getError()).toBe(typed);
  });

  it("rejects a pending stop() when an error arrives", async () => {
    FakeMediaRecorder.autoStop = false;
    const { rec } = makeRig();
    rec.start();
    const p = rec.stop();
    lastRecorder().fireError();
    await expect(p).rejects.toMatchObject({ code: "media-recorder-error" });
  });

  it("has no partial result when nothing was recorded", async () => {
    const { rec } = makeRig();
    rec.start();
    lastRecorder().fireError();
    const err = (await rec.stop().catch((e: unknown) => e)) as RecorderError;
    expect(err.partial).toBeNull();
  });

  it("ignores the stop event that follows an error", async () => {
    const { rec } = makeRig();
    rec.start();
    const mr = lastRecorder();
    mr.emitData(5);
    mr.fireError();
    mr.fireStop();
    expect(rec.getState().status).toBe("error");
    await expect(rec.stop()).rejects.toBeInstanceOf(RecorderError);
  });
});

describe("dispose", () => {
  it("rejects a pending stop and releases resources", async () => {
    FakeMediaRecorder.autoStop = false;
    const { rec, videoTrack, audioTrack } = makeRig();
    rec.start();
    const p = rec.stop();
    rec.dispose();
    await expect(p).rejects.toMatchObject({ code: "disposed" });
    expect(videoTrack.stopCalls).toBe(1);
    expect(audioTrack.stopCalls).toBe(0);
  });

  it("stops an active recording and refuses to start again", () => {
    const { rec } = makeRig();
    rec.start();
    const mr = lastRecorder();
    rec.dispose();
    expect(mr.stopCalls).toBe(1);
    expect(mr.ondataavailable).toBeNull();
    expect(() => rec.start()).toThrowError(
      expect.objectContaining({ code: "disposed" }),
    );
    rec.dispose(); // idempotent
  });

  it("drops subscribers", () => {
    const { rec } = makeRig();
    const cb = vi.fn();
    rec.subscribe(cb);
    rec.dispose();
    const calls = cb.mock.calls.length;
    rec.dispose();
    expect(cb).toHaveBeenCalledTimes(calls);
  });
});
