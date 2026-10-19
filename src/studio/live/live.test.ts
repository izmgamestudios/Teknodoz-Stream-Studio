/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LiveApiError,
  createLiveApi,
  type LiveApi,
  type LiveSession,
} from "./api";
import { PLATFORMS, QUALITIES, getPlatform, getQuality } from "./platforms";
import { LiveStreamer, pickLiveMime } from "./streamer";
import { ChunkUploader } from "./uploader";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const blob = (n = 4) => new Blob([new Uint8Array(n)]);

const SESSION: LiveSession = {
  id: "s1",
  state: "starting",
  startedAt: 0,
  uptimeMs: 0,
  bytesIn: 0,
  chunks: 0,
  nextSeq: 0,
  destinations: [{ label: "YT", host: "a.rtmps.youtube.com", secure: true }],
  progress: {
    frame: 0,
    fps: 0,
    bitrateKbps: 0,
    outTimeMs: 0,
    speed: 0,
    dropped: 0,
  },
  error: null,
  tail: [],
};

function fakeApi(over: Partial<Record<keyof LiveApi, any>> = {}) {
  const calls = { chunks: [] as number[], stop: 0, start: [] as any[] };
  const api = {
    health: vi.fn(),
    status: vi.fn(),
    probe: vi.fn(),
    start: vi.fn(async (_t: string, body: any) => {
      calls.start.push(body);
      return { session: SESSION };
    }),
    session: vi.fn(async () => ({
      session: { ...SESSION, state: "live" as const },
    })),
    stop: vi.fn(async () => {
      calls.stop++;
      return { session: { ...SESSION, state: "ended" as const } };
    }),
    chunk: vi.fn(async (_t: string, _id: string, seq: number) => {
      calls.chunks.push(seq);
      return { ok: true as const, next: seq + 1 };
    }),
    ...over,
  } as unknown as LiveApi;
  return { api, calls };
}

describe("presets", () => {
  it("prefills only the platforms with a fixed ingest address", () => {
    expect(getPlatform("youtube").server).toBe(
      "rtmps://a.rtmps.youtube.com:443/live2",
    );
    expect(getPlatform("facebook").server).toBe(
      "rtmps://live-api-s.facebook.com:443/rtmp/",
    );
    for (const id of ["twitch", "kick", "instagram", "tiktok", "custom"])
      expect(getPlatform(id).server).toBe("");
    expect(getPlatform("unknown").id).toBe("custom");
    expect(new Set(PLATFORMS.map((p) => p.id)).size).toBe(PLATFORMS.length);
    expect(getQuality("nope").id).toBe("720p30");
    for (const q of QUALITIES) {
      expect(q.width % 2).toBe(0);
      expect(q.height % 2).toBe(0);
    }
  });
});

describe("api client", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  it("maps server errors and keeps their details", async () => {
    const api = createLiveApi({
      fetch: async () =>
        json(
          { error: "bad-destination", index: 1, reason: "host-not-allowed" },
          400,
        ),
    });
    const e = await api.start("t", {} as any).catch((x) => x);
    expect(e).toBeInstanceOf(LiveApiError);
    expect(e).toMatchObject({
      code: "bad-destination",
      index: 1,
      reason: "host-not-allowed",
    });
  });
  it("detects missing server APIs and network failures", async () => {
    const spa = createLiveApi({
      fetch: async () => new Response("<html></html>", { status: 200 }),
    });
    expect(await spa.health().catch((x) => x.code)).toBe("unavailable");
    const down = createLiveApi({
      fetch: async () => {
        throw new TypeError("offline");
      },
    });
    expect(await down.status("t").catch((x) => x.code)).toBe("network");
  });
  it("sends the bearer token and raw bytes", async () => {
    let seen: any;
    const api = createLiveApi({
      fetch: async (url, init) => {
        seen = { url, init };
        return json({ ok: true, next: 3 });
      },
    });
    await api.chunk("tok", "abc", 2, new Uint8Array([1]));
    expect(seen.url).toBe("/api/live/session/abc/chunk?seq=2");
    expect(seen.init.headers["authorization"]).toBe("Bearer tok");
    expect(seen.init.headers["content-type"]).toBe("application/octet-stream");
  });
});

