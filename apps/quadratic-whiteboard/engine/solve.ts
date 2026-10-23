// Quadratic arithmetic: pure, exact, and the only source of a number in this app.
// Ported from the original `solve.py`.
//
// Two decisions run through the whole module:
//
// - Exact rationals, never floats. Coefficients arrive as `Q` (parsed from
//   text, so a spoken 0.5 is one half and not 0.5000000000000001), and every
//   root, vertex and discriminant stays exact. A teaching board that puts
//   "x = 0.9999999999999998" in front of a class has taught the class
//   something false about arithmetic.
// - Surds stay surds. An irrational root is rendered in exact form, not as a
//   decimal. √8 is simplified to 2√2 before it is shown, because "2√2" is the
//   answer a maths teacher wants on the board and "√8" is the one that gets
//   marked down.
//
// `Root` is the one representation everything else formats: every root of a
// real quadratic is `rational ± surd · √radicand`, optionally times i. Two of
// those cover the real cases and the complex ones alike, which is why there is
// no separate complex branch anywhere below.
import { Q, q } from './fraction.ts';

// ---------------------------------------------------------------- formatting

/** A rational as a teacher would write it: `3`, `-1/2`, never `3.0`. */
export const fmt = (value: Q): string => value.toString();

/**
 * One term of a polynomial, with the coefficient of 1 left implicit.
 * `1x²` is not how anybody writes it, and a board that does reads as
 * generated rather than taught.
 */
export function term(coefficient: Q, symbol: string): string {
  if (symbol === '') return fmt(coefficient);
  if (coefficient.eq(1)) return symbol;
  if (coefficient.eq(-1)) return `-${symbol}`;
  // `1/2x²` is ambiguous enough on a board that a class will read it as
  // `1/(2x²)`. The brackets are not decoration.
  if (!coefficient.isInteger()) return `(${fmt(coefficient)})${symbol}`;
  return `${fmt(coefficient)}${symbol}`;
}

/**
 * Terms joined with the signs a human writes: `x² - 4x + 3`. Zero terms are
 * dropped, except when everything is zero and something has to be written.
 */
export function join(parts: [Q, string][]): string {
  let out = '';
  for (const [coefficient, symbol] of parts) {
    if (coefficient.isZero()) continue;
    if (out === '') out = term(coefficient, symbol);
    else if (coefficient.gt(0)) out += ` + ${term(coefficient, symbol)}`;
    else out += ` - ${term(coefficient.neg(), symbol)}`;
  }
  return out || '0';
}

/**
 * `√radicand` as `coefficient · √remainder`, with `remainder` squarefree.
 *
 * Handles a rational radicand by rationalising first: √(n/d) = √(n·d) / d.
 * Returns `[1, 1]` for a perfect square of a rational, which is the test the
 * factoring method uses to decide whether it can work at all.
 */
export function simplifySurd(radicand: Q): [Q, bigint] {
  if (radicand.lt(0)) throw new RangeError('simplifySurd is for non-negative radicands');
  if (radicand.isZero()) return [q(0), 1n];
  const d = radicand.d;
  const inside = radicand.n * d; // √(n/d) == √(n·d)/d
  // Trial division to √inside. The coefficients on a teaching board are small
  // (the board refuses a discriminant big enough to make this slow), and a
  // general integer factoriser here would be a dependency bought for a loop
  // that runs in microseconds. Plain numbers while they are exact; BigInt past that.
  if (inside <= BigInt(Number.MAX_SAFE_INTEGER)) {
    let rest = Number(inside);
    let outside = 1;
    for (let factor = 2; factor * factor <= rest; factor += 1) {
      const square = factor * factor;
      while (rest % square === 0) {
        rest /= square;
        outside *= factor;
      }
    }
    return [new Q(BigInt(outside), d), BigInt(rest)];
  }
  let rest = inside;
  let outside = 1n;
  for (let factor = 2n; factor * factor <= rest; factor += 1n) {
    const square = factor * factor;
    while (rest % square === 0n) {
      rest /= square;
      outside *= factor;
    }
  }
  return [new Q(outside, d), rest];
}

