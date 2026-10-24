// Facecast: a presenter studio built the avatar-only way. Whatever audio the
// page has (a script, a recording, the user's own microphone, live) goes to
// Remy, who says it to camera; there is no conversation and no model deciding
// what he says. The server only voices scripts, in Remy's own voice (his
// avatar.json's Fish voice, the one his face was captured with, so his lips
// follow it): the API key for the voice stays here.
//
//   GET  /voice   whether scripts can be voiced here
//   POST /read    a script -> the script spoken (a WAV a sentence, in order)
import type { AppServer } from '../../server/app-server.ts';
import { fishVoiceOf } from '../../server/hosts.js';
import { speakSentences, speechAvailable } from '../../server/speech.ts';

export const MAX_SCRIPT = 1200;
const VOICE = fishVoiceOf('presenter-studio');

const app: AppServer = {
  id: 'presenter-studio',
  title: 'Facecast',
  tagline: 'Any audio, a face that says it: a script in Remy’s own voice, a recording, or your voice, live.',
  brand: { color: '#e11d48', ink: '#ffffff' },
  way: 'avatar-only',
  maxSeconds: 600,
  routes(router) {
    router.get('/voice', (_req, res) => { res.json({ available: speechAvailable() && Boolean(VOICE) }); });

    router.post('/read', async (req, res) => {
      if (!speechAvailable() || !VOICE) return void res.status(503).json({ error: 'no_voice', message: 'Set FISH_API_KEY to voice scripts' });
      const text = String(req.body?.text ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return void res.status(400).json({ error: 'empty' });
      if (text.length > MAX_SCRIPT) return void res.status(413).json({ error: 'too_long', max: MAX_SCRIPT });
      const t = Date.now();
      const clips = await speakSentences(text, VOICE);
      res.json({ clips: clips.map((clip) => clip.toString('base64')), ms: Date.now() - t });
    });
  },
};
export default app;
