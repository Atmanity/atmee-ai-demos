// The physics, against numbers worked out by hand (ported from test_flight.py).
//
// A physics app whose numbers are wrong is worse than no app: the student
// cannot tell which of the coach's sentences to trust, and the confident ones
// are the dangerous ones. So these are checked against the closed form done on
// paper, not against whatever the code happened to print the first time.
import { describe, expect, test } from 'vitest';
import { CHALLENGES, grade, limitsOf } from './challenges.ts';
import { MAX_PATH_POINTS, TRAIL_POINTS, components, heightAt, pyG, pyRound, pyStr, solve, thin } from './flight.ts';

describe('flight', () => {
  test('45° at 20 m/s travels 40.8 metres', () => {
    // v = 20, θ = 45°, g = 9.81. vy = 20·sin45 = 14.142, T = 2·vy/g = 2.883 s,
    // range = vx·T = 14.142 × 2.883 = 40.77 m, apex = vy²/2g = 10.19 m.
    const flight = solve(45, 20);
    expect(flight.range_m).toBe(40.77);
    expect(flight.flight_s).toBe(2.88);
    expect(flight.apex_m).toBe(10.19);
  });

  test('range is v² over g at 45°', () => {
    // The textbook identity: R = v²·sin(2θ)/g, maximal at θ = 45° where it is
    // v²/g exactly. Anything that breaks this breaks every challenge at once.
    for (const speed of [10, 18, 25, 40]) expect(solve(45, speed).range_m).toBe(pyRound((speed * speed) / 9.81, 2));
  });

  test('complementary angles land in the same place', () => {
    // sin(2θ) = sin(180° − 2θ), so 25° and 65° carry the same distance: the
    // entire point of the zone challenge.
    expect(Math.abs(solve(25, 20).range_m - solve(65, 20).range_m)).toBeLessThan(0.02);
    expect(solve(25, 20).flight_s).toBeLessThan(solve(65, 20).flight_s);
  });

  test('apex ignores the wind and range does not', () => {
    const still = solve(40, 25);
    const breezy = solve(40, 25, 9.81, -6);
    expect(breezy.apex_m).toBe(still.apex_m);
    expect(breezy.flight_s).toBe(still.flight_s);
    // Six metres a second against it, for `flight_s` seconds of flight.
    expect(Math.abs(breezy.range_m - (still.range_m - 6 * still.flight_s))).toBeLessThan(0.05);
  });

  test('lunar gravity carries the same shot six times further', () => {
    const earth = solve(45, 12);
    const moon = solve(45, 12, 1.62);
    expect(Math.abs(moon.range_m / earth.range_m - 9.81 / 1.62)).toBeLessThan(0.01);
  });

  test('the height at the wall matches the parabola', () => {
    const flight = solve(45, 24);
    const [vx, vy] = components(45, 24);
    const t = 40 / vx;
    expect(heightAt(flight, 40)).toBe(pyRound(vy * t - 0.5 * 9.81 * t * t, 2));
  });

  test('a shot that never reaches the wall has no height there', () => {
    // Landing at 40.77 m, so 60 m is beyond it, and "it never got there" must
    // not be reported as "it was below the top".
    expect(heightAt(solve(45, 20), 60)).toBeNull();
  });

  test('a headwind stronger than the shot goes nowhere forward', () => {
    const flight = solve(80, 6, 9.81, -6);
    expect(flight.range_m).toBeLessThanOrEqual(0);
    expect(heightAt(flight, 10)).toBeNull();
  });

  test('the path is capped and starts and ends on the ground', () => {
    const flight = solve(45, 40);
    expect(flight.path).toHaveLength(MAX_PATH_POINTS);
    expect(flight.path[0]).toEqual([0, 0]);
    expect(flight.path.at(-1)![0]).toBe(flight.range_m);
    expect(flight.path.at(-1)![1]).toBe(0);
    expect(Math.max(...flight.path.map((p) => p[1]))).toBeLessThanOrEqual(flight.apex_m + 0.01);
  });

  test('a thinned trail keeps both ends', () => {
    const path = solve(45, 30).path;
    const trail = thin(path);
    expect(trail).toHaveLength(TRAIL_POINTS);
    expect(trail[0]).toEqual(path[0]);
    expect(trail.at(-1)).toEqual(path.at(-1));
  });

  test('a near-vertical shot has almost no range and a real apex', () => {
    const flight = solve(85, 20);
    expect(flight.apex_m).toBeGreaterThan(19);
    expect(flight.range_m).toBeLessThan(8);
  });

  test('gravity must be positive', () => {
    expect(() => solve(45, 20, 0)).toThrow(/gravity must be positive/);
  });

  test('components put the wind on the horizontal only', () => {
    const [vx, vy] = components(30, 20, 5);
    expect(Math.abs(vx - (20 * Math.cos(Math.PI / 6) + 5))).toBeLessThan(1e-9);
    expect(Math.abs(vy - 20 * Math.sin(Math.PI / 6))).toBeLessThan(1e-9);
  });
});

