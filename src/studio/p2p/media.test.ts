import { describe, expect, it, vi } from "vitest";
import { P2PError } from "./errors";
import {
  DEFAULT_TEST_CONSTRAINTS,
  createLevelMeter,
  levelToUnit,
  rmsOfBytes,
  rmsOfFloat,
  stopStream,
  testMedia,
  toMediaError,
  type MediaDevicesLike,
} from "./media";
import {
  FakeStream,
  FakeTrack,
  asFake,
  fakeStream,
} from "./__fakes__/fake-rtc";

const createStream = (tracks: MediaStreamTrack[]): MediaStream =>
  new FakeStream(tracks as unknown as FakeTrack[]) as unknown as MediaStream;

const domError = (name: string) => new DOMException("nope", name);

function devices(
  handler: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
): MediaDevicesLike & { getUserMedia: ReturnType<typeof vi.fn> } {
  return { getUserMedia: vi.fn(handler) };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(P2PError);
    return (error as P2PError).code;
  }
  return "no-error";
}

describe("toMediaError", () => {
  it.each([
    ["NotAllowedError", "permission-denied"],
    ["SecurityError", "permission-denied"],
    ["PermissionDeniedError", "permission-denied"],
    ["NotFoundError", "no-device"],
    ["DevicesNotFoundError", "no-device"],
    ["OverconstrainedError", "no-device"],
    ["NotReadableError", "device-busy"],
    ["TrackStartError", "device-busy"],
    ["AbortError", "device-busy"],
    ["SomethingElse", "media-error"],
  ])("maps %s to %s", (name, code) => {
    const error = toMediaError(domError(name));
    expect(error.code).toBe(code);
    expect(error.cause).toBeInstanceOf(DOMException);
  });

  it("keeps P2PErrors and handles non-error values", () => {
    const original = new P2PError("unsupported");
    expect(toMediaError(original)).toBe(original);
    expect(toMediaError("weird").code).toBe("media-error");
    expect(toMediaError(undefined).code).toBe("media-error");
    expect(toMediaError({ name: "NotAllowedError" }).code).toBe(
      "permission-denied",
    );
  });
});

