// Facecast: a presenter studio built the avatar-only way. Whatever audio the
// page has (a script read by a voice it picks, a recording, the user's own
// microphone, live) goes to Remy, who says it to camera; there is no
// conversation and no model deciding what he says. The server only voices
// scripts: the API key for the voice stays here.
//
//   GET  /voices   the voices and reading styles on offer
//   POST /read     a script, a voice and a style -> the script spoken (a WAV a sentence, in order)
import type { AppServer } from '../../server/app-server.ts';
import { VOICES, speakSentences, speechAvailable } from '../../server/speech.ts';

export const MAX_SCRIPT = 1200;

/** How a script can be read, as the voice is told. */
export const STYLES: Record<string, { label: string; say: string }> = {
  anchor: { label: 'News anchor', say: 'like a calm, assured evening news anchor' },
  warm: { label: 'Warm host', say: 'warmly, like a friendly host welcoming viewers' },
  bright: { label: 'Upbeat', say: 'with bright, upbeat energy, like a product launch' },
  calm: { label: 'Calm', say: 'slowly and calmly, like a safety announcement' },
};

const app: AppServer = {
  id: 'presenter-studio',
  title: 'Facecast',
  tagline: 'Any audio, a face that says it: a script, a recording, or your own voice, live.',
  brand: { color: '#e11d48', ink: '#ffffff' },
  way: 'avatar-only',
  maxSeconds: 600,
  routes(router) {
    router.get('/voices', (_req, res) => {
      res.json({ available: speechAvailable(), voices: VOICES, styles: Object.entries(STYLES).map(([id, s]) => ({ id, label: s.label })) });
    });

    router.post('/read', async (req, res) => {
      if (!speechAvailable()) return void res.status(503).json({ error: 'no_voice', message: 'Set GEMINI_API_KEY to voice scripts' });
      const text = String(req.body?.text ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return void res.status(400).json({ error: 'empty' });
      if (text.length > MAX_SCRIPT) return void res.status(413).json({ error: 'too_long', max: MAX_SCRIPT });
      const voice = VOICES.find((v) => v.id === req.body?.voice)?.id ?? VOICES[0].id;
      const style = STYLES[String(req.body?.style)] ?? STYLES.anchor;
      const t = Date.now();
      const clips = await speakSentences(text, voice, style.say);
      res.json({ clips: clips.map((clip) => clip.toString('base64')), voice, ms: Date.now() - t });
    });
  },
};
export default app;
