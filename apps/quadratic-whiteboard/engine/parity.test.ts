// The port against the original. `fixtures/python-engine.json` is the
// original Python engine's output (`Board.snapshot()` and every method's
// lines) for 24 quadratics, generated from `agent-py/src/quadratic_whiteboard`:
// the TypeScript engine must write the same board, word for word.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Board } from './board.ts';
import { parseQ } from './fraction.ts';
import { stepsFor } from './methods.ts';
import type { MethodId } from './types.ts';

interface Golden { abc: [string, string, string]; equation: Record<string, unknown>; facts: Record<string, unknown>; methods_available: string[]; steps: Record<string, [string, string][]> }
const golden: Golden[] = JSON.parse(readFileSync(new URL('./fixtures/python-engine.json', import.meta.url), 'utf8'));

const NUMERIC = new Set(['a', 'b', 'c', 'crossings', 'vertex', 'axis', 'view']);

test.each(golden.map((r) => [r.abc.join(', '), r] as const))('y = %s matches the original engine', (_, record) => {
  const board = new Board();
  const [a, b, c] = record.abc.map(parseQ);
  board.setEquation(a, b, c);
  const snapshot = board.snapshot();

  for (const [key, expected] of Object.entries({ ...record.equation, ...record.facts })) {
    const actual = (snapshot.equation as unknown as Record<string, unknown>)[key] ?? (snapshot.facts as unknown as Record<string, unknown>)[key];
    if (NUMERIC.has(key)) {
      const flat = (x: unknown): number[] => (typeof x === 'number' ? [x] : Array.isArray(x) ? x.flatMap(flat) : Object.values(x as object).flatMap(flat));
      const want = flat(expected);
      const got = flat(actual);
      expect(got.length, key).toBe(want.length);
      got.forEach((value, i) => expect(value, key).toBeCloseTo(want[i], 9));
    } else {
      expect(actual, key).toEqual(expected);
    }
  }
  expect(snapshot.methods_available).toEqual(record.methods_available);
  for (const [method, lines] of Object.entries(record.steps)) {
    expect(stepsFor(board.equation!, method as MethodId).map((s) => [s.working, s.say]), method).toEqual(lines);
  }
});
