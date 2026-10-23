// src/studio/engine/audio-bus.ts
// Web Audio mixer: channels (mic / system / music / guest / sfx / video) -> master -> a
// MediaStream used by the recorder and the P2P program stream. Nothing here touches
// AudioContext, window or document until a method is called (SSR-safe).
//
// Per-channel graph:
//   source -> volume -> gate(mute) -> mixIn -> master -> [limiter] -> post -> mix destination
//                 \-> analyser (post-volume, pre-mute meter)
//                       gate -> monitor -> monitorBus -> speakers
// Tips for callers:
//  - Elements routed through the bus play ONLY through the bus (Web Audio takes the output over)
//    so keep their monitor on to hear them, and never set element.muted: use channel mute.
//  - Cross-origin media without CORS headers decodes to silence in Web Audio.

import { sanitizeLabel } from "./chapters";

export type ChannelKind =
  "mic" | "system" | "music" | "guest" | "sfx" | "video";

export type AudioBusErrorCode =
  | "unsupported"
  | "disposed"
  | "invalid-id"
  | "invalid-input"
  | "duplicate-channel"
  | "duplicate-input"
  | "too-many-channels"
  | "element-bound"
  | "sfx-url-blocked"
  | "sfx-too-large"
  | "sfx-load-failed"
  | "sfx-decode-failed";

export class AudioBusError extends Error {
  readonly code: AudioBusErrorCode;

  constructor(code: AudioBusErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "AudioBusError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const MAX_GAIN = 1.5;
/** dB value reported for silence (finite so UI math never sees -Infinity). */
export const SILENCE_DB = -100;
/** Reserved id of the built-in sound-effects channel (created together with the context). */
export const SFX_CHANNEL_ID = "sfx";
export const MAX_CHANNELS = 32;
export const MAX_ACTIVE_SFX = 32;
export const MAX_SFX_BYTES = 25 * 1024 * 1024;
export const SFX_CACHE_ENTRIES = 24;
export const SFX_CACHE_BYTES = 96 * 1024 * 1024;

const MAX_ID_LENGTH = 64;
const MAX_LABEL_LENGTH = 80;
const ANALYSER_FFT = 1024;
const PARAM_TIME_CONSTANT = 0.012;
const RESUME_TIMEOUT_MS = 3000;
const KINDS: readonly ChannelKind[] = [
  "mic",
  "system",
  "music",
  "guest",
  "sfx",
  "video",
];

/* ------------------------------------------------------------------ */
/* Pure level helpers (no Web Audio needed)                            */
/* ------------------------------------------------------------------ */

export interface AudioLevel {
  /** linear RMS 0..1+ */
  rms: number;
  /** linear sample peak 0..1+ */
  peak: number;
  /** RMS in dBFS, floored at SILENCE_DB */
  db: number;
}

export function linearToDb(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return SILENCE_DB;
  return Math.max(SILENCE_DB, 20 * Math.log10(x));
}

export function dbToLinear(db: number): number {
  return Number.isFinite(db) ? Math.pow(10, db / 20) : 0;
}

/** Clamp a gain to 0..MAX_GAIN. Non-numeric / NaN input returns `fallback`. */
export function clampGain(value: number, fallback = 1): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(MAX_GAIN, Math.max(0, value));
}

/**
 * RMS / peak / dB of a block of samples, written into `out` (no allocation). Non-finite
 * samples count as 0.
 */
export function computeLevel(
  samples: ArrayLike<number>,
  out: AudioLevel,
): AudioLevel {
  const n = samples.length;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const raw = samples[i] ?? 0;
    const v = Number.isFinite(raw) ? raw : 0;
    sum += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  const rms = n > 0 ? Math.sqrt(sum / n) : 0;
  out.rms = rms;
  out.peak = peak;
  out.db = linearToDb(rms);
  return out;
}

/** Map dB to a 0..1 meter position (linear in dB between minDb and maxDb). */
export function meterFraction(db: number, minDb = -60, maxDb = 0): number {
  if (!Number.isFinite(db) || maxDb <= minDb) return 0;
  return Math.min(1, Math.max(0, (db - minDb) / (maxDb - minDb)));
}

/**
 * Peak-hold with decay for VU meters: holds the highest linear level for `holdMs`, then falls
 * at `decayDbPerSec`. Feed it the current peak every frame with a monotonic timestamp.
 */
export class PeakHold {
  private value = 0;
  private peakAt = 0;
  private lastAt = 0;

  constructor(
    private readonly holdMs = 900,
    private readonly decayDbPerSec = 24,
  ) {}

  update(level: number, nowMs: number): number {
    const v = Number.isFinite(level) && level > 0 ? level : 0;
    if (v >= this.value) {
      this.value = v;
      this.peakAt = nowMs;
      this.lastAt = nowMs;
      return this.value;
    }
    const decayStart = this.peakAt + this.holdMs;
    if (nowMs > decayStart) {
      const dt = Math.max(0, nowMs - Math.max(this.lastAt, decayStart));
      const decayed =
        this.value * dbToLinear((-this.decayDbPerSec * dt) / 1000);
      this.value = Math.max(v, decayed < 1e-5 ? 0 : decayed);
    }
    this.lastAt = nowMs;
    return this.value;
  }

