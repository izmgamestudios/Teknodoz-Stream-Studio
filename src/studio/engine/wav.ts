// src/studio/engine/wav.ts
// Pure WAV (RIFF/PCM 16-bit) helpers. Audio is kept as a list of Blob parts so a long recording
// does not sit in one giant ArrayBuffer: the browser may keep big blobs on disk.

export const WAV_HEADER_BYTES = 44;
/** RIFF sizes are 32-bit: stop before 4 GiB of PCM. */
export const WAV_MAX_DATA_BYTES = 0xffff_ffff - 1024;

/** Float samples (-1..1) -> 16-bit PCM, interleaved L R L R… (mono is duplicated). */
export function interleaveToInt16(
  left: Float32Array,
  right: Float32Array | null,
): Int16Array {
  const n = left.length;
  const out = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    const l = left[i] as number;
    const r = right ? (right[i] as number) : l;
    out[2 * i] = toInt16(l);
    out[2 * i + 1] = toInt16(r);
  }
  return out;
}

function toInt16(x: number): number {
  const v = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
  return v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
}

/** The 44-byte header of a PCM WAV with `dataBytes` of samples. */
export function wavHeader(
  dataBytes: number,
  sampleRate: number,
  channels = 2,
  bits = 16,
): Uint8Array {
  const buf = new ArrayBuffer(WAV_HEADER_BYTES);
  const v = new DataView(buf);
  const ascii = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  const block = (channels * bits) / 8;
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * block, true);
  v.setUint16(32, block, true);
  v.setUint16(34, bits, true);
  ascii(36, "data");
  v.setUint32(40, dataBytes, true);
  return new Uint8Array(buf);
}

/** Collects PCM chunks and builds the final WAV blob. */
export class WavAccumulator {
  private parts: Blob[] = [];
  private pending: Int16Array[] = [];
  private pendingBytes = 0;
  private bytes = 0;

  constructor(
    readonly sampleRate: number,
    /** flush pending chunks into one Blob once this many bytes are waiting */
    private readonly flushBytes = 1 << 20,
  ) {}

  /** false once the 4 GiB limit is reached (the chunk is dropped). */
  push(left: Float32Array, right: Float32Array | null): boolean {
    const pcm = interleaveToInt16(left, right);
    if (this.bytes + pcm.byteLength > WAV_MAX_DATA_BYTES) return false;
    this.pending.push(pcm);
    this.pendingBytes += pcm.byteLength;
    this.bytes += pcm.byteLength;
    if (this.pendingBytes >= this.flushBytes) this.flush();
    return true;
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    this.parts.push(new Blob(this.pending as BlobPart[]));
    this.pending = [];
    this.pendingBytes = 0;
  }

  get dataBytes(): number {
    return this.bytes;
  }

  get durationMs(): number {
    return Math.round((this.bytes / 4 / this.sampleRate) * 1000);
  }

  /** The WAV file; the accumulator is empty afterwards. */
  finish(): Blob {
    this.flush();
    const header = wavHeader(this.bytes, this.sampleRate);
    const blob = new Blob([header as BlobPart, ...this.parts], {
      type: "audio/wav",
    });
    this.parts = [];
    this.bytes = 0;
    return blob;
  }
}
