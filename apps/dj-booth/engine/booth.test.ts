import { describe, expect, test } from 'vitest';
import { ANSWER_WINDOW_MS, BREAK_MS, DUCK, freshClock, heard, INTRO_TALK_MS, musicLevel, tick, type Clock, type Cue } from './booth.ts';

const play = (position: number, duration = 200_000, isPaused = false) => ({ isPaused, isBuffering: false, position, duration });

/** Runs updates through the clock, collecting the cues. */
function run(updates: ReturnType<typeof play>[], id = 'a', start: Clock = freshClock()) {
  let clock = start;
  const cues: Cue[] = [];
  for (const p of updates) {
    const r = tick(clock, id, p);
    clock = r.clock;
    if (r.cue) cues.push(r.cue);
  }
  return { clock, cues };
}

describe('the radio clock', () => {
  test('a record calls its break once in its last seconds, then ends once', () => {
    const { cues } = run([play(1000), play(150_000), play(200_000 - BREAK_MS + 500), play(195_000), play(199_600), play(199_900)]);
    expect(cues).toEqual(['break', 'ended']);
  });

  test('a player that snaps back to 0 right after the last seconds has ended', () => {
    expect(run([play(197_500), play(0, 200_000, true)]).cues).toEqual(['break', 'ended']);
  });

  test('pausing mid-record is not an end, and a paused record calls no break', () => {
    expect(run([play(60_000), play(60_000, 200_000, true), play(0, 200_000, true)]).cues).toEqual([]);
    expect(run([play(195_000, 200_000, true)]).cues).toEqual([]);
  });

  test('a new record starts a new clock', () => {
    const first = run([play(195_000), play(199_900)]);
    expect(run([play(195_000)], 'b', first.clock).cues).toEqual(['break']);
  });

  test('an unknown duration raises nothing', () => {
    expect(run([play(0, 0), play(10, 0)]).cues).toEqual([]);
  });
});

test('the music ducks under the host to a share of the listener\'s level, never out of 0..1', () => {
  expect(musicLevel(0.8, false)).toBe(0.8);
  expect(musicLevel(0.8, true)).toBeCloseTo(0.8 * DUCK);
  expect(musicLevel(2, false)).toBe(1);
});

describe('what the listener hears of the host', () => {
  const late = { musicOn: true, onBreak: false, positionMs: 60_000 };

  test('between records and in a break, everything', () => {
    expect(heard({ ...late, musicOn: false, sinceListenerMs: Infinity })).toBe(true);
    expect(heard({ ...late, onBreak: true, sinceListenerMs: Infinity })).toBe(true);
  });

  test('over the first 20 seconds of a record, everything: the host talks up to the vocal', () => {
    expect(heard({ ...late, positionMs: INTRO_TALK_MS - 1, sinceListenerMs: Infinity })).toBe(true);
    expect(heard({ ...late, positionMs: INTRO_TALK_MS, sinceListenerMs: Infinity })).toBe(false);
  });

  test('later in a record, an answer to the listener but not an unprompted check-in', () => {
    expect(heard({ ...late, sinceListenerMs: 5_000 })).toBe(true);
    expect(heard({ ...late, sinceListenerMs: ANSWER_WINDOW_MS + 1 })).toBe(false);
  });
});
