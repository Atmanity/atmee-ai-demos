// The grader: does it tell an ordering mistake from a direction one?
// (Ported from the original test_strokes.py.) These tests are the app's claim
// to be a tutor rather than a drawing toy. Each is named after the thing a
// learner would be taught wrongly if it broke.
import { describe, expect, test } from 'vitest';
import { CHARACTERS, EI, ICHI, JUU, KAWA, KI, LATIN_E, type Point } from './characters.ts';
import { clean, decimate, distanceTo, grade, isDegenerate, MATCH_TOLERANCE, MAX_POINTS, resample } from './strokes.ts';

/**
 * A human-ish drawing of a reference stroke: many samples along it, with a
 * little wobble. Real pointer input looks like this, not like the four
 * control points the reference is authored with. (Python's int() truncates.)
 */
function trace(points: readonly Point[], jitter = 0, samples = 60): Point[] {
  return resample(points, samples).map(([x, y], i) => [Math.trunc(x + jitter * Math.sin(i * 1.7)), Math.trunc(y + jitter * Math.cos(i * 2.3))] as Point);
}

const reversed = (points: Point[]) => [...points].reverse();

describe('geometry', () => {
  test('a wobbly but correct stroke is not marked wrong', () => {
    // The app grades order and direction, not handwriting. A shaky hand that
    // got the sequence right must not be told it drew the wrong stroke.
    const verdict = grade(ICHI, 0, trace(ICHI.strokes[0].points, 45));
    expect(verdict.ok).toBe(true);
    expect(verdict.kind).toBe('ok');
  });

  test('decimation caps a raw pointer trail', () => {
    const raw = trace(EI.strokes[2].points, 0, 400);
    const thinned = decimate(raw);
    expect(thinned.length).toBeLessThanOrEqual(MAX_POINTS);
    // Endpoints survive, or the stroke no longer starts and ends where drawn.
    expect(thinned[0]).toEqual(raw[0]);
    expect(thinned[thinned.length - 1]).toEqual(raw[raw.length - 1]);
  });

  test('decimation keeps the shape close enough to still grade', () => {
    const raw = trace(EI.strokes[1].points, 0, 300);
    const [forward] = distanceTo(decimate(raw), raw);
    expect(forward).toBeLessThan(MATCH_TOLERANCE / 4);
  });

  test('clean drops garbage without losing the stroke', () => {
    const points = clean([[10, 20], ['x', 3], [10, 20], [null, null], [30, 40], [Number.NaN, 1]]);
    expect(points).toEqual([[10, 20], [30, 40]]);
  });

  test('clean survives input that is not a list at all', () => {
    // This arrives over the network; a malformed body must not throw.
    expect(clean(undefined)).toEqual([]);
    expect(clean('nope')).toEqual([]);
    expect(clean([[1], 'x', { 0: 1, 1: 2 }, [5, 6]])).toEqual([[5, 6]]);
  });

  test('a tap is degenerate and a stroke is not', () => {
    expect(isDegenerate([[500, 500], [503, 501]])).toBe(true);
    expect(isDegenerate([[500, 500]])).toBe(true);
    expect(isDegenerate(trace(ICHI.strokes[0].points))).toBe(false);
  });
});

