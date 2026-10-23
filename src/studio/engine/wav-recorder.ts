// src/studio/engine/wav-recorder.ts
// Lossless audio capture of a MediaStream (the studio's final mix) as 48 kHz 16-bit stereo WAV,
// recorded next to the video so the audio can be mastered or published as a podcast without
// re-encoding. MediaRecorder cannot write WAV, so samples are tapped with an AudioWorklet
// (ScriptProcessor where worklets are missing) and packed by `WavAccumulator`.
import { WavAccumulator } from "./wav";

const PROCESSOR = `
class TkzWavTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.l = new Float32Array(4096);
    this.r = new Float32Array(4096);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === "flush") { this.flush(); this.port.postMessage({ done: true }); }
    };
  }
  flush() {
    if (!this.n) return;
    this.port.postMessage({ l: this.l.slice(0, this.n), r: this.r.slice(0, this.n) });
    this.n = 0;
  }
  process(inputs) {
    const i = inputs[0];
    if (!i || !i[0]) return true;
    const l = i[0], r = i[1] || i[0];
    for (let k = 0; k < l.length; k++) {
      this.l[this.n] = l[k]; this.r[this.n] = r[k];
      if (++this.n === 4096) this.flush();
    }
    return true;
  }
}
registerProcessor("tkz-wav-tap", TkzWavTap);
`;

export interface WavResult {
  blob: Blob;
  durationMs: number;
  sampleRate: number;
}

export class WavRecorder {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioNode | null = null;
  private sink: GainNode | null = null;
  private acc: WavAccumulator | null = null;
  private full = false;

  get active(): boolean {
    return this.ctx !== null;
  }

  /** True once the 4 GiB limit stopped the capture. */
  get hitLimit(): boolean {
    return this.full;
  }

  async start(stream: MediaStream): Promise<void> {
    if (this.ctx) return;
    const Ctx = globalThis.AudioContext;
    if (!Ctx) throw new Error("unsupported");
    const ctx = new Ctx({ sampleRate: 48_000, latencyHint: "playback" });
    this.ctx = ctx;
    await ctx.resume().catch(() => undefined);
    const acc = new WavAccumulator(ctx.sampleRate);
    this.acc = acc;
    const push = (l: Float32Array, r: Float32Array | null) => {
      if (!acc.push(l, r)) this.full = true;
    };
    this.source = ctx.createMediaStreamSource(stream);
    // the graph must reach the destination or the browser stops pulling; the sink is silent
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(ctx.destination);

    let tap: AudioNode | null = null;
    if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        const url = URL.createObjectURL(
          new Blob([PROCESSOR], { type: "application/javascript" }),
        );
        try {
          await ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const w = new AudioWorkletNode(ctx, "tkz-wav-tap", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 2,
          channelCountMode: "explicit",
          outputChannelCount: [2],
        });
        w.port.onmessage = (e: MessageEvent) => {
          const d = e.data as { l?: Float32Array; r?: Float32Array };
          if (d.l && d.r) push(d.l, d.r);
        };
        tap = w;
      } catch {
        tap = null;
      }
    }
    if (!tap) {
      // deprecated but universal fallback
      const sp = ctx.createScriptProcessor(4096, 2, 2);
      sp.onaudioprocess = (e) => {
        const l = e.inputBuffer.getChannelData(0).slice();
        const r =
          e.inputBuffer.numberOfChannels > 1
            ? e.inputBuffer.getChannelData(1).slice()
            : null;
        push(l, r);
      };
      tap = sp;
    }
    this.node = tap;
    this.source.connect(tap);
    tap.connect(this.sink);
  }

  /** Stops, flushes what the worklet still holds and returns the WAV (null when never started). */
  async stop(): Promise<WavResult | null> {
    const ctx = this.ctx;
    const acc = this.acc;
    if (!ctx || !acc) return null;
    const node = this.node;
    if (node && "port" in node) {
      const port = (node as AudioWorkletNode).port;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 600);
        const prev = port.onmessage;
        port.onmessage = (e: MessageEvent) => {
          prev?.call(port, e);
          if ((e.data as { done?: boolean }).done) {
            clearTimeout(timer);
            resolve();
          }
        };
        port.postMessage("flush");
      });
    }
    const sampleRate = ctx.sampleRate;
    const durationMs = acc.durationMs;
    this.teardown();
    return { blob: acc.finish(), durationMs, sampleRate };
  }

  private teardown(): void {
    try {
      this.source?.disconnect();
      this.node?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* already disconnected */
    }
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.source = null;
    this.node = null;
    this.sink = null;
  }

  dispose(): void {
    this.teardown();
    this.acc = null;
  }
}
