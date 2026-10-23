// The host's tools, answered by the chart. Each result is the chart's real
// outcome, in words: what was marked or drawn and where, what moved, or why
// nothing did. Ported in spirit from the original tool tests (`test_table.py`:
// refusals reach somebody, the cues hand over the catalogue's words, what rose
// and set), now as the host's first reply instead of an event after it.
import { describe, expect, test, vi } from 'vitest';
import { FACTS } from './catalog.ts';
import { SkyChart } from './chart.ts';
import { isToolName, runTool } from './actions.ts';
import { localClock, nightOf } from './sky.ts';
import type { Intent } from './types.ts';

const EPOCH = 1785931200;   // 2026-08-05, 8 pm in Taipei
const chart = (place = 'Taipei', epoch = EPOCH) => new SkyChart({ place, epoch, now: EPOCH });
const run = (sky: SkyChart, name: string, args: Record<string, unknown>, interpret?: (t: string) => Promise<Intent[] | null>) => runTool(sky, name, args, { now: EPOCH, interpret });

describe('point_out', () => {
  test('marks a star that is up, with where to look and the catalogue\'s words', async () => {
    const sky = chart();
    const done = await run(sky, 'point_out', { star: 'Vega' });
    expect(sky.selected).toBe('vega');
    expect(done.view.snapshot.selected).toBe('vega');
    expect(done.result).toMatch(/^Marked: Vega, high up in the north-east\./);
    expect(done.result).toContain(FACTS.vega[0]);
    expect(done.result).toContain('changing no number');
    expect(done.notice).toBeNull();
    expect(done.seen).toMatchObject([{ kind: 'star', name: 'Vega', place: 'Taipei', where: 'high up in the north-east' }]);
  });

  test('takes the names people use: "that bright one", "the north star", a known mishearing', async () => {
    const sky = chart();
    expect((await run(sky, 'point_out', { star: 'that bright one' })).result).toMatch(/^Marked: Arcturus, the brightest star up now, /);
    await run(sky, 'point_out', { star: 'the north star' });
    expect(sky.selected).toBe('polaris');
    const beforeDawn = chart('Taipei', EPOCH + 9 * 3600);
    await run(beforeDawn, 'point_out', { star: 'beetle juice' });
    expect(beforeDawn.selected).toBe('betelgeuse');
  });

  test('a star that is down: not marked, when it rises, its catalogue lines, and an offer of when it is well up', async () => {
    const sky = chart();
    const done = await run(sky, 'point_out', { star: 'Betelgeuse' });
    expect(sky.selected).toBeNull();
    expect(done.result).toMatch(/^Not up now: Betelgeuse is below the horizon from Taipei right now — it rises about/);
    expect(done.result).toContain(FACTS.betelgeuse[0]);
    expect(done.result).toContain('move the clock only if they ask');
    expect(done.notice?.text).toContain('below the horizon');
    expect(done.notice?.retry).toEqual({ kind: 'select', star: 'betelgeuse' });
    const later = done.notice!.later!;
    expect(later).toBeGreaterThan(EPOCH);
    expect(new SkyChart({ place: 'Taipei', epoch: later }).snapshot().visible.some((v) => v.id === 'betelgeuse')).toBe(true);
  });

  test('a star that never rises from here is refused with no offer', async () => {
    const done = await run(chart(), 'point_out', { star: 'Miaplacidus' });
    expect(done.result).toContain('never rises');
    expect(done.result).not.toContain('offer to show');
    expect(done.notice?.later).toBeNull();
  });

  test('a name the catalogue does not have is refused by name, and nothing is said from memory', async () => {
    const done = await run(chart(), 'point_out', { star: 'Zorblax' });
    expect(done.result).toContain("I don't have Zorblax in the catalogue");
    expect(done.result).toContain('say nothing about that star from memory');
    expect(done.result).toContain('Arcturus');   // the offer is a star that is up
  });

  test('a planet, the Moon or the Sun is not on the chart, and nothing changes', async () => {
    const sky = chart();
    sky.select('vega');
    for (const star of ['Jupiter', 'the Moon', 'Mars']) {
      const done = await run(sky, 'point_out', { star });
      expect(done.result).toContain('stars only');
      expect(done.result).toContain('Do not say where it is');
    }
    expect(sky.selected).toBe('vega');
  });

  test('a model reads what the rules cannot, and the chart still decides', async () => {
    const interpret = vi.fn(async () => [{ kind: 'select', star: 'Betelgeuse' }] as Intent[]);
    const sky = chart('Taipei', EPOCH + 9 * 3600);
    await run(sky, 'point_out', { star: 'Alpha Orionis' }, interpret);
    expect(interpret).toHaveBeenCalledWith('show me Alpha Orionis');
    expect(sky.selected).toBe('betelgeuse');
    // The rules first: no model call for a name they know.
    interpret.mockClear();
    await run(sky, 'point_out', { star: 'Rigel' }, interpret);
    expect(interpret).not.toHaveBeenCalled();
  });

  test('a constellation named to point_out is drawn (the host mixed them up)', async () => {
    const sky = chart();
    const done = await run(sky, 'point_out', { star: 'Scorpius' });
    expect(sky.figureCon).toBe('Sco');
    expect(done.result).toMatch(/^Drawn: Scorpius is on the chart now\./);
  });

  test('no name: nothing changes and the host asks which', async () => {
    expect((await run(chart(), 'point_out', {})).result).toContain('Ask them which star they mean');
  });
});