  get current(): number {
    return this.value;
  }

  reset(): void {
    this.value = 0;
    this.peakAt = 0;
    this.lastAt = 0;
  }
}

/** Monitoring default: off for the mic (feedback), on for everything else. */
export function defaultMonitor(kind: ChannelKind): boolean {
  return kind !== "mic";
}

/** Only blob:, data: and same-origin URLs may be loaded as sound effects (no network calls). */
export function isAllowedSfxUrl(url: string, origin?: string): boolean {
  if (typeof url !== "string" || url === "") return false;
  const base =
    origin ?? (typeof location !== "undefined" ? location.origin : undefined);
  let parsed: URL;
  try {
    parsed = base ? new URL(url, base) : new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "blob:" || parsed.protocol === "data:") return true;
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return base !== undefined && parsed.origin === new URL(base).origin;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export interface ChannelSpec {
  id: string;
  label: string;
  kind: ChannelKind;
}

export interface AddChannelOptions {
  /** 0..1.5, default 1 */
  gain?: number | undefined;
  /** play the channel through the speakers; default off for "mic", on otherwise */
  monitor?: boolean | undefined;
  muted?: boolean | undefined;
  /**
   * MediaStream inputs only: attach the stream to a muted detached <audio> so Chrome keeps
   * feeding remote WebRTC audio into Web Audio. Default true for "guest" channels.
   */
  keepAlive?: boolean | undefined;
}

export interface ChannelHandle {
  readonly id: string;
  setGain(value: number): void;
  setMuted(muted: boolean): void;
  setMonitor(on: boolean): void;
  replaceInput(input: MediaStream | HTMLMediaElement): void;
  /** The returned object is reused between calls: read it synchronously. */
  getLevel(): Readonly<AudioLevel>;
  remove(): void;
}

export interface ChannelInfo {
  readonly id: string;
  readonly label: string;
  readonly kind: ChannelKind;
  readonly gain: number;
  readonly muted: boolean;
  readonly monitor: boolean;
  /** false while a stream channel has no live audio track (e.g. guest not connected yet) */
  readonly active: boolean;
  readonly source: "stream" | "element" | "internal";
}

export type BusContextState =
  "none" | "suspended" | "running" | "closed" | "interrupted";

export interface AudioBusState {
  readonly channels: readonly ChannelInfo[];
  readonly masterGain: number;
  readonly masterMuted: boolean;
  readonly limiter: boolean;
  readonly monitorEnabled: boolean;
  readonly contextState: BusContextState;
}

export type SfxResult =
  { status: "ended" | "stopped" } | { status: "error"; error: AudioBusError };

export interface SfxHandle {
  /** Stops playback (or cancels it if the sound is still decoding). */
  stop(): void;
  /** Settles when playback ends, is stopped, or fails. Never rejects. */
  readonly done: Promise<SfxResult>;
}

export interface AudioBusOptions {
  /** Master limiter on from the start. Default true. */
  limiter?: boolean;
  /** Replace AudioContext construction (tests, custom sample rate). */
  contextFactory?: () => AudioContext;
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

type InputRef =
  | { type: "stream"; stream: MediaStream }
  | { type: "element"; element: HTMLMediaElement }
  | { type: "internal"; node: AudioNode };

interface ChannelNodes {
  volume: GainNode;
  gate: GainNode;
  analyser: AnalyserNode;
  monitor: GainNode;
}

interface Channel {
  id: string;
  label: string;
  kind: ChannelKind;
  gain: number;
  muted: boolean;
  monitor: boolean;
  keepAlive: boolean;
  input: InputRef;
  source: AudioNode | null;
  nodes: ChannelNodes;
  samples: Float32Array<ArrayBuffer>;
  level: AudioLevel;
  detachInput: (() => void) | null;
  keepAliveEl: HTMLAudioElement | null;
}

interface ReturnMix {
  exclude: string;
  sum: GainNode;
  limiter: DynamicsCompressorNode;
  dest: MediaStreamAudioDestinationNode;
}

export interface ReturnHandle {
  /** the mix of every channel except the excluded one */
  readonly stream: MediaStream;
  close(): void;
}

interface Graph {
  mixIn: GainNode;
  master: GainNode;
  limiter: DynamicsCompressorNode;
  post: GainNode;
  dest: MediaStreamAudioDestinationNode;
  masterAnalyser: AnalyserNode;
  monitorBus: GainNode;
  sfxIn: GainNode;
}

interface ActiveSfx {
  stopped: boolean;
  finished: boolean;
  src: AudioBufferSourceNode | null;
  gain: GainNode | null;
  /** settle `done` and release nodes (idempotent) */
  finish(result: SfxResult): void;
  /** stop playback / cancel a pending decode, then finish as "stopped" */
  halt(): void;
}

/** createMediaElementSource may be called once per element ever: cache it (per context). */
const ELEMENT_SOURCES = new WeakMap<
  object,
  { ctx: BaseAudioContext; node: MediaElementAudioSourceNode }
>();

const SILENT_LEVEL: Readonly<AudioLevel> = Object.freeze({
  rms: 0,
  peak: 0,
  db: SILENCE_DB,
});
const noop = (): void => {};

function safeDisconnect(node: AudioNode, dest?: AudioNode): void {
  try {
    if (dest) node.disconnect(dest);
    else node.disconnect();
  } catch {
    // not connected
  }
}

function isMediaStream(v: unknown): v is MediaStream {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as MediaStream).getAudioTracks === "function" &&
    typeof (v as MediaStream).addEventListener === "function"
  );
}

function isMediaElement(v: unknown): v is HTMLMediaElement {
  if (typeof v !== "object" || v === null) return false;
  if (typeof HTMLMediaElement !== "undefined" && v instanceof HTMLMediaElement)
    return true;
  const e = v as { play?: unknown; pause?: unknown; currentTime?: unknown };
  return (
    typeof e.play === "function" &&
    typeof e.pause === "function" &&
    "currentTime" in e
  );
}

function isAudioBuffer(v: unknown): v is AudioBuffer {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as AudioBuffer).getChannelData === "function"
  );
}

