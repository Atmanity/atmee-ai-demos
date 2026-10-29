// Crate's server side: Spotify search, signed in as the app. The page owns
// the player and answers the DJ's tools; it comes here only to dig for records.
import type { AppServer } from '../../server/app-server.ts';
import { avatarApi } from '../../server/atmee.ts';
import { avatarFor } from '../../server/hosts.js';
import { llmAvailable, structured } from '../../server/llm.ts';
import { INSTRUCTIONS, TOOLS } from './engine/director.ts';
import { Spotify } from './engine/spotify.ts';
import { DEFAULT_THEME, THEME_SCHEMA, THEME_SYSTEM, themeFrom, themePrompt, type Theme } from './engine/theme.ts';
import type { Track } from './engine/types.ts';

const ID = 'dj-booth';
// The longest a theme may take: the record is already playing in the house look.
const THEME_MS = 15_000;
const themes = new Map<string, Promise<Theme>>();

/** The cover, for the model to draw the palette from: Spotify's image host only. */
async function coverOf(url: string | null): Promise<{ mimeType: string; base64: string }[]> {
  if (!url || new URL(url).hostname !== 'i.scdn.co') return [];
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    return [{ mimeType: res.headers.get('content-type') || 'image/jpeg', base64: Buffer.from(await res.arrayBuffer()).toString('base64') }];
  } catch {
    return [];
  }
}

async function themeFor(track: Track): Promise<Theme> {
  if (!llmAvailable()) return DEFAULT_THEME;
  const ask = structured({ system: THEME_SYSTEM, user: themePrompt(track), schema: THEME_SCHEMA, images: await coverOf(track.cover), temperature: 0.8 });
  const raw = await Promise.race([ask, new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), THEME_MS))]);
  return themeFrom(raw);
}
// Speech sessions this server started, ended on shutdown so a rollout leaves nothing billing.
const speaking = new Set<string>();
const SPEECH_MAX_SECONDS = 900;

/** The tools in the speech API's shape: the OpenAI function shape, without the full-stack x-atmee delivery. */
const speechTools = TOOLS.map(({ type, name, description, parameters }) => ({ type, name, description, parameters }));

const endSpeech = (id: string) => avatarApi('POST', `/v1/speech_sessions/${id}/end`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void Promise.allSettled([...speaking].map(endSpeech)); });
}

const spotify = new Spotify(process.env.SPOTIFY_CLIENT_ID, process.env.SPOTIFY_CLIENT_SECRET);
if (!spotify.configured) console.warn('[%s] SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET unset: the DJ cannot search', ID);

const app: AppServer = {
  id: ID,
  title: 'Crate',
  tagline: 'A live radio booth: Nova digs through Spotify and spins your requests.',
  brand: { color: '#14110f', ink: '#ffb547' },
  maxSeconds: 900,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
  rendersFace: true,
  routes(router) {
    // The app's client id is public: the page signs a Premium listener in with it (PKCE, no secret)
    // to play through Spotify's Web Playback SDK, the player with a volume.
    router.get('/config', (_req, res) => res.json({ clientId: process.env.SPOTIFY_CLIENT_ID || null }));

    // The look for a record, once per record: the model's answer, made safe, or the house look.
    router.post('/theme', async (req, res) => {
      const track = (req.body as { track?: Track })?.track;
      if (!track || typeof track.id !== 'string' || typeof track.title !== 'string') return void res.status(400).json({ error: 'no_track' });
      if (!themes.has(track.id)) {
        themes.set(track.id, themeFor(track).catch((err) => {
          console.warn('[%s] theme failed: %s', ID, (err as Error).message);
          themes.delete(track.id);
          return DEFAULT_THEME;
        }));
        if (themes.size > 500) themes.delete(themes.keys().next().value!);
      }
      res.json({ theme: await themes.get(track.id) });
    });

    // A voice-only conversation (the speech API): Nova's instructions and tools are pinned here, so
    // the page cannot change them; it gets a 60-second, one-connection token for the WebSocket.
    router.post('/speech', async (_req, res) => {
      const avatarId = avatarFor(ID);
      if (!avatarId) return void res.status(500).json({ error: 'no_avatar' });
      const r = await avatarApi('POST', '/v1/speech_sessions', {
        avatarId, language: 'en', maxDurationSeconds: SPEECH_MAX_SECONDS,
        settings: { instructions: INSTRUCTIONS, delegation: { type: 'responses', responses: { tools: speechTools } } },
      });
      if (r.status !== 201 && r.status !== 200) {
        console.warn('[%s] POST /v1/speech_sessions -> %d %s %s', ID, r.status, r.json?.error ?? '', r.json?.message ?? '');
        return void res.status(r.status).json({ error: r.json?.error || `http_${r.status}`, retryAfter: r.retryAfter });
      }
      const { sessionId, url, token, actualDurationSeconds } = r.json;
      speaking.add(sessionId);
      setTimeout(() => speaking.delete(sessionId), (SPEECH_MAX_SECONDS + 120) * 1000).unref();
      console.log('[%s] speech session %s on avatar %s', ID, sessionId, avatarId.slice(0, 8));
      res.status(201).json({ sessionId, url, token, maxSeconds: actualDurationSeconds ?? SPEECH_MAX_SECONDS });
    });

    router.post('/speech/:id/end', async (req, res) => {
      if (!speaking.has(req.params.id)) return void res.status(404).json({ error: 'not_found' });
      const r = await endSpeech(req.params.id);
      if (r.status < 300) speaking.delete(req.params.id);
      res.status(r.status).json(r.json);
    });

    router.post('/search', async (req, res) => {
      if (!spotify.configured) return void res.status(503).json({ error: 'spotify_not_configured' });
      const query = String((req.body as { query?: unknown })?.query ?? '').trim().slice(0, 200);
      if (!query) return void res.status(400).json({ error: 'no_query' });
      try {
        res.json({ query, tracks: await spotify.search(query) });
      } catch (err) {
        console.warn('[%s] search failed: %s', ID, (err as Error).message);
        res.status(502).json({ error: 'search_failed' });
      }
    });
  },
};

export default app;
