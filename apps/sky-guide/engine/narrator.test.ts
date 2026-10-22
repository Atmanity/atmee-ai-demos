// The narrator: the guide's line about a change made with the chart's own
// controls. Ported from the narrator tests of the original `test_table.py`
// (speaks for a tap, never twice for a change someone else speaks for, quiet
// for a clear), plus this port's coalescing.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SkyChart } from './chart.ts';
import { act } from './guide.ts';
import { Narrator } from './narrator.ts';
import type { Intent } from './types.ts';

const EPOCH = 1785931200;
let lines: string[];
let sky: SkyChart;
let narrator: Narrator;

/** What the page does for a control: act, then hand the change to the narrator. */
function press(intent: Intent) {
  const outcome = act(sky, [intent], 'control', { now: EPOCH });
  if (outcome.narrate) narrator.changed(outcome.before, outcome.view);
  return outcome;
}

beforeEach(() => {
  vi.useFakeTimers();
  lines = [];
  sky = new SkyChart({ place: 'Taipei', epoch: EPOCH, now: EPOCH });
  narrator = new Narrator((line) => lines.push(line), 1200);
});
afterEach(() => vi.useRealTimers());

test('a tap is spoken for, once, after a moment', () => {
  press({ kind: 'select', star: 'vega' });
  expect(lines).toEqual([]);
  vi.advanceTimersByTime(1200);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('They just tapped Vega');
});

test('three quick +1h clicks are one line, about the sky three hours on', () => {
  const start = new Map(sky.snapshot().visible.map((s) => [s.id, s.name]));
  for (let i = 0; i < 3; i++) {
    press({ kind: 'set_time', shiftHours: 1 });
    vi.advanceTimersByTime(500);
  }
  vi.advanceTimersByTime(1200);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('about 11 in the evening');
  // Diffed against the sky before the FIRST click, not the second.
  const risen = sky.snapshot().visible.filter((s) => !start.has(s.id)).map((s) => s.name);
  expect(lines[0]).toContain(risen[0]);
});

test('a drag that comes back to where it started says nothing', () => {
  press({ kind: 'set_time', shiftHours: 2 });
  press({ kind: 'set_time', shiftHours: -2 });
  vi.advanceTimersByTime(1200);
  expect(lines).toEqual([]);
});

test('a request flushes the pending line first, so the two arrive in order and the change is not spoken twice', () => {
  // The original's claim(seq): a change the model is already narrating must not
  // be narrated again. Here a typed or spoken request carries its own event;
  // the narrator says what was pending and then has nothing left to say.
  press({ kind: 'set_time', shiftHours: 1 });
  narrator.flush();
  expect(lines).toHaveLength(1);
  const outcome = act(sky, [{ kind: 'select', star: 'vega' }], 'typed', { now: EPOCH });
  expect(outcome.narrate).toBe(false);
  vi.advanceTimersByTime(5000);
  expect(lines).toHaveLength(1);
});

test('clearing is not narrated (the user can see it happen)', () => {
  press({ kind: 'select', star: 'vega' });
  vi.advanceTimersByTime(1200);
  press({ kind: 'clear_selection' });
  press({ kind: 'clear_figure' });
  vi.advanceTimersByTime(1200);
  expect(lines).toHaveLength(1);
});

test('a place picked then a time stepped is one line about the place, at the new hour', () => {
  press({ kind: 'set_place', label: 'Sydney' });
  press({ kind: 'set_time', shiftHours: 1 });
  vi.advanceTimersByTime(1200);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('The chart is now over Sydney, at');
});

test('cancel drops the pending line (the session ended)', () => {
  press({ kind: 'select', star: 'vega' });
  narrator.cancel();
  vi.advanceTimersByTime(5000);
  expect(lines).toEqual([]);
});
