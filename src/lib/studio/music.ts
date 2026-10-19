// src/lib/studio/music.ts
// Procedural lo-fi / ambient music generated with the WebAudio API.
// No samples are shipped, so there is nothing to license and nothing to download.

export type Track = {
  id: string;
  name: string;
  mood: string;
  bpm: number;
  swing: number; // 0..0.3, delays every second 16th
  chords: number[][]; // MIDI notes, one chord per bar
  drums: "lofi" | "bright" | "none";
  rain?: boolean;
  crackle?: boolean;
  cutoff: number; // Rhodes low-pass, Hz
};

export const TRACKS: Track[] = [
  {
    id: "morning",
    name: "Lo-fi Sabah",
    mood: "Sıcak, sakin",
    bpm: 76,
    swing: 0.18,
    chords: [
      [60, 64, 67, 71],
      [57, 60, 64, 67],
      [62, 65, 69, 72],
      [55, 59, 62, 65],
    ],
    drums: "lofi",
    crackle: true,
    cutoff: 1400,
  },
  {
    id: "night",
    name: "Gece Sürüşü",
    mood: "Hafif karanlık",
    bpm: 88,
    swing: 0.12,
    chords: [
      [57, 60, 64, 71],
      [53, 57, 60, 67],
      [60, 64, 67, 71],
      [55, 59, 62, 69],
    ],
    drums: "lofi",
    crackle: true,
    cutoff: 1100,
  },
  {
    id: "rain",
    name: "Yağmurlu Kafe",
    mood: "Rahat, yağmur sesli",
    bpm: 68,
    swing: 0.2,
    chords: [
      [62, 65, 69, 72],
      [55, 59, 65, 69],
      [60, 64, 67, 71],
      [57, 61, 64, 67],
    ],
    drums: "lofi",
    rain: true,
    crackle: true,
    cutoff: 1000,
  },
  {
    id: "intro",
    name: "Podcast Açılışı",
    mood: "Enerjik, parlak",
    bpm: 104,
    swing: 0.05,
    chords: [
      [60, 64, 67, 72],
      [65, 69, 72, 77],
      [57, 60, 64, 69],
      [67, 71, 74, 77],
    ],
    drums: "bright",
    cutoff: 2600,
  },
  {
    id: "pad",
    name: "Ambient Fon",
    mood: "Davulsuz, konuşma altı",
    bpm: 60,
    swing: 0,
    chords: [
      [48, 55, 64, 67],
      [45, 52, 60, 64],
      [53, 60, 65, 69],
      [43, 50, 59, 62],
    ],
    drums: "none",
    cutoff: 800,
  },
];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function noiseBuffer(
  ctx: AudioContext,
  seconds: number,
  kind: "white" | "crackle" | "rain",
) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    if (kind === "crackle")
      d[i] = Math.random() < 0.0006 ? (Math.random() * 2 - 1) * 0.9 : 0;
    else if (kind === "rain") {
      last = last * 0.92 + (Math.random() * 2 - 1) * 0.08;
      d[i] = last * 3;
    } else d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

export type MusicPlayer = {
  start(trackId: string): void;
  stop(): void;
  setVolume(v: number): void;
  readonly trackId: string | null;
};

