// Your night: the list of what you looked at, and the file to take outside.
import { expect, test } from 'vitest';
import { FACTS } from './catalog.ts';
import { SkyChart } from './chart.ts';
import { byPlaceAndTime, NIGHT_LIMIT, nightFileName, nightText, remember, seenFigure, seenStar, type NightEntry } from './night.ts';

const EPOCH = 1785931200;   // 2026-08-05, 8 pm in Taipei
const chart = (place = 'Taipei', epoch = EPOCH) => new SkyChart({ place, epoch });

test('a marked star becomes a line with where to look and the catalogue\'s first line', () => {
  const sky = chart();
  expect(seenStar(sky.view())).toBeNull();
  sky.select('vega');
  expect(seenStar(sky.view())).toEqual({
    id: `star:vega:Taipei:${EPOCH}`, kind: 'star', name: 'Vega', place: 'Taipei', when: '8:00 pm, Wed 5 Aug',
    where: 'high up in the north-east', note: FACTS.vega[0],
  });
  // A star with no authored lines is remembered by its catalogue row.
  const plain = sky.snapshot().visible.find((v) => !FACTS[v.id])!;
  sky.select(plain.id);
  expect(seenStar(sky.view())!.note).toMatch(/^In .+, at magnitude/);
});

test('a drawn figure becomes a line found by its brightest star', () => {
  const sky = chart();
  expect(seenFigure(sky.view())).toBeNull();
  sky.showConstellation('Scorpius');
  expect(seenFigure(sky.view())).toMatchObject({ kind: 'figure', name: 'Scorpius', where: 'about halfway up in the south', note: 'Find it by Antares, its brightest star.' });
});

test('a repeat moves to the end instead of doubling; another hour is another line; the list is capped', () => {
  const sky = chart();
  sky.select('vega');
  const vega = seenStar(sky.view());
  sky.select('arcturus');
  const arcturus = seenStar(sky.view());
  let list = [vega, arcturus, vega].reduce<NightEntry[]>(remember, []);
  expect(list.map((e) => e.name)).toEqual(['Arcturus', 'Vega']);
  sky.setTime({ shiftHours: 1 });
  sky.select('vega');
  list = remember(list, seenStar(sky.view()));
  expect(list.map((e) => e.name)).toEqual(['Arcturus', 'Vega', 'Vega']);
  expect(remember(list, null)).toBe(list);
  const many = Array.from({ length: NIGHT_LIMIT + 5 }, (_, i) => ({ ...vega!, id: `x${i}` }));
  expect(many.reduce<NightEntry[]>(remember, [])).toHaveLength(NIGHT_LIMIT);
});

test('the file groups the night by place and hour, and says what the directions mean', () => {
  const sky = chart();
  sky.select('vega');
  const a = seenStar(sky.view());
  sky.showConstellation('Scorpius');
  const b = seenFigure(sky.view());
  const lisbon = chart('Lisbon', EPOCH + 8 * 3600);
  lisbon.select('vega');
  const c = seenStar(lisbon.view());
  const list = [a, b, c].reduce<NightEntry[]>(remember, []);
  expect(byPlaceAndTime(list).map((g) => [g.place, g.entries.length])).toEqual([['Taipei', 2], ['Lisbon', 1]]);
  const text = nightText(list);
  expect(text).toContain('Taipei, 8:00 pm, Wed 5 Aug\n  Vega: high up in the north-east.');
  expect(text).toContain('  Scorpius (constellation): about halfway up in the south. Find it by Antares, its brightest star.');
  expect(text).toContain('Lisbon, 8:00 pm, Wed 5 Aug');
  expect(text).toContain('leaves out the Sun, the Moon and the planets');
  expect(nightFileName(list)).toBe('lodestar-taipei-5-aug.txt');
  expect(nightFileName([])).toBe('lodestar.txt');
});
