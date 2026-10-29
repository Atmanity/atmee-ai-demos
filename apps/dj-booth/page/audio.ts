// Nova's voice over the speech API, played well: a continuous player with a jitter buffer (the
// stream comes as 20 ms pieces over a WebSocket, so it needs a cushion the way WebRTC has one),
// smooth volume changes, and a proper 24 -> 16 kHz resampler for the face (which takes 16 kHz).

/**
 * 24 kHz PCM to 16 kHz, without aliasing: up by 2 to 48 kHz, a windowed-sinc low-pass below the
 * new Nyquist (8 kHz), down by 3. Kept across calls, so a stream of pieces resamples as one.
 */
export class Resampler24to16 {
  private static readonly TAPS = Resampler24to16.design(96, 7_400 / 48_000);
  /** The last input samples at 48 kHz (zero-stuffed), for the filter's memory across pieces. */
  private history = new Float32Array(Resampler24to16.TAPS.length - 1);
  /** Where the next output sample falls in the 48 kHz stream, relative to the next piece. */
  private phase = 0;

  /** A Blackman-windowed sinc low-pass, `n` taps, cutoff as a fraction of the sample rate. */
  private static design(n: number, cutoff: number): Float32Array {
    const taps = new Float32Array(n);
    const mid = (n - 1) / 2;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = i - mid;
      const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
      taps[i] = sinc * w;
      sum += taps[i];
    }
    // Unity gain at DC; the zero-stuffing halves the level, so the filter doubles it back.
    for (let i = 0; i < n; i++) taps[i] = (taps[i] / sum) * 2;
    return taps;
  }

  push(pcm: Int16Array): Int16Array {
    const taps = Resampler24to16.TAPS;
    const h = this.history.length;
    // The piece at 48 kHz (every other sample zero), after the remembered tail.
    const up = new Float32Array(h + pcm.length * 2);
    up.set(this.history);
    for (let i = 0; i < pcm.length; i++) up[h + i * 2] = pcm[i] / 0x8000;
    const out: number[] = [];
    let at = this.phase;
    for (; at + h < up.length; at += 3) {
      let acc = 0;
      // Only every other input is nonzero (those an even distance after the history): skip the zeros.
      for (let k = ((at % 2) + 2) % 2; k < taps.length; k += 2) acc += taps[k] * up[at + h - k];
      out.push(acc);
    }
    this.phase = at + h - up.length;
    this.history = up.slice(up.length - h);
    const pcm16 = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) {
      const s = Math.max(-1, Math.min(1, out[i]));
      pcm16[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    }
    return pcm16;
  }
}

/** The jitter buffer's cushion: how much is held before playing, and before resuming after running dry. */
export const START_MS = 200;
export const RESUME_MS = 120;
/** Each time it runs dry the cushion grows by this much, up to MAX_CUSHION_MS (the network is jittery). */
export const GROW_MS = 100;
export const MAX_CUSHION_MS = 600;
/** Past this much held, silent pieces are skipped to come back to the cushion (the two clocks drift). */
export const DRIFT_MS = 500;

// The player: a ring buffer in an AudioWorklet, played sample by sample. It waits for a cushion,
// fades out instead of clicking when it runs dry, ramps the volume, and reports how much it holds.
const WORKLET = `
class Voice extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(sampleRate * 20); this.read = 0; this.write = 0; this.held = 0;
    this.playing = false; this.gain = 1; this.target = 1; this.step = 1 / (sampleRate * 0.03);
    this.start = Math.round(sampleRate * ${START_MS} / 1000); this.resume = Math.round(sampleRate * ${RESUME_MS} / 1000);
    this.last = 0; this.tick = 0; this.dropouts = 0;
    this.grow = Math.round(sampleRate * ${GROW_MS} / 1000); this.max = Math.round(sampleRate * ${MAX_CUSHION_MS} / 1000);
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.pcm) { const p = d.pcm; for (let i = 0; i < p.length && this.held < this.buf.length; i++) { this.buf[this.write] = p[i]; this.write = (this.write + 1) % this.buf.length; this.held++; } }
      if (typeof d.gain === 'number') this.target = d.gain;
      if (d.flush) { this.read = this.write; this.held = 0; this.playing = false; }
    };
  }
  process(_, outputs) {
    const out = outputs[0][0];
    if (!this.playing && this.held >= (this.read === 0 && this.write <= this.start ? this.start : this.resume)) this.playing = true;
    for (let i = 0; i < out.length; i++) {
      if (this.gain < this.target) this.gain = Math.min(this.target, this.gain + this.step);
      else if (this.gain > this.target) this.gain = Math.max(this.target, this.gain - this.step);
      let s = 0;
      if (this.playing && this.held > 0) {
        s = this.buf[this.read]; this.read = (this.read + 1) % this.buf.length; this.held--; this.last = s;
      } else {
        // Ran dry: fade the last sample out rather than drop to zero, then wait for a bigger cushion,
        // as WebRTC's jitter buffer grows on a jittery network.
        if (this.playing) { this.dropouts++; this.resume = Math.min(this.max, this.resume + this.grow); }
        this.playing = false; this.last *= 0.995; s = this.last;
      }
      out[i] = s * this.gain;
    }
    if (++this.tick % 30 === 0) this.port.postMessage({ heldMs: (this.held / sampleRate) * 1000, dropouts: this.dropouts, cushionMs: (this.resume / sampleRate) * 1000 });
    return true;
  }
}
registerProcessor('nova-voice', Voice);`;

export interface VoicePlayer {
  /** A piece of 24 kHz PCM, in order. Silent pieces may be skipped when the cushion has grown. */
  push(pcm: Int16Array, silent: boolean): void;
  setGain(gain: number): void;
  /** Drops what is held (her words were cut). */
  flush(): void;
  close(): Promise<void>;
}

/** The player, in an audio context of its own at the voice's rate (the browser resamples to the device). */
export async function createVoicePlayer(context: AudioContext): Promise<VoicePlayer> {
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  const node = new AudioWorkletNode(context, 'nova-voice', { outputChannelCount: [1] });
  node.connect(context.destination);
  let heldMs = 0;
  let gain = 1;
  let stats = { dropouts: 0, cushionMs: RESUME_MS };
  node.port.onmessage = (e: MessageEvent<{ heldMs: number; dropouts: number; cushionMs: number }>) => {
    heldMs = e.data.heldMs;
    stats = { dropouts: e.data.dropouts, cushionMs: Math.round(e.data.cushionMs) };
  };
  // What the listener's network does to her voice, for anyone comparing it with the full-stack call.
  const report = setInterval(() => console.info('[speech] voice: %d dropouts, cushion %d ms, held %d ms', stats.dropouts, stats.cushionMs, Math.round(heldMs)), 10_000);
  return {
    push(pcm, silent) {
      if (silent && heldMs > DRIFT_MS) return;
      const f = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 0x8000;
      node.port.postMessage({ pcm: f }, [f.buffer]);
    },
    setGain(g) {
      if (g === gain) return;
      gain = g;
      node.port.postMessage({ gain: g });
    },
    flush() { node.port.postMessage({ flush: true }); },
    async close() { clearInterval(report); node.disconnect(); },
  };
}
