import { describe, expect, it } from "vitest";

import {
  interleaveToInt16,
  WAV_HEADER_BYTES,
  wavHeader,
  WavAccumulator,
} from "./wav";

describe("interleaveToInt16", () => {
  it("scales, clamps and interleaves; mono is duplicated; NaN becomes silence", () => {
    const out = interleaveToInt16(
      new Float32Array([0, 1, -1, 2, -3, Number.NaN]),
      null,
    );
    expect([...out]).toEqual([
      0, 0, 32767, 32767, -32768, -32768, 32767, 32767, -32768, -32768, 0, 0,
    ]);
    const st = interleaveToInt16(
      new Float32Array([0.5]),
      new Float32Array([-0.5]),
    );
    expect([...st]).toEqual([16384, -16384]);
  });
});

describe("wavHeader", () => {
  it("is a valid 44-byte PCM header", () => {
    const h = wavHeader(1000, 48000);
    const v = new DataView(h.buffer);
    const txt = (o: number) => String.fromCharCode(...h.slice(o, o + 4));
    expect(h.length).toBe(WAV_HEADER_BYTES);
    expect([txt(0), txt(8), txt(12), txt(36)]).toEqual([
      "RIFF",
      "WAVE",
      "fmt ",
      "data",
    ]);
    expect(v.getUint32(4, true)).toBe(1036);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(28, true)).toBe(192000);
    expect(v.getUint16(32, true)).toBe(4);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(1000);
  });
});

describe("WavAccumulator", () => {
  it("builds a playable file: header + every sample, in order", async () => {
    const acc = new WavAccumulator(48000, 16);
    for (let i = 0; i < 5; i++)
      acc.push(
        new Float32Array(100).fill(i / 10),
        new Float32Array(100).fill(-i / 10),
      );
    expect(acc.dataBytes).toBe(5 * 100 * 4);
    expect(acc.durationMs).toBe(Math.round((500 / 48000) * 1000));
    const blob = acc.finish();
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + 2000);
    const bytes = new Uint8Array(
      await new Promise<ArrayBuffer>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as ArrayBuffer);
        r.onerror = () => reject(r.error);
        r.readAsArrayBuffer(blob);
      }),
    );
    const v = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(v.getUint32(40, true)).toBe(2000);
    // chunk 2: left 0.2 -> 6553 (x32767), right -0.2 -> -6554 (x32768)
    const at = 44 + 2 * 400;
    expect(v.getInt16(at, true)).toBe(6553);
    expect(v.getInt16(at + 2, true)).toBe(-6554);
    expect(acc.dataBytes).toBe(0);
  });
});
