// Audio for a speech session. The API hears mono PCM16 at 24 kHz, sent in
// 20 ms frames without a break (silence included: its turn-taking runs on
// the audio clock), and speaks the same format back: paced in real time,
// silence included, or, with playback control, each reply as fast as the
// voice makes it, for the page to hold and acknowledge. The microphone runs
// in an AudioWorklet at the device's own rate, resampled down to 24 kHz
// frames. The voice plays in a context of its own at 24 kHz, so the browser
// resamples it to the speaker; where a browser will not give one, it plays at
// the device's rate through the jitter buffer, resampled up, and the session
// stays paced.
//
// The classes below are plain code the worklets run (their source is sent to
// the worklet as text), so they hold no reference to anything else.

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

/** What the delivery player tells the server, through the page: a delivery began to play, or is over. */
export type PlaybackReport =
  | { started: number }
  | { finished: number; played: number; interrupted: boolean };

/**
 * The avatar's voice with playback control: the server sends each reply (a
 * delivery) as fast as the voice makes it, and this plays it at the voice's
 * own rate (the context runs at 24 kHz), holding all of it however far ahead
 * it came. It waits for a cushion before it plays, fades out instead of
 * clicking when it runs dry and then waits for a bigger cushion, and reports
 * when a delivery began to play and, once it played out or was cleared, how
 * many of its samples played. One delivery plays at a time: the server opens
 * the next only once this one is reported finished.
 */
export class DeliveryBuffer {
  declare buf: Float32Array;
  declare head: number;
  declare size: number;
  declare id: number;
  declare played: number;
  declare ended: boolean;
  declare started: boolean;
  declare playing: boolean;
  declare prime: number;
  declare grow: number;
  declare max: number;
  declare cushion: number;
  declare last: number;
  declare ramp: number;
  declare underruns: number;
  declare doneId: number;
  declare donePlayed: number;
  declare reports: PlaybackReport[];

  constructor(prime: number, grow: number, max: number) {
    this.buf = new Float32Array(1 << 18);
    this.head = 0;
    this.size = 0;
    this.id = -1;
    this.played = 0;
    this.ended = false;
    this.started = false;
    this.playing = false;
    this.prime = prime;
    this.grow = grow;
    this.max = max;
    this.cushion = prime;
    this.last = 0;
    this.ramp = 0;
    this.underruns = 0;
    this.doneId = -1;
    this.donePlayed = 0;
    this.reports = [];
  }

  get queued(): number { return this.size; }

  /** A new delivery: what is left of another is dropped. */
  open(id: number): void {
    this.id = id;
    // Each reply starts from the base cushion: one stall does not slow every reply after it.
    this.cushion = this.prime;
    this.head = 0;
    this.size = 0;
    this.played = 0;
    this.ended = false;
    this.started = false;
    this.playing = false;
  }

  push(id: number, pcm: Int16Array): void {
    if (id !== this.id) return;
    if (this.head + this.size + pcm.length > this.buf.length) {
      const room = this.size + pcm.length;
      // Room behind what plays is reused; failing that, the buffer doubles.
      const next = room * 2 > this.buf.length ? new Float32Array(Math.max(room * 2, this.buf.length * 2)) : this.buf;
      if (next === this.buf) this.buf.copyWithin(0, this.head, this.head + this.size);
      else next.set(this.buf.subarray(this.head, this.head + this.size));
      this.buf = next;
      this.head = 0;
    }
    for (let i = 0; i < pcm.length; i++) this.buf[this.head + this.size + i] = pcm[i] / 32768;
    this.size += pcm.length;
  }

  /** All of the delivery's audio has come. */
  end(id: number): void {
    if (id === this.id) this.ended = true;
  }

  /**
   * The user cut in: the rest goes, and the delivery is over where it got to.
   * A clear is answered even for a delivery that had already played out.
   */
  clear(id: number): void {
    if (id === this.id) {
      this.reports.push({ finished: id, played: this.played, interrupted: true });
      this.doneId = id;
      this.donePlayed = this.played;
      this.id = -1;
      this.size = 0;
      this.playing = false;
    } else if (id === this.doneId) {
      this.reports.push({ finished: id, played: this.donePlayed, interrupted: true });
    }
  }

