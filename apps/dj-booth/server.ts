// Crate's server side: Spotify search, signed in as the app. The page owns
// the player and answers the DJ's tools; it comes here only to dig for records.
import type { AppServer } from '../../server/app-server.ts';
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
const spotify = new Spotify(process.env.SPOTIFY_CLIENT_ID, process.env.SPOTIFY_CLIENT_SECRET);
if (!spotify.configured) console.warn('[%s] SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET unset: the DJ cannot search', ID);

const app: AppServer = {
  id: ID,
  title: 'Crate',
  tagline: 'A live radio booth: Nova digs through Spotify and spins your requests.',
  brand: { color: '#14110f', ink: '#ffb547' },
  maxSeconds: 900,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
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
