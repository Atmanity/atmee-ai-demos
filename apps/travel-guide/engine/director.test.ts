// What the host is told: within the API's limits, every tool named in its
// rules, the board in its state but never what is not on screen yet (so the
// host must call the tool), and results that never claim what the app does
// not know.
import { describe, expect, test } from 'vitest';
import { boardState, instructions, pressed, say, STATE_LIMIT, tools } from './director.ts';
import type { Snapshot, Spot } from './types.ts';

const base = (): Snapshot => ({
  seq: 1, stage: 'welcome', travelerName: '', continent: '', pending: false, newsAvailable: true,
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

describe.each([true, false])('the tools and the rules, with a news source: %s', (news) => {
  const list = tools(news);
  const rules = instructions(news);

  test('the tools fit the API: names, descriptions, schemas, timeouts', () => {
    expect(list.length).toBeLessThanOrEqual(30);
    const names = list.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of list) {
      expect(tool.type).toBe('function');
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
      expect(['web_search', 'lookup']).not.toContain(tool.name);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeLessThanOrEqual(500);
      expect(tool.parameters.type).toBe('object');
      expect(JSON.stringify(tool.parameters).length).toBeLessThanOrEqual(4096);
      const mode = tool['x-atmee']?.mode;
      // Only writing a name down needs no answer; everything the host speaks about waits for the app.
      expect(mode).toBe(tool.name === 'remember_name' ? 'notify' : 'await');
      if (mode === 'await') {
        expect(tool['x-atmee']!.timeoutSeconds!).toBeGreaterThanOrEqual(8);
        expect(tool['x-atmee']!.timeoutSeconds!).toBeLessThanOrEqual(28);
      }
    }
    expect(JSON.stringify(list).length).toBeLessThanOrEqual(24576);
  });

  test('the rules fit, and name every tool', () => {
    expect(rules.length).toBeLessThanOrEqual(4000);
    for (const tool of list) expect(rules).toContain(tool.name);
  });

  test('the news is a tool only when there is a source, and never promised without one', () => {
    expect(list.some((t) => t.name === 'show_news')).toBe(news);
    expect(rules.includes('show_news')).toBe(news);
    if (!news) expect(rules).toContain('no local news');
  });

  test('a destructive or surprising move is never the host\'s own idea', () => {
    expect(rules).toMatch(/Never start something on your own/);
    expect(rules).toMatch(/never claim/);
  });
});

test('the schemas are lenient: a call that does not fit them never reaches the app, and the host then claims it worked', () => {
  for (const tool of tools(true)) {
    const schema = JSON.stringify(tool.parameters);
    for (const strict of ['"enum"', '"pattern"', '"format"', '"minLength"', '"required"', '"additionalProperties":false']) expect(schema, `${tool.name} ${strict}`).not.toContain(strict);
    for (const prop of Object.values((tool.parameters as { properties: Record<string, { maxLength?: number }> }).properties)) expect(prop.maxLength ?? 500).toBeGreaterThanOrEqual(200);
  }
});

test('the rules say: call, never narrate', () => {
  for (const news of [true, false]) {
    expect(instructions(news)).toContain('Every request that changes the screen is a tool call, even a single word answering your own question');
    expect(instructions(news)).toContain("never say something is on the map or on screen unless a tool's result said so");
  }
});

test('every result starts with the plain outcome, so the first real words are the app\'s', () => {
  const results = [
    say.named('Sam'), say.noName(), say.continentOnly('Asia'), say.noDestination(), say.notFound('Atlantis'),
    say.destination('Japan'), say.destination('Japan', { how: 'picked' }), say.noCountryForNews(), say.news('Japan', japan().news!.headlines),
    say.noNews('Japan'), say.noCountryForFood(), say.food('Japan', [{ name: 'Ramen', description: '' }]), say.noFood('Japan'),
    say.revisited('Japan', []), say.alreadyHere('Japan'), say.notOnTrip(['Peru']), say.nothingToGoBack(), say.askPlace(), say.countryNotTown('Japan'),
    say.placeNotFound('Nowhere'), say.lookupDown('Kyoto'), say.quiet('Kyoto'), say.firstSpot('Kyoto', spot()), say.anotherSpot(spot()), say.lastSpot(),
    say.firstAlready('Kyoto'), say.nothingQueued('Kyoto'), say.askWhereToLook(), say.notLookedYet(), say.nothingToShow(), say.noCountryThere(),
    say.badCoordinates(), say.showPlanning('Japan'), say.showPlanning(''), say.showAround('Kyoto', spot()), say.showAround('', null),
    say.stillWorking('looking around Kyoto'), say.lateFailed(), say.serviceDown(), say.freshTrip(),
  ];
  for (const text of results) expect(text).toMatch(/^(Done|Not yet|Not found|Not done|Already done): /);
});

test('the tools take what the host heard, nothing the app decides', () => {
  const params = Object.fromEntries(tools(true).map((t) => [t.name, Object.keys((t.parameters as { properties: object }).properties)]));
  expect(params).toEqual({
    choose_destination: ['place'], show_food: [], show_news: [], explore_near: ['place'], next_sight: [], previous_sight: [], remember_name: ['name'],
  });
});

test('the worst board there is still fits the state limit', () => {
  const long = (n: number) => 'x'.repeat(n);
  const worst = japan({
    travelerName: 'Ana Sofia Ruiz',
    news: { country: 'Japan', headlines: Array.from({ length: 5 }, () => ({ title: long(180), source: 'x', url: '', publishDate: '' })), shown: true, loading: false },
    food: { country: 'Japan', dishes: Array.from({ length: 3 }, () => ({ name: long(80), description: long(160), imageUrl: null })), shown: true, loading: false },
    trip: { current: 'Japan', visited: Array.from({ length: 30 }, (_, i) => ({ country: `Country ${i} ${long(40)}`, city: long(80), dishes: [], headlineCount: 0, silhouette: null })) },
  });
  expect(boardState(worst).length).toBeLessThanOrEqual(STATE_LIMIT);
  const around = { ...worst, stage: 'around' as const, spot: { place: long(80), origin: null, index: 0, total: 8, lookupFailed: false, spot: spot({ name: long(80), summary: long(280) }), pins: [] } };
  expect(boardState(around).length).toBeLessThanOrEqual(STATE_LIMIT);
});

describe('the live board', () => {
  test('dishes and headlines are in it once they are on screen, and not before: the host has to call for them', () => {
    const hidden = boardState(japan());
    expect(hidden).not.toContain('Ramen');
    expect(hidden).not.toContain('Cherry blossom');
    expect(hidden).toContain('call show_food');
    expect(hidden).toContain('call show_news');
    const shown = boardState(japan({ news: { ...japan().news!, shown: true }, food: { ...japan().food!, shown: true } }));
    expect(shown).toContain('On screen, dishes from Japan: Ramen (Broth and noodles.)');
    expect(shown).toContain('Cherry blossom early');
    expect(shown).not.toContain('call show_');
  });

  test('no news source: no news, and no tool named for it', () => {
    const text = boardState(japan({ newsAvailable: false }));
    expect(text).toContain('no local news');
    expect(text).not.toContain('show_news');
  });

  test('the sight on screen and its facts are in it, the next one never is', () => {
    const s: Snapshot = { ...base(), stage: 'around', spot: { place: 'Kyoto', origin: [35, 135.77], index: 0, total: 2, lookupFailed: false, spot: spot(), pins: [{ name: 'Kiyomizu-dera', category: 'attraction', lat: 35, lon: 135.78 }, { name: 'Nishiki Market', category: 'attraction', lat: 35.005, lon: 135.765 }] } };
    const text = boardState(s);
    expect(text).toContain('sight 1 of 2 is on screen: Kiyomizu-dera, an attraction, about a 9 minute walk away');
    expect(text).toContain('A Buddhist temple on a hillside.');
    expect(text).not.toContain('Nishiki Market');
    expect(text).toContain('only next_sight knows');
  });

  test('not said yet, failed, or quiet: three different boards', () => {
    expect(boardState({ ...base(), stage: 'around' })).toContain('asks which place');
    expect(boardState({ ...base(), stage: 'around', spot: { place: 'Kyoto', origin: null, index: 0, total: 0, lookupFailed: true, spot: null, pins: [] } })).toContain('not answering');
    expect(boardState({ ...base(), stage: 'around', spot: { place: 'Hemel', origin: null, index: 0, total: 0, lookupFailed: false, spot: null, pins: [] } })).toContain('nothing stands out');
  });

  test('the route is in it once there is one, and the way back is the tool', () => {
    const two = japan({ trip: { current: 'Japan', visited: [{ country: 'Peru', city: '', dishes: [], headlineCount: 0, silhouette: null }, japan().trip.visited[0]] } });
    expect(boardState(two)).toContain('Their route so far: Peru and Japan (Kyoto)');
    expect(boardState(two)).toContain('choose_destination');
    expect(boardState(japan())).not.toContain('route');
  });

  test('headlines are never called today\'s, except to forbid it', () => {
    const shown = japan({ news: { ...japan().news!, shown: true } });
    for (const text of [boardState(shown), instructions(true), say.news('Japan', shown.news!.headlines)]) {
      for (const m of text.matchAll(/today/gi)) expect(text.slice(Math.max(0, m.index! - 20), m.index)).toMatch(/never call them $/);
    }
  });
});

describe('results', () => {
  test('a result never has the host start the next thing itself: it asks', () => {
    for (const text of [say.destination('Japan', { newsAvailable: true }), say.destination('Japan', { how: 'picked' })]) {
      expect(text).toMatch(/ask whether/);
      expect(text).toMatch(/only if they say yes/);
    }
    expect(say.destination('Japan', { newsAvailable: true })).toContain('headlines');
    expect(say.destination('Japan')).not.toContain('headlines');
  });

  test('dishes come with their words, so the host says the app\'s dishes and no others', () => {
    const text = say.food('Japan', [{ name: 'Ramen', description: 'Broth and noodles.' }, { name: 'Sushi', description: '' }]);
    expect(text).toContain('Ramen (Broth and noodles.); Sushi');
    expect(text).toContain('adding no other dishes');
  });

  test('a sight reads aloud, with its place in the list, and names no other', () => {
    expect(say.firstSpot('Kyoto', spot(), 8)).toContain('the first of 8 sights worth seeing is on screen: Kiyomizu-dera, an attraction, about a 9 minute walk away');
    expect(say.anotherSpot(spot({ category: 'museum' }), 2, 8)).toContain('sight 2 of 8: Kiyomizu-dera, a museum');
    for (const text of [say.firstSpot('Kyoto', spot()), say.anotherSpot(spot())]) expect(text).toContain('naming no other sight');
  });

  test('the opening never greets again (the host already did), and picks up what is on the board', () => {
    for (const s of [base(), japan(), { ...base(), stage: 'around' as const, spot: { place: 'Kyoto', origin: null, index: 0, total: 1, lookupFailed: false, spot: spot(), pins: [] } }]) {
      expect(say.opening(s).startsWith('You have just greeted them; do not greet or introduce yourself again.')).toBe(true);
    }
    expect(say.opening(base())).toContain('where in the world they are dreaming of');
    expect(say.opening({ ...base(), travelerName: 'Sam' })).toContain('They are called Sam');
    expect(say.opening(japan())).toContain('They have already put Japan on the map');
  });

  test('a slow lookup is admitted, never guessed at; a button is told as a press', () => {
    expect(say.stillWorking('looking around Shibuya')).toContain('say nothing about the result yet');
    expect(say.landed('Japan is on the map now.')).toMatch(/finished.*Japan is on the map now\./);
    expect(pressed('Surprise me', 'Portugal is your pick.')).toBe('The user pressed "Surprise me" on screen. Portugal is your pick.');
  });
});
