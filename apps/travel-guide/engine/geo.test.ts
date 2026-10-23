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

  test('a plaque or a boundary stone is not a sight; a gate or a fort is', () => {
    const body = { elements: [
      { tags: { name: 'Júlio de Castilho', historic: 'memorial' }, lat: 1, lon: 1 },
      { tags: { name: 'Old Plaque', historic: 'plaque' }, lat: 1, lon: 1 },
      { tags: { name: 'Old Fort', historic: 'fort' }, lat: 1, lon: 1.001 },
      { tags: { name: 'War Memorial Museum', historic: 'memorial', tourism: 'museum' }, lat: 1, lon: 1.002 },
    ] };
    expect(geo.parseOverpassPois(body, 1, 1).map((s) => s.name)).toEqual(['Old Fort', 'War Memorial Museum']);
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

/** A Wikipedia GeoSearch around Alfama, Lisbon, shaped like the API's (formatversion 2). */
const ALFAMA = { batchcomplete: true, query: { pages: [
  // What live GeoSearch put first: nearest, obscure, no photo.
  { title: 'Júlio de Castilho Memorial', coordinates: [{ lat: 38.7118, lon: -9.1302 }], length: 1800, description: 'memorial in Lisbon, Portugal', pageviews: { a: 2, b: 1 } },
  { title: 'S. Vicente (artwork)', coordinates: [{ lat: 38.7121, lon: -9.1299 }], length: 1500, thumbnail: { source: 'https://img.test/svicente.jpg' }, description: 'artwork in Lisbon', pageviews: { a: 1 } },
  { title: 'São Jorge Castle', coordinates: [{ lat: 38.7139, lon: -9.1335 }], length: 32000, thumbnail: { source: 'https://img.test/castle.jpg' }, description: 'castle in Lisbon, Portugal', pageviews: { a: 900, b: 1100 } },
  { title: 'Lisbon Cathedral', coordinates: [{ lat: 38.7099, lon: -9.1334 }], length: 21000, thumbnail: { source: 'https://img.test/se.jpg' }, description: 'Roman Catholic cathedral in Lisbon, Portugal', pageviews: { a: 600 } },
  { title: 'Miradouro de Santa Luzia', coordinates: [{ lat: 38.7116, lon: -9.1302 }], length: 6000, thumbnail: { source: 'https://img.test/luzia.jpg' }, description: 'viewpoint in Lisbon', pageviews: { a: 120 } },
  { title: 'Igreja de Santo Estêvão (Lisbon)', coordinates: [{ lat: 38.7117, lon: -9.1272 }], length: 4000, thumbnail: { source: 'https://img.test/estevao.jpg' }, description: 'church in Alfama, Lisbon' },
  // Near, with photos, and not sights.
  { title: 'Alfama', coordinates: [{ lat: 38.7114, lon: -9.1302 }], length: 15000, thumbnail: { source: 'https://img.test/alfama.jpg' }, description: 'neighbourhood of Lisbon, Portugal', pageviews: { a: 800 } },
  { title: 'Santa Apolónia station', coordinates: [{ lat: 38.7136, lon: -9.1225 }], length: 9000, thumbnail: { source: 'https://img.test/station.jpg' }, description: 'railway station in Lisbon, Portugal', pageviews: { a: 150 } },
  { title: 'List of churches in Lisbon', coordinates: [{ lat: 38.712, lon: -9.13 }], length: 9000, thumbnail: { source: 'https://img.test/list.jpg' } },
  // Things that happened there, and the ward itself (live, around Shibuya and in Lisbon).
  { title: 'Lisbon Regicide', coordinates: [{ lat: 38.7076, lon: -9.1366 }], length: 20000, thumbnail: { source: 'https://img.test/regicide.jpg' }, description: 'Murder of the king and crown prince of Portugal in 1908', pageviews: { a: 300 } },
  { title: 'February 26 incident', coordinates: [{ lat: 38.712, lon: -9.131 }], length: 60000, thumbnail: { source: 'https://img.test/coup.jpg' }, description: "1936 coup d'état attempt in Japan", pageviews: { a: 900 } },
  { title: 'Shibuya', coordinates: [{ lat: 38.7116, lon: -9.1306 }], length: 30000, thumbnail: { source: 'https://img.test/ward.jpg' }, description: 'Special ward in Tokyo, Japan', pageviews: { a: 2000 } },
  // Famous, but a long way off for a walk around Alfama.
  { title: 'Jerónimos Monastery', coordinates: [{ lat: 38.6979, lon: -9.2068 }], length: 40000, thumbnail: { source: 'https://img.test/jeronimos.jpg' }, description: 'monastery in Belém, Lisbon', pageviews: { a: 1500 } },
] } };

describe('the sights around a place, ranked for a traveller', () => {
  const ranked = () => geo.parseRankedSights(ALFAMA, 38.7115, -9.1305);

  test('the landmarks come first, the obscure after; no photo, no sight', () => {
    const names = ranked().map((s) => s.name);
    expect(names.slice(0, 3)).toEqual(['São Jorge Castle', 'Lisbon Cathedral', 'Miradouro de Santa Luzia']);
    expect(names).not.toContain('Júlio de Castilho Memorial'); // no lead image
    expect(names.indexOf('S. Vicente')).toBeGreaterThan(names.indexOf('Igreja de Santo Estêvão'));
  });

  test('the district itself, a station, a list and an event are not sights', () => {
    const names = ranked().map((s) => s.name);
    for (const notASight of ['Alfama', 'Santa Apolónia station', 'List of churches in Lisbon', 'Lisbon Regicide', 'February 26 incident', 'Shibuya']) expect(names).not.toContain(notASight);
  });

  test('a famous sight a long way off ranks below the ones within a walk', () => {
    const names = ranked().map((s) => s.name);
    expect(names.indexOf('Jerónimos Monastery')).toBeGreaterThan(names.indexOf('Miradouro de Santa Luzia'));
  });

  test('each carries its kind, its photo, and its article when the name shown is shortened', () => {
    const castle = ranked().find((s) => s.name === 'São Jorge Castle')!;
    expect([castle.category, castle.image, castle.wiki]).toEqual(['castle', 'https://img.test/castle.jpg', undefined]);
    const church = ranked().find((s) => s.name === 'Igreja de Santo Estêvão')!;
    expect([church.category, church.wiki]).toEqual(['church', 'Igreja de Santo Estêvão (Lisbon)']);
    expect(ranked().find((s) => s.name === 'Lisbon Cathedral')!.category).toBe('cathedral');
    expect(ranked().find((s) => s.name === 'S. Vicente')!.category).toBe('landmark');
  });

  test.each([null, {}, { batchcomplete: true }, { query: { pages: {} } }, { query: { pages: [null, 3, { title: 'x' }] } }])('junk and "nothing here" are an empty list: %j', (body) => {
    expect(geo.parseRankedSights(body, 0, 0)).toEqual([]);
  });
});

describe('parseHeadlines, parseSummary', () => {
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

  test('enough sights from Wikipedia, and Overpass is never asked', async () => {
    // Live, every Overpass mirror failed in both runs, for 25 to 50 seconds each time.
    const { http, calls } = fakeHttp({ 'w/api.php': { body: ALFAMA }, interpreter: { status: 504 } });
    const spots = await geo.nearbySpots(38.7115, -9.1305, http);
    expect(spots![0].name).toBe('São Jorge Castle');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(calls[0].url).toContain('generator=geosearch');
    expect(calls[0].url).toContain('pageimages');
  });

  test('a place Wikipedia knows little about is topped up from Overpass, Wikipedia first', async () => {
    const one = { query: { pages: [ALFAMA.query.pages[2]] } };
    const { http } = fakeHttp({ 'w/api.php': { body: one }, interpreter: { body: OVERPASS } });
    expect((await geo.nearbySpots(35.0, 135.7, http))!.map((s) => s.name)).toEqual(['São Jorge Castle', 'Near Gallery', 'Far Museum']);
  });

  test('Wikipedia down, Overpass up: the Overpass spots', async () => {
    const { http } = fakeHttp({ 'w/api.php': { status: 500 }, interpreter: { body: OVERPASS } });
    expect((await geo.nearbySpots(35.0, 135.7, http))!.map((s) => s.name)).toEqual(['Near Gallery', 'Far Museum']);
  });

  test('nearby spots are null only when every provider failed', async () => {
    // null and [] mean different things: one is "the service is down", the other "you are somewhere quiet".
    const { http } = fakeHttp({ interpreter: { status: 504 }, 'w/api.php': { status: 500 } });
    expect(await geo.nearbySpots(0, 0, http)).toBeNull();
  });

  test('nearby spots are empty when a provider answered with nothing', async () => {
    const { http } = fakeHttp({ interpreter: { body: { elements: [] } }, 'w/api.php': { body: { batchcomplete: true } } });
    expect(await geo.nearbySpots(0, 0, http)).toEqual([]);
  });

  test('Overpass keeps to its budget: a mirror gets only the time that is left, and none when too little is', async () => {
    // Codex review: every mirror got the full 12 s, so after one 12 s timeout the 14 s budget still started a
    // second request and the wait reached ~24 s. A fake clock, and mirrors that hang until their own timeout.
    vi.useFakeTimers();
    try {
      const posts: { url: string; timeoutMs: number }[] = [];
      const http: geo.Http = (url, init) => {
        if (init?.method !== 'POST') return Promise.resolve(new Response('null', { status: 500 })); // Wikipedia down
        const timeoutMs = init.timeoutMs ?? geo.HTTP_TIMEOUT_MS;
        posts.push({ url, timeoutMs });
        return new Promise((_, reject) => setTimeout(() => reject(new Error('The operation was aborted due to timeout')), timeoutMs));
      };
      const started = Date.now();
      let doneAt = 0;
      const result = geo.nearbySpots(38.7, -9.13, http).then((r) => { doneAt = Date.now(); return r; });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await result).toBeNull();
      expect(posts[0].timeoutMs).toBe(geo.HTTP_TIMEOUT_MS);
      for (const later of posts.slice(1)) expect(later.timeoutMs).toBeLessThanOrEqual(geo.OVERPASS_BUDGET_MS - geo.HTTP_TIMEOUT_MS);
      expect(doneAt - started).toBeLessThanOrEqual(geo.OVERPASS_BUDGET_MS);
    } finally {
      vi.useRealTimers();
    }
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
  test.each([[50, 'a few steps away'], [400, 'about a 5 minute walk away'], [2500, 'about 2.5 kilometres away']])('%d m is said as "%s"', (meters, expected) => {
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
