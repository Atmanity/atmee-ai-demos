// Invent a guest: from the producer's one-line description to a built avatar,
// in the background while the show opens (the greeting, the film, the
// trailer), so the host can invite them on as soon as she wants to.
//
//   character  Gemini writes the guest: name, credit, persona, greeting,
//              rundown, and the brief for the portrait and the voice
//   portrait   Gemini draws it (centred, facing the lens, lips parted, a
//              little back, in the film's palette), uploaded as the portrait
//   voice      Gemini reads a sample in the guest's voice, uploaded as it
//   avatar     POST /v1/avatars from both uploads, then its build
//
// The portrait and the voice run together. Gemini makes both because the
// Avatar API's own generation needs a key with generation:write, which the
// site's key has not; the API takes any portrait and voice sample uploaded.
import { randomUUID } from 'node:crypto';
import { avatarApi } from '../../server/atmee.ts';
import { structured } from '../../server/llm.ts';
import { FILM, SHOW, type Guest } from './show/cast.ts';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const BUILD_LIMIT_MS = 10 * 60_000;

export type Step = 'character' | 'portrait' | 'voice' | 'avatar';
export interface StepState { status: 'waiting' | 'running' | 'done' | 'failed'; ms?: number }
export interface Invention {
  id: string;
  description: string;
  steps: Record<Step, StepState>;
  /** The guest as the show uses it: set once the character is written; avatarId once created. */
  guest?: Guest;
  /** A short-lived link to the portrait, for the page. */
  portrait?: string;
  ready: boolean;
  error?: string;
  startedAt: number;
}

