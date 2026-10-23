// Guess the City's server side: it owns the game (the page never learns the
// city before the reveal), builds each deck with a model call, serves the
// photos behind opaque URLs, and judges everything the player says or types.
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { DECK_SCHEMA, deckFrom, deckPrompt, shuffledFallback } from './engine/deck.ts';
import { say } from './engine/director.ts';
import { Game } from './engine/game.ts';
import { commandIn, GUESS_SCHEMA, guessPrompt, namesCity, type Command } from './engine/judge.ts';
import type { City, Outcome } from './engine/types.ts';

const ID = 'guess-the-city';
// Wikimedia refuses requests without a descriptive User-Agent with contact details.
const USER_AGENT = process.env.WIKIMEDIA_USER_AGENT || 'atmee-usecase-demos/0.2 (https://atmee.ai; engineering@atmee.ai)';

interface Play { game: Game; photos: (string | null)[]; at: number }
const plays = new Map<string, Play>();
const photoSources = new Map<string, string>();     // token -> image URL (never sent to the page)
const photoBytes = new Map<string, { type: string; body: Buffer }>();
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
      photoSources.set(token, data.thumbnail?.source && data.originalimage?.width > 2400 ? data.thumbnail.source.replace(/\/\d+px-/, '/1280px-') : source);
      // Bounded like the bytes: the oldest go first (a game 200 decks back loses its photos).
      if (photoSources.size > 600) photoSources.delete(photoSources.keys().next().value!);
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
  return { game: new Game(deck), photos, at: Date.now() };
}

const viewOf = (play: Play) => play.game.view(play.photos[Math.min(play.game.index, play.photos.length - 1)] ?? null);

function apply(play: Play, command: Command): Outcome {
  const { game } = play;
  if (command === 'hint') {
    const clue = game.hint();
    const view = viewOf(play);
    if (clue) return { view, handled: true, kind: 'hint', event: say.hint(clue, view) };
    if (game.over) return { view, handled: true, event: say.finished() };
    return { view, handled: true, event: game.revealed ? say.solved() : say.noHint() };
  }
  if (command === 'skip') {
    if (game.over) return { view: viewOf(play), handled: true, event: say.finished() };
    if (!game.skip()) return { view: viewOf(play), handled: true };
    return { view: viewOf(play), handled: true, kind: 'skip', event: say.skip(viewOf(play)) };
  }
  if (command === 'next') {
    if (game.over) return { view: viewOf(play), handled: true, event: say.finished() };
    if (!game.next()) return { view: viewOf(play), handled: true, event: say.notRevealed() };
    const view = viewOf(play);
    return { view, handled: true, kind: 'next', event: game.over ? say.over(view) : say.next(view) };
  }
  return { view: viewOf(play), handled: false };
}

/** A spoken or typed line that is not a command: a guess, or something for the avatar alone. */
async function judge(play: Play, text: string): Promise<Outcome> {
  const { game } = play;
  // Between rounds or after the game a city name is not a guess; the avatar answers it.
  if (game.revealed || game.over) return { view: viewOf(play), handled: false };
  let verdict: { isGuess: boolean; place: string; correct: boolean };
  if (llmAvailable()) {
    try {
      verdict = await structured({ system: 'You judge one utterance in a city-guessing game.', user: guessPrompt(game.city, text), schema: GUESS_SCHEMA, temperature: 0 });
    } catch (err) {
      console.warn('[%s] judging failed (%s); matching the name instead', ID, (err as Error).message);
      verdict = { isGuess: namesCity(text, game.city), place: game.city.name, correct: namesCity(text, game.city) };
    }
  } else {
    const right = namesCity(text, game.city);
    const asked = /^\s*(is it|it'?s|it is|maybe|i think it'?s|i guess)\b\s*(.+?)[?.!]*\s*$/i.exec(text);
    verdict = { isGuess: right || Boolean(asked), place: right ? game.city.name : asked?.[2] ?? text, correct: right };
  }
  if (!verdict.isGuess) return { view: viewOf(play), handled: false };
  if (verdict.correct) {
    const points = game.win();
    const view = viewOf(play);
    return { view, handled: true, kind: 'guess', event: say.right(view, points) };
  }
  return { view: viewOf(play), handled: true, kind: 'guess', event: say.wrong(verdict.place || text) };
}

const app: AppServer = {
  id: ID,
  title: 'Guess the City',
  tagline: 'A photo of a mystery city, three clues, and a host who never knows the answer.',
  maxSeconds: 600,
  routes(router) {
    router.post('/games', async (_req, res) => {
      const id = randomBytes(9).toString('hex');
      const play = await newPlay();
      plays.set(id, play);
      for (const [key, p] of plays) if (Date.now() - p.at > 3 * 3600_000) plays.delete(key);
      const view = viewOf(play);
      res.json({ id, outcome: { view, handled: true, event: say.start(view) } satisfies Outcome });
    });

    router.post('/games/:id/act', async (req, res) => {
      const play = plays.get(req.params.id);
      if (!play) return void res.status(404).json({ error: 'no_game' });
      const { command, text } = req.body as { command?: Command; text?: string };
      const said = typeof text === 'string' ? text.trim() : '';
      const action = command ?? (said ? commandIn(said) : null);
      if (action === 'new') {
        // A fresh deck: the same three cities again would be no game.
        const fresh = await newPlay();
        plays.set(req.params.id, fresh);
        const view = viewOf(fresh);
        return void res.json({ view, handled: true, event: say.start(view) } satisfies Outcome);
      }
      if (action) return void res.json(apply(play, action));
      if (said) return void res.json(await judge(play, said));
      res.status(400).json({ error: 'nothing_to_do' });
    });

    router.get('/photo/:token', async (req, res) => {
      const token = req.params.token;
      let cached = photoBytes.get(token);
      if (!cached) {
        const source = photoSources.get(token);
        if (!source) return void res.status(404).end();
        const upstream = await fetch(source, { headers: { 'User-Agent': USER_AGENT } }).catch(() => null);
        if (!upstream?.ok) return void res.status(502).end();
        cached = { type: upstream.headers.get('content-type') || 'image/jpeg', body: Buffer.from(await upstream.arrayBuffer()) };
        photoBytes.set(token, cached);
        if (photoBytes.size > 64) photoBytes.delete(photoBytes.keys().next().value!);
      }
      res.setHeader('Content-Type', cached.type);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.end(cached.body);
    });
  },
};

export default app;