describe("ChunkUploader", () => {
  it("uploads strictly in order with increasing sequence numbers", async () => {
    const { api, calls } = fakeApi();
    const u = new ChunkUploader({ api, token: "t", sessionId: "s1" });
    u.push(blob(10));
    u.push(blob(20));
    u.push(blob(30));
    await u.drain();
    expect(calls.chunks).toEqual([0, 1, 2]);
    expect(u.bytesSent).toBe(60);
    expect(u.backlog).toBe(0);
  });

  it("retries network failures with the same sequence number", async () => {
    const seqs: number[] = [];
    let n = 0;
    const { api } = fakeApi({
      chunk: vi.fn(async (_t: string, _i: string, seq: number) => {
        seqs.push(seq);
        if (n++ < 2) throw new LiveApiError("network");
        return { ok: true as const, next: seq + 1 };
      }),
    });
    const u = new ChunkUploader({
      api,
      token: "t",
      sessionId: "s",
      retryDelayMs: 10,
    });
    u.push(blob());
    const done = u.drain();
    await vi.advanceTimersByTimeAsync(200);
    await done;
    expect(seqs).toEqual([0, 0, 0]);
    expect(u.hasFailed).toBe(false);
  });

  it("gives up on fatal errors and reports them once", async () => {
    const errs: LiveApiError[] = [];
    const { api } = fakeApi({
      chunk: vi.fn(async () => {
        throw new LiveApiError("ended", 410);
      }),
    });
    const u = new ChunkUploader({
      api,
      token: "t",
      sessionId: "s",
      onError: (e) => errs.push(e),
    });
    u.push(blob());
    u.push(blob());
    await u.drain();
    expect(errs.map((e) => e.code)).toEqual(["ended"]);
    expect(u.hasFailed).toBe(true);
    u.push(blob()); // ignored after a failure
    expect(u.backlog).toBe(0);
  });

  it("fails instead of buffering without bound", async () => {
    const errs: LiveApiError[] = [];
    const { api } = fakeApi({
      chunk: vi.fn(() => new Promise(() => undefined)),
    });
    const u = new ChunkUploader({
      api,
      token: "t",
      sessionId: "s",
      maxBacklogChunks: 3,
      onError: (e) => errs.push(e),
    });
    for (let i = 0; i < 6; i++) u.push(blob());
    expect(errs[0]?.data["reason"]).toBe("backlog");
  });
});

/* ------------------------------ streamer ------------------------------ */

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = (t: string) => t === "video/webm;codecs=vp8,opus";
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  private stopCbs: (() => void)[] = [];
  constructor(
    readonly stream: unknown,
    readonly opts: any,
  ) {
    FakeRecorder.instances.push(this);
  }
  start(ms: number) {
    this.state = "recording";
    (this as any).timeslice = ms;
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: blob(8) });
    for (const c of this.stopCbs) c();
  }
  addEventListener(_t: string, cb: () => void) {
    this.stopCbs.push(cb);
  }
  emit(n = 100) {
    this.ondataavailable?.({ data: blob(n) });
  }
}

function setup(api: LiveApi, canvas: any = undefined) {
  FakeRecorder.instances = [];
  const track = { stop: vi.fn() } as any;
  const cv =
    canvas === undefined
      ? {
          captureStream: vi.fn(() => ({
            getVideoTracks: () => [track],
            getTracks: () => [track],
          })),
        }
      : canvas;
  const s = new LiveStreamer(
    {
      getCanvas: () => cv,
      getAudioStream: () =>
        ({ getAudioTracks: () => [{ readyState: "live" }] }) as any,
      ensureAudio: async () => undefined,
    },
    {
      api,
      recorderCtor: FakeRecorder as any,
      makeStream: () => ({}) as any,
      pollMs: 1000,
    },
  );
  return { s, track, cv };
}

const START = {
  token: "tok",
  destinations: [
    {
      label: "YT",
      server: "rtmps://a.rtmps.youtube.com:443/live2",
      key: "abcd-efgh",
    },
  ],
  quality: getQuality("720p30"),
};

describe("pickLiveMime", () => {
  it("prefers VP8 WebM, falls back to MP4, or nothing", () => {
    expect(pickLiveMime(() => true)).toEqual({
      mimeType: "video/webm;codecs=vp8,opus",
      container: "webm",
    });
    expect(pickLiveMime((t) => t.startsWith("video/mp4"))).toMatchObject({
      container: "mp4",
    });
    expect(pickLiveMime(() => false)).toBeNull();
    expect(
      pickLiveMime(() => {
        throw new Error("x");
      }),
    ).toBeNull();
  });
});