const FEMALE = ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Callirrhoe', 'Autonoe', 'Despina', 'Erinome', 'Laomedeia', 'Achernar', 'Gacrux', 'Pulcherrima', 'Vindemiatrix', 'Sulafat'];
const MALE = ['Puck', 'Charon', 'Fenrir', 'Orus', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Algenib', 'Rasalgethi', 'Alnilam', 'Schedar', 'Achird', 'Sadachbia', 'Sadaltager'];

interface Character {
  name: string; preferredAlias: string; credit: string; from: string;
  whoPrompt: string; facts: string[]; greeting: string; rundown: string[];
  portrait: string; ttsVoice: string; voiceStyle: string; sample: string;
}

const inventions = new Map<string, Invention>();
export const invention = (id: string) => inventions.get(id);

export function invent(description: string): Invention {
  const inv: Invention = {
    id: `invented-${randomUUID().slice(0, 8)}`,
    description,
    steps: { character: { status: 'waiting' }, portrait: { status: 'waiting' }, voice: { status: 'waiting' }, avatar: { status: 'waiting' } },
    ready: false,
    startedAt: Date.now(),
  };
  inventions.set(inv.id, inv);
  void run(inv);
  return inv;
}

async function step<T>(inv: Invention, name: Step, work: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  inv.steps[name] = { status: 'running' };
  try {
    const out = await work();
    inv.steps[name] = { status: 'done', ms: Date.now() - t0 };
    console.log('[tv-show-live] invent %s: %s in %d ms', inv.id, name, Date.now() - t0);
    return out;
  } catch (err) {
    inv.steps[name] = { status: 'failed', ms: Date.now() - t0 };
    throw err;
  }
}

async function run(inv: Invention) {
  try {
    const c = await step(inv, 'character', () => writeCharacter(inv.description));
    inv.guest = {
      id: inv.id,
      name: c.name,
      billing: c.credit,
      from: c.from,
      avatarId: '',
      rundown: c.rundown.slice(0, 4),
    };
    const [image, voice] = await Promise.all([
      step(inv, 'portrait', async () => {
        const jpeg = await drawPortrait(c);
        inv.portrait = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
        return upload('portrait', 'image/jpeg', `${inv.id}.jpg`, jpeg);
      }),
      step(inv, 'voice', async () => upload('voice', 'audio/wav', `${inv.id}.wav`, await readSample(c))),
    ]);
    await step(inv, 'avatar', async () => {
      const created = await avatarApi('POST', '/v1/avatars', {
        schemaVersion: 1,
        name: c.name,
        description: `Invented guest on ${SHOW} (live TV-show demo): ${c.credit}`,
        language: 'en',
        engine: 'v2',
        previews: false,
        seedSelection: 'auto',
        persona: {
          whoPrompt: c.whoPrompt,
          whatPrompt: guestScenarioFor(c),
          greeting: c.greeting,
          preferredAlias: c.preferredAlias,
          spokenName: c.name,
          guardrails: [
            `You are an invented character and ${FILM.title} is an invented film: never claim to be a real person or to have worked on real films, and never name real films, studios, designers or actors.`,
            'Keep it friendly and family-friendly.',
            'You always speak English.',
          ],
        },
        assets: { image: { url: image }, voice: { url: voice } },
      });
      if (created.status >= 300) throw new Error(`create ${created.status}: ${JSON.stringify(created.json).slice(0, 200)}`);
      const avatarId: string = created.json.avatarId;
      inv.guest!.avatarId = avatarId;
      const until = Date.now() + BUILD_LIMIT_MS;
      for (;;) {
        await new Promise((r) => setTimeout(r, 4000));
        const a = await avatarApi('GET', `/v1/avatars/${avatarId}`);
        if (a.json?.readyToChat) return avatarId;
        const failure = a.json?.latestFailure;
        if (a.json?.status === 'failed' || failure?.userFeedback) throw new Error(failure?.userFeedback || 'the build failed');
        if (Date.now() > until) throw new Error('the build took too long');
      }
    });
    inv.ready = true;
    console.log('[tv-show-live] invent %s: %s ready in %d ms', inv.id, c.name, Date.now() - inv.startedAt);
  } catch (err) {
    inv.error = (err as Error).message;
    console.warn('[tv-show-live] invent %s failed: %s', inv.id, inv.error);
  }
}

function writeCharacter(description: string): Promise<Character> {
  return structured<Character>({
    system: [
      `You invent guests for ${SHOW}, a late-night TV talk show about the art of film. Tonight's film is ${FILM.title}, ${FILM.logline}.`,
      `The producer describes a guest; invent that person as one of the film's makers. Everything is invented: never a real person, film, studio or brand.`,
      'Fields:',
      'name: a full name. preferredAlias: what the host calls them (usually the first name).',
      `credit: their credit as the host bills them, lower case, e.g. "cinematographer of ${FILM.title}".`,
      'from: where they join the video call from, e.g. "her studio in Reykjavik".',
      'whoPrompt: who they are, in the second person ("You are ..."): role, age, background, personality, how they speak (calm, vivid, concrete). Under 900 characters.',
      `facts: 6 to 8 invented, concrete, vivid facts about how they made ${FILM.title}: materials, numbers, methods, mishaps.`,
      'greeting: one short spoken hello to the host, in English, one sentence.',
      'rundown: 4 short topic titles (3 to 6 words each) the host can raise with them, from their craft on the film.',
      'portrait: what their video-call frame shows behind them: a workplace that fits their craft, dressed for the film, in its palette of amber, ochre, sand, rust and pale glass; and what they wear. Two or three sentences. No screens, no text.',
      `ttsVoice: the voice to read their sample, one of ${[...FEMALE, ...MALE].join(', ')}: female voices ${FEMALE.join(', ')}; male voices ${MALE.join(', ')}.`,
      'voiceStyle: how they sound, for the reader: age, tone, pace, accent. One sentence.',
      `sample: 80 to 110 words they say in the first person about their work on ${FILM.title}, warm and concrete, in English, with no stage directions.`,
    ].join('\n'),
    user: `The producer's description of tonight's guest: ${description}`,
    schema: {
      type: 'object',
      properties: Object.fromEntries([
        ...['name', 'preferredAlias', 'credit', 'from', 'whoPrompt', 'greeting', 'portrait', 'voiceStyle', 'sample'].map((k) => [k, { type: 'string' }]),
        ['ttsVoice', { type: 'string', enum: [...FEMALE, ...MALE] }],
        ['facts', { type: 'array', items: { type: 'string' } }],
        ['rundown', { type: 'array', items: { type: 'string' } }],
      ]),
      required: ['name', 'preferredAlias', 'credit', 'from', 'whoPrompt', 'facts', 'greeting', 'rundown', 'portrait', 'ttsVoice', 'voiceStyle', 'sample'],
    },
    temperature: 0.9,
  });
}

/** Their persona's "what": the same frame as the cast's own guests. */
function guestScenarioFor(c: Character): string {
  return [
    `Treat user as: the host of a TV talk show about the art of film, interviewing you on a live video call from ${c.from}, shown on the big screen in her studio, with an audience watching.`,
    `Mission: be a fascinating guest: answer with a concrete detail about how something in ${FILM.title} was made, and let the host steer.`,
    '',
    'What you know (all invented):',
    `- ${FILM.title}: ${FILM.logline}.`,
    ...c.facts.map((f) => `- ${f}`),
  ].join('\n');
}

// What made the cast's portraits work with the renderer: one person, centred, facing the lens,
// lips parted, a little back from the camera with the hands inside the frame, no screens.
async function drawPortrait(c: Character): Promise<Buffer> {
  const prompt = [
    `Square photo of ${c.name}, ${c.credit} (an invented person), on a video call.`,
    'One person only, seated, centred in the frame, facing the camera squarely and looking straight into the lens, warm and engaged, lips slightly parted as if about to speak.',
    'Medium shot from a little way back: head in the upper-middle of the frame, shoulders and both hands inside the frame, clear space on both sides. The face is about a quarter of the image width, sharp, evenly lit.',
    `Behind them, softly out of focus: ${c.portrait}`,
    'Realistic photograph. No screens or monitors, no text, no logos.',
  ].join(' ');
  const res = await fetch(`${GEMINI}/${IMAGE_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '1:1' } } }),
  });
  const json: any = await res.json();
  const part = json.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
  if (!part) throw new Error(`portrait: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return Buffer.from(part.inlineData.data, 'base64');
}

async function readSample(c: Character): Promise<Buffer> {
  const res = await fetch(`${GEMINI}/${TTS_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Say this as ${c.voiceStyle}: ${c.sample}` }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: c.ttsVoice } } } },
    }),
  });
  const json: any = await res.json();
  const part = json.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
  if (!part) throw new Error(`voice: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  const pcm = Buffer.from(part.inlineData.data, 'base64');
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1]) || 24000;
  if (pcm.length / 2 / rate < 10) throw new Error('voice: the sample is under 10 seconds');
  return wav(pcm, rate);
}

function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function upload(kind: 'portrait' | 'voice', contentType: string, fileName: string, bytes: Buffer): Promise<string> {
  const made = await avatarApi('POST', '/v1/uploads', { kind, contentType, fileName });
  if (made.status >= 300) throw new Error(`${kind} upload ${made.status}: ${JSON.stringify(made.json).slice(0, 200)}`);
  const put = await fetch(made.json.uploadUrl, { method: 'PUT', headers: made.json.uploadHeaders ?? { 'Content-Type': contentType }, body: new Uint8Array(bytes) });
  if (!put.ok) throw new Error(`${kind} upload PUT ${put.status}`);
  return `upload:${made.json.uploadId}`;
}
