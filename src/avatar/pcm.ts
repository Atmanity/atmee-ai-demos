// Audio for an avatar-only render: the avatar mouths what it is sent, 16 kHz
// mono 16-bit PCM. These turn what an app has (a decoded file, a TTS answer,
// a microphone, a speech session's 24 kHz voice) into that.

export const SAMPLE_RATE = 16_000;

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

/** Float samples (-1..1) as 16-bit PCM, clipped. */
export function floatTo16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** The channels of a buffer averaged into one. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const channel of channels) for (let i = 0; i < out.length; i++) out[i] += channel[i] / channels.length;
  return out;
}

/** Seconds of 16 kHz PCM. */
export const durationOf = (pcm: Int16Array) => pcm.length / SAMPLE_RATE;

/**
 * Any audio file the browser can decode (wav, mp3, m4a, ogg, webm…), as 16 kHz
 * mono PCM: decoding in a 16 kHz context resamples it on the way.
 */
export async function decodeTo16k(data: ArrayBuffer): Promise<Int16Array> {
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buffer = await context.decodeAudioData(data);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  return floatTo16(mixToMono(channels));
}

// The microphone, frame by frame: a worklet in a 16 kHz context (the browser
// resamples the device to it) posts each block of samples to the page.
const WORKLET = `registerProcessor('pcm-tap', class extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
});`;

/** Calls onPcm with the microphone's audio as PCM at `rate` (16 kHz by default) until the returned stop() is called. */
export async function tapMicrophone(stream: MediaStream, onPcm: (pcm: Int16Array) => void, rate = SAMPLE_RATE): Promise<() => Promise<void>> {
  const context = new AudioContext({ sampleRate: rate });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  const source = context.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(context, 'pcm-tap');
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => onPcm(floatTo16(e.data));
  source.connect(tap);
  return async () => {
    tap.port.onmessage = null;
    source.disconnect();
    tap.disconnect();
    await context.close();
  };
}

/** 16 kHz PCM as a WAV file (a recording to send a model that hears). */
export function wavFile(pcm: Int16Array, rate = SAMPLE_RATE): Uint8Array {
  const out = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + pcm.byteLength, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, pcm.byteLength, true);
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 44);
  return out;
}

/** Pieces of PCM joined into one. */
export function joinPcm(pieces: Int16Array[]): Int16Array {
  const out = new Int16Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const piece of pieces) { out.set(piece, at); at += piece.length; }
  return out;
}

export const toBase64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
export const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
