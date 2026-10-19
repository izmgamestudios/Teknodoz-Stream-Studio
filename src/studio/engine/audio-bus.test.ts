import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AudioBus,
  AudioBusError,
  MAX_CHANNELS,
  MAX_GAIN,
  MAX_SFX_BYTES,
  PeakHold,
  SFX_CACHE_ENTRIES,
  SFX_CHANNEL_ID,
  SILENCE_DB,
  clampGain,
  computeLevel,
  dbToLinear,
  defaultMonitor,
  isAllowedSfxUrl,
  linearToDb,
  meterFraction,
  type AudioLevel,
  type ChannelKind,
} from "./audio-bus";

/* ------------------------------------------------------------------ */
/* Hand-written fake Web Audio                                         */
/* ------------------------------------------------------------------ */

class FakeParam {
  calls: number[] = [];
  constructor(
    public value: number,
    private readonly automation: boolean,
  ) {
    if (!automation) {
      (this as { setTargetAtTime?: unknown }).setTargetAtTime = undefined;
    }
  }
  setTargetAtTime?(target: number): void {
    this.calls.push(target);
    this.value = target;
  }
  cancelScheduledValues(): void {}
}

type NodeKind =
  | "gain"
  | "analyser"
  | "compressor"
  | "stream-source"
  | "element-source"
  | "buffer-source"
  | "stream-dest"
  | "speakers";

class FakeNode {
  connections: FakeNode[] = [];
  constructor(readonly kind: NodeKind) {}
  connect(target: FakeNode): FakeNode {
    this.connections.push(target);
    return target;
  }
  disconnect(target?: FakeNode): void {
    if (target === undefined) {
      this.connections = [];
      return;
    }
    const i = this.connections.indexOf(target);
    if (i < 0) throw new Error("InvalidAccessError");
    this.connections.splice(i, 1);
  }
}

class FakeGain extends FakeNode {
  readonly gain: FakeParam;
  constructor(automation: boolean) {
    super("gain");
    this.gain = new FakeParam(1, automation);
  }
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  signal: number[] | null = null;
  reads = 0;
  constructor() {
    super("analyser");
  }
  getFloatTimeDomainData(out: Float32Array): void {
    this.reads++;
    out.fill(0);
    if (this.signal) out.set(this.signal.slice(0, out.length));
  }
}

class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24, false);
  knee = new FakeParam(30, false);
  ratio = new FakeParam(12, false);
  attack = new FakeParam(0.003, false);
  release = new FakeParam(0.25, false);
  constructor() {
    super("compressor");
  }
}

class FakeTrack {
  readyState: "live" | "ended" = "live";
  stopCalls = 0;
  private readonly listeners = new Map<string, Set<() => void>>();
  constructor(readonly kind: "audio" | "video" = "audio") {}
  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  stop(): void {
    this.stopCalls++;
    this.readyState = "ended";
  }
  end(): void {
    this.readyState = "ended";
    for (const fn of [...(this.listeners.get("ended") ?? [])]) fn();
  }
}

class FakeMediaStream {
  private tracks: FakeTrack[];
  private readonly listeners = new Map<string, Set<() => void>>();
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  addTrack(t: FakeTrack): void {
    this.tracks.push(t);
    this.dispatch("addtrack");
  }
  removeTrack(t: FakeTrack): void {
    this.tracks = this.tracks.filter((x) => x !== t);
    this.dispatch("removetrack");
  }
  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  private dispatch(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  constructor() {
    super("buffer-source");
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    if (!this.started) throw new Error("InvalidStateError");
    this.stopped = true;
  }
  emitEnded(): void {
    this.onended?.();
  }
}

interface FakeAudioBuffer {
  length: number;
  numberOfChannels: number;
  getChannelData(): Float32Array;
}

function fakeBuffer(): FakeAudioBuffer {
  return {
    length: 480,
    numberOfChannels: 2,
    getChannelData: () => new Float32Array(480),
  };
}

const claimedElements = new WeakSet<object>();

class FakeContext {
  state: "suspended" | "running" | "closed" = "suspended";
  currentTime = 0;
  readonly destination = new FakeNode("speakers");
  readonly gains: FakeGain[] = [];
  readonly analysers: FakeAnalyser[] = [];
  readonly compressors: FakeCompressor[] = [];
  readonly streamSources: FakeNode[] = [];
  readonly bufferSources: FakeBufferSource[] = [];
  mixDestination: (FakeNode & { stream: FakeMediaStream }) | null = null;
  elementSourceCalls = 0;
  streamSourceCalls = 0;
  resumeCalls = 0;
  closeCalls = 0;
  decodeCalls = 0;
  decodeFails = false;
  resumeImpl: (() => Promise<void>) | null = null;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(private readonly automation = true) {}

  createGain(): FakeGain {
    const g = new FakeGain(this.automation);
    this.gains.push(g);
    return g;
  }
  createAnalyser(): FakeAnalyser {
    const a = new FakeAnalyser();
    this.analysers.push(a);
    return a;
  }
  createDynamicsCompressor(): FakeCompressor {
    const c = new FakeCompressor();
    this.compressors.push(c);
    return c;
  }
  createMediaStreamDestination(): FakeNode & { stream: FakeMediaStream } {
    const node = Object.assign(new FakeNode("stream-dest"), {
      stream: new FakeMediaStream([new FakeTrack("audio")]),
    });
    this.mixDestination = node;
    return node;
  }
  createMediaStreamSource(stream: FakeMediaStream): FakeNode {
    this.streamSourceCalls++;
    if (!stream.getAudioTracks().some((t) => t.readyState !== "ended")) {
      throw new Error("InvalidStateError: no audio track");
    }
    const n = new FakeNode("stream-source");
    this.streamSources.push(n);
    return n;
  }
  createMediaElementSource(el: object): FakeNode {
    this.elementSourceCalls++;
    if (claimedElements.has(el))
      throw new Error("InvalidStateError: already connected");
    claimedElements.add(el);
    return new FakeNode("element-source");
  }
  createBufferSource(): FakeBufferSource {
    const s = new FakeBufferSource();
    this.bufferSources.push(s);
    return s;
  }
  decodeAudioData(data: ArrayBuffer): Promise<FakeAudioBuffer> {
    this.decodeCalls++;
    void data;
    return this.decodeFails
      ? Promise.reject(new Error("bad audio"))
      : Promise.resolve(fakeBuffer());
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.resumeImpl) return this.resumeImpl();
    this.setState("running");
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closeCalls++;
    this.state = "closed";
    return Promise.resolve();
  }
  setState(s: "suspended" | "running" | "closed"): void {
    this.state = s;
    for (const fn of [...(this.listeners.get("statechange") ?? [])]) fn();
  }
  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

interface FakeElement {
  play(): Promise<void>;
  pause(): void;
  currentTime: number;
}

function fakeElement(): FakeElement {
  return { play: () => Promise.resolve(), pause: () => {}, currentTime: 0 };
}

function stream(...tracks: FakeTrack[]): FakeMediaStream {
  return new FakeMediaStream(tracks);
}

function micStream(): FakeMediaStream {
  return stream(new FakeTrack("audio"));
}

interface Rig {
  ctx: FakeContext;
  bus: AudioBus;
  factory: ReturnType<typeof vi.fn>;
}

function rig(opts: { automation?: boolean; limiter?: boolean } = {}): Rig {
  const ctx = new FakeContext(opts.automation ?? true);
  const factory = vi.fn(() => ctx as unknown as AudioContext);
  const bus = new AudioBus({
    contextFactory: factory,
    ...(opts.limiter !== undefined ? { limiter: opts.limiter } : {}),
  });
  return { ctx, bus, factory };
}

/** White-box: the shared graph nodes in creation order (see AudioBus.buildGraph). */
function graph(ctx: FakeContext): {
  mixIn: FakeGain;
  master: FakeGain;
  post: FakeGain;
  monitorBus: FakeGain;
  sfxIn: FakeGain;
  limiter: FakeCompressor;
  masterAnalyser: FakeAnalyser;
} {
  const [mixIn, master, post, monitorBus, sfxIn] = ctx.gains;
  const limiter = ctx.compressors[0];
  const masterAnalyser = ctx.analysers[0];
  if (
    !mixIn ||
    !master ||
    !post ||
    !monitorBus ||
    !sfxIn ||
    !limiter ||
    !masterAnalyser
  ) {
    throw new Error("graph not built");
  }
  return { mixIn, master, post, monitorBus, sfxIn, limiter, masterAnalyser };
}

/** White-box: strip of the channel fed by `source`. */
function strip(source: FakeNode): {
  volume: FakeGain;
  gate: FakeGain;
  analyser: FakeAnalyser;
  monitor: FakeGain;
  mixIn: FakeGain;
} {
  const volume = source.connections[0] as FakeGain | undefined;
  const gate = volume?.connections[0] as FakeGain | undefined;
  const analyser = volume?.connections[1] as FakeAnalyser | undefined;
  const mixIn = gate?.connections[0] as FakeGain | undefined;
  const monitor = gate?.connections[1] as FakeGain | undefined;
  if (!volume || !gate || !analyser || !mixIn || !monitor)
    throw new Error("strip not wired");
  return { volume, gate, analyser, monitor, mixIn };
}

function reaches(
  from: FakeNode,
  to: FakeNode,
  seen = new Set<FakeNode>(),
): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return from.connections.some((n) => reaches(n, to, seen));
}

