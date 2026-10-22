// Intents onto the chart, and what the avatar hears about them. The first
// half ports the original `test_table.py` (refusals reach somebody; the tool
// cues hand over the catalogue's words, directions in words, what rose and
// set). The second half pins the port's own decision: who speaks for a change.
import { describe, expect, test } from 'vitest';
import { FACTS, STARS } from './catalog.ts';
import { SkyChart } from './chart.ts';
import { say } from './director.ts';
import { act, narration } from './guide.ts';
import { localClock, nightOf } from './sky.ts';
import type { Intent } from './types.ts';
import { materialChange } from './words.ts';

const EPOCH = 1785931200;   // 2026-08-05, 8 pm in Taipei
const chart = (place = 'Taipei', epoch = EPOCH) => new SkyChart({ place, epoch, now: EPOCH });
const run = (sky: SkyChart, intents: Intent[], how: 'control' | 'typed' | 'spoken' = 'typed', exact = true) => act(sky, intents, how, { exact, now: EPOCH });
const upStar = (sky: SkyChart) => sky.snapshot().visible[0];

describe('refusals reach somebody', () => {
  test('an unknown place comes back as a reason to show and to say, not an exception', () => {
    const outcome = run(chart(), [{ kind: 'set_place', label: 'Rivendell' }]);
    expect(outcome.refusals[0]).toContain('Rivendell');
    expect(outcome.event).toContain('The chart refused that');
    expect(outcome.event).toContain('Rivendell');
  });

  test('an unknown intent is refused by name', () => {
    const outcome = run(chart(), [{ kind: 'teleport' } as unknown as Intent]);
    expect(outcome.refusals[0]).toContain('teleport');
  });

  test('a refused intent changes nothing and has nothing narrated for it', () => {
    const sky = chart();
    const before = sky.snapshot();
    const outcome = run(sky, [{ kind: 'select', star: 'Vogsphere' }], 'control');
    expect(sky.snapshot()).toEqual(before);
    expect(outcome.narrate).toBe(false);
    expect(outcome.event).toContain('Vogsphere');
  });

  test('an accepted intent moves the sky', () => {
    const sky = chart();
    const id = upStar(sky).id;
    expect(run(sky, [{ kind: 'select', star: id }]).view.snapshot.selected).toBe(id);
  });

  test('a refusal is handed over as something to say, with when it rises (the original point_out cue)', () => {
    // A refusal the user never hears is the same as no refusal, and here it
    // means the avatar confirming a star is up while the chart shows it is not.
    const event = run(chart(), [{ kind: 'select', star: 'Miaplacidus' }]).event!;
    expect(event).toContain('refused');
    expect(event).toContain('never rises');
    expect(event).toContain('do not claim anything happened');
  });
});

describe('the cues hand over the chart, never the model\'s memory', () => {
  test('pointing out a star hands over the catalogue\'s words', () => {
    const sky = chart();
    const s = sky.snapshot().visible.find((v) => FACTS[v.id])!;
    const event = run(sky, [{ kind: 'select', star: s.name }]).event!;
    expect(event).toContain(FACTS[s.id][0]);
    expect(event).toContain('changing no number');
    expect(event).toContain('marked on the chart');
  });

  test('a position is described in words, never degrees', () => {
    const sky = chart();
    const event = run(sky, [{ kind: 'select', star: upStar(sky).name }]).event!;
    expect(event).not.toContain('degrees');
    expect(['overhead', 'high up', 'halfway up', 'low down'].some((w) => event.includes(w))).toBe(true);
  });

  test('moving the clock hands over which stars rose and which set, and names no others', () => {
    // Symptom: "six hours later" and the guide announced a constellation nowhere
    // near up. The cue used to ASK the model what had risen without telling it.
    const sky = chart();
    const before = new Map(sky.snapshot().visible.map((s) => [s.id, s.name]));
    const event = run(sky, [{ kind: 'set_time', shiftHours: 6 }]).event!;
    const after = new Map(sky.snapshot().visible.map((s) => [s.id, s.name]));
    const risen = [...after].filter(([id]) => !before.has(id)).map(([, n]) => n);
    const gone = [...before].filter(([id]) => !after.has(id)).map(([, n]) => n);
    expect(risen.length && gone.length, 'the fixture must exercise both directions').toBeTruthy();
    expect(event).toContain(risen[0]);
    expect(event).toContain(gone[0]);
    const named = STARS.filter((s) => new RegExp(`\\b${s.name}\\b`).test(event)).map((s) => s.name);
    for (const name of named) expect([...risen, ...gone], name).toContain(name);
    expect(event).toContain('stars up');
    expect(event).toContain('date');
  });

  test('a move that changed nothing says so rather than going quiet', () => {
    const view = chart().view();
    expect(say.timeMoved(view, view)).toContain('Nothing has risen or set');
  });

  test('lighting a constellation says where it actually is (Scorpius, by Antares, halfway up in the south)', () => {
    // Symptom: "show me Scorpius" and the guide said low in the north-west
    // while the chart drew it halfway up in the south. A direction is the one
    // thing a user can check by standing outside.
    const event = run(chart(), [{ kind: 'show_constellation', name: 'Scorpius' }]).event!;
    expect(event).toContain('Antares');
    expect(event).toContain('halfway up in the south');
    expect(event).not.toContain('degrees');
  });

  test('looking from a new place names the brightest few only', () => {
    const event = run(chart(), [{ kind: 'set_place', label: 'Sydney' }]).event!;
    expect(event).toContain('Sydney');
    expect(event).toContain('Do not list every star');
  });

  test('a typed move that changes nothing is still answered', () => {
    const sky = new SkyChart({ place: 'Taipei', now: EPOCH });   // already at tonight
    const event = run(sky, [{ kind: 'set_time', preset: 'tonight' }]).event!;
    expect(event).toContain('already shows that');
  });
});

