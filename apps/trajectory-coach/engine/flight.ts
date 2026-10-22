// Projectile flight, as arithmetic and nothing else (ported from flight.py).
//
// No framework, no I/O: this module is the app's physics and it is a pure
// function of four numbers. Everything the coach ever says about a shot is
// computed here, once, so that there is exactly one answer to "where did it
// land".
//
// The model of the world is deliberately the one a first physics course uses:
// launched from the ground at (0, 0), constant gravity `g` downward, and a
// constant horizontal wind that adds `w` metres per second to the horizontal
// velocity (a tailwind is positive, a headwind negative). No drag.
//
//     vx = v·cos θ + w          vy = v·sin θ
//     flight time  T = 2·vy / g
//     apex         = vy² / (2g)
//     range        = vx · T
//     y(t)         = vy·t − ½·g·t²
//
// No drag is a choice, not an oversight: with drag there is no closed form, the
// coach can no longer say *why* a shot fell short in one sentence, and the
// number the page animates stops being checkable by hand. The app teaches the
// model it states.
//
// The trajectory leaves here as a capped polyline rather than a sampling rule,
// so the curve the page draws and the curve the numbers came from are the same
// object.
import type { Point } from './types.ts';

/** Points in the live trajectory. The closed form is exact at every t, so more points buy nothing. */
export const MAX_PATH_POINTS = 40;

/** Points kept for a past attempt's ghost trail: a hint about shape, not a curve anyone measures. */
export const TRAIL_POINTS = 16;

/** One shot, fully resolved. Every field is metres or seconds. */
export interface Flight {
  angle_deg: number;
  speed_ms: number;
  gravity: number;
  wind_ms: number;
  flight_s: number;
  apex_m: number;
  range_m: number;
  path: Point[];
}

/**
 * Horizontal and vertical launch velocity, in metres per second.
 *
 * The wind lands on the horizontal component only, which is the whole reason a
 * headwind is worth a challenge of its own: it costs you range without buying
 * back any hang time, so the answer is a flatter, faster shot rather than a
 * lofted one.
 */
export function components(angleDeg: number, speedMs: number, windMs = 0): [number, number] {
  const theta = (angleDeg * Math.PI) / 180;
  return [speedMs * Math.cos(theta) + windMs, speedMs * Math.sin(theta)];
}

/** Resolve one shot completely. */
export function solve(angleDeg: number, speedMs: number, gravity = 9.81, windMs = 0): Flight {
  if (!(gravity > 0)) throw new RangeError('gravity must be positive');
  const [vx, vy] = components(angleDeg, speedMs, windMs);
  const flightS = vy > 0 ? (2 * vy) / gravity : 0;
  const apexM = vy > 0 ? (vy * vy) / (2 * gravity) : 0;
  const rangeM = vx * flightS;
  return {
    angle_deg: pyRound(angleDeg, 1),
    speed_ms: pyRound(speedMs, 1),
    gravity: pyRound(gravity, 3),
    wind_ms: pyRound(windMs, 1),
    flight_s: pyRound(flightS, 2),
    apex_m: pyRound(apexM, 2),
    range_m: pyRound(rangeM, 2),
    path: sample(vx, vy, gravity, flightS, MAX_PATH_POINTS),
  };
}

/**
 * The trajectory as `[[x, y], …]`, first point the muzzle, last the ground.
 *
 * Uniform in time rather than in x: it is time the page animates against, and
 * a path sampled uniformly in x cannot be walked at constant speed without the
 * page doing physics of its own.
 */
export function sample(vx: number, vy: number, gravity: number, flightS: number, points: number): Point[] {
  const n = Math.max(2, Math.trunc(points));
  if (flightS <= 0) return [[0, 0], [0, 0]];
  const out: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = (flightS * i) / (n - 1);
    const x = vx * t;
    const y = vy * t - 0.5 * gravity * t * t;
    out.push([pyRound(x, 2), pyRound(Math.max(y, 0), 2)]);
  }
  return out;
}

/**
 * How high the shot is as it passes `xM`, or null if it never gets there.
 *
 * Null rather than a negative number on purpose: "it never reached the wall"
 * and "it was below the top of the wall" are different failures, they want
 * different sentences, and collapsing them is how a coach ends up saying you
 * clipped a wall you landed twenty metres short of.
 */
export function heightAt(flight: Flight, xM: number): number | null {
  const [vx, vy] = components(flight.angle_deg, flight.speed_ms, flight.wind_ms);
  if (vx <= 0 || xM < 0) return null;
  const t = xM / vx;
  if (t > flight.flight_s) return null;
  return pyRound(vy * t - 0.5 * flight.gravity * t * t, 2);
}

/** A shorter polyline of the same shape, keeping both ends (the ghost trails). */
export function thin(path: Point[], points = TRAIL_POINTS): Point[] {
  const n = Math.max(2, Math.trunc(points));
  if (path.length <= n) return path.map((p) => [p[0], p[1]] as Point);
  const step = (path.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => {
    const p = path[Math.min(path.length - 1, pyRound(i * step))];
    return [p[0], p[1]] as Point;
  });
}

// ---------------------------------------------------------------------------
// Python's number habits, so the TypeScript range says exactly what the
// original did (pinned by golden.test.ts against the Python engine's output).
// ---------------------------------------------------------------------------

/**
 * Python's `round(x, n)`: the exact binary value rounded, exact ties to even.
 * `toFixed` rounds the exact value too, but sends exact ties up (0.125 → 0.13
 * where Python says 0.12).
 */
export function pyRound(x: number, n = 0): number {
  if (!Number.isFinite(x)) return x;
  const a = Math.abs(x);
  const exact = a.toFixed(n + 20);
  const dot = exact.indexOf('.');
  const tieAt = dot + n + 1;
  let out: number;
  if (exact[tieAt] === '5' && /^0*$/.test(exact.slice(tieAt + 1))) {
    const down = Number(exact.slice(0, tieAt));
    const last = Number(exact[n === 0 ? dot - 1 : tieAt - 1]);
    out = last % 2 === 0 ? down : Number((down + 10 ** -n).toFixed(n));
  } else {
    out = Number(a.toFixed(n));
  }
  return x < 0 ? -out : out;
}

/** Python's `str(float)`: "40.0" where JavaScript says "40". */
export function pyStr(x: number): string {
  if (Object.is(x, -0)) return '-0.0';
  return Number.isInteger(x) && Math.abs(x) < 1e16 ? x.toFixed(1) : String(x);
}

/** Python's `format(x, 'g')` for the small numbers used here: "40" for 40.0, "2.5" for 2.5. */
export function pyG(x: number): string {
  if (Object.is(x, -0)) return '-0';
  return String(Number(x.toPrecision(6)));
}
