// Audio for an avatar-only render: the avatar mouths what it is sent, 16 kHz
// mono 16-bit PCM. These turn what an app has (a decoded file, a TTS answer,
// a microphone) into that.

export const SAMPLE_RATE = 16_000;

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

/** Calls onPcm with the microphone's audio as 16 kHz PCM until the returned stop() is called. */
export async function tapMicrophone(stream: MediaStream, onPcm: (pcm: Int16Array) => void): Promise<() => Promise<void>> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
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
