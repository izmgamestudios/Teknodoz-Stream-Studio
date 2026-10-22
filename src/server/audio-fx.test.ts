// src/server/audio-fx.test.ts
import { describe, expect, it } from "vitest";

import {
  audioGraph,
  audioSchema,
  cleanupChain,
  hasAudioWork,
} from "./audio-fx";

const A = (o: Record<string, unknown> = {}) => audioSchema.parse(o);
const ID = "0123456789abcdef";

describe("audio spec", () => {
  it("defaults to no work and validates ranges", () => {
    expect(hasAudioWork(A())).toBe(false);
    expect(hasAudioWork(A({ gate: true }))).toBe(true);
    expect(audioSchema.safeParse({ humHz: 55 }).success).toBe(false);
    expect(audioSchema.safeParse({ highpassHz: 10 }).success).toBe(false);
    expect(audioSchema.safeParse({ denoise: 4 }).success).toBe(false);
    expect(
      audioSchema.safeParse({ tracks: Array(5).fill({ mediaId: ID }) }).success,
    ).toBe(false);
  });
});

describe("cleanupChain", () => {
  it("orders rumble, hum, noise, gate, voice, compressor, gain", () => {
    const c = cleanupChain(
      A({
        highpassHz: 100,
        humHz: 50,
        denoise: 2,
        gate: true,
        voice: true,
        volumeDb: 3,
      }),
    );
    expect(c[0]).toBe("highpass=f=100");
    expect(
      c.filter((x) => x.startsWith("bandreject")).map((x) => x.split(":")[0]),
    ).toEqual(["bandreject=f=50", "bandreject=f=100", "bandreject=f=150"]);
    const names = c.map((x) => x.split("=")[0]);
    expect(names.indexOf("afftdn")).toBeLessThan(names.indexOf("agate"));
    expect(names.indexOf("agate")).toBeLessThan(names.indexOf("acompressor"));
    expect(c[c.length - 1]).toBe("volume=3dB");
  });

  it("voice mode implies a high-pass and mild denoise", () => {
    const c = cleanupChain(A({ voice: true }));
    expect(c).toContain("highpass=f=80");
    expect(c.some((x) => x.startsWith("afftdn=nr=14"))).toBe(true);
  });
});

describe("audioGraph", () => {
  const base = {
    inLabel: "[ac]",
    outLabel: "[af]",
    fmt: "aresample=48000",
    trackInputs: [] as number[],
  };

  it("without tracks it is one serial chain ending in the fades", () => {
    const g = audioGraph({
      ...base,
      audio: A({ denoise: 1 }),
      post: ["afade=t=in:st=0:d=1.000"],
    });
    expect(g).toEqual([
      "[ac]afftdn=nr=10:nf=-40:tn=1,afade=t=in:st=0:d=1.000[af]",
    ]);
    expect(audioGraph({ ...base, audio: undefined, post: [] })).toEqual([
      "[ac]anull[af]",
    ]);
  });

  it("mixes tracks, delays them and ducks with a sidechain copy of the main audio", () => {
    const g = audioGraph({
      ...base,
      audio: A({
        tracks: [
          {
            mediaId: ID,
            startMs: 2000,
            volumeDb: -15,
            duck: true,
            fadeMs: 500,
          },
          { mediaId: ID, volumeDb: -6 },
        ],
      }),
      trackInputs: [3, 4],
      post: ["loudnorm=I=-16"],
    });
    const s = g.join(";");
    expect(s).toContain("[ac]anull,asplit=2[mx0][mx1]");
    expect(s).toContain(
      "[3:a:0]aresample=48000,afade=t=in:st=0:d=0.500,volume=-15dB,adelay=2000:all=1[tk0]",
    );
    expect(s).toContain("[tk0][mx1]sidechaincompress=");
    expect(s).toContain("[4:a:0]aresample=48000,volume=-6dB[tk1]");
    expect(s).toContain(
      "[mx0][td0][tk1]amix=inputs=3:duration=first:normalize=0",
    );
    expect(s.endsWith("loudnorm=I=-16[af]")).toBe(true);
  });
});
