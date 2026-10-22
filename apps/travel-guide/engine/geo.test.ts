// Ported from test_geo.py: the open-data lookups, their parsers, and their
// behaviour under failure. Everything a provider sends is untrusted input
// arriving mid-conversation; a bad body degrades to "no result", never to an
// exception on the speaking path. Nothing here touches the network: the
// fetchers take an injected `http`, scripted below.
import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as geo from './geo.ts';

beforeAll(() => {
  // Nominatim's one-per-second politeness would add real seconds per test.
  geo.nominatimThrottle.interval = 0;
  // The fetchers log every failure they swallow; the failures here are on purpose.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

type Route = { status?: number; body?: unknown; raw?: string } | Error;

/** Routes by substring of the URL. Anything unrouted 404s, which is what a forgotten route should look like. */
function fakeHttp(routes: Record<string, Route>) {
  const calls: { method: string; url: string }[] = [];
  const http: geo.Http = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url });
    for (const [fragment, route] of Object.entries(routes)) {
      if (!url.includes(fragment)) continue;
      if (route instanceof Error) throw route;
      return new Response(route.raw ?? JSON.stringify(route.body ?? null), { status: route.status ?? 200 });
    }
    return new Response('null', { status: 404 });
  };
  return { http, calls };
}

const PORTUGAL = [{
  lat: '39.6621648',
  lon: '-8.1353519',
  boundingbox: ['29.8282470', '42.1543112', '-31.5575303', '-6.1891593'],
  display_name: 'Portugal',
  address: { country: 'Portugal', country_code: 'pt' },
  geojson: { type: 'Polygon', coordinates: [[[-9.5, 37.0], [-6.2, 37.0], [-6.2, 42.1], [-9.5, 42.1], [-9.5, 37.0]]] },
}];

describe('parseCountry', () => {
  test("the bbox is reordered from Nominatim's own order", () => {
    // Nominatim sends [south, north, west, east] as strings; ours is
    // [minLat, minLon, maxLat, maxLon]. Getting this wrong draws the sea.
    const parsed = geo.parseCountry(PORTUGAL)!;
    expect(parsed.bbox).toEqual([29.828247, -31.5575303, 42.1543112, -6.1891593]);
    expect(parsed.country).toBe('Portugal');
    expect(parsed.isoCode).toBe('PT');
    expect(parsed.center).toEqual([39.6621648, -8.1353519]);
  });

  test('a missing bounding box is survivable', () => {
    const parsed = geo.parseCountry([{ ...PORTUGAL[0], boundingbox: ['nonsense'] }]);
    expect(parsed).not.toBeNull();
    expect(parsed!.bbox).toBeNull();
  });

  test.each([null, [], {}, ['not an object'], [{ lat: 'x', lon: 'y' }], [{ lat: null, lon: null }]])('anything it cannot place is rejected: %j', (body) => {
    expect(geo.parseCountry(body)).toBeNull();
  });

  test('a non-object geojson is dropped', () => {
    expect(geo.parseCountry([{ ...PORTUGAL[0], geojson: 'a string' }])!.geojson).toBeNull();
  });
});

describe('parsePlace', () => {
  test('the most local name available wins, city over suburb', () => {
    const parsed = geo.parsePlace({ lat: '35.0', lon: '135.7', address: { suburb: 'Gion', city: 'Kyoto', country: 'Japan', country_code: 'jp' } })!;
    expect(parsed.place).toBe('Kyoto');
    expect(parsed.isoCode).toBe('JP');
    expect(parsed.country).toBe('Japan');
  });

  test('a search list is read as well as a reverse object', () => {
    const parsed = geo.parsePlace([{ lat: '51.5', lon: '-0.1', display_name: 'London, England' }])!;
    expect(parsed.place).toBe('London');
    expect(parsed.lat).toBe(51.5);
  });

  test.each([null, [], {}, { lat: '51.5' }, 'text'])('a fix it cannot use is rejected: %j', (body) => {
    expect(geo.parsePlace(body)).toBeNull();
  });
});

const OVERPASS = {
  elements: [
    { tags: { name: 'Far Museum', tourism: 'museum' }, lat: 35.02, lon: 135.7 },
    // A way: its position hides under `center`, and dropping those loses
    // every building-shaped museum, which is most of them.
    { tags: { name: 'Near Gallery', tourism: 'gallery' }, center: { lat: 35.001, lon: 135.7 } },
    { tags: { name: 'Near Gallery', tourism: 'gallery' }, lat: 35.0011, lon: 135.7 },
    { tags: { historic: 'city_gate' }, lat: 35.0, lon: 135.7 }, // unnamed
    { tags: { name: 'Nowhere' }, center: {} }, // unplaceable
  ],
};

