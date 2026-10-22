// The travel guide's server side: it owns each trip, does every lookup
// (Nominatim and Overpass want a User-Agent and one request a second; the news
// wants a key; dish ideas come from the app's own model), and turns what the
// user says or types into board actions.
//
// Nothing here is secret from the page; the engine runs here because the
// lookups must. The page sees a snapshot and draws it.
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { eventFor, ttlFor } from './engine/director.ts';
import { DISH_SCHEMA, dishIdeasFrom, dishPrompt, fallbackDishes } from './engine/food.ts';
import * as geo from './engine/geo.ts';
import { actionFrom, actionIn, INTENT_SCHEMA, intentPrompt, ruleAction, worthAsking, type JudgeContext, type ModelIntent } from './engine/judge.ts';
import { TravelState } from './engine/state.ts';
import { apply, fromAvatar, type DishIdea, type Lookups } from './engine/trip.ts';
import type { Action, MapConfig, Outcome, Source } from './engine/types.ts';

const ID = 'travel-guide';
const SOURCES: Source[] = ['button', 'typed', 'spoken', 'avatar'];
const MODEL_TIMEOUT_MS = 8000;

/** OpenStreetMap's own tiles by default; their usage policy suits a demo, not heavy traffic, so a deployment can point elsewhere. */
const MAP: MapConfig = {
  tileUrl: process.env.TRAVEL_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: process.env.TRAVEL_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};

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

const contextOf = (state: TravelState, lastAvatarLine: string, spoken: boolean): JudgeContext => ({
  stage: state.stage,
  current: state.country,
  visited: state.visited.map((e) => e.country),
  hasSpots: state.spots.length > 0,
  lastAvatarLine,
  spoken,
});

/** The app's own model, for a line the rules could not place. */
async function modelAction(text: string, ctx: JudgeContext): Promise<Action | null> {
  if (!llmAvailable() || !worthAsking(text)) return null;
  try {
    const intent = await withTimeout(structured<ModelIntent>({ system: 'You read one utterance for a travel board.', user: intentPrompt(text, ctx), schema: INTENT_SCHEMA, temperature: 0 }), MODEL_TIMEOUT_MS);
    return actionFrom(intent, ctx);
  } catch (err) {
    console.warn('[Travel] reading the utterance failed (%s); the guide answers it alone', (err as Error).message);
    return null;
  }
}

const app: AppServer = {
  id: ID,
  title: 'Travel Guide',
  tagline: 'Plan a trip on a live map, or find what is worth seeing near you, with a well-travelled friend.',
  maxSeconds: 900,
  routes(router) {
    router.post('/trips', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      const state = new TravelState(Boolean(geo.newsKey()));
      trips.set(id, { state, at: Date.now() });
      for (const [key, trip] of trips) if (Date.now() - trip.at > 3 * 3600_000) trips.delete(key);
      res.json({ id, snapshot: state.snapshot(), map: MAP });
    });

    router.get('/trips/:id', (req, res) => {
      const trip = trips.get(req.params.id);
      if (!trip) return void res.status(404).json({ error: 'no_trip' });
      res.json(trip.state.snapshot());
    });

    router.post('/trips/:id/act', async (req, res) => {
      const trip = trips.get(req.params.id);
      if (!trip) return void res.status(404).json({ error: 'no_trip' });
      const { state } = trip;
      trip.at = Date.now();
      const body = (req.body ?? {}) as { action?: unknown; text?: unknown; from?: unknown; lastAvatarLine?: unknown };
      const said = typeof body.text === 'string' ? body.text.trim().slice(0, 500) : '';
      const control = actionIn(body.action);
      const from: Source = SOURCES.includes(body.from as Source) ? (body.from as Source) : control ? 'button' : 'typed';

      // The guide's own words, read only while the user waits for it to choose a country.
      if (from === 'avatar') {
        const cue = said ? await fromAvatar(state, lookups, said) : null;
        return void res.json({ snapshot: state.snapshot(), handled: Boolean(cue), kind: 'destination', ...(cue ? { event: cue, ttl: ttlFor('destination') } : {}) } satisfies Outcome);
      }

      let action: Action | null = control;
      if (!action && said) {
        const ctx = contextOf(state, typeof body.lastAvatarLine === 'string' ? body.lastAvatarLine.slice(0, 500) : '', from === 'spoken');
        action = ruleAction(said, ctx) ?? (await modelAction(said, ctx));
      }
      if (!action) return void res.json({ snapshot: state.snapshot(), handled: false } satisfies Outcome);

      const cue = await apply(state, lookups, action, from);
      const event = eventFor(action.kind, cue, from, said);
      console.info('[Travel] %s %s -> %s', from, action.kind, event ? 'event' : 'no event');
      res.json({ snapshot: state.snapshot(), handled: true, kind: action.kind, ...(event ? { event, ttl: ttlFor(action.kind) } : {}) } satisfies Outcome);
    });
  },
};

export default app;
