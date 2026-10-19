// src/studio/engine/voice.ts
// Voice enhancement for the microphone: rumble filter -> noise gate/expander (AudioWorklet) ->
// EQ (de-mud, presence, air) -> compressor -> limiter. The pure parts (settings, presets, the
// parameter mapping, the ducking math) are unit-tested; the WebAudio wiring is thin.
import { GATE_PROCESSOR_NAME, GATE_WORKLET_SOURCE } from "./voice-dsp";

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export type VoicePreset = "off" | "speech" | "podcast" | "noisy" | "custom";

export interface DuckingSettings {
  enabled: boolean;
  /** how much music is lowered while someone speaks, dB (negative) */
  amountDb: number;
  /** mic level (dBFS) above which the voice counts as speaking */
  thresholdDb: number;
  /** ms for the music to come back after speech stops */
  releaseMs: number;
}

export interface VoiceSettings {
  enabled: boolean;
  preset: VoicePreset;
  /** high-pass (rumble / wind / handling noise), Hz */
  hpf: number;
  gate: boolean;
  /** gate opens above this level, dBFS */
  gateDb: number;
  /** how far the gate pulls noise down between words, dB (positive) */
  reductionDb: number;
  /** 0..100: EQ + compression amount */
  enhance: number;
  /** safety limiter at about -2 dBFS */
  limiter: boolean;
  ducking: DuckingSettings;
}

export const DEFAULT_DUCKING: Readonly<DuckingSettings> = {
  enabled: false,
  amountDb: -12,
  thresholdDb: -38,
  releaseMs: 700,
};

export const DEFAULT_VOICE: Readonly<VoiceSettings> = {
  enabled: false,
  preset: "off",
  hpf: 80,
  gate: false,
  gateDb: -52,
  reductionDb: 18,
  enhance: 0,
  limiter: true,
  ducking: DEFAULT_DUCKING,
};

export const VOICE_PRESETS: Readonly<
  Record<Exclude<VoicePreset, "custom">, Partial<VoiceSettings>>
> = {
  off: { enabled: false, gate: false, enhance: 0 },
  /** clean voice, light touch */
  speech: {
    enabled: true,
    hpf: 80,
    gate: true,
    gateDb: -54,
    reductionDb: 12,
    enhance: 45,
  },
  /** broadcast sound: warmer, more presence, tighter dynamics */
  podcast: {
    enabled: true,
    hpf: 90,
    gate: true,
    gateDb: -50,
    reductionDb: 18,
    enhance: 70,
  },
  /** fans, street, keyboard: aggressive gate, stronger rumble cut */
  noisy: {
    enabled: true,
    hpf: 120,
    gate: true,
    gateDb: -42,
    reductionDb: 30,
    enhance: 60,
  },
};

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.min(hi, Math.max(lo, n))
    : fallback;

/** Repairs untrusted / stored settings: unknown fields are dropped, numbers clamped. */
export function sanitizeVoiceSettings(raw: unknown): VoiceSettings {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const d = (
    typeof o["ducking"] === "object" && o["ducking"] !== null
      ? o["ducking"]
      : {}
  ) as Record<string, unknown>;
  const presets: VoicePreset[] = [
    "off",
    "speech",
    "podcast",
    "noisy",
    "custom",
  ];
  return {
    enabled: o["enabled"] === true,
    preset: presets.includes(o["preset"] as VoicePreset)
      ? (o["preset"] as VoicePreset)
      : "off",
    hpf: clamp(o["hpf"], 30, 300, DEFAULT_VOICE.hpf),
    gate: o["gate"] === true,
    gateDb: clamp(o["gateDb"], -80, -15, DEFAULT_VOICE.gateDb),
    reductionDb: clamp(o["reductionDb"], 3, 45, DEFAULT_VOICE.reductionDb),
    enhance: clamp(o["enhance"], 0, 100, DEFAULT_VOICE.enhance),
    limiter: o["limiter"] !== false,
    ducking: {
      enabled: d["enabled"] === true,
      amountDb: clamp(d["amountDb"], -30, -3, DEFAULT_DUCKING.amountDb),
      thresholdDb: clamp(
        d["thresholdDb"],
        -60,
        -15,
        DEFAULT_DUCKING.thresholdDb,
      ),
      releaseMs: clamp(d["releaseMs"], 100, 3000, DEFAULT_DUCKING.releaseMs),
    },
  };
}

export function applyVoicePreset(
  cur: VoiceSettings,
  preset: Exclude<VoicePreset, "custom">,
): VoiceSettings {
  return sanitizeVoiceSettings({
    ...cur,
    ...VOICE_PRESETS[preset],
    preset,
    ducking: cur.ducking,
  });
}

const KEY = "studio.voice.v1";

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitizeVoiceSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return sanitizeVoiceSettings({});
  }
}

export function saveVoiceSettings(s: VoiceSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked */
  }
}

/* ------------------------------------------------------------------ */
/* Pure mapping                                                        */
/* ------------------------------------------------------------------ */

export const dbToLin = (db: number): number => Math.pow(10, db / 20);

export interface ChainParams {
  hpfHz: number;
  lowShelfDb: number;
  presenceDb: number;
  airDb: number;
  compThresholdDb: number;
  compRatio: number;
  makeupDb: number;
  gateThreshold: number; // linear
  gateFloor: number; // linear
  gateEnabled: boolean;
}

