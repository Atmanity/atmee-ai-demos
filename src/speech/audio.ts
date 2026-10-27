// Audio for a speech session. The API hears mono PCM16 at 24 kHz, sent in
// 20 ms frames without a break (silence included: its turn-taking runs on
// the audio clock), and speaks the same format back, paced in real time,
// silence included. Here both run in AudioWorklets of one AudioContext at the
// device's own rate: the microphone is resampled down to 24 kHz frames, and
// the avatar's voice is played through a small jitter buffer and resampled
// up. No browser has to support a 24 kHz context.
//
// The two classes below are plain code the worklets run (their source is
// sent to the worklet as text), so they hold no reference to anything else.

/** The API's sample rate, both ways. */
export const RATE = 24_000;
/** Samples in one 20 ms frame at 24 kHz. */
export const FRAME = 480;

/**
 * Float blocks at `inRate` in, 16-bit frames of `frame` samples at `outRate`
 * out: low-passed below the new Nyquist rate, then linearly interpolated.
 */
export class Downsampler {
  // Fields are declared, never initialised in place: a build that lowers class
  // fields would call a helper the worklet does not have.
  declare step: number;
  declare frame: number;
  declare t: number;
  declare prev: number;
  declare out: Int16Array;
  declare n: number;
  declare lowpass: boolean;
  declare b0: number; declare b1: number; declare b2: number; declare a1: number; declare a2: number;
  declare x1: number; declare x2: number; declare y1: number; declare y2: number;

  constructor(inRate: number, outRate: number, frame: number) {
    this.step = inRate / outRate;
    this.frame = frame;
    this.t = 0;
    this.prev = 0;
    this.out = new Int16Array(frame);
    this.n = 0;
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
    this.lowpass = this.step > 1.01;
    if (this.lowpass) {
      // A Butterworth low-pass (RBJ biquad) at 45% of the new rate.
      const w0 = (2 * Math.PI * 0.45 * outRate) / inRate;
      const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
      const cos = Math.cos(w0);
      const a0 = 1 + alpha;
      this.b0 = (1 - cos) / 2 / a0;
      this.b1 = (1 - cos) / a0;
      this.b2 = (1 - cos) / 2 / a0;
      this.a1 = (-2 * cos) / a0;
      this.a2 = (1 - alpha) / a0;
    }
  }

  /** Takes one block; calls `emit` with each frame it completes (a new array each time). */
  push(input: Float32Array, emit: (frame: Int16Array) => void): void {
    const len = input.length;
    if (!len) return;
    let x = input;
    if (this.lowpass) {
      x = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const v = input[i];
        const y = this.b0 * v + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1; this.x1 = v; this.y2 = this.y1; this.y1 = y;
        x[i] = y;
      }
    }
    // Output sample k sits at input position t; x(-1) is the last sample of the block before.
    while (this.t < len - 1) {
      const i = Math.floor(this.t);
      const f = this.t - i;
      const a = i < 0 ? this.prev : x[i];
      const s = a + (x[i + 1] - a) * f;
      const c = s > 1 ? 1 : s < -1 ? -1 : s;
      this.out[this.n++] = c < 0 ? Math.round(c * 0x8000) : Math.round(c * 0x7fff);
      if (this.n === this.frame) {
        emit(this.out);
        this.out = new Int16Array(this.frame);
        this.n = 0;
      }
      this.t += this.step;
    }
    this.t -= len;
    this.prev = x[len - 1];
  }
}

/**
 * The avatar's voice between the socket and the speaker: 16-bit samples at
 * `inRate` in, floats at `outRate` out. It plays once `prime` samples are
 * queued, goes quiet and primes again when it runs dry, and drops the oldest
 * audio when more than `max` samples wait, so the voice never lags far
 * behind what the server sent. `flush` drops everything queued (the user cut in).
 */
export class JitterBuffer {
  declare step: number;
  declare prime: number;
  declare max: number;
  declare buf: Float32Array;
  declare head: number;
  declare size: number;
  declare frac: number;
  declare priming: boolean;
  declare underruns: number;
  declare dropped: number;

  constructor(inRate: number, outRate: number, prime: number, max: number) {
    this.step = inRate / outRate;
    this.prime = Math.max(2, prime);
    this.max = Math.max(this.prime * 2, max);
    this.buf = new Float32Array(Math.ceil(this.max * 1.5) + 4096);
    this.head = 0;
    this.size = 0;
    this.frac = 0;
    this.priming = true;
    this.underruns = 0;
    this.dropped = 0;
  }

  get queued(): number { return this.size; }

  push(pcm: Int16Array): void {
    const cap = this.buf.length;
    for (let i = 0; i < pcm.length; i++) {
      if (this.size === cap) { this.head = (this.head + 1) % cap; this.size--; this.dropped++; }
      this.buf[(this.head + this.size) % cap] = pcm[i] / 32768;
      this.size++;
    }
    if (this.size > this.max) {
      // Too far behind: keep the newest, at the primed depth.
      const drop = this.size - this.prime;
      this.head = (this.head + drop) % cap;
      this.size -= drop;
      this.dropped += drop;
      this.frac = 0;
    }
  }