  /** Fills `out` with what plays next; returns the block's RMS. */
  pull(out: Float32Array): number {
    let sum = 0;
    // A delivery whose end came once all of it had played (or with none of it).
    if (this.id >= 0 && this.ended && this.size === 0) this.finish();
    for (let k = 0; k < out.length; k++) {
      if (this.id >= 0 && !this.playing && this.size > 0
          && (this.size >= this.cushion || this.ended)) {
        this.playing = true;
        // From the faded quiet into the voice over a few milliseconds, not in one step.
        this.ramp = 96;
        if (!this.started) {
          this.started = true;
          this.reports.push({ started: this.id });
        }
      }
      if (!this.playing) {
        // Quiet: the last sample fades rather than drop to zero.
        this.last = Math.abs(this.last) < 1e-6 ? 0 : this.last * 0.995;
        out[k] = this.last;
        continue;
      }
      let s = this.buf[this.head];
      if (this.ramp > 0) {
        s = this.last + (s - this.last) * (1 - this.ramp / 96);
        this.ramp--;
      }
      this.head++;
      this.size--;
      this.played++;
      this.last = s;
      out[k] = s;
      sum += s * s;
      if (this.size === 0) {
        this.playing = false;
        if (this.ended) {
          this.finish();
        } else {
          // Ran dry before the delivery's end: wait for a bigger cushion.
          this.underruns++;
          this.cushion = Math.min(this.max, this.cushion + this.grow);
        }
      }
    }
    return Math.sqrt(sum / Math.max(1, out.length));
  }

  /** The delivery played out: all of it, as the server checks. */
  finish(): void {
    this.reports.push({ finished: this.id, played: this.played, interrupted: false });
    this.doneId = this.id;
    this.donePlayed = this.played;
    this.id = -1;
    this.playing = false;
  }

