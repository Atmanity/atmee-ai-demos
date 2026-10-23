// The page's memory of how each stroke was earned: the two inks on the sheet
// and the summary at the end both read it.
import { describe, expect, test } from 'vitest';
import type { Snapshot } from '../engine/types.ts';
import { markKey, markLabel, nextMarks } from './marks.ts';

const done = (index: number) => ({ index, status: 'done' as const, points: [[100, 100], [900, 100]] as [number, number][], name: 'the stroke', teach: 'T' });
const live = (index: number) => ({ index, status: 'current' as const, points: [] });
const later = (index: number) => ({ index, status: 'hidden' as const, points: [] });

function snap(over: Partial<Snapshot>): Snapshot {
  return {
    phase: 'writing', character: { id: 'juu', glyph: '十', meaning: 'ten', reading: 'jū', script: 'kanji', strokes_total: 2 },
    stroke_index: 0, strokes: [live(0), later(1)], attempts: 0, last_verdict: null, score: { correct: 0, total: 1 }, results: [], take: 1, grid: 1000, catalog: [], ...over,
  };
}
const ink: [number, number][] = [[140, 452], [500, 450], [860, 449]];

describe('nextMarks', () => {
  test('a stroke drawn right keeps the learner\'s own ink and the try it took', () => {
    const marks = nextMarks({}, snap({ phase: 'coaching', strokes: [done(0), later(1)], attempts: 2, last_verdict: { ok: true, kind: 'ok', note: 'N' } }), ink);
    expect(marks[markKey('juu', 0)]).toEqual({ how: 'drawn', tries: 2, ink });
    expect(markLabel(marks[markKey('juu', 0)])).toBe('Right on try 2');
  });

  test('a shown stroke says whether they asked or missed twice', () => {
    const shown = { ok: false, kind: 'reveal', note: 'N', revealed: true } as const;
    const asked = nextMarks({}, snap({ phase: 'coaching', strokes: [done(0), later(1)], attempts: 1, last_verdict: shown }));
    expect(markLabel(asked[markKey('juu', 0)])).toBe('Shown when you asked');
    const rescued = nextMarks({}, snap({ phase: 'coaching', strokes: [done(0), later(1)], attempts: 2, last_verdict: shown }));
    expect(markLabel(rescued[markKey('juu', 0)])).toBe('Shown after two misses');
  });

  test('a miss records nothing: the stroke is not done', () => {
    expect(nextMarks({}, snap({ attempts: 1, last_verdict: { ok: false, kind: 'direction', note: 'N' } }), ink)).toEqual({});
  });

  test('marks survive moving on and finishing, and are forgotten by starting over or switching', () => {
    let marks = nextMarks({}, snap({ phase: 'coaching', strokes: [done(0), later(1)], attempts: 1, last_verdict: { ok: true, kind: 'ok', note: 'N' } }), ink);
    marks = nextMarks(marks, snap({ stroke_index: 1, strokes: [done(0), live(1)] }));
    expect(marks[markKey('juu', 0)]?.how).toBe('drawn');
    marks = nextMarks(marks, snap({ phase: 'debrief', stroke_index: 2, strokes: [done(0), done(1)] }));
    expect(Object.keys(marks)).toEqual([markKey('juu', 0)]);
    expect(nextMarks(marks, snap({}))).toEqual({});
    expect(nextMarks(marks, snap({ character: { id: 'ki', glyph: '木', meaning: 'tree', reading: 'ki', script: 'kanji', strokes_total: 4 }, strokes: [done(0), live(1)] }))).toEqual({});
    expect(nextMarks(marks, snap({ character: null, strokes: [] }))).toEqual({});
  });

  test('a stroke with no record still has a line in the summary', () => {
    expect(markLabel(undefined)).toBe('Done');
    expect(markLabel({ how: 'drawn', tries: 1 })).toBe('Right first try');
  });
});
