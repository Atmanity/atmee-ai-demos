import { describe, expect, test } from 'vitest';
import { q } from './fraction.ts';
import { equationFrom, equationPrompt, interpret, isAdvanceRequest, isQuestion, methodIn, mustDo, type Action } from './judge.ts';
import { normaliseMethod } from './methods.ts';

const kinds = (text: string) => interpret(text).map((a) => a.kind);

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
    expect(interpret('hide the graph')).toEqual([{ kind: 'graph', visible: false }]);
    expect(interpret('show the graph')).toEqual([{ kind: 'graph', visible: true }]);
  });

  test('changing method is a method choice, never a clear or a new equation', () => {
    // The original's persona had to forbid its model from clearing the board
    // and re-adding the equation to change method; here the rules decide.
    expect(interpret('actually factor it instead')).toEqual([{ kind: 'method', method: 'factoring' }]);
    expect(interpret('try the formula')).toEqual([{ kind: 'method', method: 'quadratic_formula' }]);
  });

  test('"x squared" is not completing the square', () => {
    // `normaliseMethod`'s bare "square" alias would read it so; the judge never asks it to.
    expect(methodIn('put up x squared minus nine')).toBeNull();
    expect(kinds('put up x squared minus nine')).toEqual(['equation']);
  });

  test('a named equation goes up, with a method when one is named with it', () => {
    const [equation, method] = interpret('complete the square on x squared plus 6x plus 5') as [Action & { kind: 'equation' }, Action];
    expect([equation.a, equation.b, equation.c].map(String)).toEqual(['1', '6', '5']);
    expect(method).toEqual({ kind: 'method', method: 'completing_square' });
  });
});

describe('what is not a board command', () => {
  test.each([
    "What's the discriminant?", 'which way does it open?', 'why does it not factor?', 'Is that the vertex?',
    "what's next after factoring?", 'hello there', 'thanks, that was great',
  ])('%j', (text) => {
    expect(interpret(text)).toEqual([]);
  });

  test('questions are questions; "what about …" is a request', () => {
    expect(isQuestion("what's the vertex?")).toBe(true);
    expect(isQuestion('what about x squared plus one')).toBe(false);
    expect(kinds('what about x squared plus one')).toEqual(['equation']);
  });

  test('an equation mentioned to the class is not put up by rules alone', () => {
    // "Notice the x squared term is positive" is teaching, not a request.
    expect(interpret('notice the x squared term is positive')).toEqual([]);
  });

  test('maths the rules cannot read is no action', () => {
    expect(interpret('x squared five x plus six')).toEqual([]);
  });
});

describe('the safety net: only what is safe to do twice', () => {
  test.each([
    ['Hide the graph.', 'hide_graph'], ['just the working', 'hide_graph'], ['can you show the graph again', 'show_graph'],
    ['Clear the board.', 'clear_board'], ['wipe it', 'clear_board'], ['start fresh', 'clear_board'],
    ['Show it all.', 'show_all_working'], ['just show them the answer', 'show_all_working'],
    ['By factoring.', 'choose_method'], ['complete the square please', 'choose_method'], ["let's use the quadratic formula", 'choose_method'],
    ['try the formula instead', 'choose_method'],
    ['Put up x squared minus four x plus three.', 'put_up_equation'], ['x^2 - 5x + 6', 'put_up_equation'],
  ] as const)('%j -> %s', (text, name) => {
    expect(mustDo(text)?.name).toBe(name);
  });

  test.each([
    // A second one would move the board twice in front of the class.
    'next', 'Next line, please.', 'go on', 'and then?', 'go back', 'undo that',
    // Questions and talk to the class are the host's to answer.
    "What's the discriminant?", 'why does it not factor?', 'notice this one would not factor', 'notice the x squared term is positive',
    // Words that might mean something else.
    'everything', 'start again', 'start over', 'actually factor it instead', 'hello there', '',
  ])('%j -> nothing', (text) => {
    expect(mustDo(text)).toBeNull();
  });

  test('it passes the teacher\'s words, and a method named with the equation', () => {
    expect(mustDo('put up x squared minus five x plus six and factor it')).toEqual({
      name: 'put_up_equation', arguments: { equation: 'put up x squared minus five x plus six and factor it', method: 'factoring' },
    });
    expect(mustDo('use the formula')).toEqual({ name: 'choose_method', arguments: { method: 'quadratic_formula' } });
  });
});

describe("the model's half (reading an equation)", () => {
  test('the prompt carries what was said and the board, never more than the board shows', () => {
    const prompt = equationPrompt('change c to five', { equation: 'y = x² - 4x + 3', method: 'Factoring', revealed: 2, total: 6 });
    expect(prompt).toContain('"change c to five"');
    expect(prompt).toContain('y = x² - 4x + 3');
    expect(prompt).toContain('2 of 6');
    expect(prompt).toContain('give the whole new equation');
  });

  test('its answer is checked: exact coefficients or nothing', () => {
    expect(equationFrom({ readable: true, a: '1/2', b: '-4', c: '0.5' })).toEqual({ a: q(1, 2), b: q(-4), c: q(1, 2) });
    expect(equationFrom({ readable: true, a: 'one', b: '2', c: '3' })).toBeNull();
    expect(equationFrom({ readable: false, a: '1', b: '2', c: '3' })).toBeNull();
    expect(equationFrom(null)).toBeNull();
    expect(equationFrom('x squared')).toBeNull();
  });

  test('a missing b or c is zero', () => {
    expect(equationFrom({ readable: true, a: '2', b: '', c: '5' })).toEqual({ a: q(2), b: q(0), c: q(5) });
    expect(equationFrom({ readable: true, a: '1' })).toEqual({ a: q(1), b: q(0), c: q(0) });
  });
});
