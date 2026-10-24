// The avatar-only apps' own voice: text to speech with Fish Audio, in the host's
// own voice (a Fish voice cloned from the sample the host was made with: its
// avatar.json `fishVoiceId`). A v2 avatar's take is captured with its own voice,
// and its lips follow that voice; another voice can leave them still. The WAV
// comes back at 16 kHz, the rate the avatar takes.
const KEY = process.env.FISH_API_KEY;
const MODEL = process.env.FISH_TTS_MODEL || 's2.1-pro';
export const SPEECH_RATE = 16_000;

export const speechAvailable = () => Boolean(KEY);

/** Raw 16-bit mono PCM as a WAV file. */
export function wav(pcm: Buffer, rate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);       // PCM
  header.writeUInt16LE(1, 22);       // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Text cut into sentences to voice side by side: a short one rides with the next,
 * so no clip is a word long. The order is kept.
 */
export function sentences(text: string, min = 40): string[] {
  const parts = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [];
  const out: string[] = [];
  let carry = '';
  for (const part of parts) {
    carry += part;
    if (carry.trim().length >= min) { out.push(carry.trim()); carry = ''; }
  }
  const rest = carry.trim();
  if (rest && out.length && rest.length < min) out[out.length - 1] += ` ${rest}`;
  else if (rest) out.push(rest);
  return out;
}

/** The body Fish's /v1/tts takes for one utterance: the text alone is spoken, nothing else. */
export const ttsRequest = (text: string, voiceId: string) => ({
  text, reference_id: voiceId, format: 'pcm', sample_rate: SPEECH_RATE, latency: 'balanced',
});

/** `text` spoken in the Fish voice `voiceId`, as a 16 kHz WAV file. */
export async function speak(text: string, voiceId: string): Promise<Buffer> {
  if (!KEY) throw new Error('FISH_API_KEY is not set');
  if (!voiceId) throw new Error('This host has no fishVoiceId in its avatar.json');
  const res = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', model: MODEL },
    body: JSON.stringify(ttsRequest(text, voiceId)),
  });
  if (!res.ok) throw new Error(`Fish Audio ${MODEL}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return wav(Buffer.from(await res.arrayBuffer()), SPEECH_RATE);
}

/** `text` voiced a sentence at a time, all at once: the clips in order, sooner than one long clip. */
export const speakSentences = (text: string, voiceId: string) => Promise.all(sentences(text).map((s) => speak(s, voiceId)));
