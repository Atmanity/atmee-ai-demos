// Ported from the panel's messages.test.ts and merge.test.ts. One block per
// section of the snapshot, each with its happy path, its malformed payload and
// its null. Every outage in these apps has been a parser accepting or
// rejecting the wrong thing: a rejected map is a blank board, and an accepted
// half-map is a crash inside a render.
import { describe, expect, it } from 'vitest';
import { isNewer, parseFood, parseMap, parseNews, parseSnapshot, parseSpotView, parseTrip } from './messages.ts';
import type { Snapshot } from './types.ts';

const MAP = {
  country: 'Portugal',
  isoCode: 'PT',
  city: 'Lisbon',
  center: [39.6, -8.1],
  bbox: [36.9, -9.5, 42.1, -6.1],
  outline: [[[-9.5, 37], [-6.2, 37], [-6.2, 42], [-9.5, 37]]],
  attribution: '© OpenStreetMap contributors',
};

describe('map', () => {
  it('reads a country', () => {
    const map = parseMap(MAP);
    expect(map?.country).toBe('Portugal');
    expect(map?.center).toEqual([39.6, -8.1]);
    expect(map?.outline?.[0]).toHaveLength(4);
  });

  it('keeps a country whose outline did not fit its budget', () => {
    // The map still fits the bounding box; rejecting here would blank the board over a missing shape.
    expect(parseMap({ ...MAP, outline: null })?.bbox).toEqual([36.9, -9.5, 42.1, -6.1]);
  });

  it('drops ring fragments that are not a shape', () => {
    expect(parseMap({ ...MAP, outline: [[[1, 2], [3, 4]]] })?.outline).toBeNull();
  });

  it('rejects non-finite coordinates, which JSON cannot carry anyway', () => {
    expect(parseMap({ ...MAP, center: [39.6, null] })?.center).toBeNull();
  });

  it('rejects a map with a name and nothing to draw', () => {
    expect(parseMap({ country: 'Portugal', center: null, bbox: null, outline: null })).toBeNull();
  });

  it.each([null, undefined, 'Portugal', [], {}, { country: '' }])('rejects %p', (payload) => {
    expect(parseMap(payload)).toBeNull();
  });
});

describe('news', () => {
  it('reads headlines and defaults a missing source', () => {
    const news = parseNews({ country: 'Portugal', headlines: [{ title: 'Trams return', url: 'https://x/1' }], shown: true });
    expect(news?.headlines[0]).toEqual({ title: 'Trams return', source: 'news', url: 'https://x/1', publishDate: '' });
    expect(news?.shown).toBe(true);
    expect(news?.loading).toBe(false);
  });

  it('accepts an empty list, which is a real answer', () => {
    expect(parseNews({ country: 'Peru', headlines: [] })?.headlines).toEqual([]);
  });

  it('skips untitled items instead of rendering blank rows', () => {
    expect(parseNews({ country: 'Peru', headlines: [{ title: '' }, 7, { title: 'ok' }] })?.headlines.map((h) => h.title)).toEqual(['ok']);
  });

  it.each([null, undefined, {}, { headlines: 'none' }, []])('rejects %p', (payload) => {
    expect(parseNews(payload)).toBeNull();
  });
});

describe('food', () => {
  it('reads dishes with and without photos', () => {
    const food = parseFood({ country: 'Japan', dishes: [{ name: 'Ramen', description: 'Broth', imageUrl: 'https://x/r.jpg' }, { name: 'Udon', description: '', imageUrl: null }] });
    expect(food?.dishes).toHaveLength(2);
    expect(food?.dishes[1].imageUrl).toBeNull();
  });

  it('treats an empty image url as no image', () => {
    // An empty string renders a broken-image glyph AND suppresses the placeholder: the worst of both.
    expect(parseFood({ country: 'Japan', dishes: [{ name: 'Ramen', imageUrl: '' }] })?.dishes[0].imageUrl).toBeNull();
  });

  it('skips nameless dishes', () => {
    expect(parseFood({ country: 'Japan', dishes: [{ description: 'x' }] })?.dishes).toEqual([]);
  });

  it.each([null, undefined, {}, { dishes: {} }, 'Ramen'])('rejects %p', (payload) => {
    expect(parseFood(payload)).toBeNull();
  });
});