/** Connects to `out` (the caller routes it to the recorder and the speakers). */
export function createMusicPlayer(
  ctx: AudioContext,
  out: AudioNode,
): MusicPlayer {
  const master = ctx.createGain();
  master.gain.value = 0.3;
  master.connect(out);
  const white = noiseBuffer(ctx, 1, "white");

  let timer: ReturnType<typeof setInterval> | null = null;
  let current: Track | null = null;
  let ambient: AudioNode[] = [];

  const env = (
    g: GainNode,
    t: number,
    peak: number,
    attack: number,
    release: number,
  ) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  };

  function rhodes(notes: number[], t: number, dur: number, cutoff: number) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = cutoff;
    lp.Q.value = 0.7;
    lp.connect(master);
    for (const [i, m] of notes.entries()) {
      for (const [type, detune, vol] of [
        ["sine", 0, 0.5],
        ["triangle", 6, 0.25],
      ] as const) {
        const o = ctx.createOscillator(),
          g = ctx.createGain();
        o.type = type;
        o.frequency.value = mtof(m);
        o.detune.value = detune + i * 2;
        o.connect(g);
        g.connect(lp);
        env(g, t, vol / notes.length, 0.02, dur);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
  }

  function bass(m: number, t: number, dur: number) {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = mtof(m - 12);
    o.connect(g);
    g.connect(master);
    env(g, t, 0.55, 0.015, dur);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  function kick(t: number, vol: number) {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(g);
    g.connect(master);
    env(g, t, vol, 0.002, 0.22);
    o.start(t);
    o.stop(t + 0.3);
  }

  function noiseHit(
    t: number,
    vol: number,
    dur: number,
    type: BiquadFilterType,
    freq: number,
  ) {
    const s = ctx.createBufferSource(),
      f = ctx.createBiquadFilter(),
      g = ctx.createGain();
    s.buffer = white;
    f.type = type;
    f.frequency.value = freq;
    s.connect(f);
    f.connect(g);
    g.connect(master);
    env(g, t, vol, 0.002, dur);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  function startAmbient(track: Track) {
    const loops: [AudioBuffer, number, BiquadFilterType, number][] = [];
    if (track.crackle)
      loops.push([noiseBuffer(ctx, 4, "crackle"), 0.16, "highpass", 1500]);
    if (track.rain)
      loops.push([noiseBuffer(ctx, 4, "rain"), 0.22, "lowpass", 3500]);
    for (const [buf, vol, type, freq] of loops) {
      const s = ctx.createBufferSource(),
        f = ctx.createBiquadFilter(),
        g = ctx.createGain();
      s.buffer = buf;
      s.loop = true;
      f.type = type;
      f.frequency.value = freq;
      g.gain.value = vol;
      s.connect(f);
      f.connect(g);
      g.connect(master);
      s.start();
      ambient.push(s, g);
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    current = null;
    for (const n of ambient) {
      try {
        (n as AudioBufferSourceNode).stop?.();
      } catch {
        /* already stopped */
      }
      n.disconnect();
    }
    ambient = [];
  }

  function start(trackId: string) {
    const track = TRACKS.find((x) => x.id === trackId);
    if (!track) return;
    stop();
    current = track;
    startAmbient(track);

    const step = 60 / track.bpm / 4; // 16th
    let n = 0;
    let next = ctx.currentTime + 0.1;
    timer = setInterval(() => {
      while (next < ctx.currentTime + 0.25) {
        const bar = Math.floor(n / 16) % track.chords.length;
        const k = n % 16;
        const t = next + (k % 2 === 1 ? step * track.swing : 0);
        const chord = track.chords[bar]!;
        const barLen = step * 16;
        if (k === 0) {
          rhodes(chord, t, barLen * 0.95, track.cutoff);
          bass(chord[0]!, t, barLen * 0.5);
        }
        if (k === 10 && track.drums !== "none") bass(chord[0]!, t, step * 3);
        if (track.drums === "lofi") {
          if (k === 0 || k === 7 || k === 10) kick(t, k === 0 ? 0.9 : 0.55);
          if (k === 4 || k === 12) noiseHit(t, 0.35, 0.14, "bandpass", 1800);
          if (k % 2 === 0) noiseHit(t, 0.1, 0.04, "highpass", 7000);
        } else if (track.drums === "bright") {
          if (k % 4 === 0) kick(t, 0.85);
          if (k === 4 || k === 12) noiseHit(t, 0.4, 0.15, "bandpass", 2200);
          noiseHit(t, k % 4 === 2 ? 0.16 : 0.07, 0.035, "highpass", 8000);
        }
        next += step;
        n++;
      }
    }, 40);
  }

  return {
    start,
    stop,
    setVolume: (v) => {
      master.gain.value = v;
    },
    get trackId() {
      return current?.id ?? null;
    },
  };
}