describe('order', () => {
  test('drawing a later stroke first is an ORDER mistake', () => {
    // 十 is horizontal then vertical. Drawing the vertical first is the single
    // most common stroke-order error there is.
    const verdict = grade(JUU, 0, trace(JUU.strokes[1].points));
    expect(verdict.ok).toBe(false);
    expect(verdict.kind).toBe('order');
    expect(verdict.note).toContain('stroke 1');
  });

  test('an order refusal never names the stroke it wants', () => {
    // A refusal is not a hint. If the note described the stroke, the learner
    // would be reading it rather than recalling it.
    const verdict = grade(KAWA, 0, trace(KAWA.strokes[2].points));
    expect(verdict.kind).toBe('order');
    const words = new Set(verdict.note.toLowerCase().match(/[a-z]+/g));
    for (const word of ['left', 'right', 'middle', 'vertical', 'horizontal', 'short', 'long', 'dot', 'hook']) expect(words.has(word), word).toBe(false);
  });

  test('redrawing an earlier stroke says so rather than calling it wrong', () => {
    const verdict = grade(KI, 2, trace(KI.strokes[0].points));
    expect(verdict.kind).toBe('order');
    expect(verdict.note).toContain('already');
  });

  test('the two mirrored roots of 木 are told apart', () => {
    // 木's third and fourth strokes are mirror images. If the grader cannot
    // separate them it cannot teach left-root-before-right, which is the only
    // thing those two strokes are here to teach.
    expect(grade(KI, 2, trace(KI.strokes[3].points)).kind).toBe('order');
  });
});

describe('direction', () => {
  test('a backwards horizontal is a DIRECTION mistake, not a wrong shape', () => {
    const verdict = grade(ICHI, 0, reversed(trace(ICHI.strokes[0].points)));
    expect(verdict.ok).toBe(false);
    expect(verdict.kind).toBe('direction');
    expect(verdict.note).toBe(ICHI.strokes[0].directionNote);
  });

  test('a vertical drawn upwards is a direction mistake', () => {
    expect(grade(JUU, 1, reversed(trace(JUU.strokes[1].points))).kind).toBe('direction');
  });

  test('the hook of 永 drawn backwards is still recognised as that stroke', () => {
    // Reversal must not degrade into "I don't know what that was": the
    // learner drew the right stroke and needs to hear which end to start.
    expect(grade(EI, 2, reversed(trace(EI.strokes[2].points))).kind).toBe('direction');
  });
});

describe('start', () => {
  test('starting a horizontal halfway along is a START mistake', () => {
    // Right shape, right direction, begun in the middle. Common, and a
    // different lesson from either of the two above.
    const full = ICHI.strokes[0].points;
    const verdict = grade(ICHI, 0, trace([[500, 498], full[full.length - 1]]));
    expect(verdict.kind).toBe('start');
    expect(verdict.note).toBe(ICHI.strokes[0].startNote);
  });
});

describe('shape', () => {
  test('a scribble matches nothing and gets the stroke hint', () => {
    const scribble: Point[] = Array.from({ length: 30 }, (_, i) => [120 + 8 * i, 800 + (i % 2 ? 60 : -60)]);
    const verdict = grade(LATIN_E, 0, scribble);
    expect(verdict.ok).toBe(false);
    expect(verdict.kind).toBe('shape');
    expect(verdict.note).toBe(LATIN_E.strokes[0].hint);
  });

  test('a dot is refused as a shape rather than graded as a stroke', () => {
    expect(grade(ICHI, 0, [[500, 500], [502, 501]]).kind).toBe('shape');
  });
});

describe('every stroke, sanely', () => {
  test('every authored stroke grades itself correct', () => {
    // Content check. A reference stroke the grader would reject is a
    // character nobody can complete, and it would only be found in a call.
    for (const character of CHARACTERS) {
      character.strokes.forEach((stroke, index) => {
        const verdict = grade(character, index, trace(stroke.points));
        expect(verdict.ok, `${character.id} stroke ${index}: ${JSON.stringify(verdict)}`).toBe(true);
      });
    }
  });

  test('every authored stroke is told apart from its siblings', () => {
    // If two strokes of one character grade as each other, the ordering
    // lesson for that character is silently untestable in the call.
    for (const character of CHARACTERS) {
      character.strokes.forEach((stroke, index) => {
        const drawn = trace(stroke.points);
        const distances = character.strokes.map((s) => Math.min(...distanceTo(drawn, s.points)));
        const best = distances.indexOf(Math.min(...distances));
        expect(best, `${character.id}: stroke ${index} looks like ${best}`).toBe(index);
      });
    }
  });
});
