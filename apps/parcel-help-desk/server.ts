// Waybill: a parcel help desk built the avatar-only way. The app brings the
// whole agent (its model, its tools over its own parcels, its voice and its
// ears) and Tess is only the face: the page hands her the agent's voice and
// she says it, in the app's own LiveKit room.
//
//   POST /desks              a visitor's desk: their own copy of the parcels, and Tess's greeting
//   POST /desks/:id/turn     the customer's words (typed, or a recording to transcribe) -> the
//                            agent's answer, the parcel it concerns, and the answer as speech
//                            (a WAV a sentence, voiced side by side, to say in order)
import { randomUUID } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { fishVoiceOf } from '../../server/hosts.js';
import { speakSentences, speechAvailable } from '../../server/speech.ts';
import { GREETING, answer, transcribe, type History } from './engine/agent.ts';
import { createDesk, statusWords, type Desk, type Parcel } from './engine/parcels.ts';

// Tess speaks in her own voice (her avatar.json's Fish voice), the one her face was captured with.
const VOICE = fishVoiceOf('parcel-help-desk');
const DESK_TTL_MS = 30 * 60_000;
const MAX_TEXT = 500;
const MAX_AUDIO_B64 = 2_000_000;   // about a minute of 16 kHz speech

interface Visit { desk: Desk; history: History; at: number }
const visits = new Map<string, Visit>();
setInterval(() => { for (const [id, v] of visits) if (Date.now() - v.at > DESK_TTL_MS) visits.delete(id); }, 60_000).unref();

/** The parcel as the page shows it. */
export const parcelView = (p: Parcel) => ({
  tracking: p.tracking, recipient: p.recipient, from: p.from, to: p.to, status: p.status, statusWords: statusWords(p.status),
  eta: p.eta, events: p.events, issue: p.issue ?? null, claim: p.claim ?? null, pickupPoint: p.pickupPoint ?? null,
});

/** A conversation keeps its last turns: cut only before a customer's own words, never inside a tool round. */
export function trim(history: History, max = 40) {
  while (history.length > max) {
    history.shift();
    while (history.length && !(history[0].role === 'user' && (history[0].parts[0] as { text?: string })?.text !== undefined)) history.shift();
  }
}

const timed = async <T>(job: () => Promise<T>): Promise<[T, number]> => { const t = Date.now(); const v = await job(); return [v, Date.now() - t]; };

const app: AppServer = {
  id: 'parcel-help-desk',
  title: 'Waybill',
  tagline: 'A parcel help desk whose agent is all the app’s own: its model, its tools, its voice. Tess is the face.',
  brand: { color: '#ff6a2b', ink: '#ffffff' },
  way: 'avatar-only',
  maxSeconds: 600,
  routes(router) {
    router.post('/desks', async (_req, res) => {
      if (!speechAvailable() || !process.env.GEMINI_API_KEY) return void res.status(503).json({ error: 'no_model', message: 'Set GEMINI_API_KEY (the agent and its ears) and FISH_API_KEY (its voice)' });
      const id = randomUUID();
      const desk = createDesk();
      visits.set(id, { desk, history: [{ role: 'model', parts: [{ text: GREETING }] }], at: Date.now() });
      const [audio, voiceMs] = await timed(() => speakSentences(GREETING, VOICE));
      res.status(201).json({
        id, greeting: GREETING, audio: audio.map((clip) => clip.toString('base64')), timings: { voice: voiceMs },
        samples: desk.parcels.map((p) => ({ tracking: p.tracking, hint: p.issue ? 'a problem' : statusWords(p.status).toLowerCase() })),
      });
    });

    router.post('/desks/:id/turn', async (req, res) => {
      const visit = visits.get(req.params.id);
      if (!visit) return void res.status(404).json({ error: 'not_found' });
      visit.at = Date.now();
      const { text, audio } = req.body ?? {};
      let heard: string | undefined;
      let hearMs: number | undefined;
      if (typeof audio === 'string' && audio) {
        if (audio.length > MAX_AUDIO_B64) return void res.status(413).json({ error: 'too_long' });
        [heard, hearMs] = await timed(() => transcribe(audio));
        if (!heard) return void res.json({ heard: '', reply: null });
      }
      const words = String(heard ?? text ?? '').trim().slice(0, MAX_TEXT);
      if (!words) return void res.status(400).json({ error: 'nothing_said' });
      const [turn, thinkMs] = await timed(() => answer(visit.desk, visit.history, words));
      trim(visit.history);
      const [speech, voiceMs] = await timed(() => speakSentences(turn.reply, VOICE));
      res.json({
        heard, reply: turn.reply, steps: turn.steps, parcel: turn.parcel ? parcelView(turn.parcel) : null,
        audio: speech.map((clip) => clip.toString('base64')), timings: { hear: hearMs, think: thinkMs, voice: voiceMs },
      });
    });
  },
};
export default app;
