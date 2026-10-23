// What the app hears as a request to the chart. The phrasings are the ones the
// original's tool descriptions and panel hints named ("what's that bright
// one", "show me Orion", "the sky from Lisbon", "show me midnight", "which one
// is the north star", "an hour later", "before dawn", "back to tonight"),
// plus the traps found while porting.
import { describe, expect, test } from 'vitest';
import { fromModel, normalize, parse } from './judge.ts';
import type { Intent } from './types.ts';

const intents = (text: string) => parse(text, { lon: 121.56 })?.intents ?? null;
const one = (text: string) => {
  const found = intents(text);
  expect(found, text).not.toBeNull();
  expect(found, text).toHaveLength(1);
  return found![0];
};

describe('stars', () => {
  test.each([
    ["Where's Vega?", 'vega'], ['Show me Betelgeuse', 'betelgeuse'], ['Tell me about Antares', 'antares'],
    ['Kaus Australis', 'kaus_australis'], ['What is Rigil Kentaurus?', 'rigil_kentaurus'],
    ['Which one is the north star?', 'polaris'], ['Where is the pole star', 'polaris'], ['find the dog star', 'sirius'],
    ['Where is Alpha Centauri?', 'rigil_kentaurus'], ['Is Sirius the brightest star?', 'sirius'],
  ])('%s', (said, star) => {
    expect(one(said)).toEqual({ kind: 'select', star });
    expect(parse(said)!.exact).toBe(true);
  });

  test('"that bright one" asks for the brightest star that is up (the panel prints the phrase)', () => {
    for (const said of ["What's that bright one?", 'which is the brightest star', 'the bright one please']) {
      expect(one(said)).toEqual({ kind: 'select', star: 'brightest' });
    }
  });

  test('known mishearings map to the star, but are marked not exact (the avatar heard them too)', () => {
    for (const said of ['Where is beetle juice?', 'show me Beetlejuice', 'where is betelguese']) {
      expect(one(said)).toEqual({ kind: 'select', star: 'betelgeuse' });
      expect(parse(said)!.exact).toBe(false);
    }
    expect(one('Where is serious?')).toEqual({ kind: 'select', star: 'sirius' });
    expect(parse('Are you serious?')).toBeNull();
  });
});

describe('constellations', () => {
  test.each([
    ['Show me Orion', 'Orion'], ['Show me Orion.', 'Orion'], ["Show me Orion's belt", 'Orion'],
    ['Show me the Plough', 'Ursa Major'], ['Where is the Big Dipper?', 'Ursa Major'], ['the little dipper', 'Ursa Minor'],
    ['Can you show me the Teapot?', 'Sagittarius'], ['the Southern Cross please', 'Crux'], ['Is Scorpio up?', 'Scorpius'],
    ['Show me Bootes', 'Boötes'], ['show me the stars in Orion', 'Orion'],
    // No figure drawn: still a request, which the chart refuses by name.
    ['Show me Virgo', 'Virgo'],
  ])('%s', (said, name) => {
    expect(one(said)).toEqual({ kind: 'show_constellation', name });
  });

  test('an abbreviation is never read out of free speech ("And" is Andromeda\'s)', () => {
    expect(parse('and then what?')).toBeNull();
    expect(parse('Leo and Gemini')!.intents[0]).toEqual({ kind: 'show_constellation', name: 'Gemini' });
  });
});

