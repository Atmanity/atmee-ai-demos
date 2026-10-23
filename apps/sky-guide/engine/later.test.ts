// When a refused star or figure is worth a look: well up, in the dark.
import { expect, test } from 'vitest';
import { SkyChart } from './chart.ts';
import { whenUp } from './later.ts';
import { altAz, localClock, nightOf } from './sky.ts';
import { findStar } from './catalog.ts';

const EPOCH = 1785931200;   // 2026-08-05, 8 pm in Taipei
const chart = (place = 'Taipei', epoch = EPOCH) => new SkyChart({ place, epoch });

test('Orion from Taipei in August: well up before dawn, on a quarter hour, and drawable then', () => {
  const sky = chart();
  const at = whenUp(sky, { kind: 'show_constellation', name: 'Orion' })!;
  expect(at).toBeGreaterThan(EPOCH);
  const clock = localClock(at, 8);
  expect(clock.minute % 15).toBe(0);
  expect(clock.hour >= 2 && clock.hour <= 5).toBe(true);
  expect(() => chart('Taipei', at).showConstellation('Orion')).not.toThrow();
  // The chart itself was not moved.
  expect(sky.epoch).toBe(EPOCH);
});

test('a star: at least ten degrees up, and only in the dark hours', () => {
  const at = whenUp(chart(), { kind: 'select', star: 'Betelgeuse' })!;
  const star = findStar('betelgeuse')!;
  expect(altAz(star.raH, star.decDeg, 25.03, 121.56, at)[0]).toBeGreaterThanOrEqual(10);
  const { hours } = nightOf(at, 8);
  expect(hours >= 19 && hours <= 29.5).toBe(true);
});

test('nothing to offer: a star that never rises here, a name the catalogue lacks, anything else', () => {
  expect(whenUp(chart(), { kind: 'select', star: 'Miaplacidus' })).toBeNull();
  expect(whenUp(chart(), { kind: 'select', star: 'Zorblax' })).toBeNull();
  expect(whenUp(chart(), { kind: 'show_constellation', name: 'Virgo' })).toBeNull();
  expect(whenUp(chart(), { kind: 'set_place', label: 'Lisbon' })).toBeNull();
});
