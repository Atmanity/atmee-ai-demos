// The lesson notes hold what the class saw, and nothing it did not.
import { describe, expect, test } from 'vitest';
import { Table } from '../engine/table.ts';
import { maths, notesFileName, notesText, record, type NoteEntry } from './notes.ts';

/** The board after these tool calls, and the notes recorded from each view along the way. */
async function lesson(calls: [string, Record<string, unknown>][]) {
  const table = new Table();
  let notes: NoteEntry[] = [];
  for (const [name, args] of calls) {
    await table.tool(name, args);
    notes = record(notes, table.view());
  }
  return { notes, table };
}

describe('record', () => {
  test('an equation is noted with its facts, and only the lines that went up', async () => {
    const { notes, table } = await lesson([
      ['put_up_equation', { equation: 'x^2 - 4x + 3' }],
      ['choose_method', { method: 'factoring' }],
      ['next_line', {}],
      ['next_line', {}],
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0].equation).toBe('y = x² - 4x + 3');
    expect(notes[0].facts).toContain('vertex (2, -1)');
    expect(notes[0].worked).toEqual([{ method: 'factoring', label: 'Factoring', lines: table.board.derivation().slice(0, 2).map((s) => s.working), total: 6 }]);
    expect(notes[0].answer).toBeNull();
    for (const later of table.board.derivation().slice(2)) expect(JSON.stringify(notes)).not.toContain(later.working);
  });

  test('going back does not unsee a line; the answer is noted once a method reaches it', async () => {
    const { notes } = await lesson([
      ['put_up_equation', { equation: 'x^2 - 4x + 1' }],
      ['choose_method', { method: 'quadratic_formula' }],
      ['next_line', {}],
      ['next_line', {}],
      ['previous_line', {}],
      ['show_all_working', {}],
    ]);
    expect(notes[0].worked[0].lines).toHaveLength(6);
    expect(notes[0].answer).toBe('x = 2 + √3 or x = 2 - √3');
  });

  test('every equation and every method gets its own entry, in the order of the lesson', async () => {
    const { notes } = await lesson([
      ['put_up_equation', { equation: 'x^2 - 5x + 6', method: 'factoring' }],
      ['next_line', {}],
      ['choose_method', { method: 'completing_square' }],
      ['next_line', {}],
      ['put_up_equation', { equation: '2x^2 + 3x + 5' }],
      ['clear_board', {}],
    ]);
    expect(notes.map((n) => n.equation)).toEqual(['y = x² - 5x + 6', 'y = 2x² + 3x + 5']);
    expect(notes[0].worked.map((w) => w.method)).toEqual(['factoring', 'completing_square']);
    expect(notes[1].worked).toEqual([]);
  });

  test('a view that shows nothing new returns the same notes', async () => {
    const table = new Table();
    await table.enter('x^2 - 1');
    const once = record([], table.view());
    expect(record(once, table.view())).toBe(once);
    expect(record(once, new Table().view())).toBe(once);
  });
});

describe('the notes file', () => {
  test('reads as a lesson: equations, facts, answers and the working shown', async () => {
    const { notes } = await lesson([
      ['put_up_equation', { equation: 'x^2 - 4x + 3', method: 'factoring' }],
      ['show_all_working', {}],
      ['put_up_equation', { equation: 'x^2 - 4x + 1', method: 'quadratic_formula' }],
      ['next_line', {}],
      ['put_up_equation', { equation: 'x^2 + 1' }],
    ]);
    const text = notesText(notes, new Date(2026, 9, 23));
    expect(text).toMatch(/^Chalkline lesson notes, 23 October 2026\n/);
    expect(text).toContain('1. y = x² - 4x + 3');
    expect(text).toContain('Answer: x = 3 or x = 1');
    expect(text).toContain('    6  x = 3 or x = 1');
    expect(text).toContain('The quadratic formula (1 of 6 lines shown)');
    expect(text).toContain('3. y = x² + 1');
    expect(text).toContain('No working shown.');
    expect(notesFileName(new Date(2026, 9, 3))).toBe('chalkline-lesson-2026-10-03.txt');
  });
});

describe('maths on screen', () => {
  test.each([
    ['y = x² - 4x + 3', 'y = x² − 4x + 3'],
    ['(2, -1)', '(2, −1)'],
    ['x = (-b ± √(b² - 4ac)) / 2a', 'x = (−b ± √(b² − 4ac)) / 2a'],
    ['the x-axis', 'the x-axis'],
  ])('%j -> %j', (text, shown) => {
    expect(maths(text)).toBe(shown);
  });
});
