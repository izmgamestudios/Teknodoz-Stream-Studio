// src/studio/watch/audio-state.ts
// Editor state for the audio tools and its conversion to the edit API's `audio` spec.
export interface TrackState {
  key: number;
  mediaId: string;
  startMs: number;
  volumeDb: number;
  loop: boolean;
  duck: boolean;
  fadeMs: number;
}

export interface AudioState {
  voice: boolean;
  denoise: 0 | 1 | 2 | 3;
  highpassHz: number;
  humHz: 0 | 50 | 60;
  gate: boolean;
  compress: boolean;
  volumeDb: number;
  tracks: TrackState[];
}

export const DEFAULT_AUDIO: AudioState = {
  voice: false,
  denoise: 0,
  highpassHz: 0,
  humHz: 0,
  gate: false,
  compress: false,
  volumeDb: 0,
  tracks: [],
};

export const MAX_TRACKS = 4;

let nextKey = 1;

export function newTrack(mediaId: string, startMs = 0): TrackState {
  return {
    key: nextKey++,
    mediaId,
    startMs,
    volumeDb: -12,
    loop: false,
    duck: true,
    fadeMs: 0,
  };
}

export function audioActive(a: AudioState): boolean {
  return (
    a.voice ||
    a.denoise > 0 ||
    a.highpassHz > 0 ||
    a.humHz > 0 ||
    a.gate ||
    a.compress ||
    a.volumeDb !== 0 ||
    a.tracks.length > 0
  );
}

export interface AudioSpecWire {
  voice: boolean;
  denoise: number;
  highpassHz: number;
  humHz: number;
  gate: boolean;
  compress: boolean;
  volumeDb: number;
  tracks: {
    mediaId: string;
    startMs: number;
    volumeDb: number;
    loop: boolean;
    duck: boolean;
    fadeMs: number;
  }[];
}

/** `undefined` when nothing is switched on, so plain edits stay plain. */
export function toAudioSpec(a: AudioState): AudioSpecWire | undefined {
  if (!audioActive(a)) return undefined;
  return {
    voice: a.voice,
    denoise: a.denoise,
    highpassHz: a.highpassHz,
    humHz: a.humHz,
    gate: a.gate,
    compress: a.compress,
    volumeDb: Math.round(a.volumeDb * 10) / 10,
    tracks: a.tracks.map(({ key: _key, ...t }) => ({
      ...t,
      startMs: Math.round(t.startMs),
    })),
  };
}

/** One-click settings for common situations. */
export const AUDIO_PRESETS: Record<
  "speech" | "noisy" | "hum",
  Partial<AudioState>
> = {
  speech: { voice: true, denoise: 1, compress: true },
  noisy: {
    voice: true,
    denoise: 3,
    highpassHz: 100,
    gate: true,
    compress: true,
  },
  hum: { humHz: 50, highpassHz: 80, denoise: 1 },
};