  /** Fills `out` with what plays next; returns the block's RMS. */
  pull(out: Float32Array): number {
    const cap = this.buf.length;
    let sum = 0;
    for (let k = 0; k < out.length; k++) {
      if (this.priming) {
        if (this.size < this.prime) { out[k] = 0; continue; }
        this.priming = false;
      }
      if (this.size < 2) {
        this.priming = true;
        this.underruns++;
        out[k] = 0;
        continue;
      }
      const a = this.buf[this.head];
      const b = this.buf[(this.head + 1) % cap];
      const s = a + (b - a) * this.frac;
      out[k] = s;
      sum += s * s;
      this.frac += this.step;
      while (this.frac >= 1) {
        this.frac -= 1;
        this.head = (this.head + 1) % cap;
        this.size--;
      }
    }
    return Math.sqrt(sum / Math.max(1, out.length));
  }

  flush(): void {
    this.head = 0;
    this.size = 0;
    this.frac = 0;
    this.priming = true;
  }
}

// The worklets: each class goes in as an expression, so its name in a minified
// build does not matter. A level goes to the page about every 20 ms.
const CAPTURE_WORKLET = `const Downsampler = (${Downsampler.toString()});
registerProcessor('atmee-speech-capture', class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.ds = new Downsampler(sampleRate, o.rate, o.frame);
    this.sum = 0; this.count = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) this.sum += ch[i] * ch[i];
      this.count += ch.length;
      this.ds.push(ch, (frame) => this.port.postMessage({ frame }, [frame.buffer]));
      if (this.count >= sampleRate / 50) {
        this.port.postMessage({ level: Math.sqrt(this.sum / this.count) });
        this.sum = 0; this.count = 0;
      }
    }
    return true;
  }
});`;

const PLAYBACK_WORKLET = `const JitterBuffer = (${JitterBuffer.toString()});
registerProcessor('atmee-speech-playback', class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.jb = new JitterBuffer(o.rate, sampleRate, o.prime, o.max);
    this.sum = 0; this.count = 0;
    this.port.onmessage = (e) => {
      if (e.data.pcm) this.jb.push(e.data.pcm);
      else if (e.data.flush) this.jb.flush();
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    const rms = this.jb.pull(out);
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    this.sum += rms * rms * out.length; this.count += out.length;
    if (this.count >= sampleRate / 50) {
      this.port.postMessage({ level: Math.sqrt(this.sum / this.count), queued: this.jb.queued });
      this.sum = 0; this.count = 0;
    }
    return true;
  }
});`;

async function addWorklet(context: AudioContext, source: string) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
}

export class MicError extends Error {
  constructor(readonly code: 'mic_blocked' | 'no_mic') { super(code); }
}

/** The microphone and the speaker of one call. */
export interface SpeechAudio {
  /** Each 20 ms frame of the microphone at 24 kHz goes here once set. */
  onFrame: ((frame: Int16Array) => void) | null;
  /** Queues the avatar's audio to play. */
  play(pcm: Int16Array): void;
  /** Drops what is queued: the user cut in. */
  flush(): void;
  /** The avatar's voice as it plays now, 0..1 (RMS). */
  readonly level: number;
  /** The microphone's level now, 0..1 (RMS). */
  readonly micLevel: number;
  /** Milliseconds of the avatar's audio queued to play. */
  readonly queuedMs: number;
  /** The browser holds the sound until a tap (autoplay): resume() after one. */
  readonly suspended: boolean;
  resume(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Asks for the microphone (audio only: never the camera) and sets up both
 * worklets. Call it from the click that starts the call, so the context may
 * play sound at once.
 */
export async function openSpeechAudio({ primeMs = 100, maxMs = 600 }: { primeMs?: number; maxMs?: number } = {}): Promise<SpeechAudio> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (err) {
    throw new MicError((err as Error).name === 'NotAllowedError' ? 'mic_blocked' : 'no_mic');
  }
  const context = new AudioContext({ latencyHint: 'interactive' });
  try {
    await Promise.all([addWorklet(context, CAPTURE_WORKLET), addWorklet(context, PLAYBACK_WORKLET)]);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    await context.close();
    throw err;
  }
  const source = context.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(context, 'atmee-speech-capture', {
    numberOfInputs: 1, numberOfOutputs: 0, processorOptions: { rate: RATE, frame: FRAME },
  });
  const playback = new AudioWorkletNode(context, 'atmee-speech-playback', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
    processorOptions: { rate: RATE, prime: Math.round((RATE * primeMs) / 1000), max: Math.round((RATE * maxMs) / 1000) },
  });
  source.connect(capture);
  playback.connect(context.destination);

  let level = 0;
  let micLevel = 0;
  let queued = 0;
  const audio: SpeechAudio = {
    onFrame: null,
    play(pcm) { playback.port.postMessage({ pcm }, [pcm.buffer]); },
    flush() { playback.port.postMessage({ flush: true }); queued = 0; },
    get level() { return level; },
    get micLevel() { return micLevel; },
    get queuedMs() { return (queued / RATE) * 1000; },
    get suspended() { return context.state === 'suspended'; },
    async resume() { await context.resume(); },
    async close() {
      capture.port.onmessage = null;
      playback.port.onmessage = null;
      source.disconnect();
      capture.disconnect();
      playback.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      if (context.state !== 'closed') await context.close();
    },
  };
  capture.port.onmessage = (e: MessageEvent<{ frame?: Int16Array; level?: number }>) => {
    if (e.data.frame) audio.onFrame?.(e.data.frame);
    else if (e.data.level !== undefined) micLevel = e.data.level;
  };
  playback.port.onmessage = (e: MessageEvent<{ level: number; queued: number }>) => {
    level = e.data.level;
    queued = e.data.queued;
  };
  if (context.state === 'suspended') await context.resume().catch(() => {});
  return audio;
}
