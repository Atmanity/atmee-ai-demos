// Intents onto the chart, and the line for a change made with its controls.
// The first half ports the original `test_table.py` (refusals reach somebody;
// the change cue hands over the catalogue's words, directions in words, what
// rose and set); the second pins the time words this port added and the new
// rule that a place move keeps the hour of the night.
import { describe, expect, test } from 'vitest';
import { FACTS, STARS } from './catalog.ts';
import { SkyChart } from './chart.ts';
import { told } from './director.ts';
import { apply, narration } from './guide.ts';
import { localClock, nightOf } from './sky.ts';
import type { Intent } from './types.ts';
import { materialChange } from './words.ts';

const EPOCH = 1785931200;   // 2026-08-05, 8 pm in Taipei
const chart = (place = 'Taipei', epoch = EPOCH) => new SkyChart({ place, epoch, now: EPOCH });
const run = (sky: SkyChart, intents: Intent[], keepHour = true) => apply(sky, intents, { now: EPOCH, keepHour });
const upStar = (sky: SkyChart) => sky.snapshot().visible[0];

describe('refusals reach somebody', () => {
  test('an unknown place comes back as a sentence to show and to say, not an exception', () => {
    const outcome = run(chart(), [{ kind: 'set_place', label: 'Rivendell' }]);
    expect(outcome.refusals[0]).toContain('Rivendell');
    expect(outcome.accepted).toEqual([]);
  });

  test('an unknown intent is refused by name', () => {
    const outcome = run(chart(), [{ kind: 'teleport' } as unknown as Intent]);
    expect(outcome.refusals[0]).toContain('teleport');
  });

  test('a refused intent changes nothing', () => {
    const sky = chart();
    const before = sky.snapshot();
    const outcome = run(sky, [{ kind: 'select', star: 'Vogsphere' }]);
    expect(sky.snapshot()).toEqual(before);
    expect(outcome.change).toBeNull();
    expect(outcome.refusals[0]).toContain('Vogsphere');
  });

  test('an accepted intent moves the sky and says what changed', () => {
    const sky = chart();
    const id = upStar(sky).id;
    const outcome = run(sky, [{ kind: 'select', star: id }]);
    expect(outcome.view.snapshot.selected).toBe(id);
    expect(outcome.change).toBe('star');
  });

  test('a star below the horizon is refused with when it rises, or that it never does', () => {
    expect(run(chart(), [{ kind: 'select', star: 'Betelgeuse' }]).refusals[0]).toMatch(/below the horizon from Taipei right now — it rises about/);
    expect(run(chart(), [{ kind: 'select', star: 'Miaplacidus' }]).refusals[0]).toContain('never rises');
  });

  test('a refused place does not stop the time move asked for with it', () => {
    const sky = chart();
    const outcome = run(sky, [{ kind: 'set_place', label: 'Rivendell' }, { kind: 'set_time', shiftHours: 2 }]);
    expect(outcome.view.snapshot.when.epoch).toBe(EPOCH + 7200);
    expect(outcome.refusals).toHaveLength(1);
    expect(outcome.change).toBe('time');
  });
});

describe('a new place keeps the hour of the night (new in this rebuild)', () => {
  test('Taipei at 8 pm, then Lisbon: Lisbon at 8 pm that night, not 1 in the afternoon', () => {
    const sky = chart();
    run(sky, [{ kind: 'set_place', label: 'Lisbon' }]);
    expect(localClock(sky.epoch, sky.tz).hour).toBe(20);
    expect(nightOf(sky.epoch, sky.tz).date).toBe('2026-08-05');
  });

  test('past midnight stays past midnight on the same night', () => {
    const sky = chart('Taipei', EPOCH + 6 * 3600);   // 2 am on the night of the 5th
    run(sky, [{ kind: 'set_place', label: 'New York' }]);
    expect(nightOf(sky.epoch, sky.tz)).toEqual({ date: '2026-08-05', hours: 26 });
  });

  test('a time asked for with the place wins; and the chart alone still keeps the instant', () => {
    const sky = chart();
    run(sky, [{ kind: 'set_place', label: 'Lisbon' }, { kind: 'set_time', preset: 'midnight' }]);
    expect(localClock(sky.epoch, sky.tz).hour).toBe(0);
    const instant = chart();
    run(instant, [{ kind: 'set_place', label: 'Lisbon' }], false);
    expect(instant.epoch).toBe(EPOCH);
  });
});