describe('spot', () => {
  const view = {
    place: 'Kyoto',
    origin: [35, 135.77],
    index: 0,
    total: 2,
    lookupFailed: false,
    spot: { name: 'Kiyomizu-dera', category: 'temple', lat: 34.995, lon: 135.785, distance: 'about a 9 minute walk away', mapsUrl: 'https://www.google.com/maps/search/?api=1&query=x', imageUrl: null, summary: '' },
    pins: [{ name: 'Kiyomizu-dera', category: 'temple', lat: 34.995, lon: 135.785 }, { name: 'Bad pin', lat: 'x', lon: 1 }],
  };

  it('reads a spot, its place in the queue, and its pins', () => {
    const parsed = parseSpotView(view);
    expect(parsed?.spot?.name).toBe('Kiyomizu-dera');
    expect(parsed?.total).toBe(2);
    expect(parsed?.pins.map((p) => p.name)).toEqual(['Kiyomizu-dera']); // an unplaceable pin is dropped
  });

  it('keeps an empty result, which is a screen of its own', () => {
    const parsed = parseSpotView({ ...view, spot: null, total: 0 });
    expect(parsed?.spot).toBeNull();
    expect(parsed?.lookupFailed).toBe(false);
  });

  it('distinguishes a failed lookup from a quiet neighbourhood', () => {
    expect(parseSpotView({ ...view, spot: null, lookupFailed: true })?.lookupFailed).toBe(true);
  });

  it('drops a nameless or unplaceable spot rather than rendering an empty card or a pin in the sea', () => {
    expect(parseSpotView({ ...view, spot: { category: 'temple' } })?.spot).toBeNull();
    expect(parseSpotView({ ...view, spot: { ...view.spot, lat: null } })?.spot).toBeNull();
  });

  it('defaults a missing index and total to the start of the queue', () => {
    expect(parseSpotView({ place: 'Kyoto', spot: null })).toMatchObject({ index: 0, total: 0, lookupFailed: false, pins: [] });
  });

  it.each([null, undefined, {}, { place: '' }, 'Kyoto', []])('rejects %p', (payload) => {
    expect(parseSpotView(payload)).toBeNull();
  });
});

/**
 * The symptom: "actually let's look at Peru instead" wiped Japan, with no
 * history and no way back. The strip is the record that switching country no
 * longer destroys.
 */
describe('trip', () => {
  it('reads the stops', () => {
    expect(parseTrip({ current: 'Peru', visited: [{ country: 'Japan', city: 'Kyoto', dishes: ['Kaiseki'], headlineCount: 3, silhouette: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, { country: 'Peru', city: '', dishes: [], headlineCount: 0 }] })).toEqual({
      current: 'Peru',
      visited: [
        { country: 'Japan', city: 'Kyoto', dishes: ['Kaiseki'], headlineCount: 3, silhouette: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        { country: 'Peru', city: '', dishes: [], headlineCount: 0, silhouette: null },
      ],
    });
  });

  it('treats an empty trip as a real answer, not as a bad packet', () => {
    expect(parseTrip({ current: '', visited: [] })).toEqual({ current: '', visited: [] });
  });

  it('ignores a payload that is not a trip at all', () => {
    expect(parseTrip(null)).toBeNull();
    expect(parseTrip({ current: 'Peru' })).toBeNull();
  });

  it('drops a stop with no country rather than rendering a blank chip', () => {
    expect(parseTrip({ current: 'Peru', visited: [{ city: 'Kyoto' }] })?.visited).toEqual([]);
  });

  it('survives a stop whose dishes are not strings', () => {
    expect(parseTrip({ current: 'Japan', visited: [{ country: 'Japan', dishes: [1, null, 'Ramen'] }] })?.visited[0].dishes).toEqual(['Ramen']);
  });
});

describe('snapshot', () => {
  it('reads a session in full', () => {
    const s = parseSnapshot({
      seq: 4, stage: 'planning', travelerName: 'Sam', newsAvailable: true, pending: true,
      map: MAP, news: { country: 'Portugal', headlines: [] }, food: { country: 'Portugal', dishes: [] }, spot: null,
      trip: { current: 'Portugal', visited: [{ country: 'Portugal' }] },
    });
    expect(s?.map?.country).toBe('Portugal');
    expect(s?.news?.headlines).toEqual([]);
    expect(s?.spot).toBeNull();
    expect(s?.trip.visited).toHaveLength(1);
    expect([s?.seq, s?.pending, s?.newsAvailable]).toEqual([4, true, true]);
  });

  it('reads a session that has only said hello', () => {
    expect(parseSnapshot({ stage: 'welcome', travelerName: '', map: null, spot: null })).toMatchObject({ stage: 'welcome', map: null, news: null, trip: { current: '', visited: [] } });
  });

  it.each([null, undefined, {}, { stage: 'nowhere' }, 'planning'])('rejects %p', (payload) => {
    expect(parseSnapshot(payload)).toBeNull();
  });
});

describe('ordering', () => {
  const at = (seq: number, stage: Snapshot['stage']) => parseSnapshot({ seq, stage })!;

  it('takes the first snapshot, and any newer one', () => {
    expect(isNewer(null, at(0, 'welcome'))).toBe(true);
    expect(isNewer(at(3, 'welcome'), at(4, 'around'))).toBe(true);
  });

  it('does not drag the board back when an older reply loses the race', () => {
    // The original board jumped back from the spot being described to the welcome screen, mid-sentence.
    expect(isNewer(at(5, 'around'), at(4, 'welcome'))).toBe(false);
  });
});