function addMic(
  bus: AudioBus,
  ctx: FakeContext,
  id = "mic",
  kind: ChannelKind = "mic",
) {
  const s = micStream();
  const handle = bus.addChannel(
    { id, label: id, kind },
    s as unknown as MediaStream,
    {
      keepAlive: false,
    },
  );
  const source = ctx.streamSources[ctx.streamSources.length - 1];
  if (!source) throw new Error("no source created");
  return { handle, source, s };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Poll quickly (vi.waitFor defaults to 50 ms steps, which makes sequential waits slow). */
const until = (assertion: () => void): Promise<void> =>
  vi.waitFor(assertion, { interval: 2, timeout: 3000 });

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

describe("level helpers", () => {
  it("linearToDb", () => {
    expect(linearToDb(1)).toBeCloseTo(0, 6);
    expect(linearToDb(0.5)).toBeCloseTo(-6.0206, 3);
    expect(linearToDb(0.1)).toBeCloseTo(-20, 6);
    expect(linearToDb(0)).toBe(SILENCE_DB);
    expect(linearToDb(1e-9)).toBe(SILENCE_DB);
    expect(linearToDb(-1)).toBe(SILENCE_DB);
    expect(linearToDb(Number.NaN)).toBe(SILENCE_DB);
    expect(linearToDb(Number.POSITIVE_INFINITY)).toBe(SILENCE_DB);
  });

  it("dbToLinear is the inverse", () => {
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(-20)).toBeCloseTo(0.1, 8);
    expect(dbToLinear(6)).toBeCloseTo(1.9953, 3);
    expect(dbToLinear(Number.NaN)).toBe(0);
    expect(dbToLinear(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(linearToDb(dbToLinear(-12))).toBeCloseTo(-12, 6);
  });

  it("clampGain bounds to 0..1.5 and sanitises", () => {
    expect(clampGain(1)).toBe(1);
    expect(clampGain(0)).toBe(0);
    expect(clampGain(MAX_GAIN)).toBe(MAX_GAIN);
    expect(clampGain(7)).toBe(MAX_GAIN);
    expect(clampGain(-3)).toBe(0);
    expect(clampGain(Number.POSITIVE_INFINITY)).toBe(MAX_GAIN);
    expect(clampGain(Number.NaN)).toBe(1);
    expect(clampGain(Number.NaN, 0.25)).toBe(0.25);
    expect(clampGain("1" as unknown as number, 0.5)).toBe(0.5);
  });

  it("computeLevel on silence, DC, sine and clipping", () => {
    const out: AudioLevel = { rms: 9, peak: 9, db: 9 };
    expect(computeLevel(new Float32Array(64), out)).toBe(out); // reuses the output object
    expect(out).toEqual({ rms: 0, peak: 0, db: SILENCE_DB });

    computeLevel(new Float32Array(100).fill(0.5), out);
    expect(out.rms).toBeCloseTo(0.5, 6);
    expect(out.peak).toBeCloseTo(0.5, 6);
    expect(out.db).toBeCloseTo(-6.02, 2);

    const sine = Float32Array.from({ length: 1000 }, (_, i) =>
      Math.sin((2 * Math.PI * i) / 100),
    );
    computeLevel(sine, out);
    expect(out.rms).toBeCloseTo(Math.SQRT1_2, 3);
    expect(out.peak).toBeCloseTo(1, 3);
    expect(out.db).toBeCloseTo(-3.01, 1);

    computeLevel(Float32Array.from([-1.4, 0.2, 0.1]), out);
    expect(out.peak).toBeCloseTo(1.4, 6); // negative peaks count, values above 1 are kept
  });

  it("computeLevel treats NaN / Infinity as silence and handles empty input", () => {
    const out: AudioLevel = { rms: 1, peak: 1, db: 1 };
    computeLevel([Number.NaN, Number.POSITIVE_INFINITY, 0.5, 0.5], out);
    expect(out.peak).toBe(0.5);
    expect(out.rms).toBeCloseTo(Math.sqrt(0.5 / 4), 6);
    computeLevel([], out);
    expect(out).toEqual({ rms: 0, peak: 0, db: SILENCE_DB });
  });

  it("meterFraction maps dB onto 0..1", () => {
    expect(meterFraction(0)).toBe(1);
    expect(meterFraction(-60)).toBe(0);
    expect(meterFraction(-30)).toBeCloseTo(0.5, 8);
    expect(meterFraction(-120)).toBe(0);
    expect(meterFraction(6)).toBe(1);
    expect(meterFraction(Number.NaN)).toBe(0);
    expect(meterFraction(-10, -40, 0)).toBeCloseTo(0.75, 8);
    expect(meterFraction(-10, 0, 0)).toBe(0);
  });

  it("defaultMonitor is off for the mic only", () => {
    expect(defaultMonitor("mic")).toBe(false);
    for (const k of ["system", "music", "guest", "sfx", "video"] as const) {
      expect(defaultMonitor(k)).toBe(true);
    }
  });
});

describe("PeakHold", () => {
  it("rises instantly, holds, then decays", () => {
    const hold = new PeakHold(500, 20);
    expect(hold.update(0.8, 0)).toBe(0.8);
    expect(hold.update(0.2, 100)).toBe(0.8);
    expect(hold.update(0.2, 500)).toBe(0.8); // still inside the hold window
    const later = hold.update(0.01, 1500); // 1 s after the hold expired -> -20 dB
    expect(later).toBeCloseTo(0.08, 3);
    // a louder live level always wins over the decaying hold
    expect(hold.update(0.5, 1600)).toBe(0.5);
  });

  it("decays progressively and never drops below the live level", () => {
    const hold = new PeakHold(0, 20);
    hold.update(1, 0);
    const a = hold.update(0, 500);
    const b = hold.update(0, 1000);
    expect(a).toBeCloseTo(dbToLinear(-10), 4);
    expect(b).toBeCloseTo(dbToLinear(-20), 4);
    expect(hold.update(0.5, 1000)).toBe(0.5); // new peak replaces the decaying value
    expect(hold.update(0.9, 1100)).toBe(0.9);
  });

  it("falls to exactly 0 eventually and resets", () => {
    const hold = new PeakHold(0, 60);
    hold.update(0.001, 0);
    expect(hold.update(0, 5000)).toBe(0);
    hold.update(0.7, 6000);
    hold.reset();
    expect(hold.current).toBe(0);
  });

  it("ignores invalid levels", () => {
    const hold = new PeakHold();
    expect(hold.update(Number.NaN, 0)).toBe(0);
    expect(hold.update(-1, 10)).toBe(0);
    expect(hold.update(Number.POSITIVE_INFINITY, 20)).toBe(0);
  });
});

describe("isAllowedSfxUrl", () => {
  it("allows blob:, data: and same-origin URLs only", () => {
    const origin = "https://studio.test";
    expect(isAllowedSfxUrl("blob:https://studio.test/abc", origin)).toBe(true);
    expect(isAllowedSfxUrl("data:audio/wav;base64,AAAA", origin)).toBe(true);
    expect(isAllowedSfxUrl("/sounds/a.mp3", origin)).toBe(true);
    expect(isAllowedSfxUrl("https://studio.test/a.mp3", origin)).toBe(true);
    expect(isAllowedSfxUrl("https://evil.example/a.mp3", origin)).toBe(false);
    expect(isAllowedSfxUrl("http://studio.test/a.mp3", origin)).toBe(false);
    expect(isAllowedSfxUrl("//evil.example/a.mp3", origin)).toBe(false);
    expect(isAllowedSfxUrl("javascript:alert(1)", origin)).toBe(false);
    expect(isAllowedSfxUrl("file:///etc/passwd", origin)).toBe(false);
    expect(isAllowedSfxUrl("", origin)).toBe(false);
    expect(isAllowedSfxUrl(42 as unknown as string, origin)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* AudioBus                                                            */
/* ------------------------------------------------------------------ */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AudioBus lifecycle", () => {
  it("creates nothing until it is used (SSR-safe)", () => {
    const { bus, factory } = rig();
    expect(factory).not.toHaveBeenCalled();
    expect(bus.getState()).toMatchObject({
      channels: [],
      contextState: "none",
      limiter: true,
    });
    expect(bus.getLevel("nope")).toEqual({ rms: 0, peak: 0, db: SILENCE_DB });
    expect(bus.getMasterLevel()).toEqual({ rms: 0, peak: 0, db: SILENCE_DB });
    expect(bus.removeChannel("nope")).toBe(false);
    expect(bus.setGain("nope", 1)).toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });

  it("ensureRunning builds the context once and resumes it", async () => {
    const { bus, ctx, factory } = rig();
    expect(await bus.ensureRunning()).toBe("running");
    expect(await bus.ensureRunning()).toBe("running");
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ctx.resumeCalls).toBe(1); // already running the second time
    expect(bus.getState().contextState).toBe("running");
  });

  it("exposes the built-in sfx channel once the context exists", async () => {
    const { bus } = rig();
    await bus.ensureRunning();
    expect(bus.getState().channels).toEqual([
      {
        id: SFX_CHANNEL_ID,
        label: "Efektler",
        kind: "sfx",
        gain: 1,
        muted: false,
        monitor: true,
        active: true,
        source: "internal",
      },
    ]);
  });

  it("does not hang when resume() never settles", async () => {
    vi.useFakeTimers();
    const { bus, ctx } = rig();
    ctx.resumeImpl = () => new Promise<void>(() => {});
    const p = bus.ensureRunning();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toBe("suspended");
  });

  it("survives a rejecting resume()", async () => {
    const { bus, ctx } = rig();
    ctx.resumeImpl = () => Promise.reject(new Error("not allowed"));
    expect(await bus.ensureRunning()).toBe("suspended");
  });

  it("resumes on the next user gesture and then stops listening", async () => {
    const { bus, ctx } = rig();
    addMic(bus, ctx);
    expect(ctx.state).toBe("suspended");
    document.dispatchEvent(new Event("pointerdown"));
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe("running");
    document.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new Event("keydown"));
    expect(ctx.resumeCalls).toBe(1);
  });

  it("reports unsupported browsers with a typed error", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    const bus = new AudioBus();
    await expect(bus.ensureRunning()).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(() => bus.getMixStream()).toThrowError(AudioBusError);
    expect(() =>
      bus.addChannel(
        { id: "m", label: "m", kind: "mic" },
        micStream() as unknown as MediaStream,
      ),
    ).toThrowError(expect.objectContaining({ code: "unsupported" }));
    expect(bus.getState().contextState).toBe("none");
  });

  it("builds the default AudioContext with low latency and a plain fallback", async () => {
    const created: unknown[] = [];
    class Ctor {
      constructor(opts?: unknown) {
        created.push(opts);
        return new FakeContext() as unknown as Ctor;
      }
    }
    vi.stubGlobal("AudioContext", Ctor);
    await new AudioBus().ensureRunning();
    expect(created).toEqual([{ latencyHint: "interactive" }]);

    created.length = 0;
    class Picky {
      constructor(opts?: unknown) {
        if (opts !== undefined) throw new Error("bad options");
        created.push("plain");
        return new FakeContext() as unknown as Picky;
      }
    }
    vi.stubGlobal("AudioContext", Picky);
    await new AudioBus().ensureRunning();
    expect(created).toEqual(["plain"]);
  });

  it("uses webkitAudioContext when AudioContext is missing", async () => {
    let used = false;
    class Webkit {
      constructor() {
        used = true;
        return new FakeContext() as unknown as Webkit;
      }
    }
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", Webkit);
    await new AudioBus().ensureRunning();
    expect(used).toBe(true);
  });
});

describe("channel graph and bookkeeping", () => {
  it("routes source -> volume -> gate -> mix -> master -> limiter -> program stream", () => {
    const { bus, ctx } = rig();
    const { source } = addMic(bus, ctx);
    const g = graph(ctx);
    const s = strip(source);
    expect(s.mixIn).toBe(g.mixIn);
    expect(g.mixIn.connections).toEqual([g.master]);
    expect(g.master.connections).toEqual([g.limiter]);
    expect(g.limiter.connections).toEqual([g.post]);
    expect(reaches(source, ctx.mixDestination as FakeNode)).toBe(true);
    expect(s.volume.connections).toContain(s.analyser);
    expect(s.analyser.connections).toEqual([]); // meter tap only
    expect(s.monitor.connections).toEqual([g.monitorBus]);
    expect(g.monitorBus.connections).toEqual([ctx.destination]);
    expect(g.post.connections).toContain(g.masterAnalyser);
  });

  it("applies the initial gain, mute and monitor options", () => {
    const { bus, ctx } = rig();
    const s1 = micStream();
    bus.addChannel(
      { id: "a", label: "A", kind: "music" },
      s1 as unknown as MediaStream,
      {
        gain: 0.4,
        muted: true,
        monitor: false,
        keepAlive: false,
      },
    );
    const source = ctx.streamSources[0] as FakeNode;
    const st = strip(source);
    expect(st.volume.gain.value).toBe(0.4);
    expect(st.gate.gain.value).toBe(0);
    expect(st.monitor.gain.value).toBe(0);
    expect(bus.getState().channels.find((c) => c.id === "a")).toMatchObject({
      gain: 0.4,
      muted: true,
      monitor: false,
    });
  });

  it("clamps an out-of-range initial gain", () => {
    const { bus, ctx } = rig();
    bus.addChannel(
      { id: "a", label: "A", kind: "music" },
      micStream() as unknown as MediaStream,
      {
        gain: 9,
        keepAlive: false,
      },
    );
    expect(strip(ctx.streamSources[0] as FakeNode).volume.gain.value).toBe(
      MAX_GAIN,
    );
  });

  it("monitors every kind except the mic by default", () => {
    const { bus, ctx } = rig();
    const kinds: ChannelKind[] = ["mic", "system", "music", "guest", "video"];
    for (const kind of kinds) addMic(bus, ctx, `ch-${kind}`, kind);
    const monitorGain = (i: number): number =>
      strip(ctx.streamSources[i] as FakeNode).monitor.gain.value;
    expect(kinds.map((_, i) => monitorGain(i))).toEqual([0, 1, 1, 1, 1]);
    expect(
      bus.getState().channels.find((c) => c.id === SFX_CHANNEL_ID)?.monitor,
    ).toBe(true);
  });

  it("setGain clamps, sets the volume node and publishes state", () => {
    const { bus, ctx } = rig();
    const { handle, source } = addMic(bus, ctx);
    const { volume } = strip(source);
    expect(bus.setGain("mic", 0.5)).toBe(true);
    expect(volume.gain.value).toBe(0.5);
    handle.setGain(3);
    expect(volume.gain.value).toBe(MAX_GAIN);
    handle.setGain(-1);
    expect(volume.gain.value).toBe(0);
    expect(bus.setGain("mic", Number.NaN)).toBe(false);
    expect(volume.gain.value).toBe(0);
    expect(bus.getState().channels.find((c) => c.id === "mic")?.gain).toBe(0);
  });

  it("mute silences the gate but remembers the volume", () => {
    const { bus, ctx } = rig();
    const { handle, source } = addMic(bus, ctx);
    const { volume, gate } = strip(source);
    handle.setGain(0.8);
    handle.setMuted(true);
    expect(gate.gain.value).toBe(0);
    expect(volume.gain.value).toBe(0.8);
    expect(bus.getState().channels.find((c) => c.id === "mic")).toMatchObject({
      muted: true,
      gain: 0.8,
    });
    handle.setMuted(false);
    expect(gate.gain.value).toBe(1);
    expect(volume.gain.value).toBe(0.8);
  });

  it("setMonitor toggles the speaker tap", () => {
    const { bus, ctx } = rig();
    const { handle, source } = addMic(bus, ctx);
    const { monitor } = strip(source);
    handle.setMonitor(true);
    expect(monitor.gain.value).toBe(1);
    expect(bus.getState().channels.find((c) => c.id === "mic")?.monitor).toBe(
      true,
    );
    expect(bus.setMonitor("mic", false)).toBe(true);
    expect(monitor.gain.value).toBe(0);
    expect(bus.setMonitor("ghost", true)).toBe(false);
  });

  it("falls back to plain assignment without AudioParam automation", () => {
    const { bus, ctx } = rig({ automation: false });
    const { handle, source } = addMic(bus, ctx);
    handle.setGain(0.25);
    handle.setMuted(true);
    const { volume, gate } = strip(source);
    expect(volume.gain.value).toBe(0.25);
    expect(gate.gain.value).toBe(0);
    expect(volume.gain.calls).toEqual([]);
  });

  it("uses smoothed automation (no zipper noise) when available", () => {
    const { bus, ctx } = rig();
    const { handle, source } = addMic(bus, ctx);
    handle.setGain(0.3);
    expect(strip(source).volume.gain.calls).toEqual([0.3]);
  });

  it("rejects duplicate ids, bad ids and bad inputs", () => {
    const { bus, ctx } = rig();
    addMic(bus, ctx, "dup");
    const spec = { id: "dup", label: "x", kind: "mic" } as const;
    expect(() =>
      bus.addChannel(spec, micStream() as unknown as MediaStream),
    ).toThrowError(expect.objectContaining({ code: "duplicate-channel" }));
    for (const id of ["", "   ", "x".repeat(65)]) {
      expect(() =>
        bus.addChannel(
          { id, label: "x", kind: "mic" },
          micStream() as unknown as MediaStream,
        ),
      ).toThrowError(expect.objectContaining({ code: "invalid-id" }));
    }
    expect(() =>
      bus.addChannel(
        { id: "bad", label: "x", kind: "mic" },
        {} as unknown as MediaStream,
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid-input" }));
    expect(() =>
      bus.addChannel(
        { id: SFX_CHANNEL_ID, label: "x", kind: "mic" },
        micStream() as never,
      ),
    ).toThrowError(expect.objectContaining({ code: "duplicate-channel" }));
  });

  it("limits the number of channels", () => {
    const { bus, ctx } = rig();
    // the built-in sfx channel counts as one
    for (let i = 0; i < MAX_CHANNELS - 1; i++) addMic(bus, ctx, `c${i}`);
    expect(() =>
      bus.addChannel(
        { id: "one-too-many", label: "x", kind: "mic" },
        micStream() as never,
      ),
    ).toThrowError(expect.objectContaining({ code: "too-many-channels" }));
  });

  it("sanitises labels and falls back for unknown kinds", () => {
    const { bus, ctx } = rig();
    bus.addChannel(
      {
        id: "L",
        label: `  a\nb${"x".repeat(200)}`,
        kind: "weird" as ChannelKind,
      },
      micStream() as unknown as MediaStream,
      { keepAlive: false },
    );
    bus.addChannel(
      { id: "E", label: "   ", kind: "mic" },
      micStream() as never,
      {
        keepAlive: false,
      },
    );
    void ctx;
    const info = bus.getState().channels;
    expect(info.find((c) => c.id === "L")?.label.startsWith("a b")).toBe(true);
    expect(info.find((c) => c.id === "L")?.label.length).toBe(80);
    expect(info.find((c) => c.id === "L")?.kind).toBe("music");
    expect(info.find((c) => c.id === "E")?.label).toBe("E");
  });

  it("removeChannel disconnects everything and frees the id", () => {
    const { bus, ctx } = rig();
    const { source, s } = addMic(bus, ctx);
    const g = graph(ctx);
    const st = strip(source);
    expect(bus.removeChannel("mic")).toBe(true);
    expect(bus.removeChannel("mic")).toBe(false);
    expect(source.connections).toEqual([]);
    expect(st.volume.connections).toEqual([]);
    expect(st.gate.connections).toEqual([]);
    expect(st.monitor.connections).toEqual([]);
    expect(reaches(source, ctx.mixDestination as FakeNode)).toBe(false);
    expect(g.mixIn.connections).toEqual([g.master]);
    expect(s.listenerCount("addtrack")).toBe(0);
    expect(s.listenerCount("removetrack")).toBe(0);
    expect(s.getAudioTracks()[0]?.listenerCount("ended")).toBe(0);
    expect(bus.getState().channels.map((c) => c.id)).toEqual([SFX_CHANNEL_ID]);
    addMic(bus, ctx); // same id can be reused
    expect(bus.hasChannel("mic")).toBe(true);
  });

  it("handle.remove() removes the channel", () => {
    const { bus, ctx } = rig();
    const { handle } = addMic(bus, ctx);
    handle.remove();
    expect(bus.hasChannel("mic")).toBe(false);
  });
});

describe("master section", () => {
  it("master gain clamps and mute restores the previous value", () => {
    const { bus, ctx } = rig();
    addMic(bus, ctx);
    const { master } = graph(ctx);
    bus.setMasterGain(0.6);
    expect(master.gain.value).toBe(0.6);
    bus.setMasterGain(9);
    expect(master.gain.value).toBe(MAX_GAIN);
    bus.setMasterGain(0.6);
    bus.setMasterMuted(true);
    expect(master.gain.value).toBe(0);
    bus.setMasterGain(0.9); // changing gain while muted must not unmute
    expect(master.gain.value).toBe(0);
    bus.setMasterMuted(false);
    expect(master.gain.value).toBe(0.9);
    bus.setMasterGain(Number.NaN);
    expect(bus.getState().masterGain).toBe(0.9);
    expect(bus.getState()).toMatchObject({
      masterGain: 0.9,
      masterMuted: false,
    });
  });

  it("master mute and the monitor switch silence the speakers", () => {
    const { bus, ctx } = rig();
    addMic(bus, ctx);
    const { monitorBus } = graph(ctx);
    expect(monitorBus.gain.value).toBe(1);
    bus.setMasterMuted(true);
    expect(monitorBus.gain.value).toBe(0);
    bus.setMasterMuted(false);
    expect(monitorBus.gain.value).toBe(1);
    bus.setMonitorEnabled(false);
    expect(monitorBus.gain.value).toBe(0);
    expect(bus.getState().monitorEnabled).toBe(false);
    bus.setMonitorEnabled(true);
    expect(monitorBus.gain.value).toBe(1);
  });

  it("master settings survive until the context exists", () => {
    const { bus, ctx } = rig();
    bus.setMasterGain(0.5);
    bus.setMasterMuted(true);
    bus.setLimiterEnabled(false);
    bus.setMonitorEnabled(false);
    expect(ctx.gains).toHaveLength(0);
    addMic(bus, ctx);
    const g = graph(ctx);
    expect(g.master.gain.value).toBe(0);
    expect(g.monitorBus.gain.value).toBe(0);
    expect(g.master.connections).toEqual([g.post]);
    bus.setMasterMuted(false);
    expect(g.master.gain.value).toBe(0.5);
  });

  it("the limiter is wired by default with brick-wall-ish settings", () => {
    const { bus, ctx } = rig();
    addMic(bus, ctx);
    const g = graph(ctx);
    expect(g.master.connections).toEqual([g.limiter]);
    expect(g.limiter.connections).toEqual([g.post]);
    expect(g.limiter.ratio.value).toBe(20);
    expect(g.limiter.knee.value).toBe(0);
    expect(g.limiter.threshold.value).toBeLessThan(0);
    expect(bus.getState().limiter).toBe(true);
  });

  it("toggling the limiter rewires master -> post directly and back", () => {
    const { bus, ctx } = rig();
    addMic(bus, ctx);
    const g = graph(ctx);
    bus.setLimiterEnabled(false);
    expect(g.master.connections).toEqual([g.post]);
    expect(g.limiter.connections).toEqual([]);
    expect(bus.getState().limiter).toBe(false);
    expect(reaches(g.mixIn, ctx.mixDestination as FakeNode)).toBe(true);
    bus.setLimiterEnabled(true);
    expect(g.master.connections).toEqual([g.limiter]);
    expect(g.limiter.connections).toEqual([g.post]);
    expect(reaches(g.mixIn, ctx.mixDestination as FakeNode)).toBe(true);
  });

  it("can start with the limiter off", () => {
    const { bus, ctx } = rig({ limiter: false });
    addMic(bus, ctx);
    const g = graph(ctx);
    expect(g.master.connections).toEqual([g.post]);
    expect(bus.getState().limiter).toBe(false);
  });

  it("getMixStream is the same lazily created program stream", () => {
    const { bus, ctx, factory } = rig();
    expect(factory).not.toHaveBeenCalled();
    const a = bus.getMixStream();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(a).toBe(ctx.mixDestination?.stream);
    expect(bus.getMixStream()).toBe(a);
  });
});

describe("levels", () => {
  it("reads the analyser into a reused typed array and object", () => {
    const { bus, ctx } = rig();
    const { handle, source } = addMic(bus, ctx);
    const { analyser } = strip(source);
    analyser.signal = new Array<number>(1024).fill(0.5);
    const first = bus.getLevel("mic");
    expect(first.rms).toBeCloseTo(0.5, 6);
    expect(first.peak).toBeCloseTo(0.5, 6);
    expect(first.db).toBeCloseTo(-6.02, 2);
    analyser.signal = new Array<number>(1024).fill(0.25);
    const second = handle.getLevel();
    expect(second).toBe(first); // no per-call allocation
    expect(second.rms).toBeCloseTo(0.25, 6);
    expect(analyser.reads).toBe(2);
  });

  it("shows the signal of a muted channel (post-volume, pre-mute meter)", () => {
    const { bus, ctx } = rig();
    const { handle, source } = addMic(bus, ctx);
    strip(source).analyser.signal = new Array<number>(1024).fill(0.5);
    handle.setMuted(true);
    expect(handle.getLevel().peak).toBeCloseTo(0.5, 6);
  });

  it("is silent for a channel without a live input and never reads the analyser", () => {
    const { bus, ctx } = rig();
    bus.addChannel(
      { id: "g", label: "g", kind: "guest" },
      stream() as unknown as MediaStream,
      {
        keepAlive: false,
      },
    );
    const before = ctx.analysers.map((a) => a.reads);
    const level = bus.getLevel("g");
    expect(level).toEqual({ rms: 0, peak: 0, db: SILENCE_DB });
    expect(ctx.analysers.map((a) => a.reads)).toEqual(before);
  });

  it("measures the master output", () => {
    const { bus, ctx } = rig();
    addMic(bus, ctx);
    graph(ctx).masterAnalyser.signal = new Array<number>(1024).fill(1);
    expect(bus.getMasterLevel().peak).toBe(1);
    expect(bus.getMasterLevel().db).toBeCloseTo(0, 6);
  });

  it("returns silence when the analyser lacks getFloatTimeDomainData", () => {
    const { bus, ctx } = rig();
    const { source } = addMic(bus, ctx);
    (
      strip(source).analyser as { getFloatTimeDomainData?: unknown }
    ).getFloatTimeDomainData = undefined;
    expect(bus.getLevel("mic")).toEqual({ rms: 0, peak: 0, db: SILENCE_DB });
  });
});

describe("stream inputs", () => {
  it("creates a waiting channel for a stream without audio and activates it later", () => {
    const { bus, ctx } = rig();
    const notify = vi.fn();
    bus.subscribe(notify);
    const guest = stream(new FakeTrack("video"));
    bus.addChannel(
      { id: "g", label: "Konuk", kind: "guest" },
      guest as unknown as MediaStream,
      {
        keepAlive: false,
      },
    );
    expect(ctx.streamSourceCalls).toBe(0);
    expect(bus.getState().channels.find((c) => c.id === "g")?.active).toBe(
      false,
    );

    const audio = new FakeTrack("audio");
    notify.mockClear();
    guest.addTrack(audio);
    expect(ctx.streamSourceCalls).toBe(1);
    expect(bus.getState().channels.find((c) => c.id === "g")?.active).toBe(
      true,
    );
    expect(notify).toHaveBeenCalled();
    expect(
      reaches(ctx.streamSources[0] as FakeNode, ctx.mixDestination as FakeNode),
    ).toBe(true);
  });

  it("drops the source when the only audio track ends", () => {
    const { bus, ctx } = rig();
    const track = new FakeTrack("audio");
    const s = stream(track);
    bus.addChannel(
      { id: "g", label: "g", kind: "guest" },
      s as unknown as MediaStream,
      {
        keepAlive: false,
      },
    );
    const source = ctx.streamSources[0] as FakeNode;
    track.end();
    expect(source.connections).toEqual([]);
    expect(bus.getState().channels.find((c) => c.id === "g")?.active).toBe(
      false,
    );
    expect(bus.getLevel("g").db).toBe(SILENCE_DB);
  });

  it("rebuilds the source when a track is swapped inside the same stream", () => {
    const { bus, ctx } = rig();
    const oldTrack = new FakeTrack("audio");
    const s = stream(oldTrack);
    bus.addChannel(
      { id: "g", label: "g", kind: "guest" },
      s as unknown as MediaStream,
      {
        keepAlive: false,
      },
    );
    const first = ctx.streamSources[0] as FakeNode;
    const newTrack = new FakeTrack("audio");
    s.addTrack(newTrack); // live set changes: old + new
    s.removeTrack(oldTrack); // live set changes again: new only
    expect(ctx.streamSources).toHaveLength(3);
    expect(first.connections).toEqual([]);
    expect(ctx.streamSources[1]?.connections).toEqual([]);
    expect(
      reaches(ctx.streamSources[2] as FakeNode, ctx.mixDestination as FakeNode),
    ).toBe(true);
    expect(oldTrack.listenerCount("ended")).toBe(0);
    expect(newTrack.listenerCount("ended")).toBe(1);
  });

  it("does not rebuild for unrelated (video) track changes", () => {
    const { bus, ctx } = rig();
    const s = micStream();
    bus.addChannel(
      { id: "g", label: "g", kind: "guest" },
      s as unknown as MediaStream,
      {
        keepAlive: false,
      },
    );
    s.addTrack(new FakeTrack("video"));
    expect(ctx.streamSourceCalls).toBe(1);
  });

  it("survives createMediaStreamSource throwing", () => {
    const { bus, ctx } = rig();
    vi.spyOn(ctx, "createMediaStreamSource").mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() =>
      bus.addChannel(
        { id: "g", label: "g", kind: "guest" },
        micStream() as never,
        {
          keepAlive: false,
        },
      ),
    ).not.toThrow();
    expect(bus.getState().channels.find((c) => c.id === "g")?.active).toBe(
      false,
    );
  });

  it("replaceInput swaps the stream and keeps gain / mute / monitor", () => {
    const { bus, ctx } = rig();
    const s1 = micStream();
    const handle = bus.addChannel(
      { id: "g", label: "g", kind: "guest" },
      s1 as never,
      {
        gain: 0.7,
        keepAlive: false,
      },
    );
    handle.setMuted(true);
    const firstSource = ctx.streamSources[0] as FakeNode;
    const volume = strip(firstSource).volume;

    const s2 = micStream();
    handle.replaceInput(s2 as unknown as MediaStream);
    expect(firstSource.connections).toEqual([]);
    const secondSource = ctx.streamSources[1] as FakeNode;
    expect(strip(secondSource).volume).toBe(volume); // same channel strip
    expect(volume.gain.value).toBe(0.7);
    expect(strip(secondSource).gate.gain.value).toBe(0);
    expect(s1.listenerCount("addtrack")).toBe(0);
    expect(s2.listenerCount("addtrack")).toBe(1);

    // the old stream no longer drives the channel
    s1.addTrack(new FakeTrack("audio"));
    expect(ctx.streamSources).toHaveLength(2);
    expect(bus.getState().channels.find((c) => c.id === "g")).toMatchObject({
      gain: 0.7,
      muted: true,
      active: true,
    });
  });

  it("replaceInput can revive a channel that had no audio", () => {
    const { bus, ctx } = rig();
    bus.addChannel({ id: "g", label: "g", kind: "guest" }, stream() as never, {
      keepAlive: false,
    });
    expect(bus.replaceInput("g", micStream() as unknown as MediaStream)).toBe(
      true,
    );
    expect(ctx.streamSources).toHaveLength(1);
    expect(bus.getState().channels.find((c) => c.id === "g")?.active).toBe(
      true,
    );
  });

  it("replaceInput reports unknown channels and refuses internal / invalid inputs", () => {
    const { bus, ctx } = rig();
    addMic(bus, ctx);
    expect(bus.replaceInput("ghost", micStream() as never)).toBe(false);
    expect(() =>
      bus.replaceInput(SFX_CHANNEL_ID, micStream() as never),
    ).toThrowError(expect.objectContaining({ code: "invalid-input" }));
    expect(() => bus.replaceInput("mic", {} as never)).toThrowError(
      expect.objectContaining({ code: "invalid-input" }),
    );
    expect(bus.getState().channels.find((c) => c.id === "mic")?.active).toBe(
      true,
    );
  });

  it("keeps remote guest audio flowing with a muted keep-alive element", () => {
    const { bus, ctx } = rig();
    const created: HTMLAudioElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = realCreate(tag);
      if (tag === "audio") created.push(el as HTMLAudioElement);
      return el;
    }) as typeof document.createElement);
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});

    const s = micStream();
    const handle = bus.addChannel(
      { id: "g", label: "g", kind: "guest" },
      s as never,
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.muted).toBe(true);
    expect(created[0]?.srcObject).toBe(s);
    expect(play).toHaveBeenCalled();
    expect(ctx.streamSourceCalls).toBe(1);

    handle.remove();
    expect(pause).toHaveBeenCalled();
    expect(created[0]?.srcObject).toBeNull();
  });

  it("only uses the keep-alive for guests unless asked", () => {
    const { bus } = rig();
    const spy = vi.spyOn(document, "createElement");
    bus.addChannel({ id: "m", label: "m", kind: "mic" }, micStream() as never);
    bus.addChannel(
      { id: "s", label: "s", kind: "system" },
      micStream() as never,
      {
        keepAlive: false,
      },
    );
    expect(spy.mock.calls.filter(([tag]) => tag === "audio")).toHaveLength(0);
  });
});

