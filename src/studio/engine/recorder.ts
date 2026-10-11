// src/studio/engine/recorder.ts
// Canvas + mixed audio -> MediaRecorder, with pause-aware chapter markers.
// Browser-only APIs (MediaRecorder, MediaStream) are touched lazily inside methods, never at
// import time, so this module is SSR-safe.
import type { Marker } from "../types";
import { sanitizeLabel } from "./chapters";

export type RecorderContainer = "auto" | "mp4" | "webm";
export type RecordingExt = "mp4" | "webm";

export type RecorderErrorCode =
  /** MediaRecorder / canvas.captureStream missing in this browser */
  | "unsupported"
  /** method called in the wrong lifecycle state (start twice, stop before start, ...) */
  | "invalid-state"
  /** the canvas produced no video track */
  | "no-video-track"
  /** MediaRecorder could not be constructed or started */
  | "start-failed"
  /** MediaRecorder fired an `error` event while recording */
  | "media-recorder-error"
  /** dispose() was called while a stop() was pending */
  | "disposed";

export class RecorderError extends Error {
  readonly code: RecorderErrorCode;
  /** Whatever was recorded before a fatal error, when anything could be salvaged. */
  readonly partial: RecordingResult | null;

  constructor(
    code: RecorderErrorCode,
    message: string,
    extra: { cause?: unknown; partial?: RecordingResult | null } = {},
  ) {
    super(
      message,
      extra.cause !== undefined ? { cause: extra.cause } : undefined,
    );
    this.name = "RecorderError";
    this.code = code;
    this.partial = extra.partial ?? null;
  }
}

export type RecorderWarningCode =
  /** recorded data crossed `warnBytes` (default 1.5 GiB); recording continues */
  | "size-warning"
  /** recorded data crossed `maxBytes`; recording was stopped to protect the tab */
  | "size-limit"
  /** the audio stream had no live track: the file has no sound */
  | "no-audio"
  /** the requested container is not supported: another one is used */
  | "container-fallback"
  /** the chosen mimeType was rejected by MediaRecorder: the browser default is used */
  | "mime-fallback";

export interface RecorderWarning {
  code: RecorderWarningCode;
  message: string;
  /** bytes recorded so far */
  bytes: number;
}

export interface RecorderOptions {
  fps: number;
  /** bits per second; invalid values are ignored (browser default) */
  videoBitrate: number;
  audioBitrate: number;
  container: RecorderContainer;
  onWarning?: ((warning: RecorderWarning) => void) | undefined;
  /** Default 1.5 GiB. */
  warnBytes?: number | undefined;
  /** Hard cap, default 4 GiB: recording is stopped (result stays retrievable via stop()). */
  maxBytes?: number | undefined;
  /** MediaRecorder timeslice, default 1000 ms. */
  timesliceMs?: number | undefined;
  /** How long to wait for MediaRecorder's `stop` event before finalizing anyway. Default 8000. */
  stopTimeoutMs?: number | undefined;
  /** Monotonic clock in ms (tests). Default performance.now. */
  now?: (() => number) | undefined;
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  ext: RecordingExt;
  /** recorded time in ms, paused time excluded */
  durationMs: number;
  /** marker timestamps are in recorded time (paused time excluded) */
  markers: Marker[];
  /** wall-clock Date.now() when start() was called */
  startedAt: number;
}

export type RecorderStatus =
  "idle" | "recording" | "paused" | "stopping" | "stopped" | "error";

/** Immutable snapshot for useSyncExternalStore: replaced (new identity) on every change. */
export interface RecorderSnapshot {
  readonly status: RecorderStatus;
  readonly markers: readonly Marker[];
  /** bytes collected so far (updates once per timeslice) */
  readonly bytes: number;
  readonly mimeType: string | null;
  readonly ext: RecordingExt | null;
  readonly startedAt: number | null;
  readonly error: RecorderErrorCode | null;
}

/** Anything with a canvas-like captureStream (HTMLCanvasElement in practice). */
export interface CaptureCanvas {
  captureStream(frameRate?: number): MediaStream;
}

export interface PickedMime {
  /** "" means: let the browser choose (nothing could be probed / nothing matched). */
  mimeType: string;
  ext: RecordingExt;
}

export const DEFAULT_WARN_BYTES = 1.5 * 1024 * 1024 * 1024;
export const DEFAULT_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_TIMESLICE_MS = 1000;
const DEFAULT_STOP_TIMEOUT_MS = 8000;
const MAX_MARKER_LABEL = 100;
const MAX_MARKERS = 1000;

