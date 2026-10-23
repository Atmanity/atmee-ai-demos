// Exact rationals over BigInt: the TypeScript stand-in for Python's `Fraction`.
//
// The original engine leaned on `fractions.Fraction` for one property: no
// number on the board is ever a float. A coefficient arrives as text and is
// parsed exactly ("0.5" is one half, not the binary float nearest to it), and
// every root, vertex and discriminant is computed from those exact values.
// JavaScript numbers cannot do that, so this is the small piece of Fraction
// the solver needs: arithmetic, comparison, and parsing a string exactly.

const gcd = (a: bigint, b: bigint): bigint => {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
};

export type Qish = Q | bigint | number;

/** An exact rational `n/d`, always in lowest terms with `d > 0`. */
export class Q {
  readonly n: bigint;
  readonly d: bigint;

  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new RangeError('a fraction cannot have a zero denominator');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    this.n = g > 1n ? n / g : n;
    this.d = g > 1n ? d / g : d;
  }

  static of(value: Qish): Q {
    if (value instanceof Q) return value;
    if (typeof value === 'bigint') return new Q(value);
    if (Number.isInteger(value)) return new Q(BigInt(value));
    // Via its shortest decimal text, as Python's `Fraction(str(x))`: 0.1 is 1/10.
    return parseQ(String(value));
  }

  add(other: Qish): Q { const o = Q.of(other); return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(other: Qish): Q { const o = Q.of(other); return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(other: Qish): Q { const o = Q.of(other); return new Q(this.n * o.n, this.d * o.d); }
  div(other: Qish): Q {
    const o = Q.of(other);
    if (o.n === 0n) throw new RangeError('division by zero');
    return new Q(this.n * o.d, this.d * o.n);
  }
  neg(): Q { return new Q(-this.n, this.d); }
  abs(): Q { return this.n < 0n ? this.neg() : this; }

  /** -1, 0 or 1. */
  cmp(other: Qish): number {
    const o = Q.of(other);
    const left = this.n * o.d;
    const right = o.n * this.d;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  eq(other: Qish): boolean { return this.cmp(other) === 0; }
  lt(other: Qish): boolean { return this.cmp(other) < 0; }
  gt(other: Qish): boolean { return this.cmp(other) > 0; }

  get sign(): -1 | 0 | 1 { return this.n < 0n ? -1 : this.n > 0n ? 1 : 0; }
  isZero(): boolean { return this.n === 0n; }
  isInteger(): boolean { return this.d === 1n; }

  /** The nearest float: for pixels only, never for a fact on the board. */
  toNumber(): number { return Number(this.n) / Number(this.d); }

  /** `3`, `-1/2`: never `3.0`. */
  toString(): string { return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`; }
}

export const q = (n: Qish, d: Qish = 1): Q => Q.of(n).div(d);

const FRACTION = /^([+-]?)(\d+)\s*\/\s*(\d+)$/;
const DECIMAL = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i;
// An exponent bigger than this is not a coefficient anyone says aloud, and
// 10^1000000 as a BigInt is a million digits of work for nothing.
const MAX_EXPONENT = 400;

/**
 * A rational from text, exactly: "3", "-4", "0.5", ".25", "1/2", "-3 / 4",
 * "1e3", "2.5e-1". Throws on anything else, as `Fraction("one")` does.
 */
export function parseQ(text: string): Q {
  const t = text.trim();
  const fraction = FRACTION.exec(t);
  if (fraction) {
    const value = new Q(BigInt(fraction[2]), BigInt(fraction[3]));
    return fraction[1] === '-' ? value.neg() : value;
  }
  const decimal = DECIMAL.exec(t);
  if (!decimal) throw new SyntaxError(`not a number: ${JSON.stringify(text)}`);
  const [, sign, whole = '', frac = '', bare = '', exp = '0'] = decimal;
  const digits = bare ? bare : frac;
  const exponent = Number(exp);
  if (Math.abs(exponent) > MAX_EXPONENT) throw new RangeError(`exponent out of range: ${exp}`);
  let n = BigInt((bare ? '0' : whole || '0') + digits);
  let d = 10n ** BigInt(digits.length);
  if (exponent > 0) n *= 10n ** BigInt(exponent);
  if (exponent < 0) d *= 10n ** BigInt(-exponent);
  const value = new Q(n, d);
  return sign === '-' ? value.neg() : value;
}
