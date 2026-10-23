// The rules, and the one property the whole app rests on. (Ported from the
// original test_tutor.py.)
//
// That property: the snapshot never carries the points of a stroke the
// learner has not earned. One test per status. Everything else here is
// refusals, each asserted by its exact sentence: a refusal the learner cannot
// act on is the same bug as no refusal, and rewording one silently is how
// that happens.
import { describe, expect, test } from 'vitest';
import { CHARACTERS, EI, GRID, ICHI, JUU, type Character, type Point } from './characters.ts';
import { MAX_POINTS, resample } from './strokes.ts';
import {
  ALREADY_RESOLVED,
  BETWEEN_STROKES,
  CHARACTER_FINISHED,
  DEGENERATE_STROKE,
  NOTHING_TO_CLEAR,
  STROKE_UNRESOLVED,
  StrokeTutor,
  TutorRefusal,
  UNKNOWN_CHARACTER,
} from './tutor.ts';

const trace = (points: readonly Point[], samples = 40) => resample(points, samples).map(([x, y]) => [Math.trunc(x), Math.trunc(y)]);
const drawing = (character: Character, index: number) => trace(character.strokes[index].points);

function started(characterId = 'juu') {
  const tutor = new StrokeTutor();
  tutor.startCharacter(characterId);
  return tutor;
}

