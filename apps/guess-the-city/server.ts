// Guess the City's server side: it owns the game (the page never learns the
// city before the reveal), builds each deck with a model call, serves the
// photos behind opaque URLs, and answers the host's tool calls and the
// player's buttons with one set of actions.
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { DECK_SCHEMA, deckFrom, deckPrompt, shuffledFallback } from './engine/deck.ts';
import { INSTRUCTIONS, pressed, said, TOOLS } from './engine/director.ts';
import { Game } from './engine/game.ts';
import { MATCH_SCHEMA, matchPrompt, namesCity, type Command } from './engine/judge.ts';
import { PhotoStore, tokenOf } from './engine/photos.ts';
import type { City, View } from './engine/types.ts';

const ID = 'guess-the-city';
// Wikimedia refuses requests without a descriptive User-Agent with contact details.
const USER_AGENT = process.env.WIKIMEDIA_USER_AGENT || 'atmee-usecase-demos/0.2 (https://atmee.ai; engineering@atmee.ai)';

interface Play { game: Game; photos: (string | null)[]; at: number }
const plays = new Map<string, Play>();
const postcards = new PhotoStore((url) => fetch(url, { headers: { 'User-Agent': USER_AGENT } }));
// How long a new round waits for its photo before Marco announces it anyway.
const PHOTO_WAIT_MS = 6000;
const recentCities: string[] = [];   // the last few decks' cities, for the next deck to avoid

async function newDeck(): Promise<City[]> {
  if (!llmAvailable()) return shuffledFallback();
  try {
    const deck = deckFrom(await structured({ system: 'You write content for a city-guessing game.', user: deckPrompt(recentCities), schema: DECK_SCHEMA, temperature: 1 }));
    if (deck) {
      recentCities.push(...deck.map((c) => c.name));
      recentCities.splice(0, Math.max(0, recentCities.length - 12));
      return deck;
    }
    console.warn('[%s] the generated deck was unusable; using the built-in one', ID);
  } catch (err) {
    console.warn('[%s] deck generation failed (%s); using the built-in one', ID, (err as Error).message);
  }
  return shuffledFallback();
}

/** A lead image from Wikipedia for the city, behind a random token, or null. */
async function photoFor(city: City): Promise<string | null> {
  for (const title of [city.name, `${city.name}, ${city.country}`, `${city.name} City`]) {
    try {
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) continue;
      const data: any = await res.json();
      const source = data.originalimage?.source || data.thumbnail?.source;
      if (!source) continue;
      const token = randomBytes(12).toString('hex');
      postcards.add(token, data.thumbnail?.source && data.originalimage?.width > 2400 ? data.thumbnail.source.replace(/\/\d+px-/, '/1280px-') : source);
      return `/api/apps/${ID}/photo/${token}`;
    } catch {
      // the next title, or no photo
    }
  }
  return null;
}

async function newPlay(): Promise<Play> {
  const deck = await newDeck();
  // Photos are best-effort and never hold the game up for long.
  const photos = await Promise.all(deck.map((city) => Promise.race([photoFor(city), new Promise<null>((r) => setTimeout(r, 8000, null))])));
  // Every round's photo starts downloading now, so a round never opens on an empty card.
  for (const photo of photos) if (photo) void postcards.get(tokenOf(photo));
  return { game: new Game(deck), photos, at: Date.now() };
}

const viewOf = (play: Play) => play.game.view(play.photos[Math.min(play.game.index, play.photos.length - 1)] ?? null);