const MP4_CANDIDATES: readonly string[] = [
  "video/mp4;codecs=avc1.640034,mp4a.40.2", // H.264 High@5.2 (1080p60) + AAC-LC
  "video/mp4;codecs=avc1.64002A,mp4a.40.2", // High@4.2
  "video/mp4;codecs=avc1.4D402A,mp4a.40.2", // Main@4.2
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2", // Baseline@3.0
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
];

const WEBM_CANDIDATES: readonly string[] = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

/* ------------------------------------------------------------------ */
/* Pause-aware clock                                                   */
/* ------------------------------------------------------------------ */

/**
 * Recording clock whose `elapsed()` excludes paused time. Marker timestamps and the final
 * duration come from here so chapters line up with the (pause-free) media timeline.
 */
export class RecordingClock {
  private readonly now: () => number;
  private startAt: number | null = null;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private frozen: number | null = null;

  constructor(now: () => number) {
    this.now = now;
  }

  get isRunning(): boolean {
    return this.startAt !== null && this.frozen === null;
  }

  get isPaused(): boolean {
    return this.pausedAt !== null && this.frozen === null;
  }

  start(): void {
    this.startAt = this.now();
    this.pausedAt = null;
    this.pausedTotal = 0;
    this.frozen = null;
  }

  /** @returns false when the clock is not running or already paused */
  pause(): boolean {
    if (!this.isRunning || this.pausedAt !== null) return false;
    this.pausedAt = this.now();
    return true;
  }

  /** @returns false when the clock is not paused */
  resume(): boolean {
    if (this.pausedAt === null || this.frozen !== null) return false;
    this.pausedTotal += Math.max(0, this.now() - this.pausedAt);
    this.pausedAt = null;
    return true;
  }

  /** Freezes the clock (idempotent) and returns the final elapsed time. */
  stop(): number {
    if (this.frozen !== null) return this.frozen;
    const value = this.elapsed();
    this.frozen = value;
    return value;
  }