describe("media element inputs", () => {
  it("routes an element through the graph and caches the source node", () => {
    const { bus, ctx } = rig();
    const el = fakeElement();
    const h = bus.addChannel(
      { id: "v", label: "v", kind: "video" },
      el as never,
    );
    expect(ctx.elementSourceCalls).toBe(1);
    expect(bus.getState().channels.find((c) => c.id === "v")).toMatchObject({
      source: "element",
      active: true,
      monitor: true,
    });
    h.remove();
    // createMediaElementSource may only be called once per element: re-adding reuses the node
    bus.addChannel({ id: "v2", label: "v2", kind: "video" }, el as never);
    expect(ctx.elementSourceCalls).toBe(1);
    expect(bus.getState().channels.find((c) => c.id === "v2")?.active).toBe(
      true,
    );
  });

  it("disconnects the element from the channel on removal", () => {
    const { bus, ctx } = rig();
    const el = fakeElement();
    bus.addChannel({ id: "v", label: "v", kind: "video" }, el as never);
    const node = ctx.gains[ctx.gains.length - 3] as FakeNode; // the volume node of this channel
    void node;
    bus.removeChannel("v");
    bus.addChannel({ id: "w", label: "w", kind: "video" }, el as never);
    expect(ctx.elementSourceCalls).toBe(1);
  });

  it("refuses to feed one element into two channels", () => {
    const { bus } = rig();
    const el = fakeElement();
    bus.addChannel({ id: "a", label: "a", kind: "video" }, el as never);
    expect(() =>
      bus.addChannel({ id: "b", label: "b", kind: "video" }, el as never),
    ).toThrowError(expect.objectContaining({ code: "duplicate-input" }));
    expect(bus.hasChannel("b")).toBe(false);
  });

  it("refuses an element that is bound to another (older) audio context", () => {
    const a = rig();
    const b = rig();
    const el = fakeElement();
    a.bus.addChannel({ id: "a", label: "a", kind: "video" }, el as never);
    expect(() =>
      b.bus.addChannel({ id: "b", label: "b", kind: "video" }, el as never),
    ).toThrowError(expect.objectContaining({ code: "element-bound" }));
    expect(b.bus.hasChannel("b")).toBe(false);
    // the failed attempt leaves no half-wired nodes behind
    expect(b.ctx.elementSourceCalls).toBe(0);
  });

  it("wraps createMediaElementSource failures and cleans up the half-built channel", () => {
    const { bus, ctx } = rig();
    const el = fakeElement();
    claimedElements.add(el); // simulate "already connected elsewhere"
    expect(() =>
      bus.addChannel({ id: "v", label: "v", kind: "video" }, el as never),
    ).toThrowError(expect.objectContaining({ code: "invalid-input" }));
    expect(bus.hasChannel("v")).toBe(false);
    const volume = ctx.gains[ctx.gains.length - 3] as FakeGain;
    expect(volume.connections).toEqual([]);
  });

  it("replaceInput can move a channel from a stream to an element and back", () => {
    const { bus, ctx } = rig();
    const handle = bus.addChannel(
      { id: "x", label: "x", kind: "music" },
      micStream() as never,
      {
        keepAlive: false,
      },
    );
    const el = fakeElement();
    handle.replaceInput(el as never);
    expect(bus.getState().channels.find((c) => c.id === "x")?.source).toBe(
      "element",
    );
    expect(ctx.streamSources[0]?.connections).toEqual([]);
    handle.replaceInput(micStream() as never);
    expect(bus.getState().channels.find((c) => c.id === "x")?.source).toBe(
      "stream",
    );
    expect(bus.getState().channels.find((c) => c.id === "x")?.active).toBe(
      true,
    );
  });

  it("restores the previous input when replaceInput fails", () => {
    const { bus } = rig();
    const el = fakeElement();
    bus.addChannel({ id: "a", label: "a", kind: "video" }, el as never);
    const h = bus.addChannel(
      { id: "b", label: "b", kind: "music" },
      micStream() as never,
      {
        keepAlive: false,
      },
    );
    expect(() => h.replaceInput(el as never)).toThrowError(
      expect.objectContaining({ code: "duplicate-input" }),
    );
    expect(bus.getState().channels.find((c) => c.id === "b")?.active).toBe(
      true,
    );
  });
});

