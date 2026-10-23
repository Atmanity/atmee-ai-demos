// The trip notes: gathered from the board as it shows things, and written out
// as the text the user downloads at the end.
import { expect, test } from 'vitest';
import type { Snapshot, Spot } from '../engine/types.ts';
import { emptyNotes, notesFrom, sightsByPlace, tripSize, tripText } from './notes.ts';

const world = (): Snapshot => ({
  seq: 1, stage: 'welcome', travelerName: '', continent: '', pending: false, newsAvailable: true,
  map: null, news: null, food: null, spot: null, trip: { current: '', visited: [] },
});
const japan = (over: Partial<Snapshot> = {}): Snapshot => ({
  ...world(),
  stage: 'planning',
  map: { country: 'Japan', isoCode: 'JP', city: 'Kyoto', center: [36, 138], bbox: null, outline: null, attribution: '' },
  food: { country: 'Japan', dishes: [{ name: 'Ramen', description: 'Broth and noodles.', imageUrl: null }], shown: false, loading: false },
  news: { country: 'Japan', headlines: [{ title: 'Trams return', source: 'x', url: 'https://news.test/1', publishDate: '' }], shown: false, loading: false },
  trip: { current: 'Japan', visited: [{ country: 'Japan', city: 'Kyoto', dishes: [], headlineCount: 0, silhouette: null }] },
  ...over,
});
const sight = (name: string): Spot => ({ name, category: 'temple', lat: 35, lon: 135.78, distance: 'about a 9 minute walk away', mapsUrl: `https://maps.test/${name}`, imageUrl: null, summary: `${name} is lovely.` });
const around = (place: string, name: string, index = 0): Snapshot => ({
  ...japan(), stage: 'around', spot: { place, origin: null, index, total: 3, lookupFailed: false, spot: sight(name), pins: [] },
});

test('the notes keep what the board showed: dishes and headlines once shown, every sight looked at', () => {
  let notes = notesFrom(emptyNotes(), japan());
  expect(notes.countries.Japan).toEqual({ dishes: [], headlines: [] }); // on the map, nothing shown yet
  notes = notesFrom(notes, japan({ food: { ...japan().food!, shown: true } }));
  notes = notesFrom(notes, japan({ news: { ...japan().news!, shown: true } })); // the dishes stay
  expect(notes.countries.Japan.dishes.map((d) => d.name)).toEqual(['Ramen']);
  expect(notes.countries.Japan.headlines.map((h) => h.title)).toEqual(['Trams return']);
  notes = notesFrom(notes, around('Gion', 'Yasaka Shrine'));
  notes = notesFrom(notes, around('Gion', 'Kennin-ji', 1));
  notes = notesFrom(notes, around('Gion', 'Yasaka Shrine')); // seen again: once
  notes = notesFrom(notes, around('Arashiyama', 'Tenryū-ji'));
  expect(sightsByPlace(notes).map(([place, sights]) => [place, sights.map((s) => s.name)])).toEqual([
    ['Gion', ['Yasaka Shrine', 'Kennin-ji']],
    ['Arashiyama', ['Tenryū-ji']],
  ]);
  expect(tripSize(japan(), notes)).toBe(4);
});

test('a snapshot with nothing new leaves the notes as they are (no needless redraw)', () => {
  const notes = notesFrom(emptyNotes(), japan());
  expect(notesFrom(notes, japan())).toBe(notes);
  expect(notesFrom(emptyNotes(), world())).toEqual(emptyNotes());
});

test('the downloaded notes: the route with its dishes and news, the sights with their links, and the credits', () => {
  let notes = notesFrom(emptyNotes(), japan({ food: { ...japan().food!, shown: true }, news: { ...japan().news!, shown: true } }));
  notes = notesFrom(notes, around('Gion', 'Yasaka Shrine'));
  const text = tripText(japan({ travelerName: 'Sam' }), notes, 'Lumi', new Date(2026, 9, 23));
  expect(text).toContain("Sam's trip, from Yonder");
  expect(text).toContain('Dreamt up with Lumi on 23 October 2026');
  expect(text).toContain('1. Japan, Kyoto');
  expect(text).toContain('Eat: Ramen. Broth and noodles.');
  expect(text).toContain('In the news: Trams return (https://news.test/1)');
  expect(text).toContain('AROUND GION');
  expect(text).toContain('- Yasaka Shrine (temple, about a 9 minute walk away)');
  expect(text).toContain('https://maps.test/Yasaka Shrine');
  expect(text).toContain('OpenStreetMap contributors');
});

test('an empty trip says so rather than writing an empty page', () => {
  expect(tripText(world(), emptyNotes(), 'Lumi', new Date(2026, 9, 23))).toContain('Nothing on this trip yet.');
});
