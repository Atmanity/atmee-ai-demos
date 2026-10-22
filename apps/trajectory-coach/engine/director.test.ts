// What the avatar is told (the note, coach and persona tests from
// test_table.py, rewritten for state + events): the numbers and never the
// polyline, nothing about a shot still in the air, one line per change and
// none for a change the student's own words caused.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CHALLENGES } from './challenges.ts';
import { NOTES, lineFor, rangeState, refusalFor, say, type Line } from './director.ts';
import { Launcher, MAX_HISTORY } from './launcher.ts';
import { Range } from './range.ts';
import type { Intent, Source } from './types.ts';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** A range whose every change and refusal is turned into the lines the page would send. */
function coached(challenge?: string) {
  const range = new Range(new Launcher(challenge));
  const lines: Line[] = [];
  range.subscribe((change) => { const line = lineFor(change); if (line) lines.push(line); });
  const act = (intent: Intent, by: Source) => {
    const r = range.apply(intent, by);
    if (!r.applied) { const line = refusalFor(intent, r.reason, by); if (line) lines.push(line); }
    return r;
  };
  const land = () => vi.advanceTimersByTime(3_000);
  return { range, lines, act, land };
}

describe('the notes', () => {
  test('three standing notes, each within the 2,000-character limit', () => {
    expect(NOTES).toHaveLength(3);
    for (const note of NOTES) expect(note.length).toBeLessThanOrEqual(2000);
  });

  test('they keep the rules the original paid for', () => {
    const all = NOTES.join(' ').toLowerCase();
    // "you need to aim first" while the launcher sat aimed (four times in one session)
    expect(all).toContain('never say they need to aim first');
    // "the angle is now thirty degrees" with the arrow showing exactly that
    expect(all).toContain('never read the numbers back');
    // "do you want to send it?" after nearly every turn
    expect(all).toContain('do not end your turns by asking whether to fire');
    // numbers quoted, not recomputed; a shot in the air is not guessed
    expect(all).toContain('exactly as written');
    expect(all).toContain('do not guess it');
    // the avatar does not decide: the range does, a moment later
    expect(all).toContain('you do not decide whether it worked');
  });
});