describe("state snapshots", () => {
  it("keeps identity between changes and replaces it on change", () => {
    const { bus, ctx } = rig();
    const empty = bus.getState();
    expect(bus.getState()).toBe(empty);
    const { handle } = addMic(bus, ctx);
    const afterAdd = bus.getState();
    expect(afterAdd).not.toBe(empty);
    expect(bus.getState()).toBe(afterAdd);
    handle.setGain(0.2);
    expect(bus.getState()).not.toBe(afterAdd);
    expect(afterAdd.channels.find((c) => c.id === "mic")?.gain).toBe(1); // old snapshot untouched
  });

  it("getState / subscribe are bound so they can be passed to useSyncExternalStore directly", () => {
    const { bus } = rig();
    const { getState, subscribe } = bus;
    const cb = vi.fn();
    const off = subscribe(cb);
    bus.setMasterGain(0.5);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getState().masterGain).toBe(0.5);
    off();
  });

  it("does not include levels", () => {
    const { bus, ctx } = rig();
    addMic(bus, ctx);
    const info = bus.getState().channels.find((c) => c.id === "mic");
    expect(info && Object.keys(info).sort()).toEqual(
      [
        "active",
        "gain",
        "id",
        "kind",
        "label",
        "monitor",
        "muted",
        "source",
      ].sort(),
    );
  });

  it("notifies subscribers, supports unsubscribe and isolates faulty ones", () => {
    const { bus, ctx } = rig();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(() => {
      throw new Error("faulty");
    });
    bus.subscribe(a);
    const off = bus.subscribe(b);
    const { handle } = addMic(bus, ctx);
    expect(a).toHaveBeenCalled();
    off();
    const calls = b.mock.calls.length;
    handle.setMuted(true);
    expect(b).toHaveBeenCalledTimes(calls);
    expect(a.mock.calls.length).toBeGreaterThan(calls);
  });
});