describe('the line for a control\'s change (the original change cue)', () => {
  test('a tapped star gets the catalogue\'s words and where it is', () => {
    const sky = chart();
    const before = sky.view();
    const s = sky.snapshot().visible.find((v) => FACTS[v.id])!;
    run(sky, [{ kind: 'select', star: s.id }]);
    const line = narration(before, sky.view())!;
    expect(line).toContain(`The user tapped ${s.name} on the chart`);
    expect(line).toContain(FACTS[s.id][0]);
    expect(line).toContain('changing no number');
  });

  test('moving the clock hands over which stars rose and which set, and names no others', () => {
    // Symptom in the original: "six hours later" and the guide announced a
    // constellation nowhere near up. The cue used to ASK the model what had risen.
    const sky = chart();
    const before = sky.view();
    const was = new Map(sky.snapshot().visible.map((s) => [s.id, s.name]));
    run(sky, [{ kind: 'set_time', shiftHours: 6 }]);
    const line = narration(before, sky.view())!;
    const now = new Map(sky.snapshot().visible.map((s) => [s.id, s.name]));
    const risen = [...now].filter(([id]) => !was.has(id)).map(([, n]) => n);
    const gone = [...was].filter(([id]) => !now.has(id)).map(([, n]) => n);
    expect(risen.length && gone.length, 'the fixture must exercise both directions').toBeTruthy();
    expect(line).toContain(risen[0]);
    expect(line).toContain(gone[0]);
    const brightest = sky.snapshot().visible.slice(0, 3).map((s) => s.name);
    const named = STARS.filter((s) => new RegExp(`\\b${s.name}\\b`).test(line)).map((s) => s.name);
    for (const name of named) expect([...risen, ...gone, ...brightest], name).toContain(name);
    expect(line).toContain('Do not read the date out');
  });

  test('a move that changed nothing says so rather than going quiet', () => {
    const view = chart().view();
    expect(told.timeMoved(view, view)).toContain('Nothing has risen or set');
  });

  test('a figure lit from its button says where to look, by its brightest star', () => {
    const sky = chart();
    const before = sky.view();
    run(sky, [{ kind: 'show_constellation', name: 'Sco' }]);
    const line = narration(before, sky.view())!;
    expect(line).toContain('The user lit Scorpius');
    expect(line).toContain('Antares, about halfway up in the south');
  });

  test('a new place from the picker names the place and its hour', () => {
    const sky = chart();
    const before = sky.view();
    run(sky, [{ kind: 'set_place', label: 'Sydney' }]);
    expect(narration(before, sky.view())).toContain('The user moved the chart to the sky from Sydney at about 8 in the evening');
  });

  test('clearing is something the user can see happen; nobody narrates it', () => {
    const sky = chart();
    run(sky, [{ kind: 'select', star: upStar(sky).id }]);
    const before = sky.view();
    run(sky, [{ kind: 'clear_selection' }]);
    expect(narration(before, sky.view())).toBeNull();
  });

  test('a figure that dropped below the horizon on its own is not material', () => {
    const sky = chart();
    sky.showConstellation('Scorpius');
    const before = sky.snapshot();
    expect(materialChange(before, { ...before, figure: null })).toBeNull();
  });

  test('a refused control is told with what the user did', () => {
    expect(told.refused('pressed Orion', "Orion isn't up.")).toBe("The user pressed Orion on the chart, and it refused: Orion isn't up. Say that to them in one short line; nothing changed.");
  });
});

describe('time words beyond the original\'s', () => {
  test('a month keeps the hour of the night and goes to the 15th of the next such month', () => {
    const sky = chart();
    const hours = nightOf(sky.epoch, sky.tz).hours;
    run(sky, [{ kind: 'set_time', month: 12 }]);
    expect(nightOf(sky.epoch, sky.tz)).toEqual({ date: '2026-12-15', hours });
    run(sky, [{ kind: 'set_time', month: 3, day: 3 }]);
    expect(nightOf(sky.epoch, sky.tz).date).toBe('2027-03-03');
  });

  test('a month asked for twice lands on the same night (the safety net may repeat it)', () => {
    const sky = chart();
    run(sky, [{ kind: 'set_time', month: 12 }]);
    const first = sky.epoch;
    run(sky, [{ kind: 'set_time', month: 12 }]);
    expect(sky.epoch).toBe(first);
  });

  test('a season is by hemisphere: winter is January in Taipei and July in Sydney', () => {
    const north = chart();
    run(north, [{ kind: 'set_time', season: 'winter' }]);
    expect(nightOf(north.epoch, north.tz).date).toBe('2027-01-15');
    const south = chart('Sydney');
    run(south, [{ kind: 'set_time', season: 'winter' }]);
    expect(nightOf(south.epoch, south.tz).date).toBe('2027-07-15');
  });

  test('a clock hour is the next time the place\'s clock reads it; the strip stays on the night', () => {
    const sky = chart();
    run(sky, [{ kind: 'set_time', clockHour: 3 }]);
    expect(localClock(sky.epoch, sky.tz).hour).toBe(3);
    const night = nightOf(sky.epoch, sky.tz).date;
    run(sky, [{ kind: 'set_time', nightHours: 22.5 }]);
    expect(nightOf(sky.epoch, sky.tz)).toEqual({ date: night, hours: 22.5 });
  });

  test('a date that does not exist is refused', () => {
    expect(run(chart(), [{ kind: 'set_time', month: 4, day: 31 }]).refusals[0]).toContain("couldn't read");
  });
});
