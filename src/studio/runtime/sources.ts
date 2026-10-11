// src/studio/runtime/sources.ts
// Owns every live media source (camera, screen, prototype capture, guests, asset images/videos)
// and resolves a Layer to a drawable FrameSource for the compositor. Browser-only: construct it
// inside an effect, never at module scope.
import type { AudioBus, ChannelHandle } from "../engine/audio-bus";
import { captureSurface, type CaptureHandle } from "../proto";
import type { AssetStore, FrameSource, Layer } from "../types";

export type SourceName = "webcam" | "screen" | "web" | "asset";
export type SourceErrorCode =
  | "camera-denied"
  | "camera-unavailable"
  | "screen-denied"
  | "capture-failed"
  | "asset-missing"
  | "unsupported";

export interface SourceError {
  source: SourceName;
  code: SourceErrorCode;
  at: number;
}

export interface SourcesSnapshot {
  readonly webcam: boolean;
  readonly screen: boolean;
  /** layer ids that currently have a live prototype capture */
  readonly webCaptures: readonly string[];
  /** peer ids with a live guest stream */
  readonly guests: readonly string[];
  readonly error: SourceError | null;
}

interface LiveVideo {
  video: HTMLVideoElement;
  stream: MediaStream | null;
  stop: () => void;
}

function makeVideo(): HTMLVideoElement {
  const v = document.createElement("video");
  v.muted = true; // audio goes through the AudioBus, never straight to the speakers
  v.playsInline = true;
  v.autoplay = true;
  return v;
}

function isReady(v: HTMLVideoElement): boolean {
  return v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0;
}

function errName(e: unknown): string {
  return (e as { name?: string } | null)?.name ?? "";
}

export class SourceManager {
  private webcam: (LiveVideo & { channel: ChannelHandle | null }) | null = null;
  private screen: (LiveVideo & { channel: ChannelHandle | null }) | null = null;
  private captures = new Map<string, LiveVideo & { handle: CaptureHandle }>();
  private guests = new Map<
    string,
    LiveVideo & { channel: ChannelHandle | null }
  >();
  private images = new Map<string, HTMLImageElement | "loading" | "failed">();
  private videos = new Map<
    string,
    | {
        video: HTMLVideoElement;
        assetId: string;
        channel: ChannelHandle | null;
      }
    | "loading"
  >();
  private snapshot: SourcesSnapshot = {
    webcam: false,
    screen: false,
    webCaptures: [],
    guests: [],
    error: null,
  };
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(
    private readonly assets: AssetStore,
    private readonly audio: AudioBus,
  ) {}