describe("LiveStreamer", () => {
  it("starts the bridge, uploads recorder chunks and stops cleanly", async () => {
    const { api, calls } = fakeApi();
    const { s, track, cv } = setup(api);
    expect(await s.start(START)).toBe(true);
    expect(s.getSnapshot().phase).toBe("live");
    expect(calls.start[0]).toMatchObject({
      video: { width: 1280, height: 720, fps: 30, kbps: 3000 },
      container: "webm",
      destinations: START.destinations,
    });
    expect(cv.captureStream).toHaveBeenCalledWith(30);
    const rec = FakeRecorder.instances[0]!;
    expect((rec as any).timeslice).toBe(1000);
    expect(rec.opts.mimeType).toBe("video/webm;codecs=vp8,opus");
    expect(rec.opts.videoBitsPerSecond).toBe(4_500_000);

    rec.emit(1000);
    rec.emit(2000);
    await vi.advanceTimersByTimeAsync(10);
    expect(calls.chunks).toEqual([0, 1]);

    const stopping = s.stop();
    await vi.advanceTimersByTimeAsync(50);
    await stopping;
    expect(s.getSnapshot().phase).toBe("ended");
    expect(calls.chunks).toEqual([0, 1, 2]); // the final chunk is flushed before the stop call
    expect(calls.stop).toBe(1);
    expect(track.stop).toHaveBeenCalled();
    expect(s.getSnapshot().bytesSent).toBe(3008);
  });

  it("explains refused destinations without recording anything", async () => {
    const { api } = fakeApi({
      start: vi.fn(async () => {
        throw new LiveApiError("bad-destination", 400, {
          index: 0,
          reason: "host-not-allowed",
        });
      }),
    });
    const { s } = setup(api);
    expect(await s.start(START)).toBe(false);
    expect(s.getSnapshot()).toMatchObject({
      phase: "error",
      error: { code: "bad-destination", reason: "host-not-allowed", index: 0 },
    });
    expect(FakeRecorder.instances).toHaveLength(0);
  });

  it("reports unsupported browsers", async () => {
    const { api } = fakeApi();
    const { s } = setup(api, null);
    expect(await s.start(START)).toBe(false);
    expect(s.getSnapshot().error?.code).toBe("unsupported");
    expect(api.start).not.toHaveBeenCalled();
  });

  it("ends the broadcast when the upload dies and closes the server session", async () => {
    const { api, calls } = fakeApi({
      chunk: vi.fn(async () => {
        throw new LiveApiError("ended", 410, {
          session: { ...SESSION, state: "error", tail: ["Connection reset"] },
        });
      }),
    });
    const { s } = setup(api);
    await s.start(START);
    FakeRecorder.instances[0]!.emit();
    await vi.advanceTimersByTimeAsync(20);
    expect(s.getSnapshot()).toMatchObject({
      phase: "error",
      error: { code: "ended", tail: ["Connection reset"] },
    });
    expect(calls.stop).toBe(1);
    expect(FakeRecorder.instances[0]!.state).toBe("inactive");
  });

  it("notices when the server ended the session (platform refused / idle)", async () => {
    const { api } = fakeApi({
      session: vi.fn(async () => ({
        session: {
          ...SESSION,
          state: "error" as const,
          error: "ffmpeg exited (code 1)",
          tail: ["Input/output error"],
        },
      })),
    });
    const { s } = setup(api);
    await s.start(START);
    await vi.advanceTimersByTimeAsync(1100);
    expect(s.getSnapshot()).toMatchObject({
      phase: "error",
      error: { code: "ffmpeg", tail: ["Input/output error"] },
    });
    expect(FakeRecorder.instances[0]!.state).toBe("inactive");
  });

  it("refuses a second start while live and can be reset afterwards", async () => {
    const { api } = fakeApi();
    const { s } = setup(api);
    await s.start(START);
    expect(await s.start(START)).toBe(false);
    s.reset(); // ignored while live
    expect(s.getSnapshot().phase).toBe("live");
    const p = s.stop();
    await vi.advanceTimersByTimeAsync(50);
    await p;
    s.reset();
    expect(s.getSnapshot().phase).toBe("idle");
  });
});