function defaultContextFactory(): AudioContext {
  const g = globalThis as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor)
    throw new AudioBusError(
      "unsupported",
      "Bu tarayıcı Web Audio desteklemiyor.",
    );
  try {
    return new Ctor({ latencyHint: "interactive" });
  } catch {
    try {
      return new Ctor();
    } catch (cause) {
      throw new AudioBusError(
        "unsupported",
        "Ses motoru başlatılamadı.",
        cause,
      );
    }
  }
}

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    if (typeof FileReader === "undefined") {
      reject(new AudioBusError("unsupported", "Dosya okunamıyor."));
      return;
    }
    const reader = new FileReader();
    reader.onload = (): void => resolve(reader.result as ArrayBuffer);
    reader.onerror = (): void =>
      reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(blob);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/* ------------------------------------------------------------------ */
/* AudioBus                                                            */
/* ------------------------------------------------------------------ */

export class AudioBus {
  private readonly factory: () => AudioContext;
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private readonly channels = new Map<string, Channel>();
  private readonly listeners = new Set<() => void>();
  private readonly activeSfx = new Set<ActiveSfx>();
  private readonly sfxCache = new Map<string | Blob, Promise<AudioBuffer>>();
  private readonly sfxSizes = new Map<string | Blob, number>();
  private masterGainValue = 1;
  private masterMuted = false;
  private limiterOn: boolean;
  private monitorEnabled = true;
  private disposed = false;
  private gestureCleanup: (() => void) | null = null;
  private stateListenerCleanup: (() => void) | null = null;
  private masterLevel: AudioLevel = { rms: 0, peak: 0, db: SILENCE_DB };
  private masterSamples: Float32Array<ArrayBuffer> = new Float32Array(
    ANALYSER_FFT,
  );
  private snapshot: AudioBusState;

  constructor(opts: AudioBusOptions = {}) {
    this.factory = opts.contextFactory ?? defaultContextFactory;
    this.limiterOn = opts.limiter ?? true;
    this.snapshot = this.buildSnapshot();
  }

  /* ---------------- context ---------------- */

  /**
   * Create the AudioContext on first use and resume it. Call from a user gesture (click /
   * keypress). Resolves with the context state; never hangs longer than a few seconds.
   */
  async ensureRunning(): Promise<BusContextState> {
    const ctx = this.requireContext();
    if (ctx.state !== "running" && ctx.state !== "closed") {
      try {
        await withTimeout(ctx.resume(), RESUME_TIMEOUT_MS);
      } catch {
        // still suspended: the gesture listeners keep trying
      }
    }
    this.emit();
    return this.contextState();
  }

  private contextState(): BusContextState {
    return this.ctx ? (this.ctx.state as BusContextState) : "none";
  }

  private requireContext(): AudioContext {
    if (this.disposed)
      throw new AudioBusError("disposed", "Ses motoru kapatıldı.");
    if (this.ctx && this.graph) return this.ctx;
    const ctx = this.factory();
    try {
      this.ctx = ctx;
      this.graph = this.buildGraph(ctx);
    } catch (cause) {
      this.ctx = null;
      this.graph = null;
      try {
        void ctx.close();
      } catch {
        // ignore
      }
      throw cause instanceof AudioBusError
        ? cause
        : new AudioBusError("unsupported", "Ses grafiği kurulamadı.", cause);
    }
    this.armContextListeners(ctx);
    this.addInternalChannel(
      SFX_CHANNEL_ID,
      "Efektler",
      "sfx",
      this.graph.sfxIn,
    );
    this.emit();
    return ctx;
  }

  private buildGraph(ctx: AudioContext): Graph {
    const mixIn = ctx.createGain();
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    const post = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    const masterAnalyser = ctx.createAnalyser();
    const monitorBus = ctx.createGain();
    const sfxIn = ctx.createGain();

    masterAnalyser.fftSize = ANALYSER_FFT;
    // Brick-wall-ish limiter: only catches summed peaks, leaves normal levels alone.
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;

    mixIn.connect(master);
    post.connect(dest);
    post.connect(masterAnalyser);
    monitorBus.connect(ctx.destination);

    const graph: Graph = {
      mixIn,
      master,
      limiter,
      post,
      dest,
      masterAnalyser,
      monitorBus,
      sfxIn,
    };
    this.graph = graph;
    this.routeMaster();
    master.gain.value = this.masterMuted ? 0 : this.masterGainValue;
    monitorBus.gain.value = this.monitorEnabled && !this.masterMuted ? 1 : 0;
    return graph;
  }