  /* ------------------------------ store ------------------------------ */

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): SourcesSnapshot => this.snapshot;

  private publish(error?: SourceError | null): void {
    this.snapshot = {
      webcam: this.webcam !== null,
      screen: this.screen !== null,
      webCaptures: [...this.captures.keys()],
      guests: [...this.guests.keys()],
      error: error === undefined ? this.snapshot.error : error,
    };
    for (const l of [...this.listeners]) l();
  }

  private fail(source: SourceName, code: SourceErrorCode): void {
    this.publish({ source, code, at: Date.now() });
  }

  clearError(): void {
    if (this.snapshot.error) this.publish(null);
  }

  /* ------------------------------ webcam ----------------------------- */

  getWebcamStream(): MediaStream | null {
    return this.webcam?.stream ?? null;
  }

  async startWebcam(
    deviceId?: string,
    audioDeviceId?: string,
  ): Promise<boolean> {
    if (this.disposed) return false;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      this.fail("webcam", "unsupported");
      return false;
    }
    this.stopWebcam();
    try {
      await this.audio.ensureRunning();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60 },
        },
        audio: {
          ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (this.disposed) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      const video = makeVideo();
      video.srcObject = stream;
      void video.play().catch(() => undefined);
      let channel: ChannelHandle | null = null;
      if (stream.getAudioTracks().length > 0) {
        channel = this.audio.addChannel(
          { id: "mic", label: "Mikrofon", kind: "mic" },
          stream,
          {
            monitor: false,
          },
        );
      }
      const stop = () => {
        channel?.remove();
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
      };
      this.webcam = { video, stream, stop, channel };
      this.publish(null);
      return true;
    } catch (e) {
      const n = errName(e);
      this.fail(
        "webcam",
        n === "NotAllowedError" || n === "SecurityError"
          ? "camera-denied"
          : "camera-unavailable",
      );
      return false;
    }
  }

  stopWebcam(): void {
    if (!this.webcam) return;
    this.webcam.stop();
    this.webcam = null;
    this.publish();
  }

  setMicMuted(muted: boolean): void {
    this.webcam?.channel?.setMuted(muted);
  }

  /* ------------------------------ screen ----------------------------- */

  async startScreen(): Promise<boolean> {
    if (this.disposed) return false;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getDisplayMedia
    ) {
      this.fail("screen", "unsupported");
      return false;
    }
    this.stopScreen();
    try {
      await this.audio.ensureRunning();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 60 } },
        audio: true,
      });
      const video = makeVideo();
      video.srcObject = stream;
      void video.play().catch(() => undefined);
      let channel: ChannelHandle | null = null;
      if (stream.getAudioTracks().length > 0) {
        channel = this.audio.addChannel(
          { id: "system", label: "Sistem sesi", kind: "system" },
          stream,
          { monitor: false },
        );
      }
      const stop = () => {
        channel?.remove();
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
      };
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (this.screen?.stream === stream) this.stopScreen();
      });
      this.screen = { video, stream, stop, channel };
      this.publish(null);
      return true;
    } catch (e) {
      this.fail(
        "screen",
        errName(e) === "NotAllowedError" ? "screen-denied" : "capture-failed",
      );
      return false;
    }
  }

  stopScreen(): void {
    if (!this.screen) return;
    this.screen.stop();
    this.screen = null;
    this.publish();
  }

  /* ------------------- prototype (web layer) capture ------------------ */

  async startWebCapture(
    layerId: string,
    cropElement?: HTMLElement,
    mode: "current-tab-region" | "pick" = "pick",
  ): Promise<boolean> {
    if (this.disposed) return false;
    this.stopWebCapture(layerId);
    try {
      const handle = await captureSurface({
        mode,
        audio: false,
        frameRate: 30,
        ...(cropElement ? { cropElement } : {}),
      });
      const video = makeVideo();
      video.srcObject = handle.stream;
      void video.play().catch(() => undefined);
      handle.track.addEventListener("ended", () =>
        this.stopWebCapture(layerId),
      );
      this.captures.set(layerId, {
        video,
        stream: handle.stream,
        handle,
        stop: () => {
          handle.stop();
          video.srcObject = null;
        },
      });
      this.publish(null);
      return true;
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      this.fail(
        "web",
        code === "unsupported" ? "unsupported" : "capture-failed",
      );
      return false;
    }
  }

  stopWebCapture(layerId: string): void {
    const c = this.captures.get(layerId);
    if (!c) return;
    c.stop();
    this.captures.delete(layerId);
    this.publish();
  }

  /* ------------------------------- guests ---------------------------- */

  setGuestStream(peerId: string, stream: MediaStream | null): void {
    const prev = this.guests.get(peerId);
    if (prev) {
      prev.stop();
      this.guests.delete(peerId);
    }
    if (stream) {
      const video = makeVideo();
      video.srcObject = stream;
      void video.play().catch(() => undefined);
      let channel: ChannelHandle | null = null;
      try {
        channel = this.audio.addChannel(
          { id: `guest:${peerId}`, label: "Konuk", kind: "guest" },
          stream,
        );
      } catch {
        channel = null;
      }
      this.guests.set(peerId, {
        video,
        stream,
        channel,
        stop: () => {
          channel?.remove();
          video.srcObject = null;
        },
      });
    }
    this.publish();
  }

  /* --------------------------- layer resolving ----------------------- */

  /** Called by the compositor on every frame; must be cheap and never throw. */
  resolve = (layer: Layer): FrameSource | null => {
    switch (layer.kind) {
      case "webcam":
        return this.fromVideo(this.webcam?.video, layer.mirror);
      case "screen":
        return this.fromVideo(this.screen?.video, false);
      case "web":
        return this.fromVideo(this.captures.get(layer.id)?.video, false);
      case "guest":
        return this.fromVideo(this.guests.get(layer.peerId)?.video, false);
      case "image":
        return this.fromImage(layer.assetId);
      case "video":
        return this.fromAssetVideo(layer);
      default:
        return null;
    }
  };

  private fromVideo(
    v: HTMLVideoElement | undefined,
    mirror: boolean,
  ): FrameSource | null {
    if (!v) return null;
    return {
      source: v,
      width: v.videoWidth,
      height: v.videoHeight,
      mirror,
      ready: isReady(v),
    };
  }

  private fromImage(assetId: string): FrameSource | null {
    if (!assetId) return null;
    const cur = this.images.get(assetId);
    if (cur === undefined) {
      this.images.set(assetId, "loading");
      void this.loadImage(assetId);
      return null;
    }
    if (cur === "loading" || cur === "failed") return null;
    return {
      source: cur,
      width: cur.naturalWidth,
      height: cur.naturalHeight,
      ready: cur.complete && cur.naturalWidth > 0,
    };
  }

  private async loadImage(assetId: string): Promise<void> {
    try {
      const url = await this.assets.getUrl(assetId);
      if (!url || this.disposed) throw new Error("missing");
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode().catch(() => undefined);
      this.images.set(assetId, img);
    } catch {
      this.images.set(assetId, "failed");
      this.fail("asset", "asset-missing");
    }
  }

  private fromAssetVideo(
    layer: Extract<Layer, { kind: "video" }>,
  ): FrameSource | null {
    if (!layer.assetId) return null;
    const cur = this.videos.get(layer.id);
    if (cur === undefined) {
      this.videos.set(layer.id, "loading");
      void this.loadVideo(layer);
      return null;
    }
    if (cur === "loading") return null;
    if (cur.assetId !== layer.assetId) {
      this.releaseVideo(layer.id);
      return null;
    }
    cur.video.loop = layer.loop;
    cur.channel?.setMuted(layer.muted);
    cur.channel?.setGain(layer.volume);
    return {
      source: cur.video,
      width: cur.video.videoWidth,
      height: cur.video.videoHeight,
      ready: isReady(cur.video),
    };
  }

  private async loadVideo(
    layer: Extract<Layer, { kind: "video" }>,
  ): Promise<void> {
    try {
      const url = await this.assets.getUrl(layer.assetId);
      if (!url || this.disposed) throw new Error("missing");
      const video = makeVideo();
      video.loop = layer.loop;
      video.src = url;
      let channel: ChannelHandle | null = null;
      try {
        await this.audio.ensureRunning();
        channel = this.audio.addChannel(
          { id: `video:${layer.id}`, label: layer.name, kind: "video" },
          video,
        );
      } catch {
        channel = null;
      }
      void video.play().catch(() => undefined);
      this.videos.set(layer.id, { video, assetId: layer.assetId, channel });
    } catch {
      this.videos.delete(layer.id);
      this.fail("asset", "asset-missing");
    }
  }

  private releaseVideo(layerId: string): void {
    const v = this.videos.get(layerId);
    this.videos.delete(layerId);
    if (v && v !== "loading") {
      v.channel?.remove();
      v.video.pause();
      v.video.removeAttribute("src");
      v.video.load();
    }
  }

  /** Playback control for an asset video layer. */
  toggleVideo(layerId: string): void {
    const v = this.videos.get(layerId);
    if (!v || v === "loading") return;
    if (v.video.paused) void v.video.play().catch(() => undefined);
    else v.video.pause();
  }

  /** Drop per-layer resources for layers that no longer exist. Cheap; call on project changes. */
  gc(
    liveLayerIds: ReadonlySet<string>,
    liveAssetIds: ReadonlySet<string>,
  ): void {
    for (const id of [...this.videos.keys()])
      if (!liveLayerIds.has(id)) this.releaseVideo(id);
    for (const id of [...this.captures.keys()])
      if (!liveLayerIds.has(id)) this.stopWebCapture(id);
    for (const id of [...this.images.keys()])
      if (!liveAssetIds.has(id)) this.images.delete(id);
  }

  /* ----------------------------- lifecycle --------------------------- */

  dispose(): void {
    this.disposed = true;
    this.webcam?.stop();
    this.screen?.stop();
    for (const c of this.captures.values()) c.stop();
    for (const g of this.guests.values()) g.stop();
    for (const id of [...this.videos.keys()]) this.releaseVideo(id);
    this.webcam = this.screen = null;
    this.captures.clear();
    this.guests.clear();
    this.images.clear();
    this.listeners.clear();
  }
}
