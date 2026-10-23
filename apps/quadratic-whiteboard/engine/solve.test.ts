// The arithmetic, ported from the original `tests/test_solve.py`. Every test
// is named after a wrong thing a class would see.
import { describe, expect, test } from 'vitest';
import { parseQ, q } from './fraction.ts';
import { availableMethods, stepsFor } from './methods.ts';
import { Equation, factorPairs, fmt, integerFactorForm, rationalRoots, simplifySurd } from './solve.ts';

const eq = (a: string | number, b: string | number, c: string | number) => new Equation(parseQ(String(a)), parseQ(String(b)), parseQ(String(c)));

describe('roots', () => {
  test('rational roots are finished arithmetic, not "2 + 1"', () => {
    // `x = 2 + 1` is arithmetic left undone in front of a class.
    expect(eq(1, -4, 3).roots.texts()).toEqual(['3', '1']);
  });

  test('irrational roots stay as simplified surds', () => {
    // √12 must reach the board as 2√3, and the root as `2 + √3`.
    expect(eq(1, -4, 1).roots.texts()).toEqual(['2 + √3', '2 - √3']);
  });

  test('a repeated root is written once', () => {
    const roots = eq(1, -4, 4).roots;
    expect(roots.nature).toBe('one_repeated');
    expect(roots.texts()).toEqual(['2']);
  });

  test('complex roots are exact, not dropped', () => {
    expect(eq(1, 2, 5).roots.texts()).toEqual(['-1 + 2i', '-1 - 2i']);
  });

  test('complex roots keep their surd', () => {
    expect(eq(1, 1, 1).roots.texts()).toEqual(['-1/2 + (1/2)i√3', '-1/2 - (1/2)i√3']);
  });

  test('a complex root refuses to give a position on the x-axis', () => {
    // Plotting -b/2a for a complex root would draw crossings on a curve that has none.
    const root = eq(1, 2, 5).roots.values[0];
    expect(() => root.approx).toThrow();
  });

  test('fractional coefficients stay exact', () => {
    // A spoken 0.5 is one half, not the nearest binary float.
    expect(eq('0.5', 1, -4).roots.texts()).toEqual(['2', '-4']);
  });
});

describe('formatting', () => {
  test('a whole number never renders as a decimal', () => {
    expect(fmt(q(3))).toBe('3');
    expect(fmt(q(-1, 2))).toBe('-1/2');
  });

  test('surds are simplified before they are shown', () => {
    expect(simplifySurd(q(12))).toEqual([q(2), 3n]);
    expect(simplifySurd(q(9, 16))).toEqual([q(3, 4), 1n]);
    expect(simplifySurd(q(5, 2))).toEqual([q(1, 2), 10n]);
  });

  test('a fractional leading coefficient is bracketed', () => {
    // `1/2x²` reads as `1/(2x²)`.
    expect(eq('0.5', 1, -4).display).toBe('y = (1/2)x² + x - 4');
  });
});

describe('factoring', () => {
  test('factoring is offered only when it actually factors', () => {
    expect(availableMethods(eq(1, -4, 3))).toContain('factoring');
    expect(availableMethods(eq(1, -4, 1))).not.toContain('factoring');
    expect(availableMethods(eq(1, 2, 5))).not.toContain('factoring');
  });

  test('factor pairs multiply to ac and add to b', () => {
    const equation = eq(2, 1, -1);
    const [p, r] = factorPairs(equation)!;
    expect(p.mul(r).eq(equation.a.mul(equation.c))).toBe(true);
    expect(p.add(r).eq(equation.b)).toBe(true);
  });

  test('a fractional root becomes an integer bracket', () => {
    // `(x - 1/2)` is correct and no teacher writes it.
    expect(integerFactorForm(eq(2, 1, -1))).toBe('(2x - 1)(x + 1)');
  });

  test('a zero root is the factor x, not (x - 0)', () => {
    expect(integerFactorForm(eq(2, -8, 0))).toBe('2x(x - 4)');
  });

  test('a double root at zero is two factors of x, not "xx"', () => {
    // New in the port: the original wrote "xx = 0" for y = x² and "2xx" for y = 2x².
    expect(integerFactorForm(eq(1, 0, 0))).toBe('x·x');
    expect(integerFactorForm(eq(2, 0, 0))).toBe('2x·x');
    expect(integerFactorForm(eq(-1, 0, 0))).toBe('-x·x');
  });

  test('a quadratic that does not factor has no rational roots', () => {
    expect(rationalRoots(eq(1, -4, 1))).toBeNull();
  });
});