  /** (Re)wire master -> [limiter] -> post according to the limiter toggle. */
  private routeMaster(): void {
    const g = this.graph;
    if (!g) return;
    safeDisconnect(g.master);
    safeDisconnect(g.limiter);
    if (this.limiterOn) {
      g.master.connect(g.limiter);
      g.limiter.connect(g.post);
    } else {
      g.master.connect(g.post);
    }
  }

  private armContextListeners(ctx: AudioContext): void {
    const onState = (): void => {
      if (ctx.state === "running") this.disarmGesture();
      this.emit();
    };
    if (typeof ctx.addEventListener === "function") {
      ctx.addEventListener("statechange", onState);
      this.stateListenerCleanup = () =>
        ctx.removeEventListener("statechange", onState);
    }
    if (ctx.state !== "running" && typeof document !== "undefined") {
      const resume = (): void => {
        if (ctx.state !== "running" && ctx.state !== "closed")
          ctx.resume().catch(noop);
      };
      const events = ["pointerdown", "keydown", "touchend"] as const;
      for (const e of events) document.addEventListener(e, resume, true);
      this.gestureCleanup = () => {
        for (const e of events) document.removeEventListener(e, resume, true);
      };
    }
  }

  private disarmGesture(): void {
    this.gestureCleanup?.();
    this.gestureCleanup = null;
  }

  /* ---------------- state ---------------- */

  /** Bound: pass straight to useSyncExternalStore. Identity changes only when state changes. */
  readonly getState = (): AudioBusState => this.snapshot;

  /** Bound: pass straight to useSyncExternalStore. Returns the unsubscribe function. */
  readonly subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  private buildSnapshot(): AudioBusState {
    const channels: ChannelInfo[] = [];
    for (const ch of this.channels.values()) {
      channels.push({
        id: ch.id,
        label: ch.label,
        kind: ch.kind,
        gain: ch.gain,
        muted: ch.muted,
        monitor: ch.monitor,
        active: ch.source !== null,
        source: ch.input.type,
      });
    }
    return {
      channels,
      masterGain: this.masterGainValue,
      masterMuted: this.masterMuted,
      limiter: this.limiterOn,
      monitorEnabled: this.monitorEnabled,
      contextState: this.disposed ? "closed" : this.contextState(),
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const cb of [...this.listeners]) {
      try {
        cb();
      } catch {
        // a faulty subscriber must not break the mixer
      }
    }
  }

  /* ---------------- AudioParam helper ---------------- */

  private setParam(param: AudioParam, value: number): void {
    const ctx = this.ctx;
    if (ctx && typeof param.setTargetAtTime === "function") {
      try {
        param.cancelScheduledValues(ctx.currentTime);
        param.setTargetAtTime(value, ctx.currentTime, PARAM_TIME_CONSTANT);
        return;
      } catch {
        // fall through to a plain assignment
      }
    }
    param.value = value;
  }

  /* ---------------- channels ---------------- */

  addChannel(
    spec: ChannelSpec,
    input: MediaStream | HTMLMediaElement,
    opts: AddChannelOptions = {},
  ): ChannelHandle {
    if (this.disposed)
      throw new AudioBusError("disposed", "Ses motoru kapatıldı.");
    const id = typeof spec?.id === "string" ? spec.id.trim() : "";
    if (id === "" || id.length > MAX_ID_LENGTH) {
      throw new AudioBusError("invalid-id", "Geçersiz kanal kimliği.");
    }
    const kind: ChannelKind = KINDS.includes(spec.kind) ? spec.kind : "music";
    let ref: InputRef;
    if (isMediaStream(input)) ref = { type: "stream", stream: input };
    else if (isMediaElement(input)) ref = { type: "element", element: input };
    else throw new AudioBusError("invalid-input", "Ses kaynağı geçersiz.");

    this.requireContext();
    if (this.channels.has(id)) {
      throw new AudioBusError("duplicate-channel", `"${id}" kanalı zaten var.`);
    }
    if (this.channels.size >= MAX_CHANNELS) {
      throw new AudioBusError("too-many-channels", "Çok fazla ses kanalı.");
    }
    if (ref.type === "element") this.assertElementFree(ref.element, null);

    const ch = this.createChannel(
      id,
      sanitizeLabel(spec.label, id, MAX_LABEL_LENGTH),
      kind,
      ref,
      {
        gain: clampGain(opts.gain ?? 1, 1),
        muted: opts.muted === true,
        monitor: opts.monitor ?? defaultMonitor(kind),
        keepAlive: opts.keepAlive ?? kind === "guest",
      },
    );
    try {
      this.attachInput(ch, ref);
    } catch (err) {
      this.teardownChannel(ch);
      throw err;
    }
    this.channels.set(id, ch);
    this.emit();
    return this.handleFor(id);
  }

