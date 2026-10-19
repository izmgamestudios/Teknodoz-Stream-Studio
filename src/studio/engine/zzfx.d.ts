// src/lib/studio/zzfx.d.ts
declare module "zzfx" {
  export const ZZFX: {
    sampleRate: number;
    buildSamples: (...params: (number | undefined)[]) => number[];
  };
}
