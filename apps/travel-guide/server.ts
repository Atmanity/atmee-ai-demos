// Yonder's server side: it owns each trip, does every lookup (Nominatim and
// Overpass want a User-Agent and one request a second; the news wants a key;
// dish ideas come from the app's own model), and answers the host's tool
// calls and the user's buttons with one set of actions (engine/tools.ts).
//
// Nothing here is secret from the page; the engine runs here because the
// lookups must. The page sees a snapshot and draws it.
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { instructions, tools } from './engine/director.ts';
import { DISH_SCHEMA, dishIdeasFrom, dishPrompt, fallbackDishes } from './engine/food.ts';
import * as geo from './engine/geo.ts';
import { actionIn } from './engine/judge.ts';
import { TravelState } from './engine/state.ts';
import { isToolName, runAction, runTool } from './engine/tools.ts';
import type { DishIdea, Lookups } from './engine/trip.ts';
import type { MapConfig, Outcome } from './engine/types.ts';

const ID = 'travel-guide';

/** OpenStreetMap's own tiles by default; their usage policy suits light traffic, so a deployment can point elsewhere. */
const MAP: MapConfig = {
  tileUrl: process.env.TRAVEL_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: process.env.TRAVEL_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};

/** Read once: the host's tools and rules depend on it (no key, no news tool). */
const NEWS = Boolean(geo.newsKey());

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms))]);

async function suggestDishes(country: string): Promise<DishIdea[]> {
  if (llmAvailable()) {
    try {
      const ideas = dishIdeasFrom(await withTimeout(structured({ system: 'You recommend local food to travellers.', user: dishPrompt(country), schema: DISH_SCHEMA, temperature: 0.7 }), 15000));
      if (ideas.length) return ideas;
      console.warn('[Travel] the suggested dishes for %s were unusable; using the built-in ones', country);
    } catch (err) {
      console.warn('[Travel] dish suggestions failed (%s); using the built-in ones', (err as Error).message);
    }
  }
  return fallbackDishes(country);
}

const lookups: Lookups = {
  country: (name) => geo.lookupCountry(name),
  place: (query) => geo.lookupPlace(query),
  reverse: (lat, lon) => geo.reversePlace(lat, lon),
  nearby: (lat, lon) => geo.nearbySpots(lat, lon),
  summary: (title) => geo.wikipediaSummary(title),
  headlines: (isoCode) => geo.localHeadlines(isoCode),
  dishes: suggestDishes,
};

interface Trip { state: TravelState; at: number }
const trips = new Map<string, Trip>();

function tripOf(id: string): Trip | null {
  const trip = trips.get(id);
  if (trip) trip.at = Date.now();
  return trip ?? null;
}

const app: AppServer = {
  id: ID,
  title: 'Yonder',
  tagline: 'Dream up your next trip on a live map with Lumi, a friend who has been.',
  maxSeconds: 900,
  appTools: { instructions: instructions(NEWS), tools: tools(NEWS) },
  routes(router) {
    router.post('/trips', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      const state = new TravelState(NEWS);
      trips.set(id, { state, at: Date.now() });
      for (const [key, trip] of trips) if (Date.now() - trip.at > 3 * 3600_000) trips.delete(key);
      res.json({ id, snapshot: state.snapshot(), map: MAP });
    });

    // Polled while headlines, dishes or photos land in the background.
    router.get('/trips/:id', (req, res) => {
      const trip = tripOf(req.params.id);
      if (!trip) return void res.status(404).json({ error: 'no_trip' });
      res.json(trip.state.snapshot());
    });

    // The host's tool calls: the result is what it says next.
    router.post('/trips/:id/tool', async (req, res) => {
      const trip = tripOf(req.params.id);
      if (!trip) return void res.status(404).json({ error: 'no_trip' });
      const { name, arguments: args } = (req.body ?? {}) as { name?: unknown; arguments?: unknown };
      // show_news is answered even without a source ("there is no local news"), in case it is ever called.
      if (!isToolName(name)) return void res.status(400).json({ error: 'unknown_tool' });
      try {
        const result = await runTool(trip.state, lookups, name, typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {});
        console.info('[Travel] tool %s', name);
        res.json({ snapshot: trip.state.snapshot(), result } satisfies Outcome);
      } catch (err) {
        console.error('[Travel] tool %s failed: %s', name, (err as Error).message);
        res.status(500).json({ error: 'failed' });
      }
    });

    // The user's buttons, chips, pins and map taps: the page tells the host what happened.
    router.post('/trips/:id/act', async (req, res) => {
      const trip = tripOf(req.params.id);
      if (!trip) return void res.status(404).json({ error: 'no_trip' });
      const action = actionIn((req.body as { action?: unknown } | undefined)?.action);
      if (!action) return void res.status(400).json({ error: 'unknown_action' });
      try {
        const result = await runAction(trip.state, lookups, action);
        console.info('[Travel] button %s', action.kind);
        res.json({ snapshot: trip.state.snapshot(), result } satisfies Outcome);
      } catch (err) {
        console.error('[Travel] button %s failed: %s', action.kind, (err as Error).message);
        res.status(500).json({ error: 'failed' });
      }
    });
  },
};

export default app;
