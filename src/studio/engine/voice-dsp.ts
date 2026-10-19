// src/studio/engine/voice-dsp.ts
// Noise gate / downward expander as AudioWorklet source text. The same text is evaluated in unit
// tests (see voice.test.ts), so the DSP is verified without a browser audio stack.
// Block-based: RMS per 128-sample block -> envelope with attack/release -> hysteresis gate with
// hold -> smoothed gain that falls to `floor` (not to silence) when the gate is closed.

export const GATE_PROCESSOR_NAME = "tkd-voice-gate";

export const GATE_WORKLET_SOURCE = String.raw`
class GateDsp {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.env = 0;
    this.gain = 1;
    this.open = true;
    this.holdLeft = 0;
    this.threshold = 0.0025; // linear RMS (~ -52 dBFS)
    this.floor = 0.125;      // gain when closed (~ -18 dB)
    this.holdMs = 160;
    this.enabled = true;
    this.lastDb = -100;
  }
  configure(p) {
    if (typeof p.threshold === "number") this.threshold = Math.max(1e-5, p.threshold);
    if (typeof p.floor === "number") this.floor = Math.min(1, Math.max(0, p.floor));
    if (typeof p.holdMs === "number") this.holdMs = Math.max(0, p.holdMs);
    if (typeof p.enabled === "boolean") this.enabled = p.enabled;
  }
  // Processes one block in place; returns the block RMS.
  processBlock(channels) {
    const n = channels[0].length;
    let sum = 0, count = 0;
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      for (let i = 0; i < n; i++) { sum += ch[i] * ch[i]; count++; }
    }
    const rms = Math.sqrt(sum / Math.max(1, count));
    this.lastDb = rms > 1e-6 ? 20 * Math.log10(rms) : -100;
    const blockSec = n / this.sr;
    // envelope: fast attack (3 ms), slower release (60 ms)
    const k = rms > this.env ? 1 - Math.exp(-blockSec / 0.003) : 1 - Math.exp(-blockSec / 0.06);
    this.env += (rms - this.env) * k;

    let target = 1;
    if (this.enabled) {
      const closeAt = this.threshold * 0.7; // ~ -3 dB hysteresis
      if (this.env >= this.threshold) { this.open = true; this.holdLeft = this.holdMs / 1000; }
      else if (this.open) {
        this.holdLeft -= blockSec;
        if (this.env < closeAt && this.holdLeft <= 0) this.open = false;
      }
      target = this.open ? 1 : this.floor;
    } else {
      this.open = true;
    }
    // gain smoothing: open fast (4 ms), close slow (120 ms) so tails are not chopped
    const gk = target > this.gain ? 1 - Math.exp(-blockSec / 0.004) : 1 - Math.exp(-blockSec / 0.12);
    const g0 = this.gain;
    this.gain += (target - this.gain) * gk;
    const g1 = this.gain;
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      for (let i = 0; i < n; i++) ch[i] *= g0 + (g1 - g0) * (i / n);
    }
    return rms;
  }
}

class TkdVoiceGate extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dsp = new GateDsp(sampleRate);
    this.frames = 0;
    this.port.onmessage = (e) => this.dsp.configure(e.data || {});
  }
  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    if (!input || input.length === 0) return true;
    for (let c = 0; c < output.length; c++) output[c].set(input[Math.min(c, input.length - 1)]);
    this.dsp.processBlock(output);
    this.frames += output[0].length;
    if (this.frames >= sampleRate / 12) {
      this.frames = 0;
      this.port.postMessage({ open: this.dsp.open, db: this.dsp.lastDb });
    }
    return true;
  }
}
registerProcessor("${GATE_PROCESSOR_NAME}", TkdVoiceGate);
`;