describe('derivations', () => {
  const COEFFICIENTS: [string | number, string | number, string | number][] = [
    [1, -4, 3], [1, -4, 1], [1, 2, 5], [2, 1, -1], [1, 0, -9], [1, -4, 4], [2, -8, 0], [-1, 2, 3], ['0.5', 1, -4],
  ];

  test.each(COEFFICIENTS)('no method ever writes the same line twice in a row (%s, %s, %s)', (a, b, c) => {
    // A repeated line reads as the board glitching, and happens whenever a coefficient is zero.
    const equation = eq(a, b, c);
    for (const method of availableMethods(equation)) {
      const lines = stepsFor(equation, method).map((step) => step.working);
      lines.slice(1).forEach((line, i) => expect(line, `${method}: ${lines.join(' | ')}`).not.toBe(lines[i]));
    }
  });

  test.each(COEFFICIENTS)('every method ends on the same answer (%s, %s, %s)', (a, b, c) => {
    // Three methods that disagree about the roots is the worst thing this board could do.
    const equation = eq(a, b, c);
    const endings = new Set(availableMethods(equation).map((method) => stepsFor(equation, method).at(-1)!.working));
    expect(endings.size).toBe(1);
  });

  test('a negative coefficient is bracketed before it is squared', () => {
    // `-2² = 4` reads as `-(2²) = -4`.
    const lines = stepsFor(eq(1, -4, 3), 'completing_square').map((s) => s.working);
    expect(lines).toContain('half of -4 is -2; (-2)² = 4');
  });

  test('completing the square names the vertex', () => {
    const lines = stepsFor(eq(1, -4, 3), 'completing_square').map((s) => s.working);
    expect(lines).toContain('vertex at (2, -1)');
  });

  test('the formula drops a denominator of one', () => {
    // `x = (4 ± √12) / 1` invites the class to ask what the 1 is for.
    const lines = stepsFor(eq('0.5', 1, -4), 'quadratic_formula').map((s) => s.working);
    expect(lines).toContain('x = -1 ± √9');
  });

  test('a negative denominator is bracketed', () => {
    const lines = stepsFor(eq(-1, 2, 3), 'quadratic_formula').map((s) => s.working);
    expect(lines).toContain('x = (-2 ± √16) / (-2)');
  });

  test('the square-root step is worked out, not left under the sign', () => {
    // `x + 1/4 = ±√(9/16)` stops one step short of the answer.
    const lines = stepsFor(eq(2, 1, -1), 'completing_square').map((s) => s.working);
    expect(lines).toContain('x + 1/4 = ±3/4');
  });

  test('a negative radicand is bracketed in the formula', () => {
    const lines = stepsFor(eq(1, 2, 5), 'quadratic_formula').map((s) => s.working);
    expect(lines).toContain('x = (-2 ± √(-16)) / 2');
  });

  test('every step says something and writes something', () => {
    for (const method of availableMethods(eq(1, -4, 3))) {
      for (const step of stepsFor(eq(1, -4, 3), method)) {
        expect(step.working.trim()).not.toBe('');
        expect(step.say.trim()).not.toBe('');
      }
    }
  });

  test('the vertex line never claims a reading that is false', () => {
    // Completing the square divides every term by `a` first, so the folded
    // line shows the vertex of the MONIC form. Its x is the original's; its y
    // is out by a factor of `a`. Telling a class to read the printed vertex
    // straight off that line is a step that does not hold whenever a != 1, and
    // a student who checks would be right and the board wrong.
    const say = stepsFor(eq(2, 4, -6), 'completing_square').find((s) => s.working.includes('vertex'))!.say;
    expect(say).not.toContain('straight off it');
    expect(say).toContain('multiply back by 2');

    const monic = stepsFor(eq(1, -4, 3), 'completing_square').find((s) => s.working.includes('vertex'))!.say;
    expect(monic, 'the honest reading must survive for a = 1').toContain('straight off');
  });

  test('a sweep of small quadratics: no repeated line, one answer, no "xx"', () => {
    // New in the port: the same properties over every a, b, c in -3..3 (a ≠ 0).
    for (let a = -3; a <= 3; a += 1) {
      if (!a) continue;
      for (let b = -3; b <= 3; b += 1) {
        for (let c = -3; c <= 3; c += 1) {
          const equation = eq(a, b, c);
          const endings = new Set<string>();
          for (const method of availableMethods(equation)) {
            const lines = stepsFor(equation, method).map((s) => s.working);
            lines.slice(1).forEach((line, i) => expect(line).not.toBe(lines[i]));
            expect(lines.join(' ')).not.toMatch(/xx/);
            endings.add(lines.at(-1)!);
          }
          expect(endings.size, `${a}, ${b}, ${c}`).toBe(1);
        }
      }
    }
  });
});