  private createChannel(
    id: string,
    label: string,
    kind: ChannelKind,
    input: InputRef,
    init: {
      gain: number;
      muted: boolean;
      monitor: boolean;
      keepAlive: boolean;
    },
  ): Channel {
    const ctx = this.ctx as AudioContext;
    const g = this.graph as Graph;
    const volume = ctx.createGain();
    const gate = ctx.createGain();
    const analyser = ctx.createAnalyser();
    const monitor = ctx.createGain();
    analyser.fftSize = ANALYSER_FFT;
    volume.gain.value = init.gain;
    gate.gain.value = init.muted ? 0 : 1;
    monitor.gain.value = init.monitor ? 1 : 0;
    volume.connect(gate);
    volume.connect(analyser);
    gate.connect(g.mixIn);
    for (const r of this.returns) if (r.exclude !== id) gate.connect(r.sum);
    gate.connect(monitor);
    monitor.connect(g.monitorBus);
    return {
      id,
      label,
      kind,
      gain: init.gain,
      muted: init.muted,
      monitor: init.monitor,
      keepAlive: init.keepAlive,
      input,
      source: null,
      nodes: { volume, gate, analyser, monitor },
      samples: new Float32Array(analyser.fftSize || ANALYSER_FFT),
      level: { rms: 0, peak: 0, db: SILENCE_DB },
      detachInput: null,
      keepAliveEl: null,
    };
  }

  private addInternalChannel(
    id: string,
    label: string,
    kind: ChannelKind,
    node: AudioNode,
  ): void {
    const ch = this.createChannel(
      id,
      label,
      kind,
      { type: "internal", node },
      {
        gain: 1,
        muted: false,
        monitor: defaultMonitor(kind),
        keepAlive: false,
      },
    );
    node.connect(ch.nodes.volume);
    ch.source = node;
    ch.detachInput = () => safeDisconnect(node, ch.nodes.volume);
    this.channels.set(id, ch);
  }

  private handleFor(id: string): ChannelHandle {
    return {
      id,
      setGain: (v) => void this.setGain(id, v),
      setMuted: (m) => void this.setMuted(id, m),
      setMonitor: (on) => void this.setMonitor(id, on),
      replaceInput: (input) => void this.replaceInput(id, input),
      getLevel: () => this.getLevel(id),
      remove: () => void this.removeChannel(id),
    };
  }

  private returns = new Set<ReturnMix>();

  /**
   * "Mix-minus": a separate mix of every channel (present and future) except `excludeId`, e.g.
   * what a remote guest hears — the room without their own voice coming back as an echo.
   */
  openReturn(excludeId: string): ReturnHandle {
    if (this.disposed)
      throw new AudioBusError("disposed", "Ses motoru kapatıldı.");
    const ctx = this.requireContext();
    const sum = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    const dest = ctx.createMediaStreamDestination();
    sum.connect(limiter);
    limiter.connect(dest);
    const r: ReturnMix = { exclude: excludeId, sum, limiter, dest };
    for (const [id, ch] of this.channels)
      if (id !== excludeId) ch.nodes.gate.connect(sum);
    this.returns.add(r);
    return {
      stream: dest.stream,
      close: () => {
        if (!this.returns.delete(r)) return;
        for (const ch of this.channels.values())
          safeDisconnect(ch.nodes.gate, sum);
        safeDisconnect(sum);
        safeDisconnect(limiter);
      },
    };
  }

  removeChannel(id: string): boolean {
    const ch = this.channels.get(id);
    if (!ch) return false;
    this.channels.delete(id);
    this.teardownChannel(ch);
    this.emit();
    return true;
  }

  private teardownChannel(ch: Channel): void {
    ch.detachInput?.();
    ch.detachInput = null;
    this.releaseKeepAlive(ch);
    ch.source = null;
    safeDisconnect(ch.nodes.volume);
    safeDisconnect(ch.nodes.gate);
    safeDisconnect(ch.nodes.analyser);
    safeDisconnect(ch.nodes.monitor);
  }

  hasChannel(id: string): boolean {
    return this.channels.has(id);
  }

  /** @returns false when the channel does not exist or the value is NaN */
  setGain(id: string, value: number): boolean {
    const ch = this.channels.get(id);
    const g = clampGain(value, Number.NaN);
    if (!ch || Number.isNaN(g)) return false;
    ch.gain = g;
    this.setParam(ch.nodes.volume.gain, g);
    this.emit();
    return true;
  }

  setMuted(id: string, muted: boolean): boolean {
    const ch = this.channels.get(id);
    if (!ch) return false;
    ch.muted = muted === true;
    this.setParam(ch.nodes.gate.gain, ch.muted ? 0 : 1);
    this.emit();
    return true;
  }

  setMonitor(id: string, on: boolean): boolean {
    const ch = this.channels.get(id);
    if (!ch) return false;
    ch.monitor = on === true;
    this.setParam(ch.nodes.monitor.gain, ch.monitor ? 1 : 0);
    this.emit();
    return true;
  }

