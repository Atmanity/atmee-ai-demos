// The host's tools and the buttons, run against lookups that never touch the
// network: what each call puts on the board, and what it tells the host.
import { beforeAll, describe, expect, test, vi } from 'vitest';
import type { GeoCountry, RawSpot } from './geo.ts';
import { TravelState } from './state.ts';
import { isToolName, runAction, runTool, TOOL_NAMES } from './tools.ts';
import type { Lookups } from './trip.ts';
import { tools } from './director.ts';

beforeAll(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

const square = (lon: number, lat: number, d = 5) => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
const country = (name: string, isoCode: string, at: [number, number]): GeoCountry => ({
  country: name, isoCode, center: at, bbox: [at[0] - 5, at[1] - 5, at[0] + 5, at[1] + 5],
  geojson: { type: 'Polygon', coordinates: [square(at[1] - 4, at[0] - 4, 8)] },
});
const COUNTRIES: Record<string, GeoCountry> = {
  Japan: country('Japan', 'JP', [36, 138]),
  Peru: country('Peru', 'PE', [-9, -75]),
  Portugal: country('Portugal', 'PT', [39.6, -8]),
  Indonesia: country('Indonesia', 'ID', [-2, 118]),
};
const sights = (): RawSpot[] => [
  { name: 'Hachikō', category: 'memorial', lat: 35.659, lon: 139.7006 },
  { name: 'Shibuya Crossing', category: 'attraction', lat: 35.6595, lon: 139.7005 },
  { name: 'Meiji Shrine', category: 'shrine', lat: 35.6764, lon: 139.6993 },
];

function fakeLookups(over: Partial<Lookups> = {}) {
  const calls: string[] = [];
  const lookups: Lookups = {
    // The named few, and any other real-sounding country ("surprise me" picks from the ideas), each with its own
    // code as real ones have (Niger and Nigeria must not collide); Atlantis is nowhere.
    country: async (name) => { calls.push(`country:${name}`); return name === 'Atlantis' ? null : structuredClone(COUNTRIES[name] ?? country(name, name.replace(/\s/g, '').slice(0, 6).toUpperCase(), [10, 10])); },
    place: async (q) => {
      calls.push(`place:${q}`);
      if (/shibuya/i.test(q)) return { place: 'Shibuya', country: 'Japan', isoCode: 'JP', lat: 35.658, lon: 139.7016 };
      if (/bali/i.test(q)) return { place: 'Bali', country: 'Indonesia', isoCode: 'ID', lat: -8.4, lon: 115.2 };
      return null;
    },
    reverse: async () => null,
    nearby: async () => { calls.push('nearby'); return sights(); },
    summary: async (title) => { calls.push(`summary:${title}`); return { title, coordinates: null, image: null, extract: `${title} is worth the trip.` }; },
    headlines: async (iso) => { calls.push(`headlines:${iso}`); return [{ title: `News from ${iso}`, source: 'x', url: '', publishDate: '' }]; },
    dishes: async (name) => { calls.push(`dishes:${name}`); return [{ name: `${name} dish`, description: 'Worth the queue.' }]; },
    ...over,
  };
  return { lookups, calls };
}

async function settled(state: TravelState) {
  for (const d of state.detail.values()) await Promise.all([d.news, d.dishes, d.photos]);
}

test('the tool names the server answers are exactly the ones the host is given', () => {
  expect([...TOOL_NAMES].sort()).toEqual(tools(true).map((t) => t.name).sort());
  expect(isToolName('choose_destination')).toBe(true);
  expect(isToolName('lookup')).toBe(false);
  expect(isToolName(42)).toBe(false);
});

describe('choose_destination', () => {
  test('a country goes on the map, and its food starts loading', async () => {
    const { lookups, calls } = fakeLookups();
    const state = new TravelState();
    const said = await runTool(state, lookups, 'choose_destination', { place: 'Portugal' });
    expect(state.country).toBe('Portugal');
    expect(said).toContain('Portugal is on the map now');
    expect(calls).toContain('dishes:Portugal');
  });

  test('a city goes with its country: named together, or found', async () => {
    const { lookups, calls } = fakeLookups();
    const state = new TravelState();
    await runTool(state, lookups, 'choose_destination', { place: 'Kyoto, Japan' });
    expect([state.country, state.city]).toEqual(['Japan', 'Kyoto']);
    expect(calls.some((c) => c.startsWith('place:'))).toBe(false);
    await runTool(state, lookups, 'choose_destination', { place: 'Bali' });
    expect([state.country, state.city]).toEqual(['Indonesia', 'Bali']);
  });

  test('a continent narrows the ideas and leaves the map alone', async () => {
    const state = new TravelState();
    const said = await runTool(state, fakeLookups().lookups, 'choose_destination', { place: 'somewhere in South America' });
    expect(state.country).toBe('');
    expect(state.continent).toBe('South America');
    expect(said).toContain('ideas from South America');
  });

  test('a country on the route comes back as it was, with nothing fetched again', async () => {
    const { lookups, calls } = fakeLookups();
    const state = new TravelState();
    await runTool(state, lookups, 'choose_destination', { place: 'Japan' });
    await runTool(state, lookups, 'show_food');
    await runTool(state, lookups, 'choose_destination', { place: 'Peru' });
    await settled(state);
    calls.length = 0;
    const said = await runTool(state, lookups, 'choose_destination', { place: 'Japan' });
    expect(state.country).toBe('Japan');
    expect(said).toContain('back on the map');
    expect(said).toContain('Japan dish');
    expect(calls).toEqual([]);
  });

  test('a country whose name sits inside one on the route is placed, not mistaken for it', async () => {
    const { lookups, calls } = fakeLookups();
    const state = new TravelState();
    await runTool(state, lookups, 'choose_destination', { place: 'Nigeria' });
    await runTool(state, lookups, 'choose_destination', { place: 'Peru' });
    calls.length = 0;
    expect(await runTool(state, lookups, 'choose_destination', { place: 'Niger' })).toMatch(/^Done: Niger is on the map/);
    expect(state.country).toBe('Niger');
    expect(calls).toContain('country:Niger');
  });

  test('the country on screen: its page comes back from its sights, or the host hears it is already there', async () => {
    const { lookups } = fakeLookups();
    const state = new TravelState();
    await runTool(state, lookups, 'choose_destination', { place: 'Japan' });
    expect(await runTool(state, lookups, 'choose_destination', { place: 'Japan' })).toContain('already looking at Japan');
    await runTool(state, lookups, 'explore_near', { place: 'Shibuya station' });
    expect(state.stage).toBe('around');
    expect(await runTool(state, lookups, 'choose_destination', { place: 'Japan' })).toContain('back on Japan');
    expect(state.stage).toBe('planning');
  });

  test('nothing, or nowhere: the host asks', async () => {
    const state = new TravelState();
    expect(await runTool(state, fakeLookups().lookups, 'choose_destination', {})).toMatch(/^Not done: no destination was given/);
    expect(await runTool(state, fakeLookups().lookups, 'choose_destination', { place: 'Atlantis' })).toMatch(/^Not found: could not place Atlantis/);
    expect(state.seq).toBe(0);
  });
});

describe('which choices overtake a destination still being looked up', () => {
  // The ticket moves exactly when the latest choice changes which destination should be on the map: a new
  // country or going back to one (even the one already there) overtakes an older lookup still in flight; a
  // continent alone, or a tab, leaves the map as it is and overtakes nothing.
  type Act = (state: TravelState, lookups: Lookups) => Promise<string>;
  const rows: [string, Act, string][] = [
    ['a new country', (st, l) => runTool(st, l, 'choose_destination', { place: 'Peru' }), 'Peru'],
    ['a city found by search', (st, l) => runAction(st, l, { kind: 'search', query: 'Bali' }), 'Indonesia'],
    ['a tap on the map', (st, l) => runAction(st, { ...l, reverse: async () => ({ place: 'Cusco', country: 'Peru', isoCode: 'PE', lat: -13.5, lon: -72 }) }, { kind: 'destinationAt', lat: -13.5, lon: -72 }), 'Peru'],
    ['surprise me', (st, l) => runAction(st, l, { kind: 'pick' }), 'picked'],
    ['going back to a country on the route', (st, l) => runAction(st, l, { kind: 'revisit', country: 'Norway' }), 'Norway'],
    ['confirming the country on the map', (st, l) => runTool(st, l, 'choose_destination', { place: 'Portugal' }), 'Portugal'],
    ['coming back from its sights to its page', async (st, l) => { await runTool(st, l, 'explore_near', { place: 'Shibuya station' }); return runTool(st, l, 'choose_destination', { place: 'Portugal' }); }, 'Portugal'],
    ['a continent alone', (st, l) => runTool(st, l, 'choose_destination', { place: 'somewhere in Asia' }), 'Japan'],
    ['a continent chip', (st, l) => runAction(st, l, { kind: 'continent', continent: 'Asia' }), 'Japan'],
    ['a tab', (st, l) => runAction(st, l, { kind: 'show', stage: 'around' }), 'Japan'],
  ];
  test.each(rows)('%s', async (_, act, lands) => {
    const { lookups } = fakeLookups();
    const state = new TravelState();
    await runTool(state, lookups, 'choose_destination', { place: 'Norway' });
    await runTool(state, lookups, 'choose_destination', { place: 'Portugal' });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const country = lookups.country;
    const slow: Lookups = { ...lookups, country: async (name) => { if (name === 'Japan') await gate; return country(name); } };
    const older = runTool(state, slow, 'choose_destination', { place: 'Japan' });
    await act(state, lookups);
    const after = state.country;
    release();
    const olderSaid = await older;
    if (lands === 'Japan') {
      expect(state.country).toBe('Japan');
      expect(olderSaid).toMatch(/^Done: Japan is on the map/);
    } else {
      expect(state.country).toBe(lands === 'picked' ? after : lands);
      expect(state.country).not.toBe('Japan');
      expect(olderSaid).toMatch(/^Not done: overtaken/);
    }
  });
});

describe('show_food and show_news', () => {
  test('the dishes, with their words, for the country on the map', async () => {
    const state = new TravelState();
    const { lookups } = fakeLookups();
    expect(await runTool(state, lookups, 'show_food')).toMatch(/^Not yet: no country is chosen yet/);
    await runTool(state, lookups, 'choose_destination', { place: 'Japan' });
    const said = await runTool(state, lookups, 'show_food');
    expect(state.snapshot().food!.shown).toBe(true);
    expect(said).toContain('Japan dish (Worth the queue.)');
  });

  test('a built-in dish waits a moment for its one line from Wikipedia', async () => {
    const { lookups } = fakeLookups({ dishes: async () => [{ name: 'Ramen', description: '' }] });
    const state = new TravelState();
    await runTool(state, lookups, 'choose_destination', { place: 'Japan' });
    expect(await runTool(state, lookups, 'show_food')).toContain('Ramen (Ramen is worth the trip.)');
  });

  test('asked for while its sights are showing, the country\'s page comes back with them', async () => {
    const { lookups } = fakeLookups();
    const state = new TravelState(true);
    await runTool(state, lookups, 'choose_destination', { place: 'Japan' });
    await runTool(state, lookups, 'explore_near', { place: 'Shibuya station' });
    await runTool(state, lookups, 'show_news');
    expect(state.stage).toBe('planning');
    expect(state.snapshot().news!.shown).toBe(true);
  });

  test('no news source: nothing changes and the host says so', async () => {
    const { lookups, calls } = fakeLookups();
    const state = new TravelState(false);
    await runTool(state, lookups, 'choose_destination', { place: 'Japan' });
    const seq = state.seq;
    expect(await runTool(state, lookups, 'show_news')).toContain('no local news');
    expect(state.seq).toBe(seq);
    expect(calls.some((c) => c.startsWith('headlines:'))).toBe(false);
  });
});

describe('the sights', () => {
  test('explore_near shows the closest, next_sight and previous_sight move one at a time', async () => {
    const { lookups } = fakeLookups();
    const state = new TravelState();
    expect(await runTool(state, lookups, 'explore_near', { place: 'Shibuya station' })).toContain('the first of 3 sights worth seeing is on screen: Hachikō');
    expect(await runTool(state, lookups, 'next_sight')).toContain('sight 2 of 3: Shibuya Crossing');
    expect(await runTool(state, lookups, 'previous_sight')).toContain('sight 1 of 3: Hachikō');
    expect(await runTool(state, lookups, 'previous_sight')).toContain('already the first');
  });

  test('the safety net\'s next sight does nothing if the host already moved: no sight is skipped', async () => {
    const { lookups } = fakeLookups();
    const state = new TravelState();
    await runTool(state, lookups, 'explore_near', { place: 'Shibuya station' });
    await runTool(state, lookups, 'next_sight'); // the host's own, late
    const said = await runTool(state, lookups, 'next_sight', { from: 0 }); // the net's, from the sight it saw
    expect(state.spotIndex).toBe(1);
    expect(said).toMatch(/^Already done: sight 2 of 3/);
    await runTool(state, lookups, 'next_sight', { from: 1 });
    expect(state.spotIndex).toBe(2);
  });

  test('the safety net\'s move queued behind the host\'s own is checked when its turn comes, not before', async () => {
    // Same race as the explore: the check ran outside the lock, so a net Next queued behind the host's Next
    // (still describing its sight) passed the check and then moved again, skipping a sight.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow = fakeLookups();
    const state = new TravelState();
    await runTool(state, slow.lookups, 'explore_near', { place: 'Shibuya station' });
    slow.lookups.summary = async (title) => { await gate; return { title, coordinates: null, image: null, extract: '' }; };
    const host = runTool(state, slow.lookups, 'next_sight');
    const net = runTool(state, slow.lookups, 'next_sight', { from: 0 });
    release();
    const [, netSaid] = await Promise.all([host, net]);
    expect(state.spotIndex).toBe(1);
    expect(netSaid).toMatch(/^Already done: sight 2 of 3/);
  });

  test('the next sight brings the sights back from the country\'s page', async () => {
    const { lookups } = fakeLookups();
    const state = new TravelState();
    await runTool(state, lookups, 'choose_destination', { place: 'Japan' });
    await runTool(state, lookups, 'explore_near', { place: 'Shibuya station' });
    await runTool(state, lookups, 'show_food');
    expect(state.stage).toBe('planning');
    await runTool(state, lookups, 'next_sight');
    expect([state.stage, state.spotIndex]).toEqual(['around', 1]);
  });

  test('before anywhere was looked at, the host asks where', async () => {
    expect(await runTool(new TravelState(), fakeLookups().lookups, 'next_sight')).toContain('which town');
    expect(await runTool(new TravelState(), fakeLookups().lookups, 'explore_near', {})).toMatch(/^Not done: no place was given/);
  });
});

describe('arguments as the host sends them: any case, other words for the same thing, extra fields', () => {
  test('a capitalised place, a synonym, and an unknown extra field all work', async () => {
    const { lookups } = fakeLookups();
    const state = new TravelState();
    expect(await runTool(state, lookups, 'choose_destination', { place: '  PORTUGAL ', mood: 'sunny', urgency: 3 })).toMatch(/^Done: Portugal is on the map/);
    await runTool(state, lookups, 'choose_destination', { place: 'the UK' });
    expect(state.country).toBe('United Kingdom');
    await runTool(state, lookups, 'choose_destination', { country: 'Japan' }); // the host named the field its own way
    expect(state.country).toBe('Japan');
    expect(await runTool(state, lookups, 'explore_near', { location: 'Shibuya Station', radius: 'small' })).toMatch(/^Done: around Shibuya/);
    expect(await runTool(state, lookups, 'next_sight', { politely: true })).toMatch(/^Done: now on screen, sight 2 of 3/);
    await runTool(state, lookups, 'remember_name', { first_name: '  sam ' });
    expect(state.travelerName).toBe('Sam');
  });

  test('an unusable value gets a question for the host to ask, never silence', async () => {
    const state = new TravelState();
    expect(await runTool(state, fakeLookups().lookups, 'choose_destination', { place: 42 })).toMatch(/^Not done: .* Ask/);
    expect(await runTool(state, fakeLookups().lookups, 'explore_near', { place: '' })).toMatch(/^Not done: .* Ask/);
  });
});

test('remember_name writes a name down, and only a name', async () => {
  const state = new TravelState();
  await runTool(state, fakeLookups().lookups, 'remember_name', { name: 'mei lin' });
  expect(state.travelerName).toBe('Mei Lin');
  expect(await runTool(state, fakeLookups().lookups, 'remember_name', { name: 'dreaming of Japan' })).toContain('did not sound like a name');
  expect(state.travelerName).toBe('');
});

describe('buttons take the same paths', () => {
  test('a route chip, an idea chip and the search box choose a destination like the host does', async () => {
    const { lookups, calls } = fakeLookups();
    const state = new TravelState();
    await runAction(state, lookups, { kind: 'destination', country: 'Japan' });
    await runAction(state, lookups, { kind: 'search', query: 'Peru' });
    await settled(state);
    calls.length = 0;
    expect(await runAction(state, lookups, { kind: 'revisit', country: 'Japan' })).toContain('back on the map');
    expect(calls).toEqual([]);
  });

  test('food, next and previous run the tools\' paths; the rest run the trip\'s', async () => {
    const { lookups } = fakeLookups();
    const state = new TravelState();
    await runAction(state, lookups, { kind: 'search', query: 'Japan' });
    expect(await runAction(state, lookups, { kind: 'food' })).toContain('Japan dish');
    await runAction(state, lookups, { kind: 'around', place: 'Shibuya station' });
    expect(await runAction(state, lookups, { kind: 'next' })).toContain('Shibuya Crossing');
    expect(await runAction(state, lookups, { kind: 'pick' })).toContain('your pick');
  });
});