describe('parseOverpassPois', () => {
  test('sorts by distance, de-duplicates and keeps ways', () => {
    const spots = geo.parseOverpassPois(OVERPASS, 35.0, 135.7);
    expect(spots.map((s) => s.name)).toEqual(['Near Gallery', 'Far Museum']);
    expect(spots[0].category).toBe('gallery');
  });

  test('underscored categories become spoken words', () => {
    const body = { elements: [{ tags: { name: 'Old Gate', historic: 'city_gate' }, lat: 1, lon: 1 }] };
    expect(geo.parseOverpassPois(body, 1, 1)[0].category).toBe('city gate');
  });

  test('the English name wins when OSM has one: the guide says it aloud', () => {
    const body = { elements: [{ tags: { name: '清水寺', 'name:en': 'Kiyomizu-dera', tourism: 'attraction' }, lat: 35, lon: 135.78 }] };
    expect(geo.parseOverpassPois(body, 35, 135.78)[0].name).toBe('Kiyomizu-dera');
  });

  test.each([null, {}, { elements: 'nope' }, { elements: [null, 3] }])('junk is tolerated: %j', (body) => {
    expect(geo.parseOverpassPois(body, 0, 0)).toEqual([]);
  });
});

describe('parseGeosearch, parseHeadlines, parseSummary', () => {
  test("GeoSearch keeps Wikipedia's closest-first order", () => {
    const body = { query: { geosearch: [
      { title: 'Kiyomizu-dera', lat: 34.99, lon: 135.78 },
      { title: 'Kiyomizu-dera', lat: 34.99, lon: 135.78 },
      { title: 'Yasaka Shrine', lat: 35.0, lon: 135.77 },
    ] } };
    expect(geo.parseGeosearch(body).map((s) => s.name)).toEqual(['Kiyomizu-dera', 'Yasaka Shrine']);
  });

  test.each([null, {}, { query: {} }, { query: { geosearch: {} } }])('GeoSearch junk is tolerated: %j', (body) => {
    expect(geo.parseGeosearch(body)).toEqual([]);
  });

  test('headlines name their source from the url', () => {
    const [headline] = geo.parseHeadlines({ news: [{ title: '  Trams   return  ', url: 'https://www.publico.pt/x', publish_date: '2026-07-30' }] });
    expect(headline.title).toBe('Trams return'); // whitespace collapsed
    expect(headline.source).toBe('publico.pt'); // www. stripped
    expect(headline.publishDate).toBe('2026-07-30');
  });

  test('untitled items are skipped and five is the cap', () => {
    const parsed = geo.parseHeadlines({ news: [{ title: '' }, ...Array.from({ length: 9 }, (_, i) => ({ title: `n${i}`, url: '' }))] });
    expect(parsed).toHaveLength(4);
    expect(parsed.every((h) => h.source === 'news')).toBe(true);
  });

  test.each([null, {}, { news: [] }, 'text'])('headline junk is tolerated: %j', (body) => {
    expect(geo.parseHeadlines(body)).toEqual([]);
  });

  test('the summary image prefers the thumbnail over the original', () => {
    expect(geo.parseSummaryImage({ thumbnail: { source: 'https://x/thumb.jpg' }, originalimage: { source: 'https://x/huge.jpg' } })).toBe('https://x/thumb.jpg');
  });

  test.each([null, {}, { thumbnail: {} }, { thumbnail: 'x' }])('a missing summary image is null, not an error: %j', (body) => {
    expect(geo.parseSummaryImage(body)).toBeNull();
  });

  test('a big enough original gets a 960 px thumbnail, a small one keeps its own', () => {
    const thumb = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0c/Pasteis.jpg/330px-Pasteis.jpg?utm_source=x';
    expect(geo.largerImage(thumb, 2652)).toBe('https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0c/Pasteis.jpg/960px-Pasteis.jpg?utm_source=x');
    expect(geo.largerImage(thumb, 500)).toBe(thumb);
  });

  test('a summary carries its first sentences and, for a place, its coordinates', () => {
    const s = geo.parseSummary({ type: 'standard', title: 'Torre de Belém', coordinates: { lat: 38.69, lon: -9.216 }, extract: 'The Belém Tower is a fortification in Lisbon. It was built in the 16th century. '.repeat(5), thumbnail: { source: 'https://x/330px-t.jpg' }, originalimage: { width: 400 } })!;
    expect(s.coordinates).toEqual([38.69, -9.216]);
    expect(s.extract.length).toBeLessThanOrEqual(280);
    expect(s.extract.endsWith('.')).toBe(true);
    expect(s.image).toBe('https://x/330px-t.jpg');
  });

  test('a disambiguation page is no summary at all ("Mercury may refer to")', () => {
    expect(geo.parseSummary({ type: 'disambiguation', title: 'Mercury', extract: 'Mercury most commonly refers to:' })).toBeNull();
  });
});

