// What the app checks itself: a name is a name, a control's action is well
// formed, and the safety net acts only on words that clearly ask for
// something safe to do twice. The name filter is ported from
// test_the_trip_is_kept.py.
import { describe, expect, test } from 'vitest';
import { actionIn, isAName, mustDo, netContext, titleCase, type NetCall, type NetContext } from './judge.ts';
import type { Snapshot } from './types.ts';

describe('names', () => {
  // The board invites "tell me where you are dreaming of"; typed as the first
  // message, the header then read "Hello dreaming of Japan" for the rest of the session.
  test.each(['dreaming of Japan', 'I want Japan', 'a trip to Peru', 'show me Italy', 'thinking about Spain', 'hello there', 'yes please', '3 day trip', 'remember_traveler', 'I would really love to go somewhere warm'])('a request is never a name: %s', (said) => {
    expect(isAName(said)).toBe(false);
  });

  test.each(['Sam', 'Mei Lin', 'Ana Sofia Ruiz', 'Lumi'])('a name is still a name: %s', (said) => {
    expect(isAName(said)).toBe(true);
  });

  test('written the way people write names', () => {
    expect(titleCase('mei lin')).toBe('Mei Lin');
    expect(titleCase('anne-marie')).toBe('Anne-Marie');
  });
});

describe('the safety net', () => {
  const WORLD: NetContext = { stage: 'welcome', current: '', visited: [], newsAvailable: true, foodShown: false, newsShown: false, sight: null };
  const JAPAN: NetContext = { ...WORLD, stage: 'planning', current: 'Japan', visited: ['Peru', 'Japan'] };
  const SIGHTS: NetContext = { ...JAPAN, stage: 'around', sight: { index: 1, total: 4 } };
  const cases: [string, NetContext, NetCall | null][] = [
    // a country named plainly as where to go
    ["Let's go to Portugal!", WORLD, { name: 'choose_destination', arguments: { place: 'Portugal' } }],
    ["I'm dreaming of Japan", WORLD, { name: 'choose_destination', arguments: { place: 'Japan' } }],
    ['Take me to Peru instead of Japan', WORLD, { name: 'choose_destination', arguments: { place: 'Peru' } }],
    ['How about Iceland?', JAPAN, { name: 'choose_destination', arguments: { place: 'Iceland' } }],
    ["Let's go to Niger", WORLD, { name: 'choose_destination', arguments: { place: 'Niger' } }],
    ["I don't want to go to Peru", WORLD, null],
    ['I loved Japan when I went', WORLD, null],
    ['How about Bali?', WORLD, null], // not a country: the host finds where it is
    ["Let's go to Japan", JAPAN, null], // already there
    // back to a country on the route
    ['Back to Peru, please', JAPAN, { name: 'choose_destination', arguments: { place: 'Peru' } }],
    ['Take me back to Japan', SIGHTS, { name: 'choose_destination', arguments: { place: 'Japan' } }], // from its sights to its page
    ['back to Japan', JAPAN, null], // it is on screen
    // food and news for the country on the map
    ['What should I eat there?', JAPAN, { name: 'show_food', arguments: {} }],
    ['Any good food?', JAPAN, { name: 'show_food', arguments: {} }],
    ["What's in the news there?", JAPAN, { name: 'show_news', arguments: {} }],
    ['What should I eat there?', { ...JAPAN, foodShown: true }, null], // on screen already
    ['Any headlines?', { ...JAPAN, newsAvailable: false }, null],
    ['What do they eat in Peru?', JAPAN, null], // another country: the host's call
    ['What should I eat?', WORLD, null], // no country yet
    // the sights, one at a time
    ['Another one, please.', SIGHTS, { name: 'next_sight', arguments: { from: 1 } }],
    ['next', SIGHTS, { name: 'next_sight', arguments: { from: 1 } }],
    ['What else is there?', SIGHTS, { name: 'next_sight', arguments: { from: 1 } }],
    ['Go back to the one before', SIGHTS, { name: 'previous_sight', arguments: { from: 1 } }],
    ['The previous one', SIGHTS, { name: 'previous_sight', arguments: { from: 1 } }],
    ['Is it next to the river?', SIGHTS, null],
    ['another one', { ...SIGHTS, sight: { index: 3, total: 4 } }, null], // the last
    ['the one before', { ...SIGHTS, sight: { index: 0, total: 4 } }, null], // the first
    ['another one', JAPAN, null], // no sights on screen
    // not the board's business
    ['That sounds lovely', JAPAN, null],
    ["What's the weather like there in May?", JAPAN, null],
    ["What's worth seeing around Shibuya station?", JAPAN, null], // exploring is the host's: the place is its to read
  ];
  test.each(cases)('%s', (said, ctx, expected) => {
    expect(mustDo(said, ctx)).toEqual(expected);
  });

  test('reads its context from the board', () => {
    const s: Snapshot = {
      seq: 3, stage: 'around', travelerName: '', continent: '', pending: false, newsAvailable: false,
      map: { country: 'Japan', isoCode: 'JP', city: '', center: [36, 138], bbox: null, outline: null, attribution: '' },
      news: null, food: { country: 'Japan', dishes: [], shown: true, loading: false },
      spot: { place: 'Kyoto', origin: null, index: 2, total: 5, lookupFailed: false, spot: { name: 'X', category: 'temple', lat: 35, lon: 135, distance: '', mapsUrl: '', imageUrl: null, summary: '' }, pins: [] },
      trip: { current: 'Japan', visited: [{ country: 'Japan', city: '', dishes: [], headlineCount: 0, silhouette: null }] },
    };
    expect(netContext(s)).toEqual({ stage: 'around', current: 'Japan', visited: ['Japan'], newsAvailable: false, foodShown: true, newsShown: false, sight: { index: 2, total: 5 } });
  });
});

describe('controls', () => {
  test('a control sends a checked action', () => {
    expect(actionIn({ kind: 'search', query: '  Kyoto, Japan ' })).toEqual({ kind: 'search', query: 'Kyoto, Japan' });
    expect(actionIn({ kind: 'coords', lat: 38.7, lon: -9.1 })).toEqual({ kind: 'coords', lat: 38.7, lon: -9.1 });
    expect(actionIn({ kind: 'goto', index: 2 })).toEqual({ kind: 'goto', index: 2 });
    expect(actionIn({ kind: 'show', stage: 'around' })).toEqual({ kind: 'show', stage: 'around' });
    expect(actionIn({ kind: 'next' })).toEqual({ kind: 'next' });
  });

  test.each([null, 'next', {}, { kind: 'launch' }, { kind: 'search', query: '' }, { kind: 'coords', lat: '1', lon: 2 }, { kind: 'show', stage: 'moon' }, { kind: 'goto', index: Number.NaN }])('anything else is no action: %j', (value) => {
    expect(actionIn(value)).toBeNull();
  });
});
