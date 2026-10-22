// What the guide is told: within the limits, never a fact it should not
// claim, staged answers marked "only if they ask", and an event only when the
// guide does not already know.
import { describe, expect, test } from 'vitest';
import { boardState, eventFor, NOTES, say, STATE_LIMIT, ttlFor } from './director.ts';
import type { Snapshot, Spot } from './types.ts';

const base = (): Snapshot => ({
  seq: 1, stage: 'welcome', travelerName: '', continent: '', awaitingPick: false, pending: false, newsAvailable: true,
  map: null, news: null, food: null, spot: null, trip: { current: '', visited: [] },
});
const japan = (over: Partial<Snapshot> = {}): Snapshot => ({
  ...base(),
  stage: 'planning',
  map: { country: 'Japan', isoCode: 'JP', city: 'Kyoto', center: [36, 138], bbox: null, outline: null, attribution: '' },
  news: { country: 'Japan', headlines: [{ title: 'Cherry blossom early', source: 'nhk', url: '', publishDate: '' }], shown: false, loading: false },
  food: { country: 'Japan', dishes: [{ name: 'Ramen', description: 'Broth and noodles.', imageUrl: null }], shown: false, loading: false },
  trip: { current: 'Japan', visited: [{ country: 'Japan', city: 'Kyoto', dishes: [], headlineCount: 0, silhouette: null }] },
  ...over,
});
const spot = (over: Partial<Spot> = {}): Spot => ({ name: 'Kiyomizu-dera', category: 'attraction', lat: 35, lon: 135.78, distance: 'about a 9 minute walk away', mapsUrl: '', imageUrl: null, summary: 'A Buddhist temple on a hillside.', ...over });

test('every standing note fits the 2,000-character limit', () => {
  for (const note of NOTES) expect(note.length).toBeLessThanOrEqual(2000);
});

test('the worst board there is still fits the state limit', () => {
  const long = (n: number) => 'x'.repeat(n);
  const worst = japan({
    travelerName: 'Ana Sofia Ruiz',
    awaitingPick: true,
    news: { country: 'Japan', headlines: Array.from({ length: 5 }, () => ({ title: long(180), source: 'x', url: '', publishDate: '' })), shown: false, loading: false },
    food: { country: 'Japan', dishes: Array.from({ length: 3 }, () => ({ name: long(80), description: long(160), imageUrl: null })), shown: false, loading: false },
    trip: { current: 'Japan', visited: Array.from({ length: 30 }, (_, i) => ({ country: `Country ${i} ${long(40)}`, city: long(80), dishes: [], headlineCount: 0, silhouette: null })) },
  });
  expect(boardState(worst).length).toBeLessThanOrEqual(STATE_LIMIT);
  const around = { ...worst, stage: 'around' as const, spot: { place: long(80), origin: null, index: 0, total: 8, lookupFailed: false, spot: spot({ name: long(80), summary: long(280) }), pins: [] } };
  expect(boardState(around).length).toBeLessThanOrEqual(STATE_LIMIT);
});

describe('staged answers', () => {
  test('headlines and dishes are ready for the guide, but only "if they ask", until they are on screen', () => {
    const staged = boardState(japan());
    expect(staged).toContain('Cherry blossom early');
    expect(staged).toContain('Ramen (Broth and noodles.)');
    expect(staged).toMatch(/Only if they ask about the news/);
    expect(staged).toMatch(/Only if they ask what to eat/);
    const shown = boardState(japan({ news: { ...japan().news!, shown: true }, food: { ...japan().food!, shown: true } }));
    expect(shown).toContain('On screen, the newest headlines');
    expect(shown).toContain('On screen, dishes from Japan');
    expect(shown).not.toMatch(/Only if they ask/);
  });

  test('no news source, or none came back: the guide says so rather than inventing some', () => {
    expect(boardState(japan({ newsAvailable: false }))).toContain('No news source is set up');
    expect(boardState(japan({ news: { country: 'Japan', headlines: [], shown: false, loading: false } }))).toContain('No headlines came back for Japan');
    expect(boardState(japan({ news: { country: 'Japan', headlines: [], shown: false, loading: true } }))).toContain('still loading');
  });

  test('headlines are never called today\'s, except to forbid it', () => {
    for (const text of [boardState(japan()), ...NOTES]) {
      for (const m of text.matchAll(/today/gi)) expect(text.slice(Math.max(0, m.index! - 20), m.index)).toMatch(/never call them $/);
    }
  });
});

