// The operations: what they change, what they tell the host, and how they
// fail. The host's tool calls and the buttons all end up here (through
// tools.ts), so this is where the behaviour is pinned. Ported from
// test_trip.py and the async half of test_the_trip_is_kept.py (test_rpc.py's
// coordinate checks at the end), plus the flows that are new in this port:
// the destination box, the map tap, "surprise me", and detail fetched ahead.
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { IDEAS, WORLD_IDEAS } from './countries.ts';
import { instructions } from './director.ts';
import type { GeoCountry, RawSpot, WikiSummary } from './geo.ts';
import { TravelState } from './state.ts';
import * as trip from './trip.ts';
import type { Lookups } from './trip.ts';

beforeAll(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

const square = (lon: number, lat: number, d = 5) => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
const country = (name: string, isoCode: string, at: [number, number] = [36, 138]): GeoCountry => ({
  country: name, isoCode, center: at, bbox: [at[0] - 20, at[1] - 20, at[0] + 20, at[1] + 20],
  geojson: { type: 'MultiPolygon', coordinates: [[square(at[1] - 4, at[0] - 4, 8)], [square(-170, -50, 1)]] }, // a far-flung island too
});
const COUNTRIES: Record<string, GeoCountry> = {
  Japan: country('Japan', 'JP'),
  Peru: country('Peru', 'PE', [-9, -75]),
  Norway: country('Norway', 'NO', [62, 10]),
  Indonesia: country('Indonesia', 'ID', [-2, 118]),
  Portugal: country('Portugal', 'PT', [39.6, -8]),
  Italy: country('Italy', 'IT', [42, 12]),
  Greece: country('Greece', 'GR', [39, 22]),
};
/** Fresh copies, decorated as they are shown (distance, photo...), like the real lookup's fresh objects. */
const kyotoSpots = (): RawSpot[] => [
  { name: 'Kiyomizu-dera', category: 'temple', lat: 34.995, lon: 135.785 },
  { name: 'Nishiki Market', category: 'attraction', lat: 35.005, lon: 135.765 },
];
const summaryOf = (title: string, coordinates: [number, number] | null = null): WikiSummary => ({ title, coordinates, image: `https://img.test/${encodeURIComponent(title)}.jpg`, extract: `${title} is worth the trip.` });

/** Lookups that never touch the network; every call is recorded. */
function fakeLookups(over: Partial<Lookups> = {}) {
  const calls: string[] = [];
  const lookups: Lookups = {
    country: async (name) => {
      calls.push(`country:${name}`);
      // The named few, plus every idea "surprise me" can pick; anything else (Wakanda) is unknown.
      const known = COUNTRIES[name] ?? (WORLD_IDEAS.includes(name) || Object.values(IDEAS).flat().includes(name) ? country(name, name.slice(0, 2).toUpperCase()) : null);
      return known ? structuredClone(known) : null;
    },
    place: async (q) => { calls.push(`place:${q}`); return q.toLowerCase().includes('kyoto') ? { place: 'Kyoto', country: 'Japan', isoCode: 'JP', lat: 35, lon: 135.77 } : null; },
    reverse: async (lat, lon) => { calls.push(`reverse:${lat},${lon}`); return null; },
    nearby: async () => { calls.push('nearby'); return kyotoSpots(); },
    summary: async (title) => {
      calls.push(`summary:${title}`);
      const spot = kyotoSpots().find((s) => s.name === title);
      return summaryOf(title, spot ? [spot.lat, spot.lon] : null);
    },
    headlines: async (iso) => { calls.push(`headlines:${iso}`); return []; },
    dishes: async (name) => { calls.push(`dishes:${name}`); return []; },
    ...over,
  };
  return { lookups, calls };
}

async function settled(state: TravelState) {
  for (const d of state.detail.values()) await Promise.all([d.news, d.dishes, d.photos]);
}

describe('planning a trip', () => {
  test('a country reaches the board with its outline, fitted to its main landmass', async () => {
    const { lookups } = fakeLookups();
    const state = new TravelState();
    const line = await trip.chooseDestination(state, lookups, 'Japan');
    const s = state.snapshot();
    expect(s.map!.country).toBe('Japan');
    expect(s.map!.outline!.length).toBe(1); // the far-flung island is not drawn...
    expect(s.map!.bbox![0]).toBeGreaterThan(30); // ...and does not stretch the box
    expect(s.trip.visited[0].silhouette).not.toBeNull();
    expect(line).toContain('Japan');
  });

  test('the raw boundary never reaches the snapshot', async () => {
    // It is megabytes; the outline exists precisely so it does not travel.
    const state = new TravelState();
    await trip.chooseDestination(state, fakeLookups().lookups, 'Japan');
    expect(JSON.stringify(state.snapshot())).not.toContain('MultiPolygon');
  });

  test('a continent alone draws nothing and asks for a country', async () => {
    const state = new TravelState();
    const line = await trip.chooseDestination(state, fakeLookups().lookups, '', { continent: 'Asia' });
    expect(state.snapshot().map).toBeNull();
    expect(state.stage).toBe('welcome');
    expect(state.continent).toBe('Asia');
    expect(line.toLowerCase()).toContain('asia');
  });

  test('an unresolvable country asks rather than guessing', async () => {
    const state = new TravelState();
    const line = await trip.chooseDestination(state, fakeLookups().lookups, 'Wakanda');
    expect(state.snapshot().map).toBeNull();
    expect(state.seq).toBe(0);
    expect(line.toLowerCase()).toContain('confirm');
  });

  test('without a news source the guide offers the food, not headlines it cannot get', async () => {
    const line = await trip.chooseDestination(new TravelState(false), fakeLookups().lookups, 'Japan');
    expect(line).toContain('what to eat');
    expect(await trip.chooseDestination(new TravelState(true), fakeLookups().lookups, 'Japan')).toContain('headlines');
  });

  test('the destination box takes "City, Country" without a place lookup, and a bare place by finding its country', async () => {
    const { lookups, calls } = fakeLookups({ place: async (q) => (q === 'Bali' ? { place: 'Bali', country: 'Indonesia', isoCode: 'ID', lat: -8.2, lon: 115.2 } : null) });
    const state = new TravelState();
    await trip.searchDestination(state, lookups, 'Kyoto, Japan');
    expect([state.country, state.city]).toEqual(['Japan', 'Kyoto']);
    expect(calls.some((c) => c.startsWith('place:'))).toBe(false);
    await trip.searchDestination(state, lookups, 'Bali');
    expect([state.country, state.city]).toEqual(['Indonesia', 'Bali']);
    expect(await trip.searchDestination(state, lookups, 'Atlantis')).toContain('could not place Atlantis');
  });

  test('a tap on the map plans a trip to the country under it, and the sea is nobody\'s', async () => {
    const { lookups } = fakeLookups({ reverse: async (lat) => (lat > 0 ? { place: 'Sintra', country: 'Portugal', isoCode: 'PT', lat: 38.8, lon: -9.4 } : null) });
    const state = new TravelState();
    await trip.destinationAt(state, lookups, 38.8, -9.4);
    expect([state.country, state.city]).toEqual(['Portugal', 'Sintra']);
    expect(await trip.destinationAt(state, lookups, -30, -20)).toContain('no country');
  });

  test('"surprise me" picks within their continent, somewhere not yet on the trip', async () => {
    const state = new TravelState();
    const { lookups } = fakeLookups();
    await trip.chooseDestination(state, lookups, '', { continent: 'Europe' });
    await trip.chooseDestination(state, lookups, 'Portugal');
    const line = await trip.pickForThem(state, lookups, () => 0);
    expect(state.country).toBe('Italy'); // Portugal, the first European idea, is already on the trip
    expect(line).toContain('your pick');
  });
});

describe('headlines and dishes: fetched at once, shown when asked', () => {
  test('both are fetched as soon as the country is chosen, and kept off the board until asked for', async () => {
    let asked = 0;
    const { lookups } = fakeLookups({ headlines: async () => [{ title: 'Trams return', source: 'x', url: '', publishDate: '' }], dishes: async () => { asked += 1; return [{ name: 'Ramen', description: 'Broth and noodles' }]; } });
    const state = new TravelState(true);
    await trip.chooseDestination(state, lookups, 'Japan');
    expect(state.snapshot().pending).toBe(true);
    await settled(state);
    const s = state.snapshot();
    expect(s.pending).toBe(false);
    expect([s.news!.headlines.length, s.news!.shown, s.food!.dishes.length, s.food!.shown]).toEqual([1, false, 1, false]);
    // Once per country: choosing it again (or going back) asks for nothing new.
    await trip.chooseDestination(state, lookups, 'Japan');
    expect(asked).toBe(1);
  });

  test('headlines are shown even when there are none: an empty list is an answer', async () => {
    const state = new TravelState(true);
    await trip.chooseDestination(state, fakeLookups().lookups, 'Japan');
    const line = await trip.showHeadlines(state);
    expect(state.snapshot().news!.shown).toBe(true);
    expect(line.toLowerCase()).toContain('food');
  });

  test('asking for the news waits for headlines still loading', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { lookups } = fakeLookups({ headlines: async () => { await gate; return [{ title: 'Trams return', source: 'x', url: '', publishDate: '' }]; } });
    const state = new TravelState(true);
    await trip.chooseDestination(state, lookups, 'Japan');
    const asked = trip.showHeadlines(state);
    release();
    expect(await asked).toContain('Trams return');
  });

  test('nothing tells the guide the news is from today', async () => {
    // Symptom (original): "here are today's headlines from Peru", then a story
    // from last week. No date filter is sent; the only date the app holds is
    // each item's own, which it never checks.
    const state = new TravelState(true);
    const offered = await trip.chooseDestination(state, fakeLookups().lookups, 'Japan');
    const missing = await trip.showHeadlines(state);
    const s2 = new TravelState(true);
    await trip.chooseDestination(s2, fakeLookups({ headlines: async () => [{ title: 'Trams return', source: 'x', url: '', publishDate: '' }] }).lookups, 'Japan');
    const found = await trip.showHeadlines(s2);
    for (const line of [offered, missing, found]) expect(line.toLowerCase()).not.toContain('today');
    // The one mention in the host's rules forbids it.
    const rules = instructions(true);
    for (const m of rules.matchAll(/today/gi)) expect(rules.slice(Math.max(0, m.index! - 20), m.index)).toMatch(/never call them $/);
  });

  test('news before a destination is a prompt, not a lookup', async () => {
    const state = new TravelState(true);
    const line = await trip.showHeadlines(state);
    expect(state.detail.size).toBe(0);
    expect(state.seq).toBe(0);
    expect(line).toContain('no country is chosen yet');
  });

  test('dishes appear before their photos do', async () => {
    // The names should be readable while the pictures are still on their way.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { lookups } = fakeLookups({
      dishes: async () => [{ name: 'Ramen', description: 'Broth and noodles' }],
      summary: async (t) => { await gate; return summaryOf(t); },
    });
    const state = new TravelState();
    await trip.chooseDestination(state, lookups, 'Japan');
    const line = await trip.showDishes(state);
    expect(line).toContain('Ramen');
    expect(state.snapshot().food!.dishes[0].imageUrl).toBeNull();
    expect(state.snapshot().pending).toBe(true);
    release();
    await settled(state);
    expect(state.snapshot().food!.dishes[0].imageUrl).toMatch(/^https:\/\/img\.test\//);
  });

  test('a dish with no photo is still a dish, and one with no description gets Wikipedia\'s first sentence', async () => {
    const { lookups } = fakeLookups({
      dishes: async () => [{ name: 'Ramen', description: '' }, { name: 'Natto', description: 'Sticky.' }],
      summary: async (t) => (t === 'Ramen' ? summaryOf(t) : null),
    });
    const state = new TravelState();
    await trip.chooseDestination(state, lookups, 'Japan');
    await settled(state);
    const [ramen, natto] = state.snapshot().food!.dishes;
    expect(ramen.description).toBe('Ramen is worth the trip.');
    expect(natto.imageUrl).toBeNull();
    expect(natto.description).toBe('Sticky.');
  });

  test('a photo is looked up under its Wikipedia article when the name alone would miss it', async () => {
    const { lookups, calls } = fakeLookups({ dishes: async () => [{ name: 'Momo', description: 'Dumplings.', wiki: 'Momo (food)' }] });
    const state = new TravelState();
    await trip.chooseDestination(state, lookups, 'Japan');
    await settled(state);
    expect(calls).toContain('summary:Momo (food)');
  });

  test('empty dish names are dropped and three is the cap', () => {
    expect(trip.cleanDishes(['Ramen', '', 'Sushi', 'Udon', 'Soba'].map((name) => ({ name, description: '' }))).map((d) => d.name)).toEqual(['Ramen', 'Sushi', 'Udon']);
    expect(trip.cleanDishes([{ name: '  ', description: 'x' }])).toEqual([]);
    expect(trip.cleanDishes('nonsense')).toEqual([]);
  });

  test('detail that lands after the user moved on goes to its own country', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { lookups } = fakeLookups({ dishes: async (name) => { if (name === 'Japan') await gate; return [{ name: `${name} dish`, description: '' }]; } });
    const state = new TravelState();
    await trip.chooseDestination(state, lookups, 'Japan');
    await trip.chooseDestination(state, lookups, 'Peru');
    release();
    await settled(state);
    expect(state.dishes.map((d) => d.name)).toEqual(['Peru dish']);
    expect(state.visited[0].dishes.map((d) => d.name)).toEqual(['Japan dish']);
  });
});

