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
    // The named few, and any other real-sounding country ("surprise me" picks from the ideas); Atlantis is nowhere.
    country: async (name) => { calls.push(`country:${name}`); return name === 'Atlantis' ? null : structuredClone(COUNTRIES[name] ?? country(name, name.slice(0, 2).toUpperCase(), [10, 10])); },
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
    expect(await runTool(state, fakeLookups().lookups, 'choose_destination', {})).toContain('No destination was given');
    expect(await runTool(state, fakeLookups().lookups, 'choose_destination', { place: 'Atlantis' })).toContain('Could not place Atlantis');
    expect(state.seq).toBe(0);
  });
});

describe('show_food and show_news', () => {
  test('the dishes, with their words, for the country on the map', async () => {
    const state = new TravelState();
    const { lookups } = fakeLookups();
    expect(await runTool(state, lookups, 'show_food')).toContain('No country is chosen yet');
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
    expect(await runTool(state, lookups, 'explore_near', { place: 'Shibuya station' })).toContain('the closest of 3 sights is on screen: Hachikō');
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
    expect(said).toContain('done already');
    await runTool(state, lookups, 'next_sight', { from: 1 });
    expect(state.spotIndex).toBe(2);
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
    expect(await runTool(new TravelState(), fakeLookups().lookups, 'explore_near', {})).toContain('No place was given');
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