/**
 * `rational ± surd·√radicand`, real or (with `imaginary`) complex. `sign` only
 * matters when there is a surd part; a pair of roots differs in nothing else.
 */
export class Root {
  constructor(
    readonly rational: Q,
    readonly surd: Q,
    readonly radicand: bigint,
    readonly sign: 1 | -1,
    readonly imaginary: boolean,
  ) {}

  get isRational(): boolean { return this.surd.isZero() && !this.imaginary; }

  /**
   * The decimal value, for plotting and for nothing else. Throws on a complex
   * root rather than returning its real part: a complex root has no place on
   * the x-axis, and quietly plotting -b/2a there would draw two crossings on a
   * curve that has none.
   */
  get approx(): number {
    if (this.imaginary) throw new RangeError('a complex root has no position on the x-axis');
    return this.rational.toNumber() + this.sign * this.surd.toNumber() * Math.sqrt(Number(this.radicand));
  }
}

/** The irrational part of a root: `2√3`, `√5`, `(1/2)i√7`, `3i`. */
export function fmtSurd(coefficient: Q, radicand: bigint, imaginary: boolean): string {
  const unit = imaginary ? 'i' : '';
  const body = radicand === 1n ? '' : `√${radicand}`;
  if (!unit && !body) return fmt(coefficient);
  let head: string;
  if (coefficient.eq(1)) head = '';
  else if (coefficient.eq(-1)) head = '-';
  else if (coefficient.isInteger()) head = fmt(coefficient);
  else head = `(${fmt(coefficient)})`; // so `1/2i√7` cannot be read as `1/(2i√7)`
  return `${head}${unit}${body}`;
}

/** One root, written out. */
export function fmtRoot(root: Root): string {
  if (root.isRational) return fmt(root.rational);
  const tail = fmtSurd(root.surd, root.radicand, root.imaginary);
  if (root.rational.isZero()) return root.sign > 0 ? tail : `-${tail}`;
  return `${fmt(root.rational)}${root.sign > 0 ? ' + ' : ' - '}${tail}`;
}

// ----------------------------------------------------------- the quadratic

export type Nature = 'two_rational' | 'one_repeated' | 'two_irrational' | 'two_complex';

/** Both roots and what kind they are. */
export class Roots {
  constructor(readonly nature: Nature, readonly values: [Root, Root]) {}

  get allRational(): boolean { return this.values.every((root) => root.isRational); }

  texts(): string[] {
    if (this.nature === 'one_repeated') return [fmtRoot(this.values[0])];
    return this.values.map(fmtRoot);
  }
}

/** `ax² + bx + c`, with `a` guaranteed non-zero by the caller. */
export class Equation {
  private cached: Roots | null = null;

  constructor(readonly a: Q, readonly b: Q, readonly c: Q) {}

  get display(): string { return `y = ${join([[this.a, 'x²'], [this.b, 'x'], [this.c, '']])}`; }
  get zeroForm(): string { return `${join([[this.a, 'x²'], [this.b, 'x'], [this.c, '']])} = 0`; }
  get discriminant(): Q { return this.b.mul(this.b).sub(this.a.mul(this.c).mul(4)); }

  get vertex(): [Q, Q] {
    const x = this.b.neg().div(this.a.mul(2));
    const y = this.c.sub(this.b.mul(this.b).div(this.a.mul(4)));
    return [x, y];
  }

  get roots(): Roots {
    this.cached ??= analyse(this);
    return this.cached;
  }
}

/**
 * Both roots, exactly, in the one `rational ± surd·√n` shape. The complex case
 * is not special-cased: √(-D) is √D with `imaginary` set, which is the whole
 * of the difference.
 */