  /** Recorded milliseconds so far: wall time minus every paused interval. */
  elapsed(): number {
    if (this.frozen !== null) return this.frozen;
    if (this.startAt === null) return 0;
    const ref = this.pausedAt ?? this.now();
    return Math.max(0, ref - this.startAt - this.pausedTotal);
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function defaultNow(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function positiveOrUndefined(v: number | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.round(v)
    : undefined;
}

function extOf(mimeType: string, fallback: RecordingExt): RecordingExt {
  if (/mp4/i.test(mimeType)) return "mp4";
  if (/webm/i.test(mimeType)) return "webm";
  return fallback;
}

const noop = (): void => {};

/* ------------------------------------------------------------------ */
/* StudioRecorder                                                      */
/* ------------------------------------------------------------------ */

export class StudioRecorder {
  private readonly canvas: CaptureCanvas;
  private readonly audioStream: MediaStream | null;
  private readonly opts: RecorderOptions;
  private readonly clock: RecordingClock;
  private readonly listeners = new Set<() => void>();

  private status: RecorderStatus = "idle";
  private recorder: MediaRecorder | null = null;
  private ownedTracks: MediaStreamTrack[] = [];
  private chunks: Blob[] = [];
  private bytes = 0;
  private mimeType: string | null = null;
  private ext: RecordingExt | null = null;
  private startedAt: number | null = null;
  private markers: Marker[] = [];
  private markersView: readonly Marker[] = [];
  private fatal: RecorderError | null = null;
  private durationMs = 0;
  private warnedSize = false;
  private disposed = false;
  private finalized = false;

  private stopPromise: Promise<RecordingResult> | null = null;
  private resolveStop: ((r: RecordingResult) => void) | null = null;
  private rejectStop: ((e: RecorderError) => void) | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  private snapshot: RecorderSnapshot;

  constructor(
    canvas: CaptureCanvas,
    audioStream: MediaStream | null,
    opts: RecorderOptions,
  ) {
    this.canvas = canvas;
    this.audioStream = audioStream;
    this.opts = opts;
    this.clock = new RecordingClock(opts.now ?? defaultNow);
    this.snapshot = this.buildSnapshot();
  }

  /**
   * Probe MediaRecorder.isTypeSupported in ranked order: mp4 (avc1 + AAC) first when the
   * container is "auto"/"mp4", then webm (vp9/vp8 + opus), then bare webm. The other container
   * is kept as a last resort so an unsupported preference still records. Returns
   * `{ mimeType: "", ext: "webm" }` when nothing can be probed (browser default).
   */
  static pickMimeType(container: RecorderContainer = "auto"): PickedMime {
    if (
      typeof MediaRecorder === "undefined" ||
      typeof MediaRecorder.isTypeSupported !== "function"
    ) {
      return { mimeType: "", ext: "webm" };
    }
    const supported = (type: string): boolean => {
      try {
        return MediaRecorder.isTypeSupported(type);
      } catch {
        return false;
      }
    };
    const ordered =
      container === "webm"
        ? [...WEBM_CANDIDATES, ...MP4_CANDIDATES]
        : [...MP4_CANDIDATES, ...WEBM_CANDIDATES];
    for (const type of ordered) {
      if (supported(type)) return { mimeType: type, ext: extOf(type, "webm") };
    }
    return { mimeType: "", ext: "webm" };
  }

  /* ---------------- state ---------------- */

  /** Bound: pass straight to useSyncExternalStore. Identity changes only when state changes. */
  readonly getState = (): RecorderSnapshot => this.snapshot;

  /** Bound: pass straight to useSyncExternalStore. Returns the unsubscribe function. */
  readonly subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  /** Recorded milliseconds (paused time excluded). Cheap: poll it from a timer / rAF. */
  getElapsedMs(): number {
    return this.clock.elapsed();
  }

  getError(): RecorderError | null {
    return this.fatal;
  }

  private buildSnapshot(): RecorderSnapshot {
    return {
      status: this.status,
      markers: this.markersView,
      bytes: this.bytes,
      mimeType: this.mimeType,
      ext: this.ext,
      startedAt: this.startedAt,
      error: this.fatal ? this.fatal.code : null,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const cb of [...this.listeners]) {
      try {
        cb();
      } catch {
        // a faulty subscriber must never break the recorder
      }
    }
  }

  private warn(code: RecorderWarningCode, message: string): void {
    const cb = this.opts.onWarning;
    if (!cb) return;
    try {
      cb({ code, message, bytes: this.bytes });
    } catch {
      // ignore subscriber errors
    }
  }

  /* ---------------- lifecycle ---------------- */

  start(): void {
    if (this.disposed)
      throw new RecorderError("disposed", "Kaydedici kapatıldı.");
    if (this.status !== "idle") {
      throw new RecorderError("invalid-state", "Kayıt zaten başlatıldı.");
    }
    if (
      typeof MediaRecorder === "undefined" ||
      typeof MediaStream === "undefined"
    ) {
      throw new RecorderError(
        "unsupported",
        "Bu tarayıcı kayıt (MediaRecorder) desteklemiyor.",
      );
    }
    if (typeof this.canvas.captureStream !== "function") {
      throw new RecorderError(
        "unsupported",
        "Tuval yakalama (captureStream) desteklenmiyor.",
      );
    }

    const picked = StudioRecorder.pickMimeType(this.opts.container);

    let videoStream: MediaStream;
    try {
      videoStream = this.canvas.captureStream(this.captureFps());
    } catch (cause) {
      throw new RecorderError("start-failed", "Tuval akışı alınamadı.", {
        cause,
      });
    }
    const owned = videoStream.getTracks();
    const videoTracks = videoStream.getVideoTracks();
    if (videoTracks.length === 0) {
      for (const t of owned) this.safeStop(t);
      throw new RecorderError(
        "no-video-track",
        "Tuvalden görüntü akışı alınamadı.",
      );
    }

    // One MediaStream carrying video + audio so the muxer keeps them in sync.
    const audioTracks = this.audioStream
      ? this.audioStream
          .getAudioTracks()
          .filter((t) => t.readyState !== "ended")
      : [];
    let composite: MediaStream;
    let recorder: MediaRecorder;
    try {
      composite = new MediaStream([...videoTracks, ...audioTracks]);
      recorder = this.createRecorder(composite, picked);
    } catch (cause) {
      for (const t of owned) this.safeStop(t);
      if (cause instanceof RecorderError) throw cause;
      throw new RecorderError("start-failed", "Kayıt başlatılamadı.", {
        cause,
      });
    }

    const actualMime = recorder.mimeType || picked.mimeType;
    this.mimeType = actualMime || null;
    this.ext = extOf(actualMime, picked.ext);
    this.ownedTracks = owned;
    this.recorder = recorder;
    this.chunks = [];
    this.bytes = 0;
    this.markers = [];
    this.markersView = [];
    this.warnedSize = false;
    this.finalized = false;
    this.fatal = null;
    this.durationMs = 0;

    recorder.ondataavailable = (ev: BlobEvent): void => this.onData(ev);
    recorder.onerror = (ev: Event): void => this.onRecorderError(ev);
    recorder.onstop = (): void => this.onRecorderStop();

    try {
      recorder.start(
        positiveOrUndefined(this.opts.timesliceMs) ?? DEFAULT_TIMESLICE_MS,
      );
    } catch (cause) {
      this.detach();
      for (const t of owned) this.safeStop(t);
      this.ownedTracks = [];
      this.recorder = null;
      throw new RecorderError("start-failed", "Kayıt başlatılamadı.", {
        cause,
      });
    }

    this.clock.start();
    this.startedAt = Date.now();
    this.status = "recording";
    this.emit();

    if (this.audioStream && audioTracks.length === 0) {
      this.warn("no-audio", "Canlı ses kanalı yok: kayıt sessiz olacak.");
    }
    if (this.opts.container === "mp4" && this.ext !== "mp4") {
      this.warn("container-fallback", "MP4 desteklenmiyor, WebM kullanılıyor.");
    }
  }

  private captureFps(): number {
    const fps = this.opts.fps;
    return typeof fps === "number" && Number.isFinite(fps) && fps > 0
      ? Math.min(fps, 240)
      : 30;
  }

  private createRecorder(
    stream: MediaStream,
    picked: PickedMime,
  ): MediaRecorder {
    const base: MediaRecorderOptions = {};
    const vbr = positiveOrUndefined(this.opts.videoBitrate);
    const abr = positiveOrUndefined(this.opts.audioBitrate);
    if (vbr !== undefined) base.videoBitsPerSecond = vbr;
    if (abr !== undefined) base.audioBitsPerSecond = abr;
    if (picked.mimeType !== "") {
      try {
        return new MediaRecorder(stream, {
          ...base,
          mimeType: picked.mimeType,
        });
      } catch {
        this.warn(
          "mime-fallback",
          "Seçilen biçim reddedildi, tarayıcı varsayılanı kullanılıyor.",
        );
      }
    }
    try {
      return new MediaRecorder(stream, base);
    } catch (cause) {
      throw new RecorderError("start-failed", "MediaRecorder oluşturulamadı.", {
        cause,
      });
    }
  }

  pause(): void {
    if (this.status !== "recording") return;
    const rec = this.recorder;
    if (!rec || rec.state !== "recording") return;
    try {
      rec.pause();
    } catch (cause) {
      throw new RecorderError("invalid-state", "Kayıt duraklatılamadı.", {
        cause,
      });
    }
    this.clock.pause();
    this.status = "paused";
    this.emit();
  }

  resume(): void {
    if (this.status !== "paused") return;
    const rec = this.recorder;
    if (!rec || rec.state !== "paused") return;
    try {
      rec.resume();
    } catch (cause) {
      throw new RecorderError("invalid-state", "Kayıt sürdürülemedi.", {
        cause,
      });
    }
    this.clock.resume();
    this.status = "recording";
    this.emit();
  }

  /**
   * Add a chapter marker at the current recorded time (paused time excluded). The default
   * label is `Bölüm N`. Returns null when not recording / paused or at the marker limit.
   */
  addMarker(label?: string): Marker | null {
    if (this.status !== "recording" && this.status !== "paused") return null;
    if (this.markers.length >= MAX_MARKERS) return null;
    const marker: Marker = {
      t: Math.round(this.clock.elapsed()),
      label: sanitizeLabel(
        label,
        `Bölüm ${this.markers.length + 1}`,
        MAX_MARKER_LABEL,
      ),
    };
    this.markers.push(marker);
    this.markersView = this.markers.map((m) => ({ ...m }));
    this.emit();
    return { ...marker };
  }

  /**
   * Stop recording and resolve with the file. Idempotent: calling it again (or after the size
   * cap stopped the recording) returns the same promise. Rejects with RecorderError.
   */
  stop(): Promise<RecordingResult> {
    if (this.stopPromise) return this.stopPromise;
    if (this.status === "error" && this.fatal)
      return Promise.reject(this.fatal);
    if (this.status === "idle") {
      return Promise.reject(
        new RecorderError("invalid-state", "Kayıt başlatılmadı."),
      );
    }
    return this.beginStop();
  }

  private beginStop(recorderAlreadyStopped = false): Promise<RecordingResult> {
    if (this.stopPromise) return this.stopPromise;
    this.durationMs = this.clock.stop();
    this.status = "stopping";
    const promise = new Promise<RecordingResult>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });
    promise.catch(noop); // an internally triggered stop may have no consumer yet
    this.stopPromise = promise;
    this.emit();

    const rec = this.recorder;
    if (!rec || recorderAlreadyStopped || rec.state === "inactive") {
      this.finalize();
      return promise;
    }
    const timeout =
      positiveOrUndefined(this.opts.stopTimeoutMs) ?? DEFAULT_STOP_TIMEOUT_MS;
    this.stopTimer = setTimeout(() => this.finalize(), timeout);
    try {
      rec.stop();
    } catch (cause) {
      this.fail(
        new RecorderError("media-recorder-error", "Kayıt durdurulamadı.", {
          cause,
        }),
      );
    }
    return promise;
  }

  /** Discard everything and release resources. Pending stop() rejects with code "disposed". */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const pending = this.rejectStop;
    const rec = this.recorder;
    this.detach();
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        // already stopped
      }
    }
    this.releaseTracks();
    this.clearStopTimer();
    this.recorder = null;
    this.chunks = [];
    this.resolveStop = null;
    this.rejectStop = null;
    this.clock.stop();
    this.status = "idle";
    this.emit();
    this.listeners.clear();
    pending?.(new RecorderError("disposed", "Kaydedici kapatıldı."));
  }

  /* ---------------- MediaRecorder events ---------------- */

  private onData(ev: BlobEvent): void {
    const data = ev.data;
    if (!data || data.size <= 0) return;
    this.chunks.push(data);
    this.bytes += data.size;

    const warnAt =
      positiveOrUndefined(this.opts.warnBytes) ?? DEFAULT_WARN_BYTES;
    const maxAt = positiveOrUndefined(this.opts.maxBytes) ?? DEFAULT_MAX_BYTES;
    if (!this.warnedSize && this.bytes >= warnAt) {
      this.warnedSize = true;
      this.warn(
        "size-warning",
        "Kayıt boyutu 1,5 GB sınırına yaklaştı; kaydı bitirmeyi düşünün.",
      );
    }
    this.emit();
    if (
      this.bytes >= maxAt &&
      (this.status === "recording" || this.status === "paused")
    ) {
      this.warn(
        "size-limit",
        "Kayıt boyutu güvenlik sınırına ulaştı; kayıt durduruldu.",
      );
      void this.beginStop();
    }
  }

  private onRecorderError(ev: Event): void {
    const inner = (ev as { error?: { message?: string; name?: string } }).error;
    const message = inner?.message || inner?.name || "MediaRecorder hatası.";
    this.fail(
      new RecorderError("media-recorder-error", message, { cause: ev }),
    );
  }

  private onRecorderStop(): void {
    if (this.status === "error") return;
    if (this.status === "recording" || this.status === "paused") {
      // the browser ended the recording on its own (e.g. all tracks ended): behave like stop()
      void this.beginStop(true);
      return;
    }
    this.finalize();
  }

  /* ---------------- completion ---------------- */

  private buildResult(): RecordingResult {
    const mime =
      this.mimeType ?? (this.ext === "mp4" ? "video/mp4" : "video/webm");
    const blob = new Blob(this.chunks, { type: mime });
    return {
      blob,
      mimeType: mime,
      ext: this.ext ?? extOf(mime, "webm"),
      durationMs: this.durationMs,
      markers: this.markers.map((m) => ({ ...m })),
      startedAt: this.startedAt ?? Date.now(),
    };
  }

  private finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    this.clearStopTimer();
    this.detach();
    const result = this.buildResult();
    this.stopPromise ??= Promise.resolve(result);
    this.chunks = [];
    this.releaseTracks();
    this.recorder = null;
    this.status = "stopped";
    const resolve = this.resolveStop;
    this.resolveStop = null;
    this.rejectStop = null;
    this.emit();
    resolve?.(result);
  }

  private fail(error: RecorderError): void {
    if (this.finalized) return;
    this.finalized = true;
    this.clearStopTimer();
    this.detach();
    this.durationMs = this.clock.stop();
    const partial = this.chunks.length > 0 ? this.buildResult() : null;
    const withPartial = new RecorderError(error.code, error.message, {
      cause: error.cause,
      partial,
    });
    this.fatal = withPartial;
    this.chunks = [];
    this.releaseTracks();
    const rec = this.recorder;
    this.recorder = null;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        // already inactive
      }
    }
    this.status = "error";
    const reject = this.rejectStop;
    this.resolveStop = null;
    this.rejectStop = null;
    this.emit();
    reject?.(withPartial);
  }

  private detach(): void {
    const rec = this.recorder;
    if (!rec) return;
    rec.ondataavailable = null;
    rec.onerror = null;
    rec.onstop = null;
  }

  private clearStopTimer(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  /** Only the tracks created by canvas.captureStream() are ours; audio tracks belong to the bus. */
  private releaseTracks(): void {
    for (const t of this.ownedTracks) this.safeStop(t);
    this.ownedTracks = [];
  }

  private safeStop(track: MediaStreamTrack): void {
    try {
      track.stop();
    } catch {
      // ignore
    }
  }
}
