// src/studio/p2p/media.ts
// Guest pre-join helpers: a camera/mic test and an RMS level meter. Browser-only code that
// feature-detects everything lazily (SSR safe) and reports problems as typed P2PErrors.
import { P2PError } from "./errors";

/* ------------------------------------------------------------------ */
/* testMedia                                                           */
/* ------------------------------------------------------------------ */

export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

export interface TestMediaDeps {
  /** Default: `navigator.mediaDevices` (undefined on insecure origins / SSR). */
  mediaDevices?: MediaDevicesLike | null;
  /** Default: `new MediaStream(tracks)`; used to merge separately opened devices. */
  createStream?: (tracks: MediaStreamTrack[]) => MediaStream;
}

export interface TestMediaResult {
  stream: MediaStream;
  hasAudio: boolean;
  hasVideo: boolean;
}

/** Sensible guest defaults: echo-cancelled mic, 720p30 front camera. */
export const DEFAULT_TEST_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: {
    facingMode: "user",
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  },
};

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

/** Map a getUserMedia rejection to a stable P2PError code. */
export function toMediaError(error: unknown): P2PError {
  if (error instanceof P2PError) return error;
  switch (errorName(error)) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return new P2PError("permission-denied", undefined, { cause: error });
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return new P2PError("no-device", undefined, { cause: error });
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return new P2PError("device-busy", undefined, { cause: error });
    default:
      return new P2PError("media-error", undefined, { cause: error });
  }
}

function wants(value: MediaStreamConstraints["audio"]): boolean {
  return value !== undefined && value !== false;
}

function resolveDevices(deps: TestMediaDeps): MediaDevicesLike {
  const devices =
    deps.mediaDevices !== undefined
      ? deps.mediaDevices
      : typeof navigator !== "undefined"
        ? (navigator.mediaDevices as MediaDevicesLike | undefined)
        : undefined;
  if (!devices || typeof devices.getUserMedia !== "function")
    throw new P2PError("unsupported");
  return devices;
}

function describe(stream: MediaStream): TestMediaResult {
  const live = (t: MediaStreamTrack): boolean => t.readyState !== "ended";
  return {
    stream,
    hasAudio: stream.getAudioTracks().some(live),
    hasVideo: stream.getVideoTracks().some(live),
  };
}

/** Stop every track of a stream (e.g. when the test dialog closes). Never throws. */
export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* already ended */
    }
  }
}

/**
 * Open the camera and/or microphone for the guest's pre-join test. If both were requested and
 * only one device is missing or busy, the usable one is returned (see `hasAudio`/`hasVideo`);
 * a denied permission always fails. The caller owns the returned stream (`stopStream`).
 * @throws P2PError unsupported | permission-denied | no-device | device-busy | media-error
 */
export async function testMedia(
  constraints: MediaStreamConstraints = DEFAULT_TEST_CONSTRAINTS,
  deps: TestMediaDeps = {},
): Promise<TestMediaResult> {
  const devices = resolveDevices(deps);
  try {
    return describe(await devices.getUserMedia(constraints));
  } catch (first) {
    const error = toMediaError(first);
    const both = wants(constraints.audio) && wants(constraints.video);
    if (!both || error.code === "permission-denied") throw error;
    // Degrade: try each device on its own and merge whatever opens.
    const tracks: MediaStreamTrack[] = [];
    for (const single of [
      { audio: constraints.audio ?? false } satisfies MediaStreamConstraints,
      { video: constraints.video ?? false } satisfies MediaStreamConstraints,
    ]) {
      try {
        tracks.push(...(await devices.getUserMedia(single)).getTracks());
      } catch (second) {
        const secondError = toMediaError(second);
        if (secondError.code === "permission-denied") {
          for (const track of tracks) track.stop();
          throw secondError;
        }
      }
    }
    if (tracks.length === 0) throw error;
    const create =
      deps.createStream ?? ((t: MediaStreamTrack[]) => new MediaStream(t));
    return describe(create(tracks));
  }
}

/* ------------------------------------------------------------------ */
/* Level meter                                                         */
/* ------------------------------------------------------------------ */

/** Root mean square of float samples in -1..1, clamped to 0..1. Empty input yields 0. */
export function rmsOfFloat(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / n));
}

/** RMS of unsigned 8-bit time-domain data (128 = silence), as 0..1. */
export function rmsOfBytes(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = ((samples[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / n));
}

/**
 * Map a linear RMS (0..1) to a 0..1 meter position on a dB scale: `floorDb` (default -60 dB) is
 * 0, full scale (0 dB) is 1. Handy for a VU bar.
 */
export function levelToUnit(rms: number, floorDb = -60): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const db = 20 * Math.log10(Math.min(1, rms));
  return Math.min(1, Math.max(0, 1 - db / floorDb));
}

export interface LevelMeter {
  /** False when the stream has no audio track (the meter then always reads 0). */
  readonly active: boolean;
  /** Current linear RMS 0..1 (poll from requestAnimationFrame; see `levelToUnit`). */
  getLevel(): number;
  /** Release the AudioContext. Idempotent. */
  dispose(): void;
}

export interface LevelMeterDeps {
  /** Default: `new (AudioContext || webkitAudioContext)()`. Return null if unsupported. */
  createAudioContext?: () => AudioContext | null;
}

function defaultAudioContext(): AudioContext | null {
  const scope = globalThis as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

/**
 * RMS level meter for the guest's mic test (AnalyserNode on the stream, not routed to the
 * speakers, so there is no feedback). Create it from a user gesture so the AudioContext can
 * start. The caller still owns the stream.
 * @throws P2PError unsupported when Web Audio is unavailable
 */
export function createLevelMeter(
  stream: MediaStream,
  deps: LevelMeterDeps = {},
): LevelMeter {
  if (stream.getAudioTracks().length === 0) {
    return { active: false, getLevel: () => 0, dispose: () => undefined };
  }
  const ctx = (deps.createAudioContext ?? defaultAudioContext)();
  if (!ctx) throw new P2PError("unsupported");
  let source: MediaStreamAudioSourceNode;
  let analyser: AnalyserNode;
  try {
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
  } catch (cause) {
    void ctx.close().catch(() => undefined);
    throw new P2PError("unsupported", undefined, { cause });
  }
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);

  const floats = new Float32Array(analyser.fftSize);
  const bytes = new Uint8Array(analyser.fftSize);
  let disposed = false;

  return {
    active: true,
    getLevel(): number {
      if (disposed) return 0;
      if (typeof analyser.getFloatTimeDomainData === "function") {
        analyser.getFloatTimeDomainData(floats);
        return rmsOfFloat(floats);
      }
      analyser.getByteTimeDomainData(bytes);
      return rmsOfBytes(bytes);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        source.disconnect();
      } catch {
        /* already disconnected */
      }
      void ctx.close().catch(() => undefined);
    },
  };
}
