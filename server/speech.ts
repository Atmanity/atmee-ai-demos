// The avatar-only apps' own voice: text to speech with Gemini, as a WAV file the
// page decodes to 16 kHz PCM and hands the avatar. In the avatar-only way the
// app speaks and the avatar is only the face, so the voice is the app's choice.
const KEY = process.env.GEMINI_API_KEY;
// The lite model: about a second faster a sentence, which a conversation feels.
const MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-lite-tts';

/** Gemini's prebuilt voices the apps offer, with how each sounds. */
export const VOICES = [
  { id: 'Charon', label: 'Charon', sound: 'Informative, even' },
  { id: 'Kore', label: 'Kore', sound: 'Firm, clear' },
  { id: 'Puck', label: 'Puck', sound: 'Upbeat' },
  { id: 'Aoede', label: 'Aoede', sound: 'Breezy' },
  { id: 'Fenrir', label: 'Fenrir', sound: 'Excitable' },
  { id: 'Leda', label: 'Leda', sound: 'Youthful' },
] as const;

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

/** Gemini's audio as a WAV: it answers with a WAV file or with raw PCM (`audio/L16;rate=24000`). */
export function asWav(data: Buffer, mimeType: string): Buffer {
  if (data.subarray(0, 4).toString('latin1') === 'RIFF') return data;
  return wav(data, Number(/rate=(\d+)/.exec(mimeType)?.[1]) || 24000);
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

/** `text` voiced a sentence at a time, all at once: the clips in order, sooner than one long clip. */
export const speakSentences = (text: string, voice: string, style?: string) => Promise.all(sentences(text).map((s) => speak(s, voice, style)));

/** `text` spoken in `voice`, as a WAV file. `style` is how to say it ("calmly", "like a news anchor"). */
export async function speak(text: string, voice: string, style?: string): Promise<Buffer> {
  if (!KEY) throw new Error('GEMINI_API_KEY is not set');
  const prompt = style ? `Say ${style}: ${text}` : text;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }),
  });
  const json: any = await res.json();
  const audio = json.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
  if (!audio?.data) throw new Error(`${MODEL}: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return asWav(Buffer.from(audio.data, 'base64'), String(audio.mimeType || ''));
}