describe('who speaks for a change', () => {
  test('a control\'s change is left to the narrator; nothing is said at once', () => {
    const sky = chart();
    const outcome = run(sky, [{ kind: 'select', star: upStar(sky).id }], 'control');
    expect(outcome.event).toBeNull();
    expect(outcome.narrate).toBe(true);
  });

  test('a spoken request for a star that was up, with catalogue lines, was staged: no second telling', () => {
    // The avatar answered from the state (where to look) and its notes (the
    // facts) before the app heard the words; the chart just marks it.
    const outcome = run(chart(), [{ kind: 'select', star: 'vega' }], 'spoken');
    expect(outcome.view.snapshot.selected).toBe('vega');
    expect(outcome.event).toBeNull();
  });

  test('…but a star with only its catalogue row is told (that row arrives with the marking)', () => {
    const sky = chart();
    const plain = sky.snapshot().visible.find((v) => !FACTS[v.id])!;
    expect(run(sky, [{ kind: 'select', star: plain.id }], 'spoken').event).toContain('marked on the chart');
  });

  test('…and so is a star named through a mishearing (the avatar heard "beetle juice" too)', () => {
    const sky = chart('Taipei', EPOCH + 9 * 3600);   // Betelgeuse is up before dawn
    expect(sky.snapshot().visible.some((v) => v.id === 'betelgeuse')).toBe(true);
    expect(run(sky, [{ kind: 'select', star: 'betelgeuse' }], 'spoken', false).event).toContain('Betelgeuse');
  });

  test('a spoken request for a figure that was up is staged; one that is down is refused out loud', () => {
    expect(run(chart(), [{ kind: 'show_constellation', name: 'Scorpius' }], 'spoken').event).toBeNull();
    const down = run(chart(), [{ kind: 'show_constellation', name: 'Orion' }], 'spoken').event!;
    expect(down).toContain('refused');
    expect(down).toContain('rises about');
  });

  test('another place or hour can never be staged, so a spoken move is always told', () => {
    expect(run(chart(), [{ kind: 'set_place', label: 'Lisbon' }], 'spoken').event).toContain('Lisbon');
    expect(run(chart(), [{ kind: 'set_time', preset: 'midnight' }], 'spoken').event).toContain('Newly up');
  });

  test('a star that was up says nothing about where it is after a move in the same breath', () => {
    const event = run(chart(), [{ kind: 'set_time', preset: 'midnight' }, { kind: 'select', star: 'vega' }], 'spoken').event!;
    expect(event).toContain('Vega is marked on the chart');
    expect(event).toContain('Keep it all to two short lines');
  });

  test('a refused place does not stop the time move asked for with it', () => {
    const outcome = run(chart(), [{ kind: 'set_place', label: 'Rivendell' }, { kind: 'set_time', shiftHours: 2 }], 'spoken');
    expect(outcome.view.snapshot.when.epoch).toBe(EPOCH + 7200);
    expect(outcome.refusals).toHaveLength(1);
    expect(outcome.event).toContain('Rivendell');
  });
});

describe('the narrator\'s line (the original change cue)', () => {
  test('a tapped star gets its catalogue words', () => {
    const sky = chart();
    const before = sky.view();
    const s = sky.snapshot().visible.find((v) => FACTS[v.id])!;
    run(sky, [{ kind: 'select', star: s.id }], 'control');
    const line = narration(before, sky.view())!;
    expect(line).toContain(`They just tapped ${s.name}`);
    expect(line).toContain(FACTS[s.id][0]);
  });

  test('clearing is something the user can see happen; nobody narrates it', () => {
    const sky = chart();
    run(sky, [{ kind: 'select', star: upStar(sky).id }], 'control');
    const before = sky.view();
    const outcome = run(sky, [{ kind: 'clear_selection' }], 'control');
    expect(outcome.narrate).toBe(false);
    expect(narration(before, sky.view())).toBeNull();
  });

  test('a figure that dropped below the horizon on its own is not material', () => {
    const sky = chart();
    sky.showConstellation('Scorpius');
    const before = sky.snapshot();
    const after = { ...before, figure: null };
    expect(materialChange(before, after)).toBeNull();
  });

  test('a figure lit from its button says where to look', () => {
    const sky = chart();
    const before = sky.view();
    run(sky, [{ kind: 'show_constellation', name: 'Sco' }], 'control');
    expect(narration(before, sky.view())).toContain('Antares');
  });
});

describe('time words the original did not have (new in this port)', () => {
  test('a month keeps the hour of the night and goes to the 15th of the next such month', () => {
    const sky = chart();
    const hours = nightOf(sky.epoch, sky.tz).hours;
    run(sky, [{ kind: 'set_time', month: 12 }]);
    expect(nightOf(sky.epoch, sky.tz)).toEqual({ date: '2026-12-15', hours });
    run(sky, [{ kind: 'set_time', month: 3, day: 3 }]);
    expect(nightOf(sky.epoch, sky.tz).date).toBe('2027-03-03');
  });

  test('a season is by hemisphere: winter is January in Taipei and July in Sydney', () => {
    const north = chart();
    run(north, [{ kind: 'set_time', season: 'winter' }]);
    expect(nightOf(north.epoch, north.tz).date).toBe('2027-01-15');
    const south = chart('Sydney');
    run(south, [{ kind: 'set_time', season: 'winter' }]);
    expect(nightOf(south.epoch, south.tz).date).toBe('2027-07-15');
  });

  test('a clock hour is the next time the place\'s clock reads it; the scrubber stays on the night', () => {
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
