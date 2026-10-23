// The logbook: written by landings only, the first clear kept, the lesson
// only once earned, and a file the student keeps.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CHALLENGES } from './challenges.ts';
import { Launcher } from './launcher.ts';
import { clearedCount, emptyLog, logChange, logbookText, shotCount, type Entry } from './logbook.ts';
import { Range } from './range.ts';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function logged() {
  const range = new Range(new Launcher());
  let log: Entry[] = emptyLog();
  range.subscribe((change) => { log = logChange(log, change); });
  const shoot = (angle: number, speed: number) => {
    range.apply({ kind: 'set_aim', angle_deg: angle, speed_ms: speed }, 'panel');
    range.apply({ kind: 'fire' }, 'panel');
    vi.advanceTimersByTime(3_000);
  };
  return { range, shoot, log: () => log };
}

test('a fresh log has the six challenges, untried, and no lessons', () => {
  const log = emptyLog();
  expect(log.map((e) => e.id)).toEqual(CHALLENGES.map((c) => c.id));
  expect(log.every((e) => e.shots === 0 && !e.cleared && !e.lesson)).toBe(true);
});

test('only landings count; the first clear is kept with the range\'s sentence and the lesson', () => {
  const { range, shoot, log } = logged();
  range.apply({ kind: 'fire' }, 'panel');
  expect(log()[0].shots).toBe(0);                 // in the air: not yet
  vi.advanceTimersByTime(3_000);
  expect(log()[0]).toMatchObject({ shots: 1, cleared: null, lesson: null });
  shoot(45, 24);
  shoot(50, 30);                                   // a later clear does not replace the first
  const wall = log()[0];
  expect(wall.shots).toBe(3);
  expect(wall.cleared).toEqual({ angle_deg: 45, speed_ms: 24, note: 'Over with 9.75 m to spare, landing at 58.72 m after 3.46 s.', shot: 2 });
  expect(wall.lesson).toBe(CHALLENGES[0].teach);
  expect(clearedCount(log())).toBe(1);
  expect(shotCount(log())).toBe(3);
});

test('starting over clears the range\'s trails, not the student\'s record', () => {
  const { range, shoot, log } = logged();
  shoot(30, 20);
  range.apply({ kind: 'reset' }, 'panel');
  shoot(30, 20);
  expect(log()[0].shots).toBe(2);
  expect(range.snapshot().attempts).toBe(1);
});

test('the file names every challenge, the clearing shot and its lesson, and what is still to do', () => {
  const { range, shoot, log } = logged();
  shoot(45, 24);
  range.apply({ kind: 'start_challenge', id: 'zone30' }, 'panel');
  shoot(45, 18);
  const text = logbookText(log(), new Date('2026-10-23T12:00:00Z'));
  expect(text).toContain('ARCWISE LOGBOOK, 2026-10-23');
  expect(text).toContain('1 of 6 challenges cleared in 2 shots.');
  expect(text).toContain('Cleared on shot 1 of 1, at 45 degrees and 24 m/s.');
  expect(text).toContain('Over with 9.75 m to spare');
  expect(text).toContain(`The lesson: ${CHALLENGES[0].teach}`);
  expect(text).toContain('2. Land in the zone');
  expect(text).toContain('Not cleared yet: 1 shot.');
  expect(text).toContain('6. On the Moon');
  expect(text).toContain('Not tried yet.');
  for (const c of CHALLENGES.slice(1)) expect(text).not.toContain(c.teach);
});