describe('going back', () => {
  async function japanThenPeru() {
    const { lookups, calls } = fakeLookups({ dishes: async () => [{ name: 'Kaiseki', description: 'An art form on a plate' }] });
    const state = new TravelState();
    await trip.chooseDestination(state, lookups, 'Japan', { city: 'Kyoto' });
    await trip.showDishes(state);
    await trip.chooseDestination(state, lookups, 'Peru');
    await settled(state);
    calls.length = 0;
    return { state, lookups, calls };
  }

  test('the whole board comes back, and nothing is fetched again', async () => {
    const { state, lookups, calls } = await japanThenPeru();
    const line = await trip.revisitCountry(state, lookups, 'Japan');
    expect(line).toContain('Japan');
    expect(line).toContain('Kaiseki');
    expect(calls).toEqual([]);
    expect(state.snapshot().food!.shown).toBe(true);
  });

  test('a new country is not answered with where you already are', async () => {
    // Found by playing the original: "now show me Italy" over a Japan board was
    // read as a return trip; the guide said "you're already looking at Japan"
    // and the map never moved. Somewhere nobody has been is somewhere new.
    const { state, lookups } = await japanThenPeru();
    const line = await trip.revisitCountry(state, lookups, 'Norway');
    expect(state.country).toBe('Norway');
    expect(line).not.toContain('already looking at');
  });

  test('asking for where you already are says so, lightly', async () => {
    const { state, lookups } = await japanThenPeru();
    expect(await trip.revisitCountry(state, lookups, 'Peru')).toContain('already looking at Peru');
  });

  test('going back with no country named lists the trip, and with no trip says there is nothing', async () => {
    const { state, lookups } = await japanThenPeru();
    expect(await trip.revisitCountry(state, lookups, '')).toContain('Japan');
    expect((await trip.revisitCountry(new TravelState(), lookups, '')).toLowerCase()).toContain('nothing to go back to');
  });
});

