// The range: the one writer, and the clock that lands shots (the reducer and
// lander tests from test_table.py, plus the cases the page's clock adds).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Launcher } from './launcher.ts';
import { LANDING_SLACK_S, Range } from './range.ts';
import type { Change } from './types.ts';

function watched(challenge?: string) {
  const range = new Range(new Launcher(challenge));
  const changes: Change[] = [];
  range.subscribe((c) => changes.push(c));
  return { range, changes };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the reducer', () => {
  test('an impossible speed comes back as a sentence, not an exception', () => {
    const r = new Range().apply({ kind: 'set_aim', angle_deg: 45, speed_ms: 90 }, 'spoken');
    expect(r).toEqual({ applied: false, reason: "That's past what this launcher does — 5 to 40 metres a second." });
  });

  test('an unknown intent is refused by name rather than ignored', () => {
    const r = new Range().apply({ kind: 'launch_the_moon' } as never, 'typed');
    expect(r.applied).toBe(false);
    expect(!r.applied && r.reason).toContain('launch_the_moon');
  });

  test('only the range calls its own shot down', () => {
    // `land` is the moment the verdict becomes visible. A source that could
    // send it could sit on a shot it did not like, or (a remounted canvas)
    // leave the range in "flying" forever.
    const { range } = watched();
    range.apply({ kind: 'fire' }, 'panel');
    for (const by of ['panel', 'typed', 'spoken'] as const) {
      const r = range.apply({ kind: 'land' }, by);
      expect(!r.applied && r.reason).toContain('Only the range');
    }
    expect(range.snapshot().phase).toBe('flying');
  });

  test('an accepted intent tells every listener, with the whole snapshot and who asked', () => {
    const { range, changes } = watched();
    const r = range.apply({ kind: 'set_aim', angle_deg: 40, speed_ms: 22 }, 'panel');
    expect(r.applied).toBe(true);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ seq: 1, by: 'panel', intent: { kind: 'set_aim' } });
    expect(changes[0].snapshot.aim).toEqual({ angle_deg: 40, speed_ms: 22 });
    expect(changes[0].previous.aim).toEqual({ angle_deg: 45, speed_ms: 20 });
  });

  test('a refused intent tells nobody anything', () => {
    const { range, changes } = watched();
    range.apply({ kind: 'set_aim', angle_deg: 45, speed_ms: 90 }, 'spoken');
    expect(changes).toEqual([]);
    expect(range.seq).toBe(0);
  });
});

describe('the lander', () => {
  test('a shot fired is a shot that comes down, after the animation it told the page to play', () => {
    // Without this the range sits in "flying" for the rest of the session with
    // every other request refused: the poker freeze, in fancy dress.
    const { range, changes } = watched();
    range.apply({ kind: 'fire' }, 'panel');
    const playMs = range.snapshot().last_shot!.play_s * 1000;
    vi.advanceTimersByTime(playMs);
    expect(range.snapshot().phase).toBe('flying'); // never before the ball is down
    vi.advanceTimersByTime(LANDING_SLACK_S * 1000);
    expect(range.snapshot().phase).toBe('scored');
    expect(range.snapshot().last_shot!.cleared).toBe(false);
    expect(changes.map((c) => [c.intent.kind, c.by])).toEqual([['fire', 'panel'], ['land', 'range']]);
  });

  test('one landing per shot, whatever happens while it flies', () => {
    const { range, changes } = watched();
    range.apply({ kind: 'fire' }, 'spoken');
    range.apply({ kind: 'fire' }, 'typed');                                 // refused: in the air
    range.apply({ kind: 'set_aim', angle_deg: 30, speed_ms: 20 }, 'panel'); // refused: in the air
    vi.advanceTimersByTime(10_000);
    expect(changes.filter((c) => c.intent.kind === 'land')).toHaveLength(1);
    expect(range.snapshot().attempts).toBe(1);
  });

  test('a challenge changed mid-flight leaves nothing to land, and the next shot lands on its own clock', () => {
    // The original's lander would have been refused here, harmlessly, unless a
    // new shot went up first: then the old timer brought the NEW shot down
    // early, with its result on screen while the ball was still climbing.
    const { range, changes } = watched();
    range.apply({ kind: 'fire' }, 'panel');                 // 2.5 s of play
    vi.advanceTimersByTime(500);
    range.apply({ kind: 'start_challenge', id: 'zone30' }, 'panel');
    expect(range.landingPending).toBe(false);
    range.apply({ kind: 'set_aim', angle_deg: 45, speed_ms: 40 }, 'panel');
    range.apply({ kind: 'fire' }, 'panel');                 // 2.5 s again, from t = 0.5
    vi.advanceTimersByTime(2_400);                          // t = 2.9: the old timer would have fired at 2.65
    expect(range.snapshot().phase).toBe('flying');
    vi.advanceTimersByTime(300);
    expect(range.snapshot().phase).toBe('scored');
    expect(changes.filter((c) => c.intent.kind === 'land')).toHaveLength(1);
  });

  test('dispose cancels a landing in flight', () => {
    const { range, changes } = watched();
    range.apply({ kind: 'fire' }, 'panel');
    range.dispose();
    vi.advanceTimersByTime(10_000);
    expect(range.snapshot().phase).toBe('flying');
    expect(changes.map((c) => c.intent.kind)).toEqual(['fire']);
  });
});
