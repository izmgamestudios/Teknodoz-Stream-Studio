// src/studio/live/streamer.ts
// Controller of one live broadcast: records the program canvas + audio mix with MediaRecorder,
// uploads the chunks to the server bridge (ffmpeg -> RTMP/RTMPS) and tracks its progress.
// Exposes a tiny external store (`subscribe` / `getSnapshot`) for React. Browser only.
import {
  LiveApiError,
  createLiveApi,
  type LiveApi,
  type LiveSession,
  type StartBody,
} from "./api";
import type { Quality } from "./platforms";
import { ChunkUploader } from "./uploader";

export type LivePhase =
  "idle" | "starting" | "live" | "stopping" | "ended" | "error";

export interface LiveFailure {
  code: string;
  reason?: string;
  /** index of the destination that was refused */
  index?: number;
  /** last lines of ffmpeg output (secrets already removed by the server) */
  tail?: string[];
}

export interface LiveSnapshot {
  readonly phase: LivePhase;
  readonly session: LiveSession | null;
  readonly error: LiveFailure | null;
  /** chunks waiting to be uploaded (≈ seconds behind real time) */
  readonly backlog: number;
  readonly bytesSent: number;
}

const IDLE: LiveSnapshot = Object.freeze({
  phase: "idle",
  session: null,
  error: null,
  backlog: 0,
  bytesSent: 0,
});

export interface LiveSources {
  getCanvas(): HTMLCanvasElement | null;
  getAudioStream(): MediaStream | null;
  ensureAudio(): Promise<void>;
}

export interface StartOptions {
  token: string;
  destinations: StartBody["destinations"];
  quality: Quality;
}

export interface StreamerDeps {
  api?: LiveApi;
  /** test seams */
  recorderCtor?: typeof MediaRecorder;
  makeStream?: (
    video: MediaStreamTrack[],
    audio: MediaStreamTrack[],
  ) => MediaStream;
  pollMs?: number;
}

const MIMES = [
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9,opus",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
] as const;

export function pickLiveMime(
  isSupported: (t: string) => boolean,
): { mimeType: string; container: "webm" | "mp4" } | null {
  for (const m of MIMES) {
    let ok = false;
    try {
      ok = isSupported(m);
    } catch {
      ok = false;
    }
    if (ok)
      return {
        mimeType: m,
        container: m.startsWith("video/webm") ? "webm" : "mp4",
      };
  }
  return null;
}

export class LiveStreamer {
  private readonly src: LiveSources;
  private readonly api: LiveApi;
  private readonly deps: StreamerDeps;
  private snap: LiveSnapshot = IDLE;
  private listeners = new Set<() => void>();

  private token = "";
  private session: LiveSession | null = null;
  private recorder: MediaRecorder | null = null;
  private owned: MediaStreamTrack[] = [];
  private uploader: ChunkUploader | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private phase: LivePhase = "idle";
  private error: LiveFailure | null = null;
  private run = 0;

  constructor(src: LiveSources, deps: StreamerDeps = {}) {
    this.src = src;
    this.deps = deps;
    this.api = deps.api ?? createLiveApi();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): LiveSnapshot => this.snap;

  private emit(): void {
    this.snap = {
      phase: this.phase,
      session: this.session,
      error: this.error,
      backlog: this.uploader?.backlog ?? 0,
      bytesSent: this.uploader?.bytesSent ?? 0,
    };
    for (const l of [...this.listeners]) l();
  }

  private fail(e: unknown, extra: Partial<LiveFailure> = {}): void {
    const err = e instanceof LiveApiError ? e : null;
    const session = (err?.data["session"] ?? null) as LiveSession | null;
    this.error = {
      code: err ? err.code : typeof e === "string" ? e : "unknown",
      ...(err?.reason ? { reason: err.reason } : {}),
      ...(err?.index !== undefined ? { index: err.index } : {}),
      ...(session?.tail?.length ? { tail: session.tail } : {}),
      ...extra,
    };
    this.phase = "error";
    this.emit();
  }

