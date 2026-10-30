// Nova's voice over the speech API, played well: a continuous player with a jitter buffer (the
// stream comes as 20 ms pieces over a WebSocket, so it needs a cushion the way WebRTC has one),
// and smooth volume changes. The face's 24 -> 16 kHz resampler is the kit's (src/avatar/pcm.ts).

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
