// Spoken and typed maths into exact coefficients, by rules. The phrasings are
// the ones a teacher says and a recogniser writes ("X squared minus 5X plus 6.").
import { describe, expect, test } from 'vitest';
import { findQuadratic, numberAt, soundsLikeAnEquation, tokens } from './spoken.ts';

const read = (text: string) => {
  const found = findQuadratic(text);
  return found && found !== 'unreadable' ? [found.a, found.b, found.c].map(String) : found;
};

describe('equations, as said and as typed', () => {
  test.each([
    ['put up x squared minus five x plus six', ['1', '-5', '6']],
    ['X squared minus 5X plus 6.', ['1', '-5', '6']],
    ['x^2 - 5x + 6', ['1', '-5', '6']],
    ['x² − 4x + 3 = 0', ['1', '-4', '3']],
    ['2x2 + 3x - 1', ['2', '3', '-1']],
    ['y = 2x^2+3x-1', ['2', '3', '-1']],
    ['f(x) = x^2 - 1', ['1', '0', '-1']],
    ['y equals x squared minus nine', ['1', '0', '-9']],
    ['two x squared plus x minus one', ['2', '1', '-1']],
    ['negative x squared plus two x plus three', ['-1', '2', '3']],
    ['-x^2 + 4', ['-1', '0', '4']],
    ["let's do two x squared plus five", ['2', '0', '5']],
    ['x squared', ['1', '0', '0']],
    ['x squared minus x', ['1', '-1', '0']],
    ['x squared, minus five x, plus six.', ['1', '-5', '6']],
    ['x to the power of two minus 1', ['1', '0', '-1']],
    ['three times x squared plus 2', ['3', '0', '2']],
    ['x times x minus four', ['1', '0', '-4']],
    ['x squared take away four', ['1', '0', '-4']],
  ] as const)('%j', (text, expected) => {
    expect(read(text)).toEqual(expected);
  });
});

describe('numbers, exactly', () => {
  test.each([
    ['half x squared plus x minus four', ['1/2', '1', '-4']],
    ['one half x squared plus x minus 4', ['1/2', '1', '-4']],
    ['0.5x squared + x - 4', ['1/2', '1', '-4']],
    ['zero point five x squared plus x minus four', ['1/2', '1', '-4']],
    ['two point five x squared minus x', ['5/2', '-1', '0']],
    ['three quarters x squared minus one and a half', ['3/4', '0', '-3/2']],
    ['x squared plus a third x', ['1', '1/3', '0']],
    ['1/2x^2 + 3/4x - 2', ['1/2', '3/4', '-2']],
    ['x^2/2 + x', ['1/2', '1', '0']],
    ['x squared minus one over three', ['1', '0', '-1/3']],
    ['x squared minus one hundred x plus two thousand four hundred', ['1', '-100', '2400']],
    ['x squared minus one hundred and twenty', ['1', '0', '-120']],
    ['x squared plus twenty four x', ['1', '24', '0']],
    ['x squared minus 2,400', ['1', '0', '-2400']],
    ['-7x^2 + 111.5x - 2048.125', ['-7', '223/2', '-16385/8']],
  ] as const)('%j', (text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  test('a number is never negative on its own: signs belong to the expression', () => {
    expect(numberAt(tokens('minus four'), 0)).toBeNull();
    expect(String(numberAt(tokens('four'), 0)![0])).toBe('4');
  });

  test('"and" joins only after hundred or thousand', () => {
    // "four and two" is not six.
    expect(String(numberAt(tokens('four and two'), 0)![0])).toBe('4');
    expect(String(numberAt(tokens('one hundred and two'), 0)![0])).toBe('102');
  });
});

describe('both sides of an equals', () => {
  test.each([
    ['x squared equals five x minus six', ['1', '-5', '6']],
    ['x squared is equal to 9', ['1', '0', '-9']],
    ['2x^2 = 3 - x', ['2', '1', '-3']],
    ['x squared equals to 4', ['1', '0', '-4']],
  ] as const)('%j', (text, expected) => {
    expect(read(text)).toEqual(expected);
  });
});

describe('recogniser slips', () => {
  test('"for x" after an operator is four x', () => {
    expect(read('x squared minus for x plus three')).toEqual(['1', '-4', '3']);
  });

  test('"to" is two only after an operator: "change it to x squared" is not 2x²', () => {
    expect(read('change it to x squared minus nine')).toEqual(['1', '0', '-9']);
    expect(read('x squared minus to x plus one')).toEqual(['1', '-2', '1']);
  });

  test('"ex" is x', () => {
    expect(read('ex squared plus three ex')).toEqual(['1', '3', '0']);
  });

  test('a number before a pause is not a coefficient: "next two: x squared plus 1"', () => {
    expect(read('next two: x squared plus 1')).toEqual(['1', '0', '1']);
  });
});

describe('what the rules refuse rather than guess', () => {
  test.each([
    'x squared five x plus six', // a lost operator: reading only "x squared" would put up the wrong equation
    'x squared plus', // cut off
    'x cubed plus 1', // not a quadratic
    'x to the third minus x',
    '(x - 2)(x + 3)', // a product: the model expands it
    'x(x - 4)',
  ])('%j is unreadable', (text) => {
    expect(findQuadratic(text)).toBe('unreadable');
  });

  test.each(['go back one step', 'show me line two', 'hide the x-axis', 'solve for x', 'the x axis', 'next one'])('%j has no equation', (text) => {
    expect(findQuadratic(text)).toBeNull();
  });

  test('a linear expression of two terms is read, for the board to refuse out loud', () => {
    expect(read('put up 2x plus 3')).toEqual(['0', '2', '3']);
  });

  test('the words around it are kept for the judge', () => {
    const found = findQuadratic('put up x squared minus 4x plus 3 by factoring');
    expect(found && found !== 'unreadable' && found.rest).toBe('put up by factoring');
  });

  test('what sounds like an equation', () => {
    expect(soundsLikeAnEquation('x squared minus five')).toBe(true);
    expect(soundsLikeAnEquation('x² - 1')).toBe(true);
    expect(soundsLikeAnEquation('x to the third')).toBe(true);
    expect(soundsLikeAnEquation('next line')).toBe(false);
  });
});