  /**
   * Swap the input of a channel (guest reconnected, new device) keeping gain / mute / monitor.
   * Returns false for unknown ids. Throws AudioBusError for invalid input or internal channels.
   */
  replaceInput(id: string, input: MediaStream | HTMLMediaElement): boolean {
    const ch = this.channels.get(id);
    if (!ch) return false;
    if (ch.input.type === "internal") {
      throw new AudioBusError(
        "invalid-input",
        "Bu kanalın kaynağı değiştirilemez.",
      );
    }
    let next: InputRef;
    if (isMediaStream(input)) next = { type: "stream", stream: input };
    else if (isMediaElement(input)) next = { type: "element", element: input };
    else throw new AudioBusError("invalid-input", "Ses kaynağı geçersiz.");
    if (next.type === "element") this.assertElementFree(next.element, ch);

    const previous = ch.input;
    ch.detachInput?.();
    ch.detachInput = null;
    this.releaseKeepAlive(ch);
    ch.source = null;
    ch.input = next;
    try {
      this.attachInput(ch, next);
    } catch (err) {
      ch.input = previous;
      try {
        this.attachInput(ch, previous);
      } catch {
        // channel stays inactive
      }
      this.emit();
      throw err;
    }
    this.emit();
    return true;
  }

  private assertElementFree(
    el: HTMLMediaElement,
    except: Channel | null,
  ): void {
    for (const other of this.channels.values()) {
      if (
        other !== except &&
        other.input.type === "element" &&
        other.input.element === el
      ) {
        throw new AudioBusError(
          "duplicate-input",
          "Bu medya öğesi zaten bir kanalda.",
        );
      }
    }
  }

  /* ---------------- inputs ---------------- */

  private attachInput(ch: Channel, ref: InputRef): void {
    if (ref.type === "stream") this.attachStream(ch, ref.stream);
    else if (ref.type === "element") this.attachElement(ch, ref.element);
  }

  private attachStream(ch: Channel, stream: MediaStream): void {
    const ctx = this.ctx as AudioContext;
    const tracked = new Set<MediaStreamTrack>();
    let live: MediaStreamTrack[] = [];

    const rebuild = (): void => {
      const audio = stream.getAudioTracks();
      for (const t of audio) {
        if (!tracked.has(t)) {
          t.addEventListener("ended", onChange);
          tracked.add(t);
        }
      }
      for (const t of [...tracked]) {
        if (!audio.includes(t)) {
          t.removeEventListener("ended", onChange);
          tracked.delete(t);
        }
      }
      const nowLive = audio.filter((t) => t.readyState !== "ended");
      const same =
        nowLive.length === live.length &&
        nowLive.every((t, i) => t === live[i]);
      if (same && (nowLive.length === 0 || ch.source !== null)) return;
      live = nowLive;
      if (ch.source) {
        safeDisconnect(ch.source);
        ch.source = null;
      }
      if (nowLive.length === 0) return;
      try {
        const src = ctx.createMediaStreamSource(stream);
        src.connect(ch.nodes.volume);
        ch.source = src;
      } catch {
        ch.source = null; // e.g. the stream lost its audio between the check and the call
      }
    };
    const onChange = (): void => {
      rebuild();
      this.emit();
    };

    rebuild();
    stream.addEventListener("addtrack", onChange);
    stream.addEventListener("removetrack", onChange);
    if (ch.keepAlive) this.attachKeepAlive(ch, stream);
    ch.detachInput = () => {
      stream.removeEventListener("addtrack", onChange);
      stream.removeEventListener("removetrack", onChange);
      for (const t of tracked) t.removeEventListener("ended", onChange);
      tracked.clear();
      if (ch.source) safeDisconnect(ch.source);
      ch.source = null;
    };
  }

  private attachElement(ch: Channel, el: HTMLMediaElement): void {
    const ctx = this.ctx as AudioContext;
    let entry = ELEMENT_SOURCES.get(el);
    if (entry && entry.ctx !== ctx) {
      throw new AudioBusError(
        "element-bound",
        "Bu medya öğesi başka bir ses motoruna bağlı; yeni bir öğe oluşturun.",
      );
    }
    if (!entry) {
      try {
        entry = { ctx, node: ctx.createMediaElementSource(el) };
      } catch (cause) {
        throw new AudioBusError(
          "invalid-input",
          "Medya öğesi ses motoruna bağlanamadı.",
          cause,
        );
      }
      ELEMENT_SOURCES.set(el, entry);
    }
    const node = entry.node;
    node.connect(ch.nodes.volume);
    ch.source = node;
    ch.detachInput = () => {
      safeDisconnect(node, ch.nodes.volume);
      ch.source = null;
    };
  }

  private attachKeepAlive(ch: Channel, stream: MediaStream): void {
    if (typeof document === "undefined") return;
    try {
      const el = document.createElement("audio");
      el.muted = true;
      el.autoplay = true;
      el.srcObject = stream;
      const played = el.play() as Promise<void> | undefined;
      played?.catch(noop);
      ch.keepAliveEl = el;
    } catch {
      ch.keepAliveEl = null; // purely a workaround: Web Audio still works in most browsers
    }
  }

  private releaseKeepAlive(ch: Channel): void {
    const el = ch.keepAliveEl;
    if (!el) return;
    ch.keepAliveEl = null;
    try {
      el.pause();
      el.srcObject = null;
    } catch {
      // ignore
    }
  }

  /* ---------------- levels ---------------- */

  /**
   * Post-volume, pre-mute level (so a muted mic still shows that you are talking). The returned
   * object is reused for the channel: read it synchronously, copy if you need to keep it.
   */
  getLevel(id: string): Readonly<AudioLevel> {
    const ch = this.channels.get(id);
    if (!ch) return SILENT_LEVEL;
    if (ch.source === null) {
      ch.level.rms = 0;
      ch.level.peak = 0;
      ch.level.db = SILENCE_DB;
      return ch.level;
    }
    return this.measure(ch.nodes.analyser, ch.samples, ch.level);
  }

