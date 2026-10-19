// src/lib/studio/sfx.ts
// Synthesized sound effects via ZzFX (MIT, https://github.com/KilledByAPixel/ZzFX).
// No audio files are shipped, so there are no sample licences to track.

type Params = {
  volume?: number;
  randomness?: number;
  frequency?: number;
  attack?: number;
  sustain?: number;
  release?: number;
  shape?: number;
  shapeCurve?: number;
  slide?: number;
  deltaSlide?: number;
  pitchJump?: number;
  pitchJumpTime?: number;
  repeatTime?: number;
  noise?: number;
  modulation?: number;
  bitCrush?: number;
  delay?: number;
  sustainVolume?: number;
  decay?: number;
  tremolo?: number;
  filter?: number;
};

export type SfxPreset = {
  id: string;
  label: string;
  emoji: string;
  params: Params;
};

export const SFX_PRESETS: SfxPreset[] = [
  {
    id: "whoosh",
    label: "Whoosh",
    emoji: "💨",
    params: {
      volume: 0.9,
      frequency: 300,
      attack: 0.12,
      sustain: 0.05,
      release: 0.35,
      shape: 4,
      slide: 2,
      noise: 0.6,
      filter: 300,
    },
  },
  {
    id: "ding",
    label: "Ding",
    emoji: "🔔",
    params: {
      volume: 0.9,
      frequency: 1318,
      attack: 0.01,
      sustain: 0.1,
      release: 0.7,
      shape: 0,
      sustainVolume: 0.6,
      tremolo: 0.1,
    },
  },
  {
    id: "pop",
    label: "Pop",
    emoji: "🫧",
    params: {
      volume: 1,
      frequency: 500,
      attack: 0,
      sustain: 0.01,
      release: 0.08,
      shape: 0,
      slide: 30,
      noise: 0.05,
    },
  },
  {
    id: "hit",
    label: "Vuruş",
    emoji: "🥁",
    params: {
      volume: 1.2,
      frequency: 90,
      attack: 0,
      sustain: 0.04,
      release: 0.3,
      shape: 4,
      slide: -6,
      noise: 0.4,
    },
  },
  {
    id: "win",
    label: "Başarı",
    emoji: "🎉",
    params: {
      volume: 0.9,
      frequency: 523,
      attack: 0.01,
      sustain: 0.2,
      release: 0.3,
      shape: 1,
      pitchJump: 261,
      pitchJumpTime: 0.08,
      repeatTime: 0.13,
    },
  },
  {
    id: "coin",
    label: "Puan",
    emoji: "🪙",
    params: {
      volume: 0.8,
      frequency: 988,
      attack: 0,
      sustain: 0.05,
      release: 0.25,
      shape: 1,
      pitchJump: 400,
      pitchJumpTime: 0.06,
    },
  },
  {
    id: "buzz",
    label: "Hata",
    emoji: "❌",
    params: {
      volume: 0.9,
      frequency: 120,
      attack: 0.01,
      sustain: 0.2,
      release: 0.15,
      shape: 2,
      modulation: 3,
    },
  },
  {
    id: "riser",
    label: "Yükseliş",
    emoji: "📈",
    params: {
      volume: 0.8,
      frequency: 150,
      attack: 0.5,
      sustain: 0.3,
      release: 0.2,
      shape: 2,
      slide: 6,
      noise: 0.1,
    },
  },
];

const ORDER: (keyof Params)[] = [
  "volume",
  "randomness",
  "frequency",
  "attack",
  "sustain",
  "release",
  "shape",
  "shapeCurve",
  "slide",
  "deltaSlide",
  "pitchJump",
  "pitchJumpTime",
  "repeatTime",
  "noise",
  "modulation",
  "bitCrush",
  "delay",
  "sustainVolume",
  "decay",
  "tremolo",
  "filter",
];

/** Renders a preset into an AudioBuffer on the given context (client only; ZzFX touches AudioContext on import). */
export async function buildSfxBuffer(
  ctx: AudioContext,
  preset: SfxPreset,
): Promise<AudioBuffer> {
  const { ZZFX } = await import("zzfx");
  const args = ORDER.map((k) => preset.params[k]);
  const samples: number[] = ZZFX.buildSamples(...args);
  const buf = ctx.createBuffer(1, samples.length, ZZFX.sampleRate);
  buf.getChannelData(0).set(samples);
  return buf;
}