describe('the state', () => {
  test('a shot in the air is described without its result', () => {
    const l = new Launcher();
    l.fire();
    const state = rangeState(l.snapshot());
    expect(state).toContain('in the air');
    for (const spoiler of ['40.77', '10.19', 'below the top', 'CLEARED', 'missed by']) expect(state, spoiler).not.toContain(spoiler);
  });

  test('a landed shot carries its numbers and the range\'s sentence verbatim, never the polyline', () => {
    const l = new Launcher();
    l.fire();
    const shot = l.land();
    const state = rangeState(l.snapshot());
    expect(state).toContain('40.77');
    expect(state).toContain('10.19');
    expect(state).toContain(`"${shot.note}"`);
    expect(state).toContain('missed by 2.24 m');
    expect(state).not.toMatch(/path|\[\[/);
  });

  test('conditions that are not Earth-normal are named', () => {
    expect(rangeState(new Launcher('headwind').snapshot())).toContain('6 m/s headwind');
    expect(rangeState(new Launcher('moonshot').snapshot())).toContain('gravity of 1.62');
    expect(rangeState(new Launcher('ceiling').snapshot())).toContain('without going above 6 m');
  });

  test('the limits are staged, so "try ninety degrees" can be refused on the spot', () => {
    expect(rangeState(new Launcher().snapshot())).toContain('5 to 85 degrees, 5 to 40 metres a second');
    expect(rangeState(new Launcher('maxrange').snapshot())).toContain('5 to 18 metres a second');
  });

  test('the six challenges are staged, with the next one along, so "let\'s do the Moon" is set up right', () => {
    const state = rangeState(new Launcher().snapshot());
    for (const c of CHALLENGES) expect(state).toContain(`${c.name}: ${c.blurb}`);
    expect(state).toContain('The next one along is Land in the zone.');
    expect(rangeState(new Launcher('moonshot').snapshot())).toContain('The next one along is Clear the wall.');
  });

  test('the teaching point appears once it is earned', () => {
    const l = new Launcher();
    expect(rangeState(l.snapshot())).not.toContain(CHALLENGES[0].teach);
    l.setAim(45, 24);
    l.fire();
    expect(rangeState(l.snapshot())).not.toContain(CHALLENGES[0].teach);   // cleared, but still in the air
    l.land();
    expect(rangeState(l.snapshot())).toContain(CHALLENGES[0].teach);
  });

  test('the busiest range, on every challenge, stays under 3,858 characters', () => {
    for (const c of CHALLENGES) {
      const l = new Launcher(c.id);
      const cleared = () => l.snapshot().catalog.some((e) => e.id === c.id && e.cleared);
      // Clear it first, so the teaching point rides along with a full history.
      for (let a = 5; a <= 85 && !cleared(); a += 1)
        for (let v = 5; v <= c.speed_max && !cleared(); v += 1) { l.setAim(a, v); l.fire(); l.land(); }
      expect(cleared(), c.id).toBe(true);
      for (let i = 0; i < MAX_HISTORY + 2; i++) { l.setAim(20 + i * 5, c.speed_max); l.fire(); l.land(); }
      for (const state of [rangeState(l.snapshot()), (l.fire(), rangeState(l.snapshot()))]) expect(state.length, c.id).toBeLessThan(3858);
    }
  });
});

describe('the events', () => {
  test('the opening describes the challenge that is actually up', () => {
    // The original's hand-typed greeting described the wall to a student
    // looking at the Moon. Every figure comes from the snapshot the page draws.
    const wall = say.start(new Launcher('wall40').snapshot());
    expect(wall).toContain('Clear the wall');
    expect(wall).toContain('forty metres out');
    const moon = say.start(new Launcher('moonshot').snapshot());
    expect(moon).toContain('On the Moon');
    expect(moon.toLowerCase()).not.toContain('wall');
    expect(moon.toLowerCase()).toContain('drag');
  });

  test('a miss is said with the range\'s own words, then one change; later misses ask why', () => {
    const l = new Launcher();
    l.fire();
    const shot = l.land();
    const first = say.landing(l.snapshot());
    expect(first).toContain(`"${shot.note}"`);
    expect(first).toContain('without changing a single number');
    expect(first).toContain('one specific change');
    l.fire(); l.land(); l.fire(); l.land();
    expect(say.landing(l.snapshot())).toContain('Explain WHY');
  });

  test('clearing a challenge gets the result and the teaching point', () => {
    const l = new Launcher();
    l.setAim(45, 24);
    l.fire();
    l.land();
    const line = say.landing(l.snapshot());
    expect(line).toContain('they cleared it');
    expect(line).toContain('Forty-five degrees maximises range');
  });

  test('the aim line neither reads the numbers back nor asks whether to fire', () => {
    // The original's aim cue once ended "and ask if they want to send it",
    // which is why the coach asked that after almost every turn.
    const cue = say.aimed();
    expect(cue.toLowerCase()).toContain('do not ask whether they want to fire');
    expect(cue.toLowerCase()).toContain('do not say the angle or the speed back');
    expect(cue).not.toMatch(/\d/);
  });
});

describe('one line per change', () => {
  test('every landing gets exactly one line, whoever fired', () => {
    for (const by of ['panel', 'typed', 'spoken'] as const) {
      const { act, land, lines } = coached();
      act({ kind: 'fire' }, by);
      expect(lines, by).toEqual([]);   // the launch has no line of its own: the landing is its line
      land();
      expect(lines, by).toHaveLength(1);
      expect(lines[0].text).toContain('below the top');
    }
  });

  test('a change the student\'s own speech caused gets no line: the avatar is already answering it', () => {
    const { act, land, lines } = coached();
    act({ kind: 'set_aim', angle_deg: 40 }, 'spoken');
    act({ kind: 'start_challenge', id: 'moonshot' }, 'spoken');
    act({ kind: 'next_challenge' }, 'spoken');
    act({ kind: 'reset' }, 'spoken');
    act({ kind: 'fire' }, 'spoken');
    expect(lines).toEqual([]);
    land();
    expect(lines).toHaveLength(1);   // only the landing
  });

  test('dragging the arrow does not make the coach say anything, or re-announce the challenge', () => {
    const { act, lines } = coached();
    for (const angle of [30, 35, 40]) act({ kind: 'set_aim', angle_deg: angle, speed_ms: 20 }, 'panel');
    expect(lines).toEqual([]);
  });

  test('a challenge chosen on the panel or typed is introduced; the same one re-armed is not', () => {
    const { act, lines } = coached();
    act({ kind: 'start_challenge', id: 'moonshot' }, 'panel');
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain('On the Moon');
    act({ kind: 'start_challenge', id: 'moonshot' }, 'panel');
    act({ kind: 'next_challenge' }, 'typed');
    expect(lines).toHaveLength(2);
    expect(lines[1].text).toContain('Clear the wall');
  });

  test('a challenge switched by voice is not announced on the next change either', () => {
    const { act, lines } = coached();
    act({ kind: 'start_challenge', id: 'moonshot' }, 'spoken');
    act({ kind: 'set_aim', angle_deg: 40, speed_ms: 12 }, 'panel');
    expect(lines).toEqual([]);
  });

  test('a typed aim or "start over" gets its line; the avatar never saw the typed words', () => {
    const { act, lines } = coached();
    act({ kind: 'set_aim', angle_deg: 30 }, 'typed');
    act({ kind: 'reset' }, 'typed');
    expect(lines.map((l) => l.text)).toEqual([say.aimed(), say.reset()]);
  });
});

describe('refusals', () => {
  test('a refused aim reaches the avatar as a sentence to say, with the numbers', () => {
    const { act, lines } = coached();
    act({ kind: 'set_aim', angle_deg: 45, speed_ms: 90 }, 'typed');
    expect(lines[0].text).toContain('5 to 40 metres a second');
    expect(lines[0].text).toContain('do NOT describe anything as done');
  });

  test('a spoken one too, but the avatar may have refused it already from the staged limits', () => {
    const { act, lines, range } = coached();
    act({ kind: 'set_aim', angle_deg: 90 }, 'spoken');
    expect(lines[0].text).toContain('If you have not already told them');
    expect(lines[0].text).toContain('90 is off the rail');
    // An out-of-range request is never quietly clamped.
    expect(range.snapshot().aim).toEqual({ angle_deg: 45, speed_ms: 20 });
  });

  test('a typed "fire" while one is up is refused honestly; a spoken one needs nothing (the state says so)', () => {
    const { act, lines } = coached();
    act({ kind: 'fire' }, 'panel');
    act({ kind: 'fire' }, 'spoken');
    expect(lines).toEqual([]);
    act({ kind: 'fire' }, 'typed');
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain("It's already in the air.");
  });

  test('the panel shows its own refusals; the avatar is not told', () => {
    expect(refusalFor({ kind: 'fire' }, "It's already in the air.", 'panel')).toBeNull();
  });
});