  /**
   * Frequency magnitudes (0..255, `fftSize / 2` bins, linear Hz) of one channel or of the final
   * mix (`"master"`), for visualisers. Fills `out` and returns false when there is nothing to
   * read (unknown channel, no audio yet).
   */
  getFrequencyData(id: string, out: Uint8Array<ArrayBuffer>): boolean {
    let analyser: AnalyserNode | null = null;
    if (id === "master") analyser = this.graph?.masterAnalyser ?? null;
    else {
      const ch = this.channels.get(id);
      if (ch && ch.source !== null) analyser = ch.nodes.analyser;
    }
    if (!analyser || typeof analyser.getByteFrequencyData !== "function") {
      out.fill(0);
      return false;
    }
    analyser.getByteFrequencyData(out);
    return true;
  }

  /** Level of the final mix (after master gain, mute and limiter). */
  getMasterLevel(): Readonly<AudioLevel> {
    if (!this.graph) return SILENT_LEVEL;
    return this.measure(
      this.graph.masterAnalyser,
      this.masterSamples,
      this.masterLevel,
    );
  }

  private measure(
    analyser: AnalyserNode,
    samples: Float32Array<ArrayBuffer>,
    out: AudioLevel,
  ): AudioLevel {
    if (typeof analyser.getFloatTimeDomainData !== "function") {
      out.rms = 0;
      out.peak = 0;
      out.db = SILENCE_DB;
      return out;
    }
    analyser.getFloatTimeDomainData(samples);
    return computeLevel(samples, out);
  }

  /* ---------------- master ---------------- */

  setMasterGain(value: number): void {
    const g = clampGain(value, Number.NaN);
    if (Number.isNaN(g)) return;
    this.masterGainValue = g;
    if (this.graph && !this.masterMuted)
      this.setParam(this.graph.master.gain, g);
    this.emit();
  }

  setMasterMuted(muted: boolean): void {
    this.masterMuted = muted === true;
    if (this.graph) {
      this.setParam(
        this.graph.master.gain,
        this.masterMuted ? 0 : this.masterGainValue,
      );
      this.setParam(this.graph.monitorBus.gain, this.monitorBusTarget());
    }
    this.emit();
  }

  /** Master limiter (DynamicsCompressor) on/off: prevents clipping when channels are summed. */
  setLimiterEnabled(on: boolean): void {
    this.limiterOn = on === true;
    this.routeMaster();
    this.emit();
  }

  /** Global speaker output on/off (headphone button). Master mute silences it too. */
  setMonitorEnabled(on: boolean): void {
    this.monitorEnabled = on === true;
    if (this.graph)
      this.setParam(this.graph.monitorBus.gain, this.monitorBusTarget());
    this.emit();
  }

  private monitorBusTarget(): number {
    return this.monitorEnabled && !this.masterMuted ? 1 : 0;
  }

  /** The mixed program audio. Same MediaStream object on every call. */
  getMixStream(): MediaStream {
    this.requireContext();
    return (this.graph as Graph).dest.stream;
  }

  /* ---------------- sound effects ---------------- */

  /**
   * Fire-and-forget sound effect through the built-in "sfx" channel. Never throws: failures show
   * up as `{ status: "error" }` on `done`. Decoded buffers are cached (LRU).
   */
  playSfx(
    source: Blob | string | AudioBuffer,
    opts: { gain?: number } = {},
  ): SfxHandle {
    let settle: (r: SfxResult) => void = noop;
    const done = new Promise<SfxResult>((resolve) => {
      settle = resolve;
    });
    const entry: ActiveSfx = {
      stopped: false,
      finished: false,
      src: null,
      gain: null,
      finish: (result) => {
        if (entry.finished) return;
        entry.finished = true;
        this.activeSfx.delete(entry);
        if (entry.src) {
          entry.src.onended = null;
          safeDisconnect(entry.src);
        }
        if (entry.gain) safeDisconnect(entry.gain);
        settle(result);
      },
      halt: () => {
        if (entry.finished) return;
        entry.stopped = true;
        if (entry.src) {
          try {
            entry.src.stop();
          } catch {
            // never started
          }
        }
        entry.finish({ status: "stopped" });
      },
    };
    const handle: SfxHandle = { done, stop: () => entry.halt() };

    let ctx: AudioContext;
    try {
      ctx = this.requireContext();
    } catch (err) {
      entry.finish({
        status: "error",
        error: this.asBusError(err, "unsupported"),
      });
      return handle;
    }
    while (this.activeSfx.size >= MAX_ACTIVE_SFX) {
      const oldest = this.activeSfx.values().next().value;
      if (!oldest) break;
      oldest.halt();
    }
    this.activeSfx.add(entry);
    void this.ensureRunning().catch(noop);

    void this.getSfxBuffer(source).then(
      (buffer) => {
        if (entry.stopped || entry.finished || this.disposed) {
          entry.halt();
          return;
        }
        try {
          const g = this.graph as Graph;
          const node = ctx.createBufferSource();
          const gain = ctx.createGain();
          gain.gain.value = clampGain(opts.gain ?? 1, 1);
          node.buffer = buffer;
          node.connect(gain);
          gain.connect(g.sfxIn);
          node.onended = (): void => entry.finish({ status: "ended" });
          entry.src = node;
          entry.gain = gain;
          node.start();
        } catch (err) {
          entry.finish({
            status: "error",
            error: this.asBusError(err, "sfx-decode-failed"),
          });
        }
      },
      (err: unknown) =>
        entry.finish({
          status: "error",
          error: this.asBusError(err, "sfx-load-failed"),
        }),
    );
    return handle;
  }

