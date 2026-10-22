import { describe, expect, test } from 'vitest';
import { q } from './fraction.ts';
import { actionsFrom, commandPrompt, interpret, isAdvanceRequest, isQuestion, methodIn, type Action } from './judge.ts';
import { normaliseMethod } from './methods.ts';

const kinds = (text: string) => interpret(text).actions.map((a) => a.kind);

describe('the bare "next" (ported from test_table.py)', () => {
  test.each([
    ['next', true], ['Next.', true], ['next line', true], ['go on', true], ['keep going', true], ['continue', true],
    // Questions about the lesson, not requests to reveal. Revealing a line the
    // teacher did not ask for, in front of a class, is the one mistake this app must not make.
    ["what's next after factoring?", false], ['go back', false], ['next, can you hide the graph', false], ['', false],
  ] as const)('%j -> %s', (text, expected) => {
    expect(isAdvanceRequest(text)).toBe(expected);
  });
});

describe('the method a teacher says (ported from test_table.py)', () => {
  test.each([
    ['factoring', 'factoring'], ["let's factorise this one", 'factoring'], ['by factors', 'factoring'],
    ['completing the square', 'completing_square'], ['complete the square please', 'completing_square'],
    ['use the quadratic formula', 'quadratic_formula'], ['just use the formula', 'quadratic_formula'],
    ['show me the graph', null], ['', null],
  ] as const)('%j -> %s', (spoken, expected) => {
    expect(normaliseMethod(spoken)).toBe(expected);
  });
});

describe('commands, as a teacher says them', () => {
  test.each([
    ['next please', 'next'], ['okay, next line please', 'next'], ['can you show the next line', 'next'],
    ["what's next?", 'next'], ['and then?', 'next'], ['one more line', 'next'],
    ['go back', 'back'], ['back a step', 'back'], ['undo that', 'back'], ['take that line down', 'back'],
    ['show it all', 'all'], ['just show them the answer', 'all'], ['reveal everything', 'all'], ['show the whole thing', 'all'],
    ['hide the graph', 'graph'], ['take the curve away', 'graph'], ['just the working', 'graph'], ['show the graph again', 'graph'],
    ["let's see the parabola", 'graph'],
    ['clear the board', 'clear'], ['wipe it', 'clear'], ['start fresh', 'clear'], ['rub that off', 'clear'],
    ['by factoring', 'method'], ['complete the square', 'method'], ['use the formula', 'method'], ['try the quadratic formula instead', 'method'],
  ] as const)('%j -> %s', (text, kind) => {
    expect(kinds(text)).toEqual([kind]);
  });

  test('hide and show are told apart', () => {
    expect(interpret('hide the graph').actions).toEqual([{ kind: 'graph', visible: false }]);
    expect(interpret('show the graph').actions).toEqual([{ kind: 'graph', visible: true }]);
  });

  test('changing method is a method choice, never a clear or a new equation', () => {
    // The original's persona had to forbid its model from clearing the board
    // and re-adding the equation to change method; here the rules decide.
    expect(interpret('actually factor it instead').actions).toEqual([{ kind: 'method', method: 'factoring' }]);
    expect(interpret('try the formula').actions).toEqual([{ kind: 'method', method: 'quadratic_formula' }]);
  });

  test('"x squared" is not completing the square', () => {
    // `normaliseMethod`'s bare "square" alias would read it so; the judge never asks it to.
    expect(methodIn('put up x squared minus nine')).toBeNull();
    expect(kinds('put up x squared minus nine')).toEqual(['equation']);
  });

  test('a named equation goes up, with a method when one is named with it', () => {
    const [equation, method] = interpret('complete the square on x squared plus 6x plus 5').actions as [Action & { kind: 'equation' }, Action];
    expect([equation.a, equation.b, equation.c].map(String)).toEqual(['1', '6', '5']);
    expect(method).toEqual({ kind: 'method', method: 'completing_square' });
  });
});

describe('what is not a board command', () => {
  test.each([
    "What's the discriminant?", 'which way does it open?', 'why does it not factor?', 'Is that the vertex?',
    "what's next after factoring?", 'hello there', 'thanks, that was great',
  ])('%j', (text) => {
    expect(interpret(text).actions).toEqual([]);
  });

  test('questions are questions; "what about …" is a request', () => {
    expect(isQuestion("what's the vertex?")).toBe(true);
    expect(isQuestion('what about x squared plus one')).toBe(false);
    expect(kinds('what about x squared plus one')).toEqual(['equation']);
  });

  test('an equation mentioned to the class is not put up by rules alone', () => {
    // "Notice the x squared term is positive" is teaching, not a request.
    const reading = interpret('notice the x squared term is positive');
    expect(reading.actions).toEqual([]);
    expect(reading.ask).toBe(true);
    expect(reading.attempt).toBe(false);
  });

  test('a question is asked of the model only when it names a board verb', () => {
    expect(interpret("what's the discriminant?").ask).toBe(false);
    expect(interpret('can we hide the curve for a sec?').ask || kinds('can we hide the curve for a sec?').length > 0).toBe(true);
  });

  test('maths the rules cannot read is an attempt, for the model or the teacher', () => {
    const reading = interpret('x squared five x plus six');
    expect(reading).toEqual({ actions: [], ask: true, attempt: true });
  });
});

describe("the model's half", () => {
  test('the prompt carries the board, never more than the board shows', () => {
    const prompt = commandPrompt('change c to five', { equation: 'y = x² - 4x + 3', method: 'Factoring', revealed: 2, total: 6 });
    expect(prompt).toContain('y = x² - 4x + 3');
    expect(prompt).toContain('2 of 6');
  });

  test('its answer is checked: exact coefficients, known actions, at most three', () => {
    expect(actionsFrom({ actions: [{ action: 'put_equation', a: '1/2', b: '-4', c: '0.5' }] }).actions).toEqual([{ kind: 'equation', a: q(1, 2), b: q(-4), c: q(1, 2) }]);
    expect(actionsFrom({ actions: [{ action: 'put_equation', a: 'one', b: '2', c: '3' }] })).toEqual({ actions: [], unreadable: true });
    expect(actionsFrom({ actions: [{ action: 'choose_method', method: 'completing_square' }, { action: 'next_line' }] }).actions).toEqual([
      { kind: 'method', method: 'completing_square' }, { kind: 'next' },
    ]);
    expect(actionsFrom({ actions: [{ action: 'launch_rockets' }] }).actions).toEqual([]);
    expect(actionsFrom(null).actions).toEqual([]);
    expect(actionsFrom({ actions: Array(5).fill({ action: 'next_line' }) }).actions).toHaveLength(3);
  });

  test('a missing b or c is zero', () => {
    expect(actionsFrom({ actions: [{ action: 'put_equation', a: '2', b: '', c: '5' }] }).actions).toEqual([{ kind: 'equation', a: q(2), b: q(0), c: q(5) }]);
  });
});
