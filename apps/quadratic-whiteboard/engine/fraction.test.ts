// The exact rationals the engine stands on (Python's `Fraction`, ported).
import { expect, test } from 'vitest';
import { Q, parseQ, q } from './fraction.ts';

test('text parses exactly, as Fraction(str(x)) does', () => {
  expect(String(parseQ('0.5'))).toBe('1/2');
  expect(String(parseQ('0.1'))).toBe('1/10');
  expect(String(parseQ('-2048.125'))).toBe('-16385/8');
  expect(String(parseQ('.25'))).toBe('1/4');
  expect(String(parseQ('3 / 4'))).toBe('3/4');
  expect(String(parseQ('-3/6'))).toBe('-1/2');
  expect(String(parseQ('1e3'))).toBe('1000');
  expect(String(parseQ('2.5e-1'))).toBe('1/4');
  expect(String(parseQ(' 7 '))).toBe('7');
});

test('what is not a number is refused, not guessed', () => {
  for (const text of ['one', '', '1/0', '1.2.3', 'x', '1e100000']) expect(() => parseQ(text), text).toThrow();
});

test('a float goes through its decimal text, so 0.1 is one tenth', () => {
  expect(String(Q.of(0.1))).toBe('1/10');
  expect(String(Q.of(111.5))).toBe('223/2');
});

test('arithmetic stays in lowest terms with a positive denominator', () => {
  const half = q(1, 2);
  expect(String(half.add(q(1, 3)))).toBe('5/6');
  expect(String(half.sub(1))).toBe('-1/2');
  expect(String(half.mul(q(-2, 3)))).toBe('-1/3');
  expect(String(half.div(q(-1, 4)))).toBe('-2');
  expect(String(new Q(4n, -6n))).toBe('-2/3');
  expect(() => half.div(0)).toThrow();
});

test('comparison and sign', () => {
  expect(q(1, 3).lt(q(1, 2))).toBe(true);
  expect(q(-1, 2).cmp(q(-1, 2))).toBe(0);
  expect(q(-5).sign).toBe(-1);
  expect(q(0).isZero()).toBe(true);
  expect(q(6, 3).isInteger()).toBe(true);
  expect(q(7, 2).toNumber()).toBe(3.5);
});