  private asBusError(err: unknown, code: AudioBusErrorCode): AudioBusError {
    return err instanceof AudioBusError
      ? err
      : new AudioBusError(code, "Ses efekti çalınamadı.", err);
  }

  private getSfxBuffer(
    source: Blob | string | AudioBuffer,
  ): Promise<AudioBuffer> {
    if (isAudioBuffer(source)) return Promise.resolve(source);
    if (
      typeof source !== "string" &&
      !(typeof Blob !== "undefined" && source instanceof Blob)
    ) {
      return Promise.reject(
        new AudioBusError("invalid-input", "Ses efekti kaynağı geçersiz."),
      );
    }
    const hit = this.sfxCache.get(source);
    if (hit) {
      this.sfxCache.delete(source); // refresh LRU position
      this.sfxCache.set(source, hit);
      return hit;
    }
    const pending = this.decodeSfx(source);
    this.sfxCache.set(source, pending);
    pending.then(
      (buf) => {
        if (this.sfxCache.get(source) !== pending) return;
        this.sfxSizes.set(source, buf.length * buf.numberOfChannels * 4);
        this.evictSfx(source);
      },
      () => {
        if (this.sfxCache.get(source) === pending) this.sfxCache.delete(source);
      },
    );
    return pending;
  }

  /** Drop least-recently-used decoded sounds beyond the entry / byte budget. */
  private evictSfx(keep: string | Blob): void {
    let total = 0;
    for (const size of this.sfxSizes.values()) total += size;
    for (const key of [...this.sfxCache.keys()]) {
      if (this.sfxCache.size <= SFX_CACHE_ENTRIES && total <= SFX_CACHE_BYTES)
        break;
      if (key === keep) continue;
      total -= this.sfxSizes.get(key) ?? 0;
      this.sfxCache.delete(key);
      this.sfxSizes.delete(key);
    }
  }

  private async decodeSfx(source: Blob | string): Promise<AudioBuffer> {
    const ctx = this.ctx;
    if (!ctx) throw new AudioBusError("disposed", "Ses motoru kapatıldı.");
    let data: ArrayBuffer;
    if (typeof source === "string") {
      if (!isAllowedSfxUrl(source)) {
        throw new AudioBusError(
          "sfx-url-blocked",
          "Ses efekti adresine izin verilmiyor.",
        );
      }
      if (typeof fetch !== "function") {
        throw new AudioBusError("unsupported", "Ses efekti yüklenemiyor.");
      }
      try {
        const res = await fetch(source);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.arrayBuffer();
      } catch (cause) {
        throw new AudioBusError(
          "sfx-load-failed",
          "Ses efekti yüklenemedi.",
          cause,
        );
      }
    } else {
      if (source.size > MAX_SFX_BYTES) {
        throw new AudioBusError("sfx-too-large", "Ses efekti çok büyük.");
      }
      try {
        data = await readBlob(source);
      } catch (cause) {
        throw new AudioBusError(
          "sfx-load-failed",
          "Ses efekti okunamadı.",
          cause,
        );
      }
    }
    if (data.byteLength > MAX_SFX_BYTES) {
      throw new AudioBusError("sfx-too-large", "Ses efekti çok büyük.");
    }
    try {
      return await ctx.decodeAudioData(data);
    } catch (cause) {
      throw new AudioBusError(
        "sfx-decode-failed",
        "Ses efekti çözümlenemedi.",
        cause,
      );
    }
  }

  /* ---------------- teardown ---------------- */

  /** Release every node, stop the mix tracks and close the context. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of [...this.activeSfx]) entry.halt();
    this.activeSfx.clear();
    for (const ch of this.channels.values()) this.teardownChannel(ch);
    this.channels.clear();
    this.sfxCache.clear();
    this.sfxSizes.clear();
    this.disarmGesture();
    this.stateListenerCleanup?.();
    this.stateListenerCleanup = null;
    const g = this.graph;
    if (g) {
      for (const node of [
        g.mixIn,
        g.master,
        g.limiter,
        g.post,
        g.masterAnalyser,
        g.monitorBus,
      ]) {
        safeDisconnect(node);
      }
      safeDisconnect(g.sfxIn);
      try {
        for (const t of g.dest.stream.getTracks()) t.stop();
      } catch {
        // ignore
      }
      safeDisconnect(g.dest);
    }
    const ctx = this.ctx;
    if (ctx && ctx.state !== "closed") {
      try {
        ctx.close().catch(noop);
      } catch {
        // ignore
      }
    }
    this.graph = null;
    this.emit();
    this.listeners.clear();
  }
}