describe('what is around them', () => {
  test('a spoken location becomes a nearby spot, with its distance, a maps link, a photo and a sentence', async () => {
    const { lookups } = fakeLookups();
    const state = new TravelState();
    const line = await trip.explorePlace(state, lookups, 'Kyoto');
    const v = state.snapshot().spot!;
    expect(state.stage).toBe('around');
    expect(v.spot!.name).toBe('Kiyomizu-dera');
    expect(v.spot!.mapsUrl.startsWith('https://www.google.com/maps/')).toBe(true);
    expect(v.spot!.distance).toMatch(/away$/); // spoken, not "1483 m"
    expect(v.spot!.imageUrl).toMatch(/^https:\/\/img\.test\//);
    expect(v.spot!.summary).toContain('worth the trip');
    expect(line).toContain('Kiyomizu-dera');
  });

  test("a ranked sight keeps its own photo, and its article is looked up by its exact title", async () => {
    const { lookups, calls } = fakeLookups({
      nearby: async () => [{ name: 'Igreja de Santo Estêvão', wiki: 'Igreja de Santo Estêvão (Lisbon)', category: 'church', lat: 38.7117, lon: -9.1272, image: 'https://img.test/estevao.jpg' }],
      summary: async (t) => { calls.push(`summary:${t}`); return null; },
    });
    const state = new TravelState();
    await trip.explorePlace(state, lookups, 'Kyoto');
    expect(calls).toContain('summary:Igreja de Santo Estêvão (Lisbon)');
    expect(state.snapshot().spot!.spot!.imageUrl).toBe('https://img.test/estevao.jpg');
    expect(state.snapshot().spot!.spot!.name).toBe('Igreja de Santo Estêvão');
  });

  test('a Wikipedia article about some other place lends neither its photo nor its words', async () => {
    // "Central Station" finds the generic article, or one in another city.
    const { lookups } = fakeLookups({ summary: async (t) => summaryOf(t, [51.5, -0.1]) });
    const state = new TravelState();
    await trip.explorePlace(state, lookups, 'Kyoto');
    expect(state.snapshot().spot!.spot!.imageUrl).toBeNull();
    expect(state.snapshot().spot!.spot!.summary).toBe('');
  });

  test('a place nobody can find asks for another name', async () => {
    const state = new TravelState();
    const line = await trip.explorePlace(state, fakeLookups().lookups, 'the moon');
    expect(state.snapshot().spot).toBeNull();
    expect(line).toContain('nearest city');
  });

  test('a whole country is not a town', async () => {
    const { lookups, calls } = fakeLookups();
    expect(await trip.explorePlace(new TravelState(), lookups, 'Japan')).toContain('which town');
    expect(calls).toEqual([]);
  });

  test('a broken lookup service says so instead of saying nothing is there', async () => {
    const state = new TravelState();
    const line = await trip.explorePlace(state, fakeLookups({ nearby: async () => null }).lookups, 'Kyoto');
    expect(state.snapshot().spot!.lookupFailed).toBe(true);
    expect(line).toContain('not answering');
  });

  test('a genuinely quiet neighbourhood reads differently', async () => {
    const state = new TravelState();
    const line = await trip.explorePlace(state, fakeLookups({ nearby: async () => [] }).lookups, 'Kyoto');
    expect(state.snapshot().spot!.lookupFailed).toBe(false);
    expect(line).toContain('nothing stands out');
  });

  test('next spot moves on once, and then offers something else', async () => {
    const { lookups } = fakeLookups();
    const state = new TravelState();
    await trip.explorePlace(state, lookups, 'Kyoto');
    expect(await trip.nextSpot(state, lookups)).toContain('Nishiki Market');
    expect(await trip.nextSpot(state, lookups)).toContain('last standout spot');
  });

  test('two overlapping next spots do not skip one', async () => {
    // A tap while the guide is already fetching must not lose a spot: the photo
    // lookup between advancing and describing is an await. Unguarded, both
    // callers advanced and only one described.
    const { lookups } = fakeLookups();
    const state = new TravelState();
    await trip.explorePlace(state, lookups, 'Kyoto');
    const lines = await Promise.all([trip.nextSpot(state, lookups), trip.nextSpot(state, lookups)]);
    expect(state.spotIndex).toBe(1);
    expect(lines.filter((l) => l.includes('Nishiki Market'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('last standout spot'))).toHaveLength(1);
  });

  test('next spot before looking anywhere asks where they are', async () => {
    const state = new TravelState();
    expect(await trip.nextSpot(state, fakeLookups().lookups)).toContain('which town');
    expect(state.seq).toBe(0);
  });

  test("a spot's photo is fetched once and reused", async () => {
    const { lookups, calls } = fakeLookups();
    const state = new TravelState();
    await trip.explorePlace(state, lookups, 'Kyoto');
    await trip.nextSpot(state, lookups);
    await trip.previousSpot(state, lookups);
    await trip.nextSpot(state, lookups);
    expect(calls.filter((c) => c.startsWith('summary:'))).toEqual(['summary:Kiyomizu-dera', 'summary:Nishiki Market']);
  });

  test('the previous spot at the start says so, without redrawing', async () => {
    const { lookups } = fakeLookups();
    const state = new TravelState();
    await trip.explorePlace(state, lookups, 'Kyoto');
    const seq = state.seq;
    expect((await trip.previousSpot(state, lookups)).toLowerCase()).toContain('first spot');
    expect(state.seq).toBe(seq);
    expect((await trip.previousSpot(new TravelState(), lookups)).toLowerCase()).toContain('which town');
  });

  test('a pin on the map goes to its spot; the one already showing says nothing', async () => {
    const { lookups } = fakeLookups();
    const state = new TravelState();
    await trip.explorePlace(state, lookups, 'Kyoto');
    expect(await trip.gotoSpot(state, lookups, 1)).toContain('Nishiki Market');
    expect(await trip.gotoSpot(state, lookups, 1)).toBe('');
  });

  test('"use my location" and a tap on the map run the same flow from coordinates', async () => {
    // In the original this was a sealed seam: its sandboxed panel had no geolocation.
    const { lookups } = fakeLookups({ reverse: async () => ({ place: 'Lisbon', country: 'Portugal', isoCode: 'PT', lat: 38.7, lon: -9.1 }) });
    const state = new TravelState();
    await trip.exploreCoordinates(state, lookups, 38.7, -9.1);
    expect(state.aroundPlace).toBe('Lisbon');
    expect(state.stage).toBe('around');
  });

  test.each<[unknown, unknown]>([[91, 0], [0, 181], [Number.NaN, 0], ['38.7', '-9.1'], [null, null]])('coordinates the flow cannot use are refused, not raised: %j, %j', async (lat, lon) => {
    expect(trip.validCoordinates(lat, lon)).toBe(false);
    const { lookups, calls } = fakeLookups();
    expect(await trip.exploreCoordinates(new TravelState(), lookups, lat as number, lon as number)).toContain('could not be read');
    expect(calls).toEqual([]);
  });
});

describe('the traveller', () => {
  test('a name is remembered, and an empty one is allowed', () => {
    const state = new TravelState();
    trip.rememberTraveler(state, '  Sam!  ');
    expect(state.travelerName).toBe('Sam');
    expect(trip.rememberTraveler(state, '')).toContain('carry on');
    expect(state.travelerName).toBe('');
  });

  test("a tool name or a request is never taken as the traveller's name", () => {
    // Symptoms: the header read "remember_traveler", and "Hello dreaming of Japan".
    const state = new TravelState();
    for (const notAName of ['remember_traveler', '3 day trip to Kyoto', "I'm dreaming of Japan"]) {
      expect(trip.rememberTraveler(state, notAName)).toContain('carry on');
      expect(state.travelerName).toBe('');
    }
    trip.rememberTraveler(state, 'Mary Anne Fitzgerald');
    expect(state.travelerName).toBe('Mary Anne Fitzgerald');
  });
});

test('pressing "surprise me" lets the app pick at once', async () => {
  const state = new TravelState();
  expect(await trip.apply(state, fakeLookups().lookups, { kind: 'pick' })).toContain('your pick');
  expect(state.country).not.toBe('');
});

test('the board tabs switch what it shows', async () => {
  const state = new TravelState();
  expect(await trip.apply(state, fakeLookups().lookups, { kind: 'show', stage: 'around' })).toContain('which town');
  expect(state.stage).toBe('around');
  await trip.apply(state, fakeLookups().lookups, { kind: 'show', stage: 'planning' });
  expect(state.stage).toBe('planning');
});
