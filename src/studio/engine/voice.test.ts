import { describe, expect, it } from "vitest";

import {
  applyVoicePreset,
  chainParams,
  DEFAULT_DUCKING,
  DEFAULT_VOICE,
  duckStep,
  sanitizeVoiceSettings,
  VOICE_PRESETS,
} from "./voice";
import { GATE_PROCESSOR_NAME, GATE_WORKLET_SOURCE } from "./voice-dsp";

interface Dsp {
  open: boolean;
  gain: number;
  env: number;
  configure(p: Record<string, unknown>): void;
  processBlock(ch: Float32Array[]): number;
}

function makeDsp(sr = 48000): Dsp {
  let registered = "";
  const factory = new Function(
    "AudioWorkletProcessor",
    "registerProcessor",
    "sampleRate",
    `${GATE_WORKLET_SOURCE}; return GateDsp;`,
  ) as (
    a: unknown,
    r: (n: string) => void,
    sr: number,
  ) => new (sr: number) => Dsp;
  const Cls = factory(
    class {},
    (n) => {
      registered = n;
    },
    sr,
  );
  expect(registered).toBe(GATE_PROCESSOR_NAME);
  return new Cls(sr);
}

const block = (amp: number, n = 128) => {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++)
    a[i] = amp * Math.sin((2 * Math.PI * 220 * i) / 48000);
  return [a];
};
const rmsOf = (b: Float32Array[]) =>
  Math.sqrt(b[0]!.reduce((s, v) => s + v * v, 0) / b[0]!.length);

describe("noise gate DSP", () => {
  it("passes speech-level signal and attenuates noise down to the floor", () => {
    const g = makeDsp();
    g.configure({ threshold: 0.02, floor: 0.125, holdMs: 100, enabled: true });
    let last = block(0.3);
    for (let i = 0; i < 200; i++)
      last = (() => {
        const b = block(0.3);
        g.processBlock(b);
        return b;
      })();
    expect(g.open).toBe(true);
    expect(rmsOf(last)).toBeGreaterThan(0.18); // ~0.212 rms input, unchanged

    // switch to noise (rms ~0.0035) for a second
    let tail = block(0.005);
    for (let i = 0; i < 400; i++) {
      tail = block(0.005);
      g.processBlock(tail);
    }
    expect(g.open).toBe(false);
    expect(g.gain).toBeLessThan(0.16);
    expect(rmsOf(tail)).toBeLessThan(0.0035 * 0.2);
  });
  it("holds the gate open through short pauses (no chopped words)", () => {
    const g = makeDsp();
    g.configure({ threshold: 0.02, floor: 0.1, holdMs: 300, enabled: true });
    for (let i = 0; i < 100; i++) g.processBlock(block(0.3));
    for (let i = 0; i < 40; i++) g.processBlock(block(0.0005)); // ~107 ms silence < hold
    expect(g.open).toBe(true);
    for (let i = 0; i < 300; i++) g.processBlock(block(0.0005)); // long silence
    expect(g.open).toBe(false);
  });
  it("is transparent when disabled", () => {
    const g = makeDsp();
    g.configure({ enabled: false });
    const b = block(0.001);
    const before = rmsOf(b);
    for (let i = 0; i < 50; i++) g.processBlock(block(0.001));
    const c = block(0.001);
    g.processBlock(c);
    expect(rmsOf(c)).toBeCloseTo(before, 4);
  });
});

describe("voice settings", () => {
  it("repairs garbage and clamps numbers", () => {
    const s = sanitizeVoiceSettings({
      enabled: "yes",
      preset: "x",
      hpf: 99999,
      gateDb: -500,
      enhance: NaN,
      ducking: { amountDb: 5, releaseMs: 1 },
    });
    expect(s.enabled).toBe(false);
    expect(s.preset).toBe("off");
    expect(s.hpf).toBe(300);
    expect(s.gateDb).toBe(-80);
    expect(s.enhance).toBe(DEFAULT_VOICE.enhance);
    expect(s.ducking.amountDb).toBe(-3);
    expect(s.ducking.releaseMs).toBe(100);
    expect(sanitizeVoiceSettings(null)).toEqual(sanitizeVoiceSettings({}));
  });
  it("presets enable the chain and keep the ducking choice", () => {
    const cur = sanitizeVoiceSettings({
      ducking: { enabled: true, amountDb: -18 },
    });
    for (const id of ["speech", "podcast", "noisy"] as const) {
      const s = applyVoicePreset(cur, id);
      expect(s.enabled).toBe(true);
      expect(s.gate).toBe(true);
      expect(s.preset).toBe(id);
      expect(s.ducking).toEqual(cur.ducking);
    }
    expect(applyVoicePreset(cur, "off").enabled).toBe(false);
    expect(VOICE_PRESETS.noisy.reductionDb!).toBeGreaterThan(
      VOICE_PRESETS.speech.reductionDb!,
    );
  });
  it("maps settings to node parameters", () => {
    const off = chainParams(DEFAULT_VOICE);
    expect(off.presenceDb).toBe(0);
    expect(off.gateEnabled).toBe(false);
    const on = chainParams(
      applyVoicePreset(sanitizeVoiceSettings({}), "podcast"),
    );
    expect(on.presenceDb).toBeGreaterThan(2);
    expect(on.compRatio).toBeGreaterThan(2);
    expect(on.gateEnabled).toBe(true);
    expect(on.gateThreshold).toBeCloseTo(Math.pow(10, -50 / 20), 6);
  });
});

describe("ducking", () => {
  it("falls quickly and recovers with the configured release", () => {
    let m = 1;
    for (let i = 0; i < 20; i++) m = duckStep(m, true, DEFAULT_DUCKING, 50);
    expect(m).toBeCloseTo(Math.pow(10, DEFAULT_DUCKING.amountDb / 20), 2);
    const down = m;
    m = duckStep(m, false, DEFAULT_DUCKING, 50);
    expect(m).toBeGreaterThan(down);
    expect(m).toBeLessThan(0.6); // slow release
    for (let i = 0; i < 100; i++) m = duckStep(m, false, DEFAULT_DUCKING, 50);
    expect(m).toBeCloseTo(1, 2);
  });
});
