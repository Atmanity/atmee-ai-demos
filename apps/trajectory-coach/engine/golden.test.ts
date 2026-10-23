// The port against the original: golden/golden.json is the Python engine's own
// output (golden/make_golden.py), so every number and every coaching sentence
// the TypeScript range produces is pinned to what the original said, byte for
// byte, including the projection that hides a shot's result while it flies.
import { describe, expect, test } from 'vitest';
import { BY_ID, grade } from './challenges.ts';
import { solve, thin } from './flight.ts';
import golden from './golden/golden.json';
import { Launcher, LauncherRefusal } from './launcher.ts';

type GradeRow = [string, number, number, number, number, number, boolean, number, string];

describe('the TypeScript range says what the Python one said', () => {
  test(`${golden.grades.length} graded shots across the six challenges: numbers and notes`, () => {
    for (const [id, angle, speed, range, apex, flightS, cleared, miss, note] of golden.grades as GradeRow[]) {
      const c = BY_ID.get(id)!;
      const flight = solve(angle, speed, c.gravity, c.wind_ms);
      const verdict = grade(c, flight);
      const label = `${id} ${angle}° ${speed} m/s`;
      expect([flight.range_m, flight.apex_m, flight.flight_s], label).toEqual([range, apex, flightS]);
      expect(verdict, label).toEqual({ cleared, miss_m: miss, note });
    }
  });

  test('the curves and the ghost trails, point for point', () => {
    for (const { id, aim, path, trail } of golden.paths) {
      const c = BY_ID.get(id)!;
      const flight = solve(aim[0], aim[1], c.gravity, c.wind_ms);
      expect(flight.path, id).toEqual(path);
      expect(thin(flight.path), id).toEqual(trail);
    }
  });

  test('a scripted session: every refusal and every snapshot', () => {
    const launcher = new Launcher('wall40');
    const call: Record<string, (...args: unknown[]) => unknown> = {
      fire: () => launcher.fire(),
      land: () => launcher.land(),
      set_aim: (a, s) => launcher.setAim(a, s),
      next_challenge: () => launcher.nextChallenge(),
      start_challenge: (id) => launcher.startChallenge(id),
      reset: () => launcher.reset(),
    };
    for (const [i, step] of (golden.session as ({ snapshot: unknown } | { do: string; args: unknown[]; refused: string | null })[]).entries()) {
      if ('snapshot' in step) {
        expect(JSON.parse(JSON.stringify(launcher.snapshot())), `step ${i}`).toEqual(step.snapshot);
        continue;
      }
      let refused: string | null = null;
      try {
        call[step.do](...step.args);
      } catch (err) {
        if (!(err instanceof LauncherRefusal)) throw err;
        refused = err.message;
      }
      expect(refused, `step ${i}: ${step.do}(${step.args.join(', ')})`).toBe(step.refused);
    }
  });
});