/** Maps the user-facing settings to concrete node parameters. */
export function chainParams(s: VoiceSettings): ChainParams {
  const e = s.enabled ? s.enhance / 100 : 0;
  return {
    hpfHz: s.hpf,
    lowShelfDb: -3.5 * e, // remove boominess / proximity mud around 180 Hz
    presenceDb: 4.5 * e, // intelligibility, 3.2 kHz
    airDb: 2.5 * e, // openness, 9 kHz
    compThresholdDb: -18 - 8 * e,
    compRatio: 1 + 3.2 * e,
    makeupDb: 4 * e,
    gateThreshold: dbToLin(s.gateDb),
    gateFloor: dbToLin(-s.reductionDb),
    gateEnabled: s.enabled && s.gate,
  };
}

/**
 * Music gain multiplier while ducking. `speaking` comes from the mic level; the multiplier moves
 * towards its target with a fast attack (60 ms) and the configured release. Returns the new value.
 */
export function duckStep(
  current: number,
  speaking: boolean,
  d: DuckingSettings,
  dtMs: number,
): number {
  const target = speaking ? dbToLin(d.amountDb) : 1;
  const tau = speaking ? 60 : d.releaseMs;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  return current + (target - current) * k;
}

/* ------------------------------------------------------------------ */
/* WebAudio wiring                                                     */
/* ------------------------------------------------------------------ */

export interface VoiceMeter {
  /** gate currently open (voice present) */
  open: boolean;
  /** mic level, dBFS */
  db: number;
}

type Listener = (m: VoiceMeter) => void;

export class VoiceProcessor {
  private ctx: AudioContext | null = null;
  private nodes: {
    source: MediaStreamAudioSourceNode;
    dry: GainNode;
    wet: GainNode;
    hpf: BiquadFilterNode;
    gate: AudioWorkletNode | null;
    low: BiquadFilterNode;
    presence: BiquadFilterNode;
    air: BiquadFilterNode;
    comp: DynamicsCompressorNode;
    makeup: GainNode;
    limiter: DynamicsCompressorNode;
    dest: MediaStreamAudioDestinationNode;
  } | null = null;
  private settings: VoiceSettings = sanitizeVoiceSettings({});
  private listeners = new Set<Listener>();
  private meter: VoiceMeter = { open: true, db: -100 };
  /** false when AudioWorklet is missing: the gate then stays out of the chain */
  gateAvailable = true;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getMeter = (): VoiceMeter => this.meter;
  getSettings = (): VoiceSettings => this.settings;

  /** Routes `input`'s audio through the chain and returns a stream with the processed audio. */
  async attach(
    input: MediaStream,
    settings: VoiceSettings,
  ): Promise<MediaStream> {
    this.detach();
    this.settings = settings;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    await ctx.resume().catch(() => undefined);

    let gate: AudioWorkletNode | null = null;
    if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        const url = URL.createObjectURL(
          new Blob([GATE_WORKLET_SOURCE], { type: "application/javascript" }),
        );
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        gate = new AudioWorkletNode(ctx, GATE_PROCESSOR_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        gate.port.onmessage = (e: MessageEvent<VoiceMeter>) => {
          this.meter = { open: !!e.data.open, db: Number(e.data.db) };
          for (const l of [...this.listeners]) l(this.meter);
        };
      } catch {
        gate = null;
      }
    }
    this.gateAvailable = gate !== null;

    const source = ctx.createMediaStreamSource(input);
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.Q.value = 0.707;
    const low = ctx.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 180;
    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 3200;
    presence.Q.value = 0.9;
    const air = ctx.createBiquadFilter();
    air.type = "highshelf";
    air.frequency.value = 9000;
    const comp = ctx.createDynamicsCompressor();
    comp.attack.value = 0.006;
    comp.release.value = 0.22;
    comp.knee.value = 12;
    const makeup = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    const dest = ctx.createMediaStreamDestination();

    source.connect(dry);
    dry.connect(dest);
    source.connect(hpf);
    let tail: AudioNode = hpf;
    if (gate) {
      tail.connect(gate);
      tail = gate;
    }
    tail.connect(low);
    low.connect(presence);
    presence.connect(air);
    air.connect(comp);
    comp.connect(makeup);
    makeup.connect(limiter);
    limiter.connect(wet);
    wet.connect(dest);

    this.nodes = {
      source,
      dry,
      wet,
      hpf,
      gate,
      low,
      presence,
      air,
      comp,
      makeup,
      limiter,
      dest,
    };
    this.update(settings);

    // Keep the other tracks (none for a mic) untouched; only audio goes through the chain.
    return dest.stream;
  }

  /** Applies new settings to the live graph without re-attaching. */
  update(settings: VoiceSettings): void {
    this.settings = settings;
    const n = this.nodes;
    const ctx = this.ctx;
    if (!n || !ctx) return;
    const p = chainParams(settings);
    const t = ctx.currentTime;
    const ramp = (param: AudioParam, v: number) =>
      param.setTargetAtTime(v, t, 0.02);
    ramp(n.dry.gain, settings.enabled ? 0 : 1);
    ramp(n.wet.gain, settings.enabled ? 1 : 0);
    ramp(n.hpf.frequency, p.hpfHz);
    ramp(n.low.gain, p.lowShelfDb);
    ramp(n.presence.gain, p.presenceDb);
    ramp(n.air.gain, p.airDb);
    ramp(n.comp.threshold, p.compThresholdDb);
    ramp(n.comp.ratio, p.compRatio);
    ramp(n.makeup.gain, dbToLin(p.makeupDb));
    ramp(n.limiter.threshold, settings.limiter ? -2 : 0);
    ramp(n.limiter.ratio, settings.limiter ? 20 : 1);
    n.gate?.port.postMessage({
      enabled: p.gateEnabled,
      threshold: p.gateThreshold,
      floor: p.gateFloor,
    });
  }

  detach(): void {
    try {
      this.nodes?.source.disconnect();
    } catch {
      /* already disconnected */
    }
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.nodes = null;
    this.meter = { open: true, db: -100 };
  }
}