/** The refusal's sentence, or a failure if it did not refuse. */
function refusal(call: () => unknown): string {
  try {
    call();
  } catch (err) {
    if (err instanceof TutorRefusal) return err.reason;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('the leak', () => {
  test('the live stroke is sent with no points', () => {
    // The stroke being asked for is the question. Sending its coordinates
    // turns writing practice into tracing, which is the app not existing.
    const live = started('ei').snapshot().strokes[0];
    expect(live.status).toBe('current');
    expect(live.points).toEqual([]);
    expect(live.name).toBeUndefined();
    expect(live.teach).toBeUndefined();
  });

  test('a hidden stroke is sent with no points', () => {
    for (const stroke of started('ei').snapshot().strokes.slice(1)) {
      expect(stroke.status).toBe('hidden');
      expect(stroke.points).toEqual([]);
      expect(stroke.name).toBeUndefined();
      expect(stroke.teach).toBeUndefined();
    }
  });

  test('a stroke earns its points by being drawn correctly', () => {
    const tutor = started('juu');
    tutor.stroke(drawing(JUU, 0));
    const stroke = tutor.snapshot().strokes[0];
    expect(stroke.status).toBe('done');
    expect(stroke.points).toEqual(JUU.strokes[0].points.map((p) => [...p]));
    expect(stroke.teach).toBe(JUU.strokes[0].teach);
  });

  test('a stroke earns its points by being revealed', () => {
    const tutor = started('juu');
    tutor.reveal();
    expect(tutor.snapshot().strokes[0].points).not.toEqual([]);
  });

  test('a wrong attempt does not hand over the points', () => {
    // The commonest way this leak would come back: a miss that reveals the answer "to help".
    const tutor = started('juu');
    tutor.stroke(drawing(JUU, 1)); // the vertical, drawn first
    expect(tutor.snapshot().strokes[0].points).toEqual([]);
  });

  test('no character means no strokes at all', () => {
    expect(new StrokeTutor().snapshot().strokes).toEqual([]);
  });
});

describe('the shape', () => {
  test('the snapshot carries the grid so the page never sees pixels', () => {
    expect(new StrokeTutor().snapshot().grid).toBe(GRID);
  });

  test('the catalog is always offered so the learner can switch', () => {
    const catalog = new StrokeTutor().snapshot().catalog;
    expect(catalog.map((entry) => entry.id)).toEqual(CHARACTERS.map((c) => c.id));
    expect(catalog[0].glyph).toBe('一');
  });

  test('the snapshot stays small, even with every stroke of the longest character earned', () => {
    // The original's limit was a 32 KiB envelope the shell dropped in
    // silence; here it is every response the page waits for. The worst case
    // is the longest character with every stroke earned.
    const tutor = started('ei');
    for (let i = 0; i < EI.strokes.length; i += 1) {
      tutor.reveal();
      tutor.nextStroke();
    }
    const encoded = new TextEncoder().encode(JSON.stringify(tutor.snapshot())).length;
    // If this ever trips, the fix is fewer points, not a bigger number.
    expect(encoded).toBeLessThan(8192);
    const longest = Math.max(...CHARACTERS.map((c) => c.strokes.length));
    expect(longest * MAX_POINTS * '[1000,1000],'.length).toBeLessThan(32 * 1024 / 2);
  });
});

describe('refusals', () => {
  test('an unknown character is refused with the list', () => {
    expect(refusal(() => new StrokeTutor().startCharacter('dragon'))).toBe(UNKNOWN_CHARACTER);
  });

  test('drawing before a character is chosen is refused', () => {
    expect(refusal(() => new StrokeTutor().stroke(drawing(ICHI, 0)))).toBe(BETWEEN_STROKES);
  });

  test('drawing while the stroke is already resolved is refused', () => {
    const tutor = started('juu');
    tutor.stroke(drawing(JUU, 0));
    expect(refusal(() => tutor.stroke(drawing(JUU, 1)))).toBe(BETWEEN_STROKES);
  });

  test('a tap is refused rather than counted as a miss', () => {
    // A slip must not push the learner towards the two-miss rescue.
    const tutor = started('juu');
    expect(refusal(() => tutor.stroke([[500, 500], [501, 502]]))).toBe(DEGENERATE_STROKE);
    expect(tutor.snapshot().attempts).toBe(0);
  });

  test('an empty stroke is refused', () => {
    expect(refusal(() => started('juu').stroke([]))).toBe(DEGENERATE_STROKE);
  });

  test('advancing before the stroke is resolved is refused', () => {
    expect(refusal(() => started('juu').nextStroke())).toBe(STROKE_UNRESOLVED);
  });

  test('revealing a resolved stroke is refused', () => {
    // This refusal is what makes the rescue single-shot: the rules stop it
    // repeating, not a flag something has to remember.
    const tutor = started('juu');
    tutor.reveal();
    expect(refusal(() => tutor.reveal())).toBe(ALREADY_RESOLVED);
  });

  test('everything is refused once the character is finished', () => {
    const tutor = started('ichi');
    tutor.reveal();
    tutor.nextStroke();
    expect(tutor.phase).toBe('debrief');
    for (const call of [() => tutor.reveal(), () => tutor.nextStroke(), () => tutor.clearAttempt()]) expect(refusal(call)).toBe(CHARACTER_FINISHED);
  });

  test('clearing nothing is refused', () => {
    expect(refusal(() => started('juu').clearAttempt())).toBe(NOTHING_TO_CLEAR);
  });

  test('clearing resets the attempt count and the verdict', () => {
    const tutor = started('juu');
    tutor.stroke(drawing(JUU, 1));
    expect(tutor.snapshot().attempts).toBe(1);
    tutor.clearAttempt();
    expect(tutor.snapshot().attempts).toBe(0);
    expect(tutor.snapshot().last_verdict).toBeNull();
  });

  test('a refusal leaves the board exactly as it was', () => {
    const tutor = started('juu');
    tutor.stroke(drawing(JUU, 1));
    const before = JSON.stringify(tutor.snapshot());
    refusal(() => tutor.nextStroke());
    refusal(() => tutor.startCharacter('dragon'));
    expect(JSON.stringify(tutor.snapshot())).toBe(before);
  });
});

describe('the walk', () => {
  test('a correct stroke scores and a revealed one does not', () => {
    const tutor = started('juu');
    tutor.stroke(drawing(JUU, 0));
    tutor.nextStroke();
    tutor.reveal();
    tutor.nextStroke();
    expect(tutor.snapshot().score).toEqual({ correct: 1, total: 2 });
    expect(tutor.phase).toBe('debrief');
  });

  test('next character walks the teaching order and wraps', () => {
    const tutor = new StrokeTutor();
    tutor.nextCharacter();
    expect(tutor.snapshot().character?.id).toBe(CHARACTERS[0].id);
    for (let i = 0; i < CHARACTERS.length; i += 1) tutor.nextCharacter();
    expect(tutor.snapshot().character?.id).toBe(CHARACTERS[0].id);
  });

  test('starting over puts the same character back at stroke one', () => {
    const tutor = started('juu');
    tutor.stroke(drawing(JUU, 0));
    tutor.nextStroke();
    tutor.startCharacter();
    const snapshot = tutor.snapshot();
    expect(snapshot.character?.id).toBe('juu');
    expect(snapshot.stroke_index).toBe(0);
    expect(snapshot.strokes[0].points).toEqual([]);
  });

  test('starting with no character at all starts the easiest one', () => {
    const tutor = new StrokeTutor();
    tutor.startCharacter();
    expect(tutor.snapshot().character?.id).toBe('ichi');
  });

  test('a character is found by its spoken and written names', () => {
    for (const [said, id] of [['tree', 'ki'], ['永', 'ei'], ['Latin A', 'latin_a'], ['capital-e', 'latin_e'], ['TEN', 'juu']]) {
      const tutor = new StrokeTutor();
      tutor.startCharacter(said);
      expect(tutor.snapshot().character?.id, said).toBe(id);
    }
  });
});