describe('places', () => {
  test.each([
    ['Show me the sky from Lisbon', 'Lisbon'], ['What about from Sydney?', 'Sydney'], ["I'm in Tokyo", 'Tokyo'],
    ['Take me to Cape Town', 'Cape Town'], ['Lisbon', 'Lisbon'], ['how about NYC', 'New York'], ['Rome!', 'Rome'],
  ])('%s', (said, label) => {
    expect(one(said)).toEqual({ kind: 'set_place', label });
  });

  test('coordinates, however they are said', () => {
    expect(one('latitude 40 longitude -74')).toEqual({ kind: 'set_place', lat: 40, lon: -74 });
    expect(one('40.7 north 74 west')).toEqual({ kind: 'set_place', lat: 40.7, lon: -74 });
    expect(one('33.9 degrees south, 18.4 degrees east')).toEqual({ kind: 'set_place', lat: -33.9, lon: 18.4 });
    expect(one('33.9°S 18.4°E')).toEqual({ kind: 'set_place', lat: -33.9, lon: 18.4 });
    expect(one('latitude minus 33.9, longitude 18.4')).toEqual({ kind: 'set_place', lat: -33.9, lon: 18.4 });
  });

  test('the equator and the poles keep the chart\'s longitude (the original tool\'s "from the equator")', () => {
    expect(one('Show me the sky from the equator')).toEqual({ kind: 'set_place', lat: 0, lon: 121.56 });
    expect(one('What about the north pole?')).toEqual({ kind: 'set_place', lat: 90, lon: 121.56 });
  });

  test('an unknown city in a place frame is unresolved, with a fallback the chart refuses by name', () => {
    for (const said of ['the sky from Kyoto', 'From Kyoto?', "I'm in Kyoto", 'the sky from kyoto at midnight']) {
      const parsed = parse(said)!;
      expect(parsed.unresolved, said).toMatchObject({ target: 'kyoto', frame: 'place', fallback: { kind: 'set_place', label: 'Kyoto' } });
    }
    expect(parse('the sky from kyoto at midnight')!.intents).toEqual([{ kind: 'set_time', preset: 'midnight' }]);
  });

  test('a bare "from" needs a capitalised name: "away from the city lights" is not a place', () => {
    expect(parse('far away from the city lights')).toBeNull();
    expect(parse('What can I see from here?')).toBeNull();
  });
});

describe('time', () => {
  test.each<[string, Intent]>([
    ['Show me midnight', { kind: 'set_time', preset: 'midnight' }],
    ['Before dawn', { kind: 'set_time', preset: 'dawn' }],
    ['Back to tonight', { kind: 'set_time', preset: 'tonight' }],
    ['reset the clock', { kind: 'set_time', preset: 'tonight' }],
    ['An hour later', { kind: 'set_time', shiftHours: 1 }],
    ['one hour later please', { kind: 'set_time', shiftHours: 1 }],
    ['Two hours earlier', { kind: 'set_time', shiftHours: -2 }],
    ['Go back an hour', { kind: 'set_time', shiftHours: -1 }],
    ['move forward 3 hours', { kind: 'set_time', shiftHours: 3 }],
    ['half an hour later', { kind: 'set_time', shiftHours: 0.5 }],
    ['what does it look like in an hour', { kind: 'set_time', shiftHours: 1 }],
    ['a bit later', { kind: 'set_time', shiftHours: 1 }],
    ['In three days', { kind: 'set_time', shiftHours: 72 }],
    ['Tomorrow night', { kind: 'set_time', shiftHours: 24 }],
    ['Six months from now', { kind: 'set_time', shiftHours: 4383 }],
    ['Show me 3 a.m.', { kind: 'set_time', clockHour: 3 }],
    ['What about 10:30 pm?', { kind: 'set_time', clockHour: 22.5 }],
    ['at nine in the evening', { kind: 'set_time', clockHour: 21 }],
    ['half past two in the morning', { kind: 'set_time', clockHour: 2.5 }],
    ['at 12 tonight', { kind: 'set_time', clockHour: 0 }],
    ['ten o\'clock', { kind: 'set_time', clockHour: 22 }],
    ['what about at sunset', { kind: 'set_time', clockHour: 19 }],
    ['Show me December', { kind: 'set_time', month: 12 }],
    ['December 21st', { kind: 'set_time', month: 12, day: 21 }],
    ['the 3rd of March', { kind: 'set_time', month: 3, day: 3 }],
    ['Show me the sky in winter', { kind: 'set_time', season: 'winter' }],
    ['what about in the fall', { kind: 'set_time', season: 'autumn' }],
  ])('%s', (said, intent) => {
    expect(one(said)).toEqual(intent);
  });

  test('a preset and a shift compose: "two hours before dawn"', () => {
    expect(intents('two hours before dawn')).toEqual([{ kind: 'set_time', preset: 'dawn' }, { kind: 'set_time', shiftHours: -2 }]);
  });

  test('a far jump is still parsed; the chart refuses it ("further than a year away")', () => {
    expect(one('in two years')).toEqual({ kind: 'set_time', shiftHours: 17532 });
  });

  test('stories and questions are not clock moves', () => {
    for (const said of ["What's up tonight?", 'I saw a shooting star a few minutes ago', 'May I ask something?', 'what is the summer triangle', 'tonight is lovely, isn\'t it']) {
      expect(parse(said), said).toBeNull();
    }
  });
});

