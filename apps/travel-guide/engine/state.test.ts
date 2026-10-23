// The board's state, with no network anywhere near it. Ported from
// test_state.py and the state half of test_the_trip_is_kept.py, whose
// symptoms were watched live:
//  - said "actually let's look at Peru instead" and Japan vanished whole (the
//    Kyoto label, the Kaiseki card) with no way back short of paying for the
//    entire lookup again;
//  - "take me back to Niger" put NIGERIA on the map.
import { describe, expect, test } from 'vitest';
import { TravelState, type Destination } from './state.ts';

const JAPAN: Destination = { country: 'Japan', isoCode: 'JP', center: [36, 138], bbox: [24, 122, 45.5, 153], outline: null };
const PERU: Destination = { country: 'Peru', isoCode: 'PE', center: [-9.2, -75], bbox: [-18.3, -81.3, 0, -68.6], outline: null };
const SPOTS = [
  { name: 'A', category: 'museum', lat: 0, lon: 0 },
  { name: 'B', category: 'viewpoint', lat: 0.1, lon: 0 },
];

/** Japan with Kyoto, a headline and a dish, all shown. */
function aJapanSession(): TravelState {
  const state = new TravelState(true);
  state.setDestination(JAPAN, { city: 'Kyoto' });
  state.headlines = [{ title: 'Cherry blossom early', source: 'NHK', url: '', publishDate: '' }];
  state.dishes = [{ name: 'Kaiseki', description: 'An art form on a plate', imageUrl: null }];
  state.here!.headlinesShown = true;
  state.here!.dishesShown = true;
  return state;
}

describe('planning a trip', () => {
  test("a new country shows its own (empty) detail, never the last one's", () => {
    // Otherwise Japanese headlines sit under a map of Peru, which reads as a broken board rather than a stale one.
    const state = aJapanSession();
    state.setDestination(PERU);
    expect(state.country).toBe('Peru');
    expect(state.headlines).toEqual([]);
    expect(state.dishes).toEqual([]);
  });

  test('re-confirming the same country keeps what is on the board', () => {
    const state = aJapanSession();
    state.setDestination(JAPAN);
    expect(state.headlines).toHaveLength(1);
    expect(state.city).toBe('Kyoto'); // not wiped by a call that named no city
  });

  test('choosing a destination moves the board to planning', () => {
    const state = new TravelState();
    expect(state.stage).toBe('welcome');
    state.setDestination(JAPAN);
    expect(state.stage).toBe('planning');
  });

  test('a country already on the trip, chosen again, is the same stop with its detail kept', () => {
    const state = aJapanSession();
    state.setDestination(PERU);
    state.setDestination({ ...JAPAN, country: 'Japan' });
    expect(state.visited.map((e) => e.country)).toEqual(['Japan', 'Peru']);
    expect(state.dishes.map((d) => d.name)).toEqual(['Kaiseki']);
  });

  test('the same country under another name (its code matches) is not a second stop', () => {
    const state = new TravelState();
    state.setDestination({ ...PERU, country: 'Turkey', isoCode: 'TR' });
    state.setDestination({ ...PERU, country: 'Türkiye', isoCode: 'TR' });
    expect(state.visited).toHaveLength(1);
  });
});

describe('the trip that used to evaporate', () => {
  test('moving on files the country instead of dropping it', () => {
    const state = aJapanSession();
    state.setDestination(PERU);
    const japan = state.visited.find((e) => e.country === 'Japan')!;
    expect(japan.city).toBe('Kyoto');
    expect(japan.dishes.map((d) => d.name)).toEqual(['Kaiseki']);
    expect(japan.headlines).toHaveLength(1);
  });

  test('the strip lists where you have been and where you are, with what was shown there', () => {
    const state = aJapanSession();
    state.setDestination(PERU);
    const body = state.tripView();
    expect(body.current).toBe('Peru');
    expect(body.visited.map((v) => v.country)).toEqual(['Japan', 'Peru']);
    expect(body.visited[0].dishes).toEqual(['Kaiseki']);
    expect(body.visited[0].headlineCount).toBe(1);
  });

  test('dishes and headlines that were never shown stay off the strip', () => {
    const state = aJapanSession();
    state.here!.dishesShown = false;
    state.here!.headlinesShown = false;
    const [japan] = state.tripView().visited;
    expect(japan.dishes).toEqual([]);
    expect(japan.headlineCount).toBe(0);
  });

  test('the strip stays thin: names, what was shown, and a silhouette, never the full outlines', () => {
    const state = new TravelState();
    for (const [isoCode, country] of [['JP', 'Japan'], ['PE', 'Peru'], ['IT', 'Italy']]) {
      state.setDestination({ country, isoCode, center: [0, 0], bbox: null, outline: [[[0, 0], [1, 0], [1, 1], [0, 0]]], silhouette: null });
    }
    for (const stop of state.tripView().visited) expect(Object.keys(stop).sort()).toEqual(['city', 'country', 'dishes', 'headlineCount', 'silhouette']);
  });
});