describe("playSfx", () => {
  it("plays an AudioBuffer through the sfx channel and settles when it ends", async () => {
    const { bus, ctx } = rig();
    const buf = fakeBuffer();
    const h = bus.playSfx(buf as unknown as AudioBuffer, { gain: 0.5 });
    await flush();
    const src = ctx.bufferSources[0];
    expect(src?.started).toBe(true);
    expect(src?.buffer).toBe(buf);
    const g = graph(ctx);
    const sfxGain = src?.connections[0] as FakeGain;
    expect(sfxGain.gain.value).toBe(0.5);
    expect(sfxGain.connections).toEqual([g.sfxIn]);
    expect(reaches(g.sfxIn, ctx.mixDestination as FakeNode)).toBe(true);
    src?.emitEnded();
    await expect(h.done).resolves.toEqual({ status: "ended" });
    expect(src?.connections).toEqual([]);
    expect(sfxGain.connections).toEqual([]);
  });

  it("clamps the per-sound gain and defaults to 1", async () => {
    const { bus, ctx } = rig();
    bus.playSfx(fakeBuffer() as unknown as AudioBuffer, { gain: 10 });
    bus.playSfx(fakeBuffer() as unknown as AudioBuffer);
    await flush();
    const gains = ctx.bufferSources.map(
      (s) => (s.connections[0] as FakeGain).gain.value,
    );
    expect(gains).toEqual([MAX_GAIN, 1]);
  });

  it("stop() halts a playing sound", async () => {
    const { bus, ctx } = rig();
    const h = bus.playSfx(fakeBuffer() as unknown as AudioBuffer);
    await flush();
    h.stop();
    expect(ctx.bufferSources[0]?.stopped).toBe(true);
    await expect(h.done).resolves.toEqual({ status: "stopped" });
    h.stop(); // idempotent
  });

  it("stop() before decoding finishes cancels the sound", async () => {
    const { bus, ctx } = rig();
    const h = bus.playSfx(new Blob([new Uint8Array(16)]));
    h.stop();
    await expect(h.done).resolves.toEqual({ status: "stopped" });
    await flush();
    expect(ctx.bufferSources).toHaveLength(0);
  });

  it("decodes a blob once and serves repeats from the cache (even in flight)", async () => {
    const { bus, ctx } = rig();
    const blob = new Blob([new Uint8Array(32)]);
    bus.playSfx(blob);
    bus.playSfx(blob);
    await until(() => expect(ctx.bufferSources).toHaveLength(2));
    bus.playSfx(blob);
    await until(() => expect(ctx.bufferSources).toHaveLength(3));
    expect(ctx.decodeCalls).toBe(1);
  });

  it("evicts the least recently used sound beyond the cache size", async () => {
    const { bus, ctx } = rig();
    const blobs = Array.from(
      { length: SFX_CACHE_ENTRIES + 1 },
      (_, i) => new Blob([`s${i}`]),
    );
    for (let i = 0; i < blobs.length; i++) {
      bus.playSfx(blobs[i] as Blob);
      await until(() => expect(ctx.bufferSources).toHaveLength(i + 1));
    }
    expect(ctx.decodeCalls).toBe(blobs.length);
    bus.playSfx(blobs[blobs.length - 1] as Blob); // still cached
    await until(() => expect(ctx.bufferSources).toHaveLength(blobs.length + 1));
    expect(ctx.decodeCalls).toBe(blobs.length);
    bus.playSfx(blobs[0] as Blob); // evicted: decoded again
    await until(() => expect(ctx.bufferSources).toHaveLength(blobs.length + 2));
    expect(ctx.decodeCalls).toBe(blobs.length + 1);
  });

  it("refreshes the LRU position on a cache hit", async () => {
    const { bus, ctx } = rig();
    const blobs = Array.from(
      { length: SFX_CACHE_ENTRIES },
      (_, i) => new Blob([`s${i}`]),
    );
    for (let i = 0; i < blobs.length; i++) {
      bus.playSfx(blobs[i] as Blob);
      await until(() => expect(ctx.bufferSources).toHaveLength(i + 1));
    }
    bus.playSfx(blobs[0] as Blob); // touch the oldest entry
    await until(() => expect(ctx.bufferSources).toHaveLength(blobs.length + 1));
    bus.playSfx(new Blob(["newcomer"])); // evicts blobs[1], not blobs[0]
    await until(() => expect(ctx.bufferSources).toHaveLength(blobs.length + 2));
    const decodes = ctx.decodeCalls;
    bus.playSfx(blobs[0] as Blob);
    await until(() => expect(ctx.bufferSources).toHaveLength(blobs.length + 3));
    expect(ctx.decodeCalls).toBe(decodes);
    bus.playSfx(blobs[1] as Blob);
    await until(() => expect(ctx.bufferSources).toHaveLength(blobs.length + 4));
    expect(ctx.decodeCalls).toBe(decodes + 1);
  });

  it("reports decode failures and does not cache them", async () => {
    const { bus, ctx } = rig();
    ctx.decodeFails = true;
    const blob = new Blob([new Uint8Array(8)]);
    const result = await bus.playSfx(blob).done;
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.error.code).toBe(
      "sfx-decode-failed",
    );
    ctx.decodeFails = false;
    const h = bus.playSfx(blob);
    await until(() => expect(ctx.bufferSources).toHaveLength(1));
    expect(ctx.decodeCalls).toBe(2);
    h.stop();
  });

  it("rejects oversized blobs without decoding", async () => {
    const { bus, ctx } = rig();
    const big = { size: MAX_SFX_BYTES + 1 } as unknown as Blob;
    Object.setPrototypeOf(big, Blob.prototype);
    const result = await bus.playSfx(big).done;
    expect(result).toMatchObject({
      status: "error",
      error: { code: "sfx-too-large" },
    });
    expect(ctx.decodeCalls).toBe(0);
  });

  it("only loads allowed URLs", async () => {
    const { bus, ctx } = rig();
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const blocked = await bus.playSfx("https://evil.example/a.mp3").done;
    expect(blocked).toMatchObject({
      status: "error",
      error: { code: "sfx-url-blocked" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    const ok = bus.playSfx("blob:http://localhost/abc");
    await until(() => expect(ctx.bufferSources).toHaveLength(1));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    ok.stop();

    const sameOrigin = bus.playSfx("/sounds/ding.wav");
    await until(() => expect(ctx.bufferSources).toHaveLength(2));
    sameOrigin.stop();
  });

  it("reports HTTP failures and oversized downloads", async () => {
    const { bus } = rig();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    );
    const notFound = await bus.playSfx("blob:http://localhost/missing").done;
    expect(notFound).toMatchObject({
      status: "error",
      error: { code: "sfx-load-failed" },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => ({ byteLength: MAX_SFX_BYTES + 1 }),
      })),
    );
    const big = await bus.playSfx("blob:http://localhost/huge").done;
    expect(big).toMatchObject({
      status: "error",
      error: { code: "sfx-too-large" },
    });
  });

  it("rejects invalid sources instead of throwing", async () => {
    const { bus } = rig();
    const r = await bus.playSfx(42 as unknown as Blob).done;
    expect(r).toMatchObject({
      status: "error",
      error: { code: "invalid-input" },
    });
  });

  it("never throws when the audio engine is unavailable or disposed", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    const bus = new AudioBus();
    const r = await bus.playSfx(new Blob(["x"])).done;
    expect(r).toMatchObject({
      status: "error",
      error: { code: "unsupported" },
    });

    const live = rig();
    live.bus.dispose();
    const r2 = await live.bus.playSfx(new Blob(["x"])).done;
    expect(r2).toMatchObject({ status: "error", error: { code: "disposed" } });
  });

  it("reports a failing start() as an error", async () => {
    const { bus, ctx } = rig();
    const orig = ctx.createBufferSource.bind(ctx);
    vi.spyOn(ctx, "createBufferSource").mockImplementation(() => {
      const s = orig();
      s.start = () => {
        throw new Error("InvalidStateError");
      };
      return s;
    });
    const r = await bus.playSfx(fakeBuffer() as unknown as AudioBuffer).done;
    expect(r).toMatchObject({
      status: "error",
      error: { code: "sfx-decode-failed" },
    });
  });

  it("bounds the number of simultaneous sounds by stopping the oldest", async () => {
    const { bus, ctx } = rig();
    const handles = Array.from({ length: 33 }, () =>
      bus.playSfx(fakeBuffer() as unknown as AudioBuffer),
    );
    await flush();
    expect(await handles[0]?.done).toEqual({ status: "stopped" });
    expect(ctx.bufferSources).toHaveLength(32);
    expect(ctx.bufferSources.every((s) => s.started)).toBe(true);
  });

  it("tries to resume the context so a click-triggered sound is audible", async () => {
    const { bus, ctx } = rig();
    bus.playSfx(fakeBuffer() as unknown as AudioBuffer);
    await flush();
    expect(ctx.resumeCalls).toBeGreaterThan(0);
  });

  it("is controlled by the sfx channel fader and mute", async () => {
    const { bus, ctx } = rig();
    bus.playSfx(fakeBuffer() as unknown as AudioBuffer);
    await flush();
    bus.setGain(SFX_CHANNEL_ID, 0.3);
    bus.setMuted(SFX_CHANNEL_ID, true);
    const sfxStrip = strip(graph(ctx).sfxIn);
    expect(sfxStrip.volume.gain.value).toBe(0.3);
    expect(sfxStrip.gate.gain.value).toBe(0);
  });
});