  /** The reports since the last call. */
  take(): PlaybackReport[] {
    const reports = this.reports;
    this.reports = [];
    return reports;
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

// The paced stream (session.output_audio.delta) goes to the jitter buffer, a
// controlled delivery (causeur.playback.*) to the delivery buffer; a session
// sends one or the other, so their outputs are added.
const PLAYBACK_WORKLET = `const JitterBuffer = (${JitterBuffer.toString()});
const DeliveryBuffer = (${DeliveryBuffer.toString()});
registerProcessor('atmee-speech-playback', class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.jb = new JitterBuffer(o.rate, sampleRate, o.prime, o.max);
    this.db = new DeliveryBuffer(o.deliveryPrime, o.deliveryGrow, o.deliveryMax);
    this.scratch = new Float32Array(128);
    this.sum = 0; this.count = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.pcm && d.delivery !== undefined) this.db.push(d.delivery, d.pcm);
      else if (d.pcm) this.jb.push(d.pcm);
      else if (d.flush) this.jb.flush();
      else if (d.open !== undefined) this.db.open(d.open);
      else if (d.end !== undefined) this.db.end(d.end);
      else if (d.clear !== undefined) this.db.clear(d.clear);
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (this.scratch.length !== out.length) this.scratch = new Float32Array(out.length);
    const paced = this.jb.pull(out);
    const controlled = this.db.pull(this.scratch);
    for (let i = 0; i < out.length; i++) out[i] += this.scratch[i];
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    const rms = Math.max(paced, controlled);
    this.sum += rms * rms * out.length; this.count += out.length;
    const reports = this.db.take();
    if (reports.length) this.port.postMessage({ reports });
    if (this.count >= sampleRate / 50) {
      this.port.postMessage({ level: Math.sqrt(this.sum / this.count), queued: this.jb.queued + this.db.queued });
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
  /** Queues the avatar's audio to play (the paced stream). */
  play(pcm: Int16Array): void;
  /** Drops what is queued of the paced stream: the user cut in. */
  flush(): void;
  /**
   * Whether the voice plays at its own rate, as playback control needs: its
   * acknowledgments count samples of the voice. False where the browser
   * would not give a 24 kHz context; the session is then paced.
   */
  readonly controlled: boolean;
  /** Playback control: a delivery opens, takes its audio, ends, or is cleared. */
  open(delivery: number): void;
  deliver(delivery: number, pcm: Int16Array): void;
  end(delivery: number): void;
  clear(delivery: number): void;
  /** What the delivery player reports, for the server, once set. */
  onPlayback: ((report: PlaybackReport) => void) | null;
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
export async function openSpeechAudio({ primeMs = 100, maxMs = 600, deliveryPrimeMs = 150,
  deliveryGrowMs = 100, deliveryMaxMs = 1000 }: {
  primeMs?: number; maxMs?: number; deliveryPrimeMs?: number; deliveryGrowMs?: number; deliveryMaxMs?: number;
} = {}): Promise<SpeechAudio> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (err) {
    throw new MicError((err as Error).name === 'NotAllowedError' ? 'mic_blocked' : 'no_mic');
  }
  // The microphone at the device's rate (some browsers take a microphone only
  // there), the voice in a context of its own at its rate: the browser
  // resamples it to the speaker, and the delivery player counts its samples.
  // Whatever fails once the microphone is granted lets it go, and every
  // context made so far.
  const contexts: AudioContext[] = [];
  let context: AudioContext;
  let output: AudioContext;
  let source: MediaStreamAudioSourceNode;
  let capture: AudioWorkletNode;
  let playback: AudioWorkletNode;
  try {
    context = new AudioContext({ latencyHint: 'interactive' });
    contexts.push(context);
    output = context;
    try {
      output = new AudioContext({ latencyHint: 'interactive', sampleRate: RATE });
      contexts.push(output);
    } catch { /* the voice is resampled in the worklet, paced */ }
    await Promise.all([addWorklet(context, CAPTURE_WORKLET), addWorklet(output, PLAYBACK_WORKLET)]);
    const ms = (n: number) => Math.round((RATE * n) / 1000);
    source = context.createMediaStreamSource(stream);
    // The capture worklet's silent output goes to the speaker through a muted gain: a context
    // whose graph reaches no destination may stop being rendered (Safari), and the microphone with it.
    capture = new AudioWorkletNode(context, 'atmee-speech-capture', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { rate: RATE, frame: FRAME },
    });
    playback = new AudioWorkletNode(output, 'atmee-speech-playback', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: {
        rate: RATE, prime: ms(primeMs), max: ms(maxMs),
        deliveryPrime: ms(deliveryPrimeMs), deliveryGrow: ms(deliveryGrowMs), deliveryMax: ms(deliveryMaxMs),
      },
    });
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(capture);
    capture.connect(mute).connect(context.destination);
    playback.connect(output.destination);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
    throw err;
  }

  let level = 0;
  let micLevel = 0;
  let queued = 0;
  const audio: SpeechAudio = {
    onFrame: null,
    onPlayback: null,
    controlled: output.sampleRate === RATE,
    play(pcm) { playback.port.postMessage({ pcm }, [pcm.buffer]); },
    flush() { playback.port.postMessage({ flush: true }); queued = 0; },
    open(delivery) { playback.port.postMessage({ open: delivery }); },
    deliver(delivery, pcm) { playback.port.postMessage({ delivery, pcm }, [pcm.buffer]); },
    end(delivery) { playback.port.postMessage({ end: delivery }); },
    clear(delivery) { playback.port.postMessage({ clear: delivery }); },
    get level() { return level; },
    get micLevel() { return micLevel; },
    get queuedMs() { return (queued / RATE) * 1000; },
    get suspended() { return contexts.some((c) => c.state === 'suspended'); },
    async resume() { await Promise.all(contexts.map((c) => c.resume())); },
    async close() {
      capture.port.onmessage = null;
      playback.port.onmessage = null;
      source.disconnect();
      capture.disconnect();
      playback.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await Promise.all(contexts.map((c) => (c.state !== 'closed' ? c.close() : undefined)));
    },
  };
  capture.port.onmessage = (e: MessageEvent<{ frame?: Int16Array; level?: number }>) => {
    if (e.data.frame) audio.onFrame?.(e.data.frame);
    else if (e.data.level !== undefined) micLevel = e.data.level;
  };
  playback.port.onmessage = (e: MessageEvent<{ level?: number; queued?: number; reports?: PlaybackReport[] }>) => {
    if (e.data.reports) {
      for (const report of e.data.reports) audio.onPlayback?.(report);
      return;
    }
    level = e.data.level ?? level;
    queued = e.data.queued ?? queued;
  };
  for (const c of contexts) if (c.state === 'suspended') await c.resume().catch(() => {});
  return audio;
}
