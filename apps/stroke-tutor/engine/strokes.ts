// Stroke geometry and grading: pure, no I/O, SERVER ONLY (it grades against
// the reference strokes in characters.ts).
//
// This is where the app decides whether a stroke was right, and it decides it
// in code. No model is in this loop. The teacher reads the note out loud; it
// never rules on an answer, because a sampler that occasionally agrees with a
// backwards 撇 teaches the wrong muscle memory and cannot be diffed.
//
// What is graded is stroke ORDER and stroke DIRECTION, not handwriting. A
// wobbly line drawn in the right place, the right sequence and the right
// direction is a pass here, and it should be: the app teaches the sequence,
// and the rest is practice a screen cannot judge.
//
// The four verdicts, in the order they are checked:
//
// - `order`: the drawing best matches some OTHER stroke of the character.
//   Checked first because it subsumes the rest: a backwards later stroke is an
//   ordering mistake, not a direction one.
// - `direction`: the right shape, travelled backwards. The dot product of the
//   start-to-end vectors against the reference decides it.
// - `start`: the right shape travelling the right way, begun in the wrong
//   place (halfway along, or at the far end of a symmetric stroke).
// - `shape`: nothing in the character matches. The catch-all.
//
// Everything is measured in grid units (`GRID`, 1000 across), so the
// thresholds below are absolute and mean the same thing on any screen.
// Ported line for line from the original `strokes.py`; `strokes.parity.test.ts`
// replays verdicts recorded from that grader.
import {
  DEGENERATE_NOTE,
  ORDER_EARLIER_NOTE,
  ORDER_LATER_NOTE,
  SHAPE_FALLBACK_NOTE,
  type Character,
  type Point,
} from './characters.ts';
import type { Verdict } from './types.ts';

type XY = readonly [number, number];

/**
 * The budget for one stroke. Raw pointer sampling produces hundreds of points
 * per stroke; the page decimates before sending and this module decimates
 * again on arrival, because "the other end already did it" is not a property
 * anything at runtime can check.
 */
export const MAX_POINTS = 40;

/** How many equally spaced samples two strokes are compared at: enough to tell a curve from a line, few enough to be cheap. */
export const SAMPLES = 24;

/** Mean per-sample distance, in grid units, within which two strokes are "the same stroke". Generous on purpose: this app grades sequence, not neatness. */
export const MATCH_TOLERANCE = 200;

/** How far the start of a correctly shaped, correctly travelled stroke may sit from the reference start before it is a `start` mistake rather than sloppy aim. Roughly a fifth of the square. */
export const START_TOLERANCE = 230;

/** Below this total path length a "stroke" is a tap or a slip, not an attempt. */
export const MIN_PATH_LENGTH = 60;

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------------------------------------------------------------- points

/**
 * Coerce whatever arrived over the network into integer grid points.
 *
 * Anything non-finite, malformed or off the grid is dropped rather than
 * thrown: this input crosses a network boundary from a browser, and one bad
 * sample in three hundred must not lose the stroke. (Python's round() rounds
 * halves to even and Math.round() rounds them up; the page already sends
 * integers, so the two never disagree in practice.)
 */
