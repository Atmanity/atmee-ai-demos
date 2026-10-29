// Crate's server side: Spotify search, signed in as the app. The page owns
// the player and answers the DJ's tools; it comes here only to dig for records.
import type { AppServer } from '../../server/app-server.ts';
import { INSTRUCTIONS, TOOLS } from './engine/director.ts';
import { Spotify } from './engine/spotify.ts';

const ID = 'dj-booth';
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