describe('show_constellation', () => {
  test('draws a figure that is up and says where it is, by its brightest star', async () => {
    const sky = chart();
    const done = await run(sky, 'show_constellation', { name: 'Scorpio' });
    expect(sky.figureCon).toBe('Sco');
    expect(done.result).toContain('Antares, about halfway up in the south');
    expect(done.seen).toMatchObject([{ kind: 'figure', name: 'Scorpius', where: 'about halfway up in the south' }]);
  });

  test('the names people use: the Plough, the Teapot, the Big Dipper', async () => {
    const sky = chart();
    await run(sky, 'show_constellation', { name: 'the Teapot' });
    expect(sky.figureCon).toBe('Sgr');
    await run(sky, 'show_constellation', { name: 'the Big Dipper' });
    expect(sky.figureCon).toBe('UMa');
  });

  test('a figure that is down: not drawn, when it rises, and when it is well up in the dark', async () => {
    const sky = chart();
    const done = await run(sky, 'show_constellation', { name: 'Orion' });
    expect(sky.figureCon).toBeNull();
    expect(done.result).toMatch(/^Not up now: Orion isn't up at this hour from Taipei — it rises about quarter past 2 in the morning\. Nothing is drawn\./);
    expect(done.result).toMatch(/it is well up by about .* in the morning, so offer to show the sky then, and move the clock only if they ask/);
    const later = done.notice!.later!;
    const hour = localClock(later, 8).hour;
    expect(hour >= 2 && hour <= 5).toBe(true);
    const then = new SkyChart({ place: 'Taipei', epoch: later });
    expect(() => then.showConstellation('Orion')).not.toThrow();
  });

  test('a constellation with no figure is refused, with the figures there are', async () => {
    const done = await run(chart(), 'show_constellation', { name: 'Virgo' });
    expect(done.result).toContain("I don't have a figure drawn for Virgo");
    expect(done.result).toContain('Orion, Ursa Major');
    expect(done.notice?.later).toBeNull();
  });
});

describe('move_chart', () => {
  test('another place keeps the hour of the night, and says what is up there and what rose or set', async () => {
    const sky = chart();
    const done = await run(sky, 'move_chart', { place: 'Lisbon' });
    expect(sky.placeLabel).toBe('Lisbon');
    expect(localClock(sky.epoch, sky.tz).hour).toBe(20);
    expect(nightOf(sky.epoch, sky.tz).date).toBe('2026-08-05');
    expect(done.result).toMatch(/^Moved: The chart now shows the sky from Lisbon at about 8 in the evening \(8:00 pm, Wed 5 Aug\), with \d+ stars up; the brightest are /);
    expect(done.result).toContain('naming only stars given here');
    expect(done.result).not.toContain('daytime');
  });

  test('another time: the risen and the set, named', async () => {
    const sky = chart();
    const before = new Set(sky.snapshot().visible.map((v) => v.name));
    const done = await run(sky, 'move_chart', { time: 'midnight' });
    expect(localClock(sky.epoch, sky.tz).hour).toBe(0);
    expect(done.result).toMatch(/^Moved: The chart now shows about midnight over Taipei/);
    const risen = sky.snapshot().visible.map((v) => v.name).filter((n) => !before.has(n));
    expect(done.result).toContain(`Newly up: ${risen[0]}`);
  });

  test('both at once: the place first, then its clock', async () => {
    const sky = chart();
    const done = await run(sky, 'move_chart', { place: 'Sydney', time: 'midnight' });
    expect(sky.placeLabel).toBe('Sydney');
    expect(localClock(sky.epoch, sky.tz).hour).toBe(0);
    expect(done.result).toContain('the sky from Sydney at about midnight');
  });

  test.each<[string, (sky: SkyChart) => void]>([
    ['two hours later', (sky) => expect(sky.epoch).toBe(EPOCH + 7200)],
    ['an hour earlier', (sky) => expect(sky.epoch).toBe(EPOCH - 3600)],
    ['3 am', (sky) => expect(localClock(sky.epoch, sky.tz).hour).toBe(3)],
    ['21:30', (sky) => expect(localClock(sky.epoch, sky.tz)).toMatchObject({ hour: 21, minute: 30 })],
    ['9', (sky) => expect(localClock(sky.epoch, sky.tz).hour).toBe(21)],
    ['2026-12-21', (sky) => expect(nightOf(sky.epoch, sky.tz).date).toBe('2026-12-21')],
    ['December 21st', (sky) => expect(nightOf(sky.epoch, sky.tz).date).toBe('2026-12-21')],
    ['March', (sky) => expect(nightOf(sky.epoch, sky.tz).date).toBe('2027-03-15')],
    ['winter', (sky) => expect(nightOf(sky.epoch, sky.tz).date).toBe('2027-01-15')],
    ['before dawn', (sky) => expect(localClock(sky.epoch, sky.tz).hour).toBe(5)],
  ])('the time as heard: "%s"', async (time, check) => {
    const sky = chart();
    await run(sky, 'move_chart', { time });
    check(sky);
  });

  test('a time asked for after a date stays on that night', async () => {
    const sky = chart();
    await run(sky, 'move_chart', { time: 'December 21st' });
    await run(sky, 'move_chart', { time: 'midnight' });
    expect(nightOf(sky.epoch, sky.tz)).toEqual({ date: '2026-12-21', hours: 24 });
    await run(sky, 'move_chart', { time: '3 am' });
    expect(nightOf(sky.epoch, sky.tz)).toEqual({ date: '2026-12-21', hours: 27 });
  });

  test('"back to tonight" and "now" are the evening; already there, the host says so', async () => {
    const sky = new SkyChart({ place: 'Taipei', now: EPOCH });   // tonight is 9 pm
    sky.setTime({ shiftHours: 3 });
    await run(sky, 'move_chart', { time: 'now' });
    expect(localClock(sky.epoch, sky.tz).hour).toBe(21);
    expect((await run(sky, 'move_chart', { time: 'back to tonight' })).result).toMatch(/^Already there: /);
  });

  test('coordinates, however they arrive', async () => {
    for (const place of ['40.7, -74', '40.7 north 74 west', 'latitude 40.7 longitude -74']) {
      const sky = chart();
      await run(sky, 'move_chart', { place });
      expect([sky.lat, sky.lon], place).toEqual([40.7, -74]);
      expect(sky.exact).toBe(true);
    }
    const sky = chart();
    await run(sky, 'move_chart', { place: 'the equator' });
    expect([sky.lat, sky.lon]).toEqual([0, 121.56]);
  });

  test('a place the chart does not know is refused by name and nothing moves', async () => {
    const sky = chart();
    const done = await run(sky, 'move_chart', { place: 'Kyoto' });
    expect(sky.placeLabel).toBe('Taipei');
    expect(sky.epoch).toBe(EPOCH);
    // The chart's own offer, never "not in my system".
    expect(done.result).toMatch(/^Not moved: the chart has no city called Kyoto\. It knows 41 cities \(Taipei, Tokyo, /);
    expect(done.result).toContain('and any latitude and longitude');
    expect(done.result).toContain('move only if they ask');
    expect(done.notice?.text).toContain('Kyoto');
  });

  test('a refused place does not stop the time asked for with it', async () => {
    const sky = chart();
    const done = await run(sky, 'move_chart', { place: 'Rivendell', time: 'two hours later' });
    expect(sky.epoch).toBe(EPOCH + 7200);
    expect(done.result).toMatch(/^Moved: The chart now shows/);
    expect(done.result).toContain('no city called Rivendell');
  });

  test('a time it cannot read moves nothing, and the host asks for one it can', async () => {
    const sky = chart();
    const done = await run(sky, 'move_chart', { time: 'whenever' });
    expect(sky.epoch).toBe(EPOCH);
    expect(done.result).toMatch(/^Not moved: "whenever" is not a time the chart can read/);
  });

  test('nothing to move: the host asks where or when', async () => {
    expect((await run(chart(), 'move_chart', {})).result).toContain('Ask them where or when');
  });

  test('a far jump is refused by the chart', async () => {
    const done = await run(chart(), 'move_chart', { time: 'in two years' });
    expect(done.result).toContain('further than a year away');
  });

  test('a move into daylight says so, and offers tonight only if they ask', async () => {
    const done = await run(chart(), 'move_chart', { time: 'noon' });
    expect(done.result).toContain('Daytime there: it is about noon');
    expect(done.result).toContain('move the clock only if they ask');
  });
});

describe('clear_chart', () => {
  test('clears the star, the figure, or both', async () => {
    const sky = chart();
    sky.select('vega');
    sky.showConstellation('Scorpius');
    await run(sky, 'clear_chart', { what: 'star' });
    expect([sky.selected, sky.figureCon]).toEqual([null, 'Sco']);
    sky.select('vega');
    await run(sky, 'clear_chart', { what: 'constellation' });
    expect([sky.selected, sky.figureCon]).toEqual(['vega', null]);
    sky.showConstellation('Scorpius');
    expect((await run(sky, 'clear_chart', {})).result).toContain('no star is marked and no constellation is drawn');
    expect([sky.selected, sky.figureCon]).toEqual([null, null]);
  });
});

describe('lenient arguments: any case, synonyms, stray fields, near-miss names', () => {
  test('capitalised and padded words work', async () => {
    const sky = chart();
    await run(sky, 'point_out', { star: '  VEGA ' });
    expect(sky.selected).toBe('vega');
    await run(sky, 'move_chart', { place: 'LISBON', time: 'Midnight' });
    expect([sky.placeLabel, localClock(sky.epoch, sky.tz).hour]).toEqual(['Lisbon', 0]);
  });

  test('an extra unknown field is accepted, and a near-miss of the field name is read', async () => {
    const sky = chart();
    expect((await run(sky, 'show_constellation', { name: 'Scorpius', confidence: 0.9, extra: { a: 1 } })).result).toMatch(/^Drawn: /);
    await run(sky, 'point_out', { name: 'Antares' });
    expect(sky.selected).toBe('antares');
    await run(sky, 'move_chart', { city: 'Sydney', when: '3 am' });
    expect([sky.placeLabel, localClock(sky.epoch, sky.tz).hour]).toEqual(['Sydney', 3]);
  });

  test('clear_chart takes the words people use, and asks about ones it cannot use', async () => {
    const sky = chart();
    for (const [what, left] of [['Everything', [null, null]], ['both', [null, null]], ['the lines', ['vega', null]], ['The Star', [null, 'Sco']], ['marker', [null, 'Sco']]] as const) {
      sky.select('vega');
      sky.showConstellation('Scorpius');
      expect((await run(sky, 'clear_chart', { what })).result, what).toMatch(/^Cleared: /);
      expect([sky.selected, sky.figureCon], what).toEqual(left);
    }
    sky.select('vega');
    const done = await run(sky, 'clear_chart', { what: 'banana' });
    expect(done.result).toBe('Nothing cleared: "banana" is not something on the chart. Ask them whether to clear the marked star, the drawn constellation, or both.');
    expect(sky.selected).toBe('vega');
  });
});

test('every result begins with its plain outcome, so the reply\'s first real words are the chart\'s', async () => {
  const outcomes = /^(?:Marked|Not up now|Not in the catalogue|Not on the chart|Drawn|No figure|Moved|Already there|Refused|Not moved|Nothing changed|Nothing cleared|Cleared): /;
  const calls: [string, Record<string, unknown>][] = [
    ['point_out', { star: 'Vega' }], ['point_out', { star: 'Betelgeuse' }], ['point_out', { star: 'Zorblax' }], ['point_out', { star: 'Jupiter' }], ['point_out', {}],
    ['show_constellation', { name: 'Scorpius' }], ['show_constellation', { name: 'Orion' }], ['show_constellation', { name: 'Virgo' }],
    ['move_chart', { place: 'Lisbon' }], ['move_chart', { place: 'Kyoto' }], ['move_chart', { time: 'whenever' }], ['move_chart', {}], ['move_chart', { time: 'in two years' }],
    ['clear_chart', {}], ['clear_chart', { what: 'banana' }],
  ];
  for (const [name, args] of calls) expect((await run(chart(), name, args)).result, `${name} ${JSON.stringify(args)}`).toMatch(outcomes);
});

test('only the four tools run', async () => {
  expect(['point_out', 'show_constellation', 'move_chart', 'clear_chart'].every(isToolName)).toBe(true);
  expect(isToolName('teleport')).toBe(false);
  await expect(run(chart(), 'teleport', {})).rejects.toThrow('no tool called teleport');
});