describe('going back, which used to be impossible', () => {
  test('going back restores what was on screen', () => {
    const state = aJapanSession();
    state.setDestination(PERU);
    state.dishes = [{ name: 'Ceviche', description: 'Lime-cured fish', imageUrl: null }];
    expect(state.revisit('Japan')).toBe(true);
    expect(state.country).toBe('Japan');
    expect(state.city).toBe('Kyoto');
    expect(state.dishes.map((d) => d.name)).toEqual(['Kaiseki']);
    expect(state.stage).toBe('planning');
  });

  test('going back does not lose the country you left', () => {
    const state = aJapanSession();
    state.setDestination(PERU);
    state.dishes = [{ name: 'Ceviche', description: 'Lime-cured fish', imageUrl: null }];
    state.revisit('Japan');
    expect(state.visited.find((e) => e.country === 'Peru')!.dishes.map((d) => d.name)).toEqual(['Ceviche']);
  });

  test('a partial name or a country code finds it', () => {
    const state = aJapanSession();
    state.setDestination(PERU);
    expect(state.revisit('jp')).toBe(true);
    state.setDestination(PERU);
    expect(state.revisit('jap')).toBe(true);
  });

  test('going back to where you already are is refused, not silently ignored', () => {
    expect(aJapanSession().revisit('Japan')).toBe(false);
  });

  const nigerThenNigeria = () => {
    const state = new TravelState();
    state.setDestination({ country: 'Nigeria', isoCode: 'NG', center: [9, 8], bbox: null, outline: null });
    state.setDestination({ country: 'Niger', isoCode: 'NE', center: [17, 8], bbox: null, outline: null });
    return state;
  };

  test('going back lands on the country they named, not one that contains it', () => {
    // Dominica/Dominican Republic and Sudan/South Sudan do the same thing.
    const state = nigerThenNigeria();
    state.setDestination(PERU);
    expect(state.revisit('Niger')).toBe(true);
    expect(state.country).toBe('Niger');
  });

  test('asking for the country you are already on is not answered with a lookalike', () => {
    // Same cause, worse symptom: the board MOVED, to somewhere they did not ask for.
    const state = nigerThenNigeria();
    expect(state.revisit('Niger')).toBe(false);
    expect(state.country).toBe('Niger');
  });

  test('going back somewhere you never went is refused', () => {
    expect(aJapanSession().revisit('Norway')).toBe(false);
  });
});

describe('what is around them', () => {
  test('the queue advances once and then clamps', () => {
    // Wrapping would show the first museum again while the guide calls it another.
    const state = new TravelState();
    state.setSpots('Kyoto', [0, 0], SPOTS);
    expect(state.spot!.name).toBe('A');
    expect(state.hasMoreSpots).toBe(true);
    expect(state.advanceSpot()!.name).toBe('B');
    expect(state.hasMoreSpots).toBe(false);
    expect(state.advanceSpot()).toBeNull();
    expect(state.spot!.name).toBe('B');
  });

  test('you can get back to a spot you liked, and the first is the end of going back', () => {
    const state = new TravelState();
    state.setSpots('Kyoto', [35, 135], [...SPOTS, { name: 'C', category: 'shrine', lat: 0.2, lon: 0 }]);
    state.advanceSpot();
    state.advanceSpot();
    expect(state.rewindSpot()!.name).toBe('B');
    expect(state.rewindSpot()!.name).toBe('A');
    expect(state.rewindSpot()).toBeNull();
  });

  test('a pin on the map goes straight to its spot; the one showing, or one not there, does nothing', () => {
    const state = new TravelState();
    state.setSpots('Kyoto', [0, 0], SPOTS);
    expect(state.gotoSpot(1)!.name).toBe('B');
    expect(state.gotoSpot(1)).toBeNull();
    expect(state.gotoSpot(7)).toBeNull();
    expect(state.gotoSpot(-1)).toBeNull();
  });

  test('a failed lookup is not an empty neighbourhood', () => {
    const failed = new TravelState();
    failed.setSpots('Kyoto', [0, 0], null);
    const empty = new TravelState();
    empty.setSpots('Kyoto', [0, 0], []);
    expect(failed.spotView()!.lookupFailed).toBe(true);
    expect(empty.spotView()!.lookupFailed).toBe(false);
    expect(failed.spotView()!.spot).toBeNull();
    expect(empty.spotView()!.spot).toBeNull();
  });

  test('looking somewhere new restarts the queue', () => {
    const state = new TravelState();
    state.setSpots('Kyoto', [0, 0], SPOTS);
    state.advanceSpot();
    state.setSpots('Lisbon', [38.7, -9.1], SPOTS.slice(0, 1));
    expect(state.spotIndex).toBe(0);
    expect(state.aroundPlace).toBe('Lisbon');
  });
});

describe('the snapshot', () => {
  test('is what the page redraws from', () => {
    const state = new TravelState();
    state.travelerName = 'Sam';
    state.setDestination({ ...JAPAN, outline: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
    state.headlines = [{ title: 'x', source: 'news', url: '', publishDate: '' }];
    state.setSpots('Kyoto', [0, 0], SPOTS);
    const s = state.snapshot();
    expect(s.stage).toBe('around');
    expect(s.travelerName).toBe('Sam');
    expect(s.map!.outline).toEqual([[[0, 0], [1, 0], [1, 1], [0, 0]]]);
    expect(s.map!.attribution).toMatch(/OpenStreetMap/);
    expect(s.news!.headlines).toHaveLength(1);
    expect(s.news!.shown).toBe(false);
    expect(s.spot!.total).toBe(2);
    expect(s.spot!.pins.map((p) => p.name)).toEqual(['A', 'B']);
  });

  test('a fresh session snapshots empty rather than missing keys', () => {
    const s = new TravelState().snapshot();
    expect(s.map).toBeNull();
    expect(s.spot).toBeNull();
    expect(s.trip).toEqual({ current: '', visited: [] });
    expect(Object.keys(s).sort()).toEqual(['continent', 'food', 'map', 'news', 'newsAvailable', 'pending', 'seq', 'spot', 'stage', 'travelerName', 'trip']);
  });

  test('anything still loading, for any country, keeps the page polling', () => {
    const state = aJapanSession();
    expect(state.snapshot().pending).toBe(false);
    state.setDestination(PERU);
    state.visited[0].photosLoading = true; // Japan's photos, still on their way after moving on
    expect(state.snapshot().pending).toBe(true);
  });
});

