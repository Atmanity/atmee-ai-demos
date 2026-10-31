// Facecast: a presenter studio built the avatar-only way. Whatever audio the
// page has (a script, a recording, the user's own microphone, live) goes to
// Remy, who says it to camera; there is no conversation and no model deciding
// what he says. The server voices scripts in Remy's own voice (his avatar.json's
// Fish voice, the one his face was captured with, so his lips follow it), and
// for Stand-in it hears the speaker and restates them: every key stays here.
//
//   GET  /voice    whether scripts can be voiced here, and whether Stand-in can run
//   POST /read     a script -> the script spoken (a WAV a sentence, in order)
//   POST /turn     Stand-in: one clause heard -> the words to say, spoken
//   WS   /socket   Stand-in: the microphone to live speech recognition, and what it heard back
import WebSocket from 'ws';
import type { AppServer } from '../../server/app-server.ts';
import { fishVoiceOf } from '../../server/hosts.js';
import { llmAvailable, structured } from '../../server/llm.ts';
import { speak, speakSentences, speechAvailable } from '../../server/speech.ts';
import { bridgeHearing, listenUrl } from './engine/hearing.ts';
import { isHeard, isTarget, isTone } from './engine/options.ts';
import { rewrite } from './engine/rewrite.ts';

export const MAX_SCRIPT = 1200;
export const MAX_CLAUSE = 600;
const MAX_RECENT = 3;
const VOICE = fishVoiceOf('presenter-studio');
const hearingKey = () => process.env.DEEPGRAM_API_KEY;
const standInAvailable = () => speechAvailable() && llmAvailable() && Boolean(VOICE) && Boolean(hearingKey());

const app: AppServer = {
  id: 'presenter-studio',
  title: 'Facecast',
  tagline: 'Any audio, a face that says it: a script, a recording, your live voice, or a stand-in that cleans up and translates what you say.',
  brand: { color: '#e11d48', ink: '#ffffff' },
  way: 'avatar-only',
  maxSeconds: 600,
  routes(router) {
    router.get('/voice', (_req, res) => { res.json({ available: speechAvailable() && Boolean(VOICE), standIn: standInAvailable() }); });

    router.post('/read', async (req, res) => {
      if (!speechAvailable() || !VOICE) return void res.status(503).json({ error: 'no_voice', message: 'Set FISH_API_KEY to voice scripts' });
      const text = String(req.body?.text ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return void res.status(400).json({ error: 'empty' });
      if (text.length > MAX_SCRIPT) return void res.status(413).json({ error: 'too_long', max: MAX_SCRIPT });
      const t = Date.now();
      const clips = await speakSentences(text, VOICE);
      res.json({ clips: clips.map((clip) => clip.toString('base64')), ms: Date.now() - t });
    });

    router.post('/turn', async (req, res) => {
      if (!standInAvailable()) return void res.status(503).json({ error: 'not_set_up', message: 'Stand-in needs DEEPGRAM_API_KEY, GEMINI_API_KEY and FISH_API_KEY' });
      const text = String(req.body?.text ?? '').replace(/\s+/g, ' ').trim();
      const { target, tone } = req.body ?? {};
      if (!text) return void res.status(400).json({ error: 'empty' });
      if (text.length > MAX_CLAUSE) return void res.status(413).json({ error: 'too_long', max: MAX_CLAUSE });
      if (!isTarget(target) || !isTone(tone)) return void res.status(400).json({ error: 'bad_option' });
      const recent = (Array.isArray(req.body?.recent) ? req.body.recent : []).slice(-MAX_RECENT).map((r: unknown) => String(r).slice(0, MAX_CLAUSE));

      const started = Date.now();
      let said: string;
      try {
        said = await rewrite({ text, target, tone, recent }, structured);
      } catch (err) {
        // Nothing the model got wrong is ever voiced: the speaker sees that this clause was dropped.
        console.error('[facecast] rewrite failed: %s', (err as Error).message);
        return void res.status(502).json({ error: 'no_rewrite' });
      }
      const rewritten = Date.now();
      if (!said) return void res.json({ said: '', rewriteMs: rewritten - started, voiceMs: 0 });
      const clip = await speak(said, VOICE);
      res.json({ said, clip: clip.toString('base64'), rewriteMs: rewritten - started, voiceMs: Date.now() - rewritten });
    });
  },
  socket(client, url) {
    const language = url.searchParams.get('language');
    const key = hearingKey();
    if (!key || !isHeard(language)) return client.close(1008);
    const upstream = new WebSocket(listenUrl(language as string), { headers: { Authorization: `Token ${key}` } });
    bridgeHearing(client, upstream);
  },
};
export default app;