/** The game's actions: what each did, as the words the host speaks from. */
async function run(play: Play, action: string, args: Record<string, unknown> = {}): Promise<{ play: Play; text: string }> {
  const { game } = play;
  if (action === 'new_game') {
    // A fresh deck: the same three cities again would be no game.
    const fresh = await newPlay();
    return { play: fresh, text: said.start(viewOf(fresh)) };
  }
  if (game.over) return { play, text: said.finished() };
  switch (action) {
    case 'check_guess': {
      if (game.revealed) return { play, text: said.alreadyRevealed(viewOf(play)) };
      const place = String(args.place ?? '').trim().slice(0, 80);
      if (!place) return { play, text: 'No place was given: ask the player which city they mean.' };
      if (await isTheCity(game.city, place)) {
        const points = game.win();
        return { play, text: said.right(viewOf(play), points) };
      }
      return { play, text: said.wrong(place, viewOf(play)) };
    }
    case 'get_clue': {
      if (game.revealed) return { play, text: said.alreadyRevealed(viewOf(play)) };
      const clue = game.hint();
      return { play, text: clue ? said.clue(clue, viewOf(play)) : said.noClue() };
    }
    case 'reveal_answer':
      if (!game.skip()) return { play, text: said.alreadyRevealed(viewOf(play)) };
      return { play, text: said.reveal(viewOf(play)) };
    case 'next_city': {
      if (!game.next()) return { play, text: said.notRevealed() };
      // Marco says the photo is up, so it must be: wait for it (bounded); one that
      // cannot be had becomes the no-photo card, and he is told so.
      const photo = play.photos[game.index];
      if (!game.over && photo) {
        const got = await Promise.race([postcards.get(tokenOf(photo)), new Promise<'slow'>((r) => setTimeout(r, PHOTO_WAIT_MS, 'slow'))]);
        if (got === null) play.photos[game.index] = null;
      }
      const view = viewOf(play);
      return { play, text: game.over ? said.over(view) : said.next(view) };
    }
  }
  throw new Error(`unknown action ${action}`);
}

async function isTheCity(city: City, place: string): Promise<boolean> {
  if (namesCity(place, city)) return true;
  if (!llmAvailable()) return false;
  try {
    const verdict = await structured<{ correct: boolean }>({ system: 'You judge one answer in a city-guessing game.', user: matchPrompt(city, place), schema: MATCH_SCHEMA, temperature: 0 });
    return verdict.correct === true;
  } catch (err) {
    console.warn('[%s] judging failed (%s); matching the name only', ID, (err as Error).message);
    return false;
  }
}

const BUTTONS: Record<Command, [string, string]> = {
  hint: ['get_clue', 'Get a clue'], skip: ['reveal_answer', 'I give up'], next: ['next_city', 'Next city'], new: ['new_game', 'Play again'],
};
const ACTIONS = new Set(TOOLS.map((t) => t.name));

const app: AppServer = {
  id: ID,
  title: 'Postmark',
  tagline: 'One photo, three clues: guess the city with Marco.',
  brand: { color: '#17224a', ink: '#ffffff' },
  maxSeconds: 600,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
  routes(router) {
    router.post('/games', async (_req, res) => {
      const id = randomBytes(9).toString('hex');
      const play = await newPlay();
      plays.set(id, play);
      for (const [key, p] of plays) if (Date.now() - p.at > 3 * 3600_000) plays.delete(key);
      const view = viewOf(play);
      res.json({ id, view, opening: said.start(view) });
    });

    // The host's tool calls: the result is what it says next.
    router.post('/games/:id/tool', async (req, res) => {
      const play = plays.get(req.params.id);
      if (!play) return void res.status(404).json({ error: 'no_game' });
      const { name, arguments: args } = req.body as { name?: string; arguments?: Record<string, unknown> };
      if (!name || !ACTIONS.has(name)) return void res.status(400).json({ error: 'unknown_tool' });
      const done = await run(play, name, args ?? {});
      plays.set(req.params.id, done.play);
      res.json({ view: viewOf(done.play), result: done.text } satisfies { view: View; result: string });
    });

    // The player's buttons: the host cannot see them, so it is told.
    router.post('/games/:id/act', async (req, res) => {
      const play = plays.get(req.params.id);
      if (!play) return void res.status(404).json({ error: 'no_game' });
      const button = BUTTONS[(req.body as { command?: Command }).command as Command];
      if (!button) return void res.status(400).json({ error: 'unknown_command' });
      const done = await run(play, button[0]);
      plays.set(req.params.id, done.play);
      res.json({ view: viewOf(done.play), event: pressed(button[1], done.text) });
    });

    router.get('/photo/:token', async (req, res) => {
      const token = req.params.token;
      if (!postcards.has(token)) return void res.status(404).end();
      const photo = await postcards.get(token);
      if (!photo) return void res.status(502).end();
      res.setHeader('Content-Type', photo.type);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.end(photo.body);
    });
  },
};

export default app;
