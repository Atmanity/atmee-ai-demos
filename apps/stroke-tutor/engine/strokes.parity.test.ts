// The port's riskiest line: a geometry port that silently shifts a threshold
// grades a learner differently from the original and nobody notices.
// `strokes.parity.json` holds 120 drawings (traced, reversed, shifted,
// partial, scaled, scribbled, tapped) with the verdicts the ORIGINAL Python
// grader (strokes.py) gave them: for each verdict kind, the 12 closest calls
// to a threshold and 12 ordinary ones. During the port, 12,000 such random
// cases were compared and all agreed; these are kept as the guard.
import { expect, test } from 'vitest';
import { CHARACTERS_BY_ID } from './characters.ts';
import { clean, decimate, grade } from './strokes.ts';
import cases from './strokes.parity.json';

interface Case { c: string; i: number; p: [number, number][]; kind: string; ok: boolean; note: string }

test('every recorded drawing gets the verdict the original grader gave it', () => {
  const rows = cases as Case[];
  expect(rows.length).toBe(120);
  for (const row of rows) {
    const verdict = grade(CHARACTERS_BY_ID[row.c], row.i, decimate(clean(row.p)));
    expect({ kind: verdict.kind, ok: verdict.ok, note: verdict.note }, `${row.c} stroke ${row.i}: ${JSON.stringify(row.p)}`).toEqual({ kind: row.kind, ok: row.ok, note: row.note });
  }
});

test('the recorded set covers every verdict kind', () => {
  const kinds = new Set((cases as Case[]).map((row) => row.kind));
  expect([...kinds].sort()).toEqual(['direction', 'ok', 'order', 'shape', 'start']);
});