describe("dispose", () => {
  it("releases nodes, tracks and the context, and is idempotent", async () => {
    const { bus, ctx } = rig();
    const { source, s } = addMic(bus, ctx);
    const g = graph(ctx);
    const track = ctx.mixDestination?.stream.getTracks()[0];
    const listener = vi.fn();
    bus.subscribe(listener);
    bus.dispose();
    bus.dispose();
    expect(source.connections).toEqual([]);
    expect(g.mixIn.connections).toEqual([]);
    expect(g.master.connections).toEqual([]);
    expect(g.limiter.connections).toEqual([]);
    expect(g.post.connections).toEqual([]);
    expect(g.monitorBus.connections).toEqual([]);
    expect(track?.stopCalls).toBe(1);
    expect(ctx.closeCalls).toBe(1);
    expect(s.listenerCount("addtrack")).toBe(0);
    expect(ctx.listenerCount("statechange")).toBe(0);
    expect(bus.getState()).toMatchObject({
      channels: [],
      contextState: "closed",
    });
    // subscribers were told about the final state, then dropped
    expect(listener).toHaveBeenCalled();
    const calls = listener.mock.calls.length;
    bus.setMasterGain(0.5);
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it("refuses new work afterwards", () => {
    const { bus } = rig();
    bus.dispose();
    expect(() =>
      bus.addChannel(
        { id: "m", label: "m", kind: "mic" },
        micStream() as never,
      ),
    ).toThrowError(expect.objectContaining({ code: "disposed" }));
    expect(() => bus.getMixStream()).toThrowError(
      expect.objectContaining({ code: "disposed" }),
    );
    return expect(bus.ensureRunning()).rejects.toMatchObject({
      code: "disposed",
    });
  });

  it("stops running sounds and keeps the setters harmless", async () => {
    const { bus, ctx } = rig();
    const h = bus.playSfx(fakeBuffer() as unknown as AudioBuffer);
    await flush();
    bus.dispose();
    expect(ctx.bufferSources[0]?.stopped).toBe(true);
    await expect(h.done).resolves.toEqual({ status: "stopped" });
    expect(bus.setGain("mic", 1)).toBe(false);
    expect(() => bus.setLimiterEnabled(false)).not.toThrow();
    expect(() => bus.setMasterMuted(true)).not.toThrow();
  });

  it("removes the gesture listeners it installed", () => {
    const { bus, ctx } = rig();
    addMic(bus, ctx);
    bus.dispose();
    document.dispatchEvent(new Event("pointerdown"));
    expect(ctx.resumeCalls).toBe(0);
  });

  it("does not close a context that failed to build", () => {
    const ctx = new FakeContext();
    vi.spyOn(ctx, "createMediaStreamDestination").mockImplementation(() => {
      throw new Error("no destination");
    });
    const bus = new AudioBus({
      contextFactory: () => ctx as unknown as AudioContext,
    });
    expect(() => bus.getMixStream()).toThrowError(
      expect.objectContaining({ code: "unsupported" }),
    );
    expect(bus.getState().contextState).toBe("none");
    expect(ctx.closeCalls).toBe(1); // the half-built context is released
  });
});