export function clean(points: unknown): Point[] {
  const out: Point[] = [];
  if (!Array.isArray(points)) return out;
  for (const raw of points) {
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const x = toNumber(raw[0]);
    const y = toNumber(raw[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const point: Point = [Math.round(x), Math.round(y)];
    // Consecutive duplicates carry no shape and inflate the payload.
    const last = out[out.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    out.push(point);
  }
  return out;
}

/** Python's float(): numbers and numeric strings, nothing else. */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

export function pathLength(points: readonly XY[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) total += dist(points[i], points[i + 1]);
  return total;
}

/** A tap, a jitter, or a single held point: not a stroke. */
export function isDegenerate(points: readonly XY[]): boolean {
  return points.length < 2 || pathLength(points) < MIN_PATH_LENGTH;
}

/**
 * Thin a polyline to at most `maxPoints`, keeping its shape.
 *
 * Ramer-Douglas-Peucker first, because it keeps corners (the turn in 永's
 * shoulder is the whole stroke) and throws away the straight runs where the
 * samples are densest. If a genuinely wiggly stroke survives that, a uniform
 * subsample enforces the cap; the endpoints are always kept, so a decimated
 * stroke still starts and ends where it was drawn.
 */
export function decimate(points: readonly Point[], maxPoints = MAX_POINTS): Point[] {
  if (points.length <= maxPoints) return [...points];
  let epsilon = 4;
  let reduced = rdp(points, epsilon);
  while (reduced.length > maxPoints && epsilon < 200) {
    epsilon *= 1.8;
    reduced = rdp(points, epsilon);
  }
  if (reduced.length <= maxPoints) return reduced;
  const step = (reduced.length - 1) / (maxPoints - 1);
  const thinned = Array.from({ length: maxPoints }, (_, i) => reduced[Math.round(i * step)]);
  thinned[maxPoints - 1] = reduced[reduced.length - 1];
  return thinned;
}

function rdp(points: readonly Point[], epsilon: number): Point[] {
  if (points.length < 3) return [...points];
  const start = points[0];
  const end = points[points.length - 1];
  let worstIndex = 0;
  let worst = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = pointToSegment(points[i], start, end);
    if (distance > worst) {
      worstIndex = i;
      worst = distance;
    }
  }
  if (worst <= epsilon) return [start, end];
  const left = rdp(points.slice(0, worstIndex + 1), epsilon);
  const right = rdp(points.slice(worstIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}

function pointToSegment(point: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return dist(point, a);
  let t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return dist(point, [a[0] + t * dx, a[1] + t * dy]);
}

/**
 * `count` points spaced equally along the path.
 *
 * Comparing by arc length rather than by index is what makes a slow, densely
 * sampled drawing comparable to a four-point reference: the shape is compared,
 * not the sampling rate.
 */
export function resample(points: readonly XY[], count = SAMPLES): [number, number][] {
  if (!points.length) return [];
  const first: [number, number] = [points[0][0], points[0][1]];
  if (points.length === 1 || pathLength(points) === 0) return Array.from({ length: count }, () => [...first] as [number, number]);
  const total = pathLength(points);
  const step = total / (count - 1);
  const out: [number, number][] = [first];
  let walked = 0;
  let index = 0;
  for (let sample = 1; sample < count; sample += 1) {
    const target = sample * step;
    while (index < points.length - 2 && walked + dist(points[index], points[index + 1]) < target) {
      walked += dist(points[index], points[index + 1]);
      index += 1;
    }
    const segment = dist(points[index], points[index + 1]);
    const t = segment === 0 ? 0 : Math.min(1, (target - walked) / segment);
    out.push([
      points[index][0] + t * (points[index + 1][0] - points[index][0]),
      points[index][1] + t * (points[index + 1][1] - points[index][1]),
    ]);
  }
  return out;
}

// --------------------------------------------------------------- compare

export function meanDistance(a: readonly XY[], b: readonly XY[]): number {
  if (!a.length || !b.length || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += dist(a[i], b[i]);
  return sum / a.length;
}

/**
 * [forward, reversed] mean distance between a drawing and a reference.
 *
 * Both are returned because they answer two different questions: the smaller
 * decides WHICH stroke this is, and the difference between them decides
 * whether it was travelled the right way.
 */
export function distanceTo(drawn: readonly XY[], reference: readonly XY[]): [number, number] {
  const a = resample(drawn);
  const b = resample(reference);
  return [meanDistance(a, b), meanDistance(a, [...b].reverse())];
}

const travel = (points: readonly XY[]): XY => [points[points.length - 1][0] - points[0][0], points[points.length - 1][1] - points[0][1]];
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1];

const fill = (template: string, position: number, total: number) =>
  template.replace('{position}', String(position)).replace('{total}', String(total));

// ----------------------------------------------------------------- grade

/**
 * The verdict for one drawn stroke against stroke `index` of `character`.
 *
 * `note` is a sentence from characters.ts, said aloud unchanged in meaning:
 * this function chooses which sentence, never what it says.
 */
export function grade(character: Character, index: number, drawn: readonly Point[]): Verdict {
  const strokes = character.strokes;
  const reference = strokes[index];

  if (isDegenerate(drawn)) return { ok: false, kind: 'shape', note: DEGENERATE_NOTE };

  // min(forward, reversed) per candidate: a backwards stroke is still
  // recognisably that stroke, and calling it the wrong shape would teach the
  // wrong lesson.
  const distances = strokes.map((s) => Math.min(...distanceTo(drawn, s.points)));
  let best = 0;
  for (let i = 1; i < distances.length; i += 1) if (distances[i] < distances[best]) best = i;

  if (distances[best] > MATCH_TOLERANCE && distances[index] > MATCH_TOLERANCE) {
    return { ok: false, kind: 'shape', note: reference.hint || SHAPE_FALLBACK_NOTE };
  }

  if (best !== index && distances[best] < distances[index]) {
    const template = best < index ? ORDER_EARLIER_NOTE : ORDER_LATER_NOTE;
    return { ok: false, kind: 'order', note: fill(template, index + 1, strokes.length) };
  }

  const [forward, backward] = distanceTo(drawn, reference.points);
  if (dot(travel(drawn), travel(reference.points)) < 0 || backward < forward) {
    return { ok: false, kind: 'direction', note: reference.directionNote };
  }

  if (dist(drawn[0], reference.points[0]) > START_TOLERANCE) {
    return { ok: false, kind: 'start', note: reference.startNote };
  }

  return { ok: true, kind: 'ok', note: reference.teach };
}