describe('the marking', () => {
  const [wall, zone, , , ceiling] = CHALLENGES;

  test('the wall distinguishes short from low', () => {
    const short = grade(wall, solve(45, 15));
    expect(short.cleared).toBe(false);
    expect(short.note).toContain('short of the wall');
    const low = grade(wall, solve(45, 20)); // lands at 40.77, so it passes 40 m low
    expect(low.cleared).toBe(false);
    expect(low.note).toContain('below the top');
    const over = grade(wall, solve(45, 24));
    expect(over.cleared).toBe(true);
    expect(over.miss_m).toBe(0);
  });

  test('the zone says long or short and by how much', () => {
    const longShot = grade(zone, solve(45, 20)); // 40.77 m
    expect(longShot.cleared).toBe(false);
    expect(longShot.miss_m).toBe(pyRound(40.77 - 32, 2));
    expect(longShot.note).toContain('long of the zone');
    expect(grade(zone, solve(45, 17.15)).cleared).toBe(true);
  });

  test('a roof overrides a shot that went far enough', () => {
    const lofted = grade(ceiling, solve(60, 20));
    expect(lofted.cleared).toBe(false);
    expect(lofted.note).toContain('Into the roof');
    expect(grade(ceiling, solve(20, 25)).cleared).toBe(true);
  });

  test('every challenge is clearable within its own limits', () => {
    // A challenge nobody can clear is not a lesson, it is a bug that only shows
    // up as a student giving up.
    for (const c of CHALLENGES) {
      const { angle, speed } = limitsOf(c);
      let clearable = false;
      for (let a = angle[0]; a <= angle[1] && !clearable; a += 1)
        for (let v = speed[0]; v <= speed[1] && !clearable; v += 1)
          clearable = grade(c, solve(a, v, c.gravity, c.wind_ms)).cleared;
      expect(clearable, `${c.id} cannot be cleared`).toBe(true);
    }
  });

  test('every note carries a number', () => {
    for (const [angle, speed] of [[45, 15], [45, 20], [45, 24], [5, 40], [85, 40]]) {
      const note = grade(wall, solve(angle, speed)).note;
      expect(note, note).toMatch(/\d/);
    }
  });
});

describe("Python's number habits", () => {
  test('round: exact ties go to even, everything else to the nearest', () => {
    expect([pyRound(0.125, 2), pyRound(0.375, 2), pyRound(2.5), pyRound(3.5), pyRound(-0.125, 2)]).toEqual([0.12, 0.38, 2, 4, -0.12]);
    // 2.675 is really 2.67499999…: Python says 2.67, and so must we.
    expect([pyRound(2.675, 2), pyRound(1.005, 2), pyRound(40.77, 2)]).toEqual([2.67, 1, 40.77]);
  });
  test('str and g', () => {
    expect([pyStr(40), pyStr(40.77), pyStr(-0), pyG(40), pyG(2.5), pyG(95)]).toEqual(['40.0', '40.77', '-0.0', '40', '2.5', '95']);
  });
});