describe('around them', () => {
  test('the current spot and its facts are in the state, and the next one never is', () => {
    const s: Snapshot = { ...base(), stage: 'around', spot: { place: 'Kyoto', origin: [35, 135.77], index: 0, total: 2, lookupFailed: false, spot: spot(), pins: [{ name: 'Kiyomizu-dera', category: 'attraction', lat: 35, lon: 135.78 }, { name: 'Nishiki Market', category: 'attraction', lat: 35.005, lon: 135.765 }] } };
    const text = boardState(s);
    expect(text).toContain('spot 1 of 2 is on screen: Kiyomizu-dera, an attraction, about a 9 minute walk away');
    expect(text).toContain('A Buddhist temple on a hillside.');
    expect(text).not.toContain('Nishiki Market');
    expect(text).toContain('never say which it is');
  });

  test('asked where they are, failed, or quiet: three different things to say', () => {
    expect(boardState({ ...base(), stage: 'around' })).toContain('Ask which town');
    expect(boardState({ ...base(), stage: 'around', spot: { place: 'Kyoto', origin: null, index: 0, total: 0, lookupFailed: true, spot: null, pins: [] } })).toContain('not answering');
    expect(boardState({ ...base(), stage: 'around', spot: { place: 'Hemel', origin: null, index: 0, total: 0, lookupFailed: false, spot: null, pins: [] } })).toContain('nothing stands out');
  });
});

describe('events', () => {
  test('spoken: nothing for what the guide answered from its state, a nudge not to repeat itself for a move it reacted to', () => {
    expect(eventFor('food', say.food('Japan', ['Ramen']), 'spoken')).toBeNull();
    expect(eventFor('news', say.noNews('Japan'), 'spoken')).toMatch(/^You may already have answered them; do not repeat yourself\. No headlines came back for Japan\./);
    expect(eventFor('pick', '', 'spoken')).toBeNull();
    expect(eventFor('destination', 'Japan is on the map now.', 'spoken')).toMatch(/^You may already have answered them; do not repeat yourself\. Japan is on the map now\./);
    // The next spot is something it could not know: the app tells it.
    expect(eventFor('next', 'Offer another one: Nishiki Market.', 'spoken')).toBe('Offer another one: Nishiki Market.');
  });

  test('typed: the line never reached the guide, so the event carries it', () => {
    const e = eventFor('destination', 'Japan is on the map now.', 'typed', "Let's do Japan, what's it like in May?")!;
    expect(e).toContain("Let's do Japan, what's it like in May?");
    expect(e).toContain('answer that too');
  });

  test('a button: the cue as it is; nothing to say: no event', () => {
    expect(eventFor('food', 'Local dishes...', 'button')).toBe('Local dishes...');
    expect(eventFor('goto', '', 'button')).toBeNull();
  });

  test('spots go stale fast; a new country is worth saying for longer', () => {
    expect(ttlFor('next')).toBeLessThan(ttlFor('destination'));
    for (const kind of ['next', 'destination', 'food'] as const) expect(ttlFor(kind)).toBeLessThanOrEqual(60);
  });

  test('the opening asks for a name only when it is not known, and picks up what is already on the board', () => {
    expect(say.opening(base())).toContain('ask what they would like to be called');
    expect(say.opening({ ...base(), travelerName: 'Sam' })).toContain('Greet Sam');
    expect(say.opening(japan())).toContain('They have already put Japan on the map');
  });

  test('the spot line reads aloud: "an attraction", not "a attraction"', () => {
    expect(say.firstSpot('Kyoto', spot())).toContain('Kiyomizu-dera, an attraction, about a 9 minute walk away');
    expect(say.anotherSpot(spot({ category: 'museum' }))).toContain('a museum');
  });
});