  /** Begin a broadcast. Resolves true once media is flowing to the server. */
  async start(opts: StartOptions): Promise<boolean> {
    if (
      this.phase === "starting" ||
      this.phase === "live" ||
      this.phase === "stopping"
    )
      return false;
    const run = ++this.run;
    this.token = opts.token;
    this.error = null;
    this.session = null;
    this.phase = "starting";
    this.emit();

    const canvas = this.src.getCanvas();
    const Rec =
      this.deps.recorderCtor ??
      (typeof MediaRecorder === "undefined" ? undefined : MediaRecorder);
    if (!canvas || typeof canvas.captureStream !== "function" || !Rec) {
      this.fail("unsupported");
      return false;
    }
    const picked = pickLiveMime((t) => Rec.isTypeSupported(t));
    if (!picked) {
      this.fail("unsupported");
      return false;
    }

    try {
      await this.src.ensureAudio();
    } catch {
      // continue: the mix bus may still deliver a (silent) track
    }

    let session: LiveSession;
    try {
      const r = await this.api.start(opts.token, {
        destinations: opts.destinations,
        video: {
          width: opts.quality.width,
          height: opts.quality.height,
          fps: opts.quality.fps,
          kbps: opts.quality.kbps,
        },
        audioKbps: 128,
        container: picked.container,
      });
      session = r.session;
    } catch (e) {
      this.fail(e);
      return false;
    }
    if (run !== this.run) return false;
    this.session = session;

    try {
      const video = canvas.captureStream(opts.quality.fps);
      const vTracks = video.getVideoTracks();
      const aTracks = (
        this.src.getAudioStream()?.getAudioTracks() ?? []
      ).filter((t) => t.readyState !== "ended");
      if (vTracks.length === 0) throw new Error("no-video-track");
      this.owned = video.getTracks();
      const composite = this.deps.makeStream
        ? this.deps.makeStream(vTracks, aTracks)
        : new MediaStream([...vTracks, ...aTracks]);
      const rec = new Rec(composite, {
        mimeType: picked.mimeType,
        videoBitsPerSecond: Math.min(
          12_000_000,
          Math.round(opts.quality.kbps * 1000 * 1.5),
        ),
        audioBitsPerSecond: 128_000,
      });
      const uploader = new ChunkUploader({
        api: this.api,
        token: opts.token,
        sessionId: session.id,
        onError: (e) => {
          void this.abort(e);
        },
      });
      this.uploader = uploader;
      rec.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) {
          uploader.push(ev.data);
          this.emit();
        }
      };
      rec.onerror = () => void this.abort("recorder-error");
      this.recorder = rec;
      rec.start(1000);
    } catch (e) {
      await this.api.stop(opts.token, session.id).catch(() => undefined);
      this.cleanup();
      this.fail(
        e instanceof Error && e.message === "no-video-track"
          ? "no-video-track"
          : "recorder-start-failed",
      );
      return false;
    }

    this.poll = setInterval(
      () => void this.refresh(run),
      this.deps.pollMs ?? 2000,
    );
    this.phase = "live";
    this.emit();
    return true;
  }

  private async refresh(run: number): Promise<void> {
    if (run !== this.run || !this.session || this.phase !== "live") return;
    try {
      const r = await this.api.session(this.token, this.session.id);
      if (run !== this.run) return;
      this.session = r.session;
      if (r.session.state === "ended" || r.session.state === "error") {
        // the server ended it (idle watchdog, time limit, ffmpeg or platform failure)
        this.cleanup();
        if (r.session.state === "error" || r.session.error) {
          this.error = {
            code:
              r.session.error === "idle" || r.session.error === "max-duration"
                ? r.session.error
                : "ffmpeg",
            ...(r.session.tail.length ? { tail: r.session.tail } : {}),
          };
          this.phase = "error";
        } else this.phase = "ended";
      }
      this.emit();
    } catch {
      // transient: the next tick retries; uploader errors end the broadcast
      this.emit();
    }
  }

  /** Stop recording first (final chunk), flush the upload, then close the server session. */
  async stop(): Promise<void> {
    if (this.phase !== "live" && this.phase !== "starting") return;
    const session = this.session;
    this.phase = "stopping";
    this.emit();
    const rec = this.recorder;
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 1500);
        rec.addEventListener("stop", () => (clearTimeout(t), resolve()), {
          once: true,
        });
        try {
          rec.stop();
        } catch {
          resolve();
        }
      });
    }
    await Promise.race([
      this.uploader?.drain(),
      new Promise((r) => setTimeout(r, 6000)),
    ]);
    if (session) {
      try {
        const r = await this.api.stop(this.token, session.id);
        this.session = r.session;
      } catch {
        // already gone
      }
    }
    this.cleanup();
    this.phase = "ended";
    this.emit();
  }

  /** Stop a session left over from an earlier page load (found through /status). */
  async stopRemote(token: string, id: string): Promise<boolean> {
    try {
      await this.api.stop(token, id);
      return true;
    } catch {
      return false;
    }
  }

  private async abort(reason: LiveApiError | string): Promise<void> {
    if (
      this.phase === "idle" ||
      this.phase === "ended" ||
      this.phase === "error"
    )
      return;
    const session = this.session;
    const token = this.token;
    this.cleanup();
    if (session) await this.api.stop(token, session.id).catch(() => undefined);
    this.fail(reason);
  }

  private cleanup(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    const rec = this.recorder;
    this.recorder = null;
    if (rec) {
      rec.ondataavailable = null;
      rec.onerror = null;
      if (rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          // already stopped
        }
      }
    }
    for (const t of this.owned) {
      try {
        t.stop();
      } catch {
        // ignore
      }
    }
    this.owned = [];
    this.uploader?.stop();
    // keep the counters for the final summary
  }

  /** Back to the idle state (clears the last result). */
  reset(): void {
    if (
      this.phase === "live" ||
      this.phase === "starting" ||
      this.phase === "stopping"
    )
      return;
    this.session = null;
    this.error = null;
    this.uploader = null;
    this.phase = "idle";
    this.emit();
  }

  dispose(): void {
    this.run++;
    const s = this.session;
    const live =
      this.phase === "live" ||
      this.phase === "starting" ||
      this.phase === "stopping";
    this.cleanup();
    if (s && live) void this.api.stop(this.token, s.id).catch(() => undefined);
    this.listeners.clear();
  }
}