describe('several things at once, in the order they apply: place, time, figure, star', () => {
  test('the sky from Lisbon at midnight', () => {
    expect(intents('Show me the sky from Lisbon at midnight')).toEqual([{ kind: 'set_place', label: 'Lisbon' }, { kind: 'set_time', preset: 'midnight' }]);
  });
  test('will Orion be up at midnight', () => {
    expect(intents('Will Orion be up at midnight?')).toEqual([{ kind: 'set_time', preset: 'midnight' }, { kind: 'show_constellation', name: 'Orion' }]);
  });
  test('Vega in Lyra', () => {
    expect(intents('where is Vega in Lyra')).toEqual([{ kind: 'show_constellation', name: 'Lyra' }, { kind: 'select', star: 'vega' }]);
  });
});

describe('clearing', () => {
  test.each<[string, Intent[]]>([
    ['Clear', [{ kind: 'clear_selection' }]],
    ['unmark it', [{ kind: 'clear_selection' }]],
    ['Clear the constellation', [{ kind: 'clear_figure' }]],
    ['Hide the lines', [{ kind: 'clear_figure' }]],
    ['Clear everything', [{ kind: 'clear_selection' }, { kind: 'clear_figure' }]],
  ])('%s', (said, expected) => {
    expect(intents(said)).toEqual(expected);
  });
});

describe('not for the chart: the avatar answers these itself', () => {
  test.each(['Tell me about it', 'Why is it orange?', "What's up?", 'How far away is it?', 'Is that Venus?', 'Show me Mars', 'Where is the Moon tonight?', 'where is the best place to see stars', 'Thank you!'])('%s', (said) => {
    expect(parse(said)).toBeNull();
  });

  test('a command around a capitalised unknown name is unresolved, and the fallback is refused by name', () => {
    expect(parse("Where's Zorblax?")).toMatchObject({ intents: [], unresolved: { target: 'zorblax', frame: 'thing', fallback: { kind: 'select', star: 'Zorblax' } } });
    expect(parse('Where is Proxima?')!.unresolved!.fallback).toEqual({ kind: 'select', star: 'Proxima' });
  });
});

describe('the words as heard', () => {
  test('normalising keeps numbers, signs and times, and nothing else', () => {
    expect(normalize('At 10:30 P.M., 33.9°S −18.4!')).toBe('at 10:30 pm 33.9 degrees s -18.4');
    expect(normalize('Kaus-Australis')).toBe('kaus australis');
  });
});

describe('the model\'s reading, when there is one', () => {
  test('becomes intents in order, which the chart still validates', () => {
    expect(fromModel({ action: 'constellation', constellation: 'Orion', hoursFromNow: 3 })).toEqual([
      { kind: 'set_time', shiftHours: 3 }, { kind: 'show_constellation', name: 'Orion' },
    ]);
    expect(fromModel({ action: 'coordinates', latitude: 35, longitude: 135.8 })).toEqual([{ kind: 'set_place', lat: 35, lon: 135.8 }]);
    expect(fromModel({ action: 'place', place: 'Kyoto' })).toEqual([{ kind: 'set_place', label: 'Kyoto' }]);
    expect(fromModel({ action: 'time', date: '2026-12-21' })).toEqual([{ kind: 'set_time', date: '2026-12-21' }]);
  });

  test('"none" is nothing, and coordinates count only when the model says the user said them', () => {
    expect(fromModel({ action: 'none', star: 'Vega' })).toEqual([]);
    expect(fromModel({ action: 'place', place: 'Kyoto', latitude: 35, longitude: 135.8 })).toEqual([{ kind: 'set_place', label: 'Kyoto' }]);
    expect(fromModel(null)).toEqual([]);
  });
});