describe('the transport half, against scripted responses', () => {
  test('lookupCountry reads a real-shaped response', async () => {
    const { http } = fakeHttp({ '/search': { body: PORTUGAL } });
    expect((await geo.lookupCountry('Portugal', http))!.isoCode).toBe('PT');
  });

  test.each<[string, Route]>([
    ["Nominatim's punishment for hammering", { status: 429 }],
    ['not json', { raw: 'not json' }],
    ['a reset connection', new Error('connection reset')],
  ])('lookupCountry degrades to null: %s', async (_, route) => {
    const { http } = fakeHttp({ '/search': route });
    expect(await geo.lookupCountry('Portugal', http)).toBeNull();
  });

  test('every Nominatim call identifies itself', async () => {
    const seen: Headers[] = [];
    await geo.lookupPlace('Kyoto', async (_url, init) => { seen.push(new Headers(init?.headers)); return new Response('[]'); });
    expect(seen[0].get('User-Agent')).toMatch(/atmee/);
  });

  test('nearby spots fall back to Wikipedia when Overpass is down', async () => {
    // Every Overpass mirror 504ing is a normal afternoon, and it must not read as "there is nothing near you".
    const { http } = fakeHttp({
      interpreter: { status: 504 },
      'w/api.php': { body: { query: { geosearch: [{ title: 'Torre de Belém', lat: 38.69, lon: -9.21 }] } } },
    });
    expect((await geo.nearbySpots(38.7, -9.2, http))!.map((s) => s.name)).toEqual(['Torre de Belém']);
  });

  test('nearby spots are null only when every provider failed', async () => {
    // null and [] mean different things: one is "the service is down", the other "you are somewhere quiet".
    const { http } = fakeHttp({ interpreter: { status: 504 }, 'w/api.php': { status: 500 } });
    expect(await geo.nearbySpots(0, 0, http)).toBeNull();
  });

  test('nearby spots are empty when a provider answered with nothing', async () => {
    const { http } = fakeHttp({ interpreter: { body: { elements: [] } }, 'w/api.php': { body: { query: { geosearch: [] } } } });
    expect(await geo.nearbySpots(0, 0, http)).toEqual([]);
  });

  test('Overpass moves on to the next mirror', async () => {
    const { http, calls } = fakeHttp({ 'overpass-api.de': { status: 504 }, 'kumi.systems': { body: OVERPASS } });
    const spots = await geo.nearbySpots(35.0, 135.7, http);
    expect(spots![0].name).toBe('Near Gallery');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });

  test('headlines need a key, and never complain without one', async () => {
    const { http, calls } = fakeHttp({ worldnewsapi: { body: { news: [{ title: 'x' }] } } });
    expect(await geo.localHeadlines('PT', http, '')).toEqual([]);
    expect(calls).toEqual([]); // not even attempted
  });

  test('headlines with a key', async () => {
    const { http } = fakeHttp({ worldnewsapi: { body: { news: [{ title: 'Trams return', url: '' }] } } });
    expect((await geo.localHeadlines('PT', http, 'k'))[0].title).toBe('Trams return');
  });

  test('an upstream error is swallowed (out of quota)', async () => {
    const { http } = fakeHttp({ worldnewsapi: { status: 402 } });
    expect(await geo.localHeadlines('PT', http, 'k')).toEqual([]);
  });

  test('a Wikipedia miss is quiet', async () => {
    const { http } = fakeHttp({ 'page/summary': { status: 404 } });
    expect(await geo.wikipediaSummary('Nowhere At All', http)).toBeNull();
  });
});

describe('spoken helpers', () => {
  test.each([[50, 'right next to you'], [400, 'about a 5 minute walk away'], [2500, 'about 2.5 kilometres away']])('%d m is said as "%s"', (meters, expected) => {
    expect(geo.distancePhrase(meters)).toBe(expected);
  });

  test('haversine is metres, not degrees', () => {
    // One degree of latitude is ~111 km anywhere on earth.
    const d = geo.haversineM(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  test('the maps link anchors the name to its coordinates', () => {
    const url = geo.mapsUrl('Central Park', 40.78, -73.96);
    expect(url).toContain('Central+Park');
    expect(url).toContain('40.78');
  });

  test('whole sentences, clipped only when one sentence is already too long', () => {
    expect(geo.firstSentences('One. Two two. Three three three.', 14)).toBe('One. Two two.');
    expect(geo.firstSentences('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});
