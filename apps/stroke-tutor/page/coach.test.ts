// The coaching line's way to the avatar: newest only, once it has the floor.
// The original coach spoke once per state, not once per change, because a
// learner drawing quickly otherwise hears every stale verdict in turn.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Outcome, Snapshot } from '../engine/types.ts';
import { createCoach, cueFor, QUIET_MS } from './coach.ts';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup() {
  const sent: string[] = [];
  const coach = createCoach((text) => sent.push(text), QUIET_MS, () => Date.now());
  return { sent, coach };
}

describe('the queue', () => {
  test('a cue goes at once when the avatar is live and quiet', () => {
    const { sent, coach } = setup();
    coach.live(true);
    coach.push({ text: 'A', ttlS: 20 });
    expect(sent).toEqual(['A']);
  });

  test('while the avatar speaks, only the newest cue survives, and it goes after a quiet moment', () => {
    const { sent, coach } = setup();
    coach.live(true);
    coach.speaking(true);
    coach.push({ text: 'verdict on stroke 1', ttlS: 20 });
    coach.push({ text: 'verdict on stroke 1, again', ttlS: 20 });
    coach.push({ text: 'the rescue', ttlS: 20 });
    expect(sent).toEqual([]);
    coach.speaking(false);
    vi.advanceTimersByTime(QUIET_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(['the rescue']);
  });

  test('a pause inside a reply does not count as the end of it', () => {
    const { sent, coach } = setup();
    coach.live(true);
    coach.speaking(true);
    coach.push({ text: 'A', ttlS: 20 });
    coach.speaking(false);
    vi.advanceTimersByTime(QUIET_MS / 2);
    coach.speaking(true);
    vi.advanceTimersByTime(QUIET_MS * 2);
    expect(sent).toEqual([]);
    coach.speaking(false);
    vi.advanceTimersByTime(QUIET_MS);
    expect(sent).toEqual(['A']);
  });

  test('cues before the avatar arrives wait for it, the newest only, however long it takes', () => {
    const { sent, coach } = setup();
    coach.push({ text: 'opening', ttlS: 45 });
    coach.push({ text: '十 is on the board', ttlS: 20 });
    vi.advanceTimersByTime(90_000);
    coach.live(true);
    expect(sent).toEqual(['十 is on the board']);
  });

  test('a cue that outlived its ttl while the avatar talked is dropped', () => {
    const { sent, coach } = setup();
    coach.live(true);
    coach.speaking(true);
    coach.push({ text: 'stale', ttlS: 20 });
    vi.advanceTimersByTime(25_000);
    coach.speaking(false);
    vi.advanceTimersByTime(QUIET_MS);
    expect(sent).toEqual([]);
    expect(coach.waiting()).toBeNull();
  });

  test('clear drops what is waiting', () => {
    const { sent, coach } = setup();
    coach.push({ text: 'A', ttlS: 20 });
    coach.clear();
    coach.live(true);
    expect(sent).toEqual([]);
  });
});

describe('which outcomes are spoken', () => {
  const view = {} as Snapshot;
  const outcome = (o: Partial<Outcome>): Outcome => ({ view, handled: true, ...o });

  test('a refusal of something pressed is shown, not spoken; one asked for in words is spoken', () => {
    const refused = outcome({ refused: 'Finish this stroke first.', event: 'The board refused that: Finish this stroke first.' });
    expect(cueFor(refused, 'panel')).toBeNull();
    expect(cueFor(refused, 'spoken')?.text).toContain('Finish this stroke first.');
    expect(cueFor(refused, 'typed')?.text).toContain('Finish this stroke first.');
  });

  test('every accepted action is spoken, whoever asked', () => {
    for (const from of ['panel', 'typed', 'spoken'] as const) expect(cueFor(outcome({ event: 'E' }), from)?.text).toBe('E');
  });

  test('a line that was not a board action has nothing to say', () => {
    expect(cueFor({ view, handled: false }, 'spoken')).toBeNull();
  });
});