export function analyse(equation: Equation): Roots {
  const { a, b } = equation;
  const discriminant = equation.discriminant;
  const rational = b.neg().div(a.mul(2));

  if (discriminant.isZero()) {
    const root = new Root(rational, q(0), 1n, 1, false);
    return new Roots('one_repeated', [root, root]);
  }

  const imaginary = discriminant.lt(0);
  const [coefficient, radicand] = simplifySurd(discriminant.abs());
  // |2a|, not 2a: a negative `a` would otherwise flip which root is "+", and
  // the pair is the same set either way, but the board reads better with the
  // larger root first when it can.
  const surd = coefficient.div(a.mul(2).abs());

  if (radicand === 1n && !imaginary) {
    // A perfect-square discriminant means the roots are plain rationals, so
    // the surd part is folded in here rather than left for the formatter.
    // Without this the board writes "x = 2 + 1": arithmetic left undone in
    // front of a class, and `rationalRoots` (hence factoring) would decide
    // this quadratic was irrational.
    return new Roots('two_rational', [
      new Root(rational.add(surd), q(0), 1n, 1, false),
      new Root(rational.sub(surd), q(0), 1n, -1, false),
    ]);
  }

  const plus = new Root(rational, surd, radicand, 1, imaginary);
  const minus = new Root(rational, surd, radicand, -1, imaginary);
  return new Roots(imaginary ? 'two_complex' : 'two_irrational', [plus, minus]);
}

/**
 * Both roots as plain rationals, or null if they are not rational. This is
 * exactly the question "does this factor over the rationals?", which is why
 * factoring asks it and nothing else does.
 */
export function rationalRoots(equation: Equation): [Q, Q] | null {
  const roots = equation.roots;
  if (!roots.allRational) return null;
  const [first, second] = roots.values;
  return [first.rational.add(first.surd.mul(first.sign)), second.rational.add(second.surd.mul(second.sign))];
}

/**
 * The two numbers of the AC method: they multiply to `ac` and add to `b`.
 * They are the roots of the same quadratic scaled by `a`, so they come out of
 * the root machinery rather than a search, and are null for exactly the
 * quadratics that do not factor.
 */
export function factorPairs(equation: Equation): [Q, Q] | null {
  const pair = rationalRoots(equation);
  if (!pair) return null;
  // roots r₁, r₂: a(r₁ + r₂) = -b and a²r₁r₂ = ac, so the pair is (-a·r₁, -a·r₂).
  return [equation.a.neg().mul(pair[0]), equation.a.neg().mul(pair[1])];
}

/**
 * The factorisation with integer coefficients inside the brackets.
 *
 * A root of 1/2 becomes `(2x - 1)`, not `(x - 1/2)`: the second is correct and
 * no teacher writes it. Any leftover constant is kept out front so the
 * identity still holds: `2x² + x - 1` is `(2x - 1)(x + 1)`, and `2x² - 8` is
 * `2(x - 2)(x + 2)`.
 */
export function integerFactorForm(equation: Equation): string {
  const pair = rationalRoots(equation);
  if (!pair) throw new RangeError('this quadratic does not factor over the rationals');
  // A root of zero is the factor `x`, not `(x - 0)`, and it goes first so the
  // line reads `2x(x - 4)` rather than `2(x - 4)x`.
  const bare: string[] = [];
  const brackets: string[] = [];
  let denominators = 1n;
  for (const root of pair) {
    denominators *= root.d;
    if (root.isZero()) bare.push(term(new Q(root.d), 'x'));
    else brackets.push(`(${join([[new Q(root.d), 'x'], [new Q(-root.n), '']])})`);
  }
  const leading = equation.a.div(new Q(denominators));
  // Two roots of zero (y = ax²) are the factors x and x. Written side by side
  // they would read "xx", so the product is spelled out.
  const body = bare.length === 2 ? 'x·x' : [...bare, ...brackets].join('');
  if (leading.eq(1)) return body;
  if (leading.eq(-1)) return `-${body}`;
  if (!leading.isInteger()) return `(${fmt(leading)})${body}`;
  return `${fmt(leading)}${body}`;
}

// The curve itself is NOT sampled here and sent to the page. y = ax² + bx + c
// is three numbers the page already has, and evaluating them per pixel gives a
// smooth curve at any size for nothing. That is rendering, not rules: the
// roots, vertex and discriminant the class reads off the picture are still
// computed here and only here.