describe("testMedia", () => {
  it("returns the stream with accurate hasAudio/hasVideo and uses the default constraints", async () => {
    const md = devices(async () => fakeStream("video", "audio"));
    const result = await testMedia(undefined, { mediaDevices: md });
    expect(result).toMatchObject({ hasAudio: true, hasVideo: true });
    expect(md.getUserMedia).toHaveBeenCalledWith(DEFAULT_TEST_CONSTRAINTS);
  });

  it("passes custom constraints through and reports audio-only streams", async () => {
    const md = devices(async () => fakeStream("audio"));
    const result = await testMedia({ audio: true }, { mediaDevices: md });
    expect(result).toMatchObject({ hasAudio: true, hasVideo: false });
    expect(md.getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it("ignores ended tracks when reporting availability", async () => {
    const stream = fakeStream("video", "audio");
    asFake(stream.getVideoTracks()[0] as MediaStreamTrack).stop();
    const result = await testMedia(
      { audio: true, video: true },
      { mediaDevices: devices(async () => stream) },
    );
    expect(result).toMatchObject({ hasAudio: true, hasVideo: false });
  });

  it("throws 'unsupported' without mediaDevices (insecure origin / SSR)", async () => {
    expect(
      await codeOf(testMedia({ audio: true }, { mediaDevices: null })),
    ).toBe("unsupported");
    expect(
      await codeOf(
        testMedia({ audio: true }, { mediaDevices: {} as MediaDevicesLike }),
      ),
    ).toBe("unsupported");
    // jsdom has no navigator.mediaDevices
    expect(await codeOf(testMedia({ audio: true }))).toBe("unsupported");
  });

  it("fails fast on a denied permission, without retrying", async () => {
    const md = devices(async () => {
      throw domError("NotAllowedError");
    });
    expect(
      await codeOf(
        testMedia({ audio: true, video: true }, { mediaDevices: md }),
      ),
    ).toBe("permission-denied");
    expect(md.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("does not retry single-device requests", async () => {
    const md = devices(async () => {
      throw domError("NotFoundError");
    });
    expect(await codeOf(testMedia({ video: true }, { mediaDevices: md }))).toBe(
      "no-device",
    );
    expect(md.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("degrades to the device that works when the other is missing", async () => {
    const md = devices(async (c) => {
      if (c.audio && c.video) throw domError("NotFoundError");
      if (c.video) throw domError("NotFoundError");
      return fakeStream("audio");
    });
    const result = await testMedia(
      { audio: true, video: true },
      { mediaDevices: md, createStream },
    );
    expect(result).toMatchObject({ hasAudio: true, hasVideo: false });
    expect(md.getUserMedia).toHaveBeenCalledTimes(3);
  });

  it("merges separately opened devices into one stream", async () => {
    const md = devices(async (c) => {
      if (c.audio && c.video) throw domError("NotReadableError");
      return fakeStream(c.audio ? "audio" : "video");
    });
    const result = await testMedia(
      { audio: true, video: true },
      { mediaDevices: md, createStream },
    );
    expect(result).toMatchObject({ hasAudio: true, hasVideo: true });
    expect(result.stream.getTracks()).toHaveLength(2);
  });

  it("reports the original error when nothing opens", async () => {
    const md = devices(async () => {
      throw domError("NotReadableError");
    });
    expect(
      await codeOf(
        testMedia(
          { audio: true, video: true },
          { mediaDevices: md, createStream },
        ),
      ),
    ).toBe("device-busy");
  });

  it("stops already-opened tracks when a later single request is denied", async () => {
    const audio = fakeStream("audio");
    const md = devices(async (c) => {
      if (c.audio && c.video) throw domError("NotFoundError");
      if (c.audio) return audio;
      throw domError("NotAllowedError");
    });
    expect(
      await codeOf(
        testMedia(
          { audio: true, video: true },
          { mediaDevices: md, createStream },
        ),
      ),
    ).toBe("permission-denied");
    expect(
      asFake(audio.getAudioTracks()[0] as MediaStreamTrack).stopCalls,
    ).toBe(1);
  });
});

describe("stopStream", () => {
  it("stops every track and tolerates null / throwing tracks", () => {
    const stream = fakeStream("video", "audio");
    stopStream(stream);
    expect(stream.getTracks().every((t) => asFake(t).stopCalls === 1)).toBe(
      true,
    );
    expect(() => stopStream(null)).not.toThrow();
    expect(() => stopStream(undefined)).not.toThrow();
    const hostile = {
      getTracks: () => [
        {
          stop: () => {
            throw new Error("already ended");
          },
        },
      ],
    } as unknown as MediaStream;
    expect(() => stopStream(hostile)).not.toThrow();
  });
});

describe("level math", () => {
  it("rmsOfFloat", () => {
    expect(rmsOfFloat([])).toBe(0);
    expect(rmsOfFloat([0, 0, 0])).toBe(0);
    expect(rmsOfFloat([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5, 10);
    expect(rmsOfFloat([1, -1])).toBe(1);
    expect(rmsOfFloat([3, -3])).toBe(1); // clamped
    expect(rmsOfFloat(new Float32Array(1024).fill(0.25))).toBeCloseTo(0.25, 6);
  });

  it("rmsOfBytes treats 128 as silence", () => {
    expect(rmsOfBytes([])).toBe(0);
    expect(rmsOfBytes(new Uint8Array(512).fill(128))).toBe(0);
    expect(rmsOfBytes(new Uint8Array(512).fill(192))).toBeCloseTo(0.5, 10);
    expect(rmsOfBytes(new Uint8Array(512).fill(0))).toBe(1);
    expect(rmsOfBytes(new Uint8Array(512).fill(255))).toBeCloseTo(
      127 / 128,
      10,
    );
  });

  it("levelToUnit maps dB to a 0..1 meter", () => {
    expect(levelToUnit(0)).toBe(0);
    expect(levelToUnit(-1)).toBe(0);
    expect(levelToUnit(Number.NaN)).toBe(0);
    expect(levelToUnit(Number.POSITIVE_INFINITY)).toBe(0);
    expect(levelToUnit(1)).toBe(1);
    expect(levelToUnit(5)).toBe(1);
    expect(levelToUnit(0.001)).toBeCloseTo(0, 6); // -60 dB
    expect(levelToUnit(0.1)).toBeCloseTo(2 / 3, 6); // -20 dB
    expect(levelToUnit(0.1, -40)).toBeCloseTo(0.5, 6);
    expect(levelToUnit(0.0000001)).toBe(0);
  });
});

describe("createLevelMeter", () => {
  function fakeContext(
    options: { state?: string; floatData?: boolean; failSource?: boolean } = {},
  ) {
    const analyser: Record<string, unknown> = {
      fftSize: 0,
      smoothingTimeConstant: 1,
      getByteTimeDomainData: vi.fn((a: Uint8Array) => void a.fill(192)),
    };
    if (options.floatData !== false) {
      analyser["getFloatTimeDomainData"] = vi.fn(
        (a: Float32Array) => void a.fill(0.5),
      );
    }
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const ctx = {
      state: options.state ?? "running",
      createMediaStreamSource: vi.fn(() => {
        if (options.failSource) throw new Error("bad stream");
        return source;
      }),
      createAnalyser: vi.fn(() => analyser),
      resume: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
    };
    return {
      ctx,
      analyser,
      source,
      factory: () => ctx as unknown as AudioContext,
    };
  }

  it("reads RMS from the analyser (float path) and never routes audio to the speakers", () => {
    const f = fakeContext();
    const meter = createLevelMeter(fakeStream("audio"), {
      createAudioContext: f.factory,
    });
    expect(meter.active).toBe(true);
    expect(meter.getLevel()).toBeCloseTo(0.5, 6);
    expect(f.analyser["fftSize"]).toBe(1024);
    expect(f.source.connect).toHaveBeenCalledWith(f.analyser);
    expect(f.source.connect).toHaveBeenCalledTimes(1); // only the analyser, no destination
  });

  it("falls back to byte data when float data is unavailable", () => {
    const f = fakeContext({ floatData: false });
    const meter = createLevelMeter(fakeStream("audio"), {
      createAudioContext: f.factory,
    });
    expect(meter.getLevel()).toBeCloseTo(0.5, 6);
  });

  it("resumes a suspended context and releases it on dispose (idempotent)", () => {
    const f = fakeContext({ state: "suspended" });
    const meter = createLevelMeter(fakeStream("audio"), {
      createAudioContext: f.factory,
    });
    expect(f.ctx.resume).toHaveBeenCalledTimes(1);
    meter.dispose();
    meter.dispose();
    expect(f.source.disconnect).toHaveBeenCalledTimes(1);
    expect(f.ctx.close).toHaveBeenCalledTimes(1);
    expect(meter.getLevel()).toBe(0);
  });

  it("returns an inactive meter for streams without audio", () => {
    const f = fakeContext();
    const meter = createLevelMeter(fakeStream("video"), {
      createAudioContext: f.factory,
    });
    expect(meter.active).toBe(false);
    expect(meter.getLevel()).toBe(0);
    expect(() => meter.dispose()).not.toThrow();
    expect(f.ctx.createAnalyser).not.toHaveBeenCalled();
  });

  it("throws a typed 'unsupported' error without Web Audio and cleans up on setup failure", () => {
    expect(() =>
      createLevelMeter(fakeStream("audio"), { createAudioContext: () => null }),
    ).toThrow(P2PError);
    expect(() => createLevelMeter(fakeStream("audio"))).toThrow(
      expect.objectContaining({ code: "unsupported" }),
    ); // jsdom has no AudioContext
    const f = fakeContext({ failSource: true });
    expect(() =>
      createLevelMeter(fakeStream("audio"), { createAudioContext: f.factory }),
    ).toThrow(expect.objectContaining({ code: "unsupported" }));
    expect(f.ctx.close).toHaveBeenCalledTimes(1);
  });
});
