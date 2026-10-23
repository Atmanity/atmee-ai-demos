// The three methods, as the lines a teacher writes on a board. Ported from the
// original `methods.py`.
//
// A method is a function from an `Equation` to a list of `Step`s, and a step
// is one line of working plus the one sentence the avatar is allowed to say
// about it. Why a `say` line per step rather than letting the avatar narrate
// freely: every number on this board is exact, and an avatar paraphrasing
// "x = 2 ± √3" as "about three point seven" in a lesson about surds is
// teaching the opposite of the lesson.
//
// Factoring is the only method that can decline. It declines for a real
// reason (the quadratic has no rational factorisation), and the reason is a
// sentence a teacher can act on, not an error.
import type { Q } from './fraction.ts';
import { Equation, factorPairs, fmt, fmtSurd, integerFactorForm, rationalRoots, simplifySurd, term, type Nature } from './solve.ts';
import type { MethodId } from './types.ts';

export const FACTORING = 'factoring';
export const COMPLETING_SQUARE = 'completing_square';
export const QUADRATIC_FORMULA = 'quadratic_formula';

export const METHODS: MethodId[] = [FACTORING, COMPLETING_SQUARE, QUADRATIC_FORMULA];

export const METHOD_LABELS: Record<MethodId, string> = {
  factoring: 'Factoring',
  completing_square: 'Completing the square',
  quadratic_formula: 'The quadratic formula',
};

/**
 * What a teacher might actually say, mapped onto the three ids. Matched
 * longest-first against the whole phrase, so "complete the square" wins over a
 * bare "square" and "formula" does not swallow "completing".
 */
const ALIASES: Record<string, MethodId> = {
  factoring: FACTORING,
  factorising: FACTORING,
  factorizing: FACTORING,
  factorise: FACTORING,
  factorize: FACTORING,
  factor: FACTORING,
  factors: FACTORING,
  factorisation: FACTORING,
  factorization: FACTORING,
  'completing the square': COMPLETING_SQUARE,
  'complete the square': COMPLETING_SQUARE,
  completing_square: COMPLETING_SQUARE,
  completing: COMPLETING_SQUARE,
  square: COMPLETING_SQUARE,
  'quadratic formula': QUADRATIC_FORMULA,
  quadratic_formula: QUADRATIC_FORMULA,
  'the formula': QUADRATIC_FORMULA,
  formula: QUADRATIC_FORMULA,
};
// Stable sort: equal lengths keep the table's order, as Python's `sorted` does.
const BY_LENGTH = Object.keys(ALIASES).sort((x, y) => y.length - x.length);

export const NOT_FACTORABLE = "This one doesn't factor over the rationals — completing the square or the formula will work.";

/** One line of the derivation: `working` goes on the board, `say` is what the avatar narrates. */
export interface Step { working: string; say: string }

/**
 * What goes to the left of a `²`. Bracketed when negative or fractional,
 * because `-2² = 4` reads as `-(2²) = -4` and `1/4² = 1/16` reads as `1/(4²)`.
 * Both are lines a class would be right to challenge.
 */
const squaredBase = (value: Q) => (value.lt(0) || !value.isInteger() ? `(${fmt(value)})` : fmt(value));

/** `√n` verbatim, bracketed when the inside would otherwise run on: `√(-16)`, `√(9/16)`. */
const radical = (value: Q) => (value.lt(0) || !value.isInteger() ? `√(${fmt(value)})` : `√${fmt(value)}`);

/**
 * `√value` worked out exactly: `3/4`, `2√3`, `(1/2)√10`. This is the
 * right-hand side after the square root has been taken, so it is simplified:
 * a board that writes `±√(9/16)` and stops has left the last step of the
 * arithmetic to the class as an accident rather than on purpose.
 */
function rootValue(value: Q): string {
  if (value.lt(0)) return radical(value);
  const [coefficient, radicand] = simplifySurd(value);
  return fmtSurd(coefficient, radicand, false);
}

/**
 * The formula with this quadratic's numbers in it. A denominator of 1 takes
 * the brackets with it: `x = (4 ± √12) / 1` is a line that invites the class to
 * ask what the 1 is for.
 */
function substituted(minusB: Q, discriminant: Q, twoA: Q): string {
  const numerator = `${fmt(minusB)} ± ${radical(discriminant)}`;
  if (twoA.eq(1)) return `x = ${numerator}`;
  const denominator = twoA.lt(0) ? `(${fmt(twoA)})` : fmt(twoA);
  return `x = (${numerator}) / ${denominator}`;
}

/**
 * ` + 3x` / ` - 3x`, or "" for a zero term. Every method builds lines by
 * concatenation, and getting the sign right at the joint, rather than at each
 * call site, is what keeps `x² + -4x` off the board.
 */
function signed(coefficient: Q, symbol: string): string {
  if (coefficient.isZero()) return '';
  if (coefficient.gt(0)) return ` + ${term(coefficient, symbol)}`;
  return ` - ${term(coefficient.neg(), symbol)}`;
}

const monicZeroForm = (p: Q, qq: Q) => `x²${signed(p, 'x')}${signed(qq, '')} = 0`;

/**
 * Add a line unless it repeats the one above it. The derivations legitimately
 * collapse: with no constant term "move the constant across" writes the line
 * it was given, and with no x term the perfect square is already written. Left
 * in, those show a class the same equation twice and read as the board
 * glitching. Deduping at the joint beats a special case in each method.
 */
function append(steps: Step[], step: Step): void {
  if (steps.length && steps[steps.length - 1].working === step.working) return;
  steps.push(step);
}

/**
 * A method id from whatever the teacher said, or null if it is not one.
 * Substring matching rather than equality: people say "let's do completing the
 * square", and requiring an exact id would turn a normal instruction into a
 * refusal. (Free speech goes through `judge.ts` first, which never hands a
 * bare "x squared" to this.)
 */
export function normaliseMethod(spoken: string | null | undefined): MethodId | null {
  const text = (spoken ?? '').trim().toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean).join(' ');
  if (!text) return null;
  if (text in ALIASES) return ALIASES[text];
  for (const alias of BY_LENGTH) if (text.includes(alias)) return ALIASES[alias];
  return null;
}

/**
 * The methods that will actually produce working for this quadratic. The
 * panel greys out what is missing and the avatar is told not to offer it,
 * which turns almost every would-be refusal into a thing never asked for.
 */
export function availableMethods(equation: Equation): MethodId[] {
  if (rationalRoots(equation) === null) return [COMPLETING_SQUARE, QUADRATIC_FORMULA];
  return [...METHODS];
}

/** The refusal sentence, or null if factoring is fine here. */
export const whyNotFactorable = (equation: Equation): string | null => (rationalRoots(equation) !== null ? null : NOT_FACTORABLE);

// ---------------------------------------------------------------- methods

/** The last step of every method: the answer, written the same way each time. */
function rootsLine(equation: Equation): Step {
  const roots = equation.roots;
  const texts = roots.texts();
  if (roots.nature === 'one_repeated') {
    return {
      working: `x = ${texts[0]} (repeated)`,
      say: `One repeated root at x equals ${texts[0]} — the parabola just touches the x-axis there.`,
    };
  }
  if (roots.nature === 'two_complex') {
    return {
      working: `x = ${texts[0]} or x = ${texts[1]}`,
      say: `Two complex roots, ${texts[0]} and ${texts[1]} — which is why the curve never crosses the x-axis.`,
    };
  }
  return {
    working: `x = ${texts[0]} or x = ${texts[1]}`,
    say: `So x is ${texts[0]} or ${texts[1]} — the two places the curve crosses the x-axis.`,
  };
}

/** The AC method, then the zero-product rule. */
export function factoringSteps(equation: Equation): Step[] {
  const pair = factorPairs(equation);
  if (!pair) throw new RangeError(NOT_FACTORABLE);
  const [first, second] = pair;
  const ac = equation.a.mul(equation.c);
  const factored = integerFactorForm(equation);
  return [
    { working: equation.zeroForm, say: 'Start by setting it equal to zero — factoring finds the values of x that make the whole thing vanish.' },
    { working: `need p·q = ${fmt(ac)} and p + q = ${fmt(equation.b)}`, say: `We want two numbers that multiply to ${fmt(ac)} and add to ${fmt(equation.b)}.` },
    { working: `p = ${fmt(first)}, q = ${fmt(second)}`, say: `Those two numbers are ${fmt(first)} and ${fmt(second)}.` },
    { working: `${factored} = 0`, say: `Which means the whole quadratic factors as ${factored}.` },
    { working: 'each factor = 0', say: 'A product is zero only when one of its factors is zero — so take each bracket in turn.' },
    rootsLine(equation),
  ];
}

/**
 * Move the constant, halve the middle, square it, take roots. Also the method
 * that explains the vertex, so it names it: the graph beside the working is
 * showing exactly the number the algebra just produced.
 */
export function completingSquareSteps(equation: Equation): Step[] {
  const { a, b, c } = equation;
  const steps: Step[] = [
    { working: equation.zeroForm, say: 'Completing the square works on any quadratic, and it shows you where the vertex comes from.' },
  ];

  // Work in the monic form; the whole method is defined on x² + px + q.
  const p = b.div(a);
  const qq = c.div(a);
  if (!a.eq(1)) {
    append(steps, { working: monicZeroForm(p, qq), say: `First divide every term by ${fmt(a)} so the x² stands alone.` });
  }

  const moved = qq.neg();
  append(steps, { working: `x²${signed(p, 'x')} = ${fmt(moved)}`, say: 'Move the constant across: the left is now just x² and the x term.' });

  const half = p.div(2);
  const square = half.mul(half);
  const right = moved.add(square);
  // With no x term there is nothing to complete: the square is already there.
  // Walking a class through "half of zero is zero" is the kind of filler that
  // makes a generated board feel generated.
  if (!half.isZero()) {
    append(steps, {
      working: `half of ${fmt(p)} is ${fmt(half)}; ${squaredBase(half)}² = ${fmt(square)}`,
      say: `Halve the coefficient of x — that's ${fmt(half)} — and square it to get ${fmt(square)}.`,
    });
    append(steps, {
      working: `x²${signed(p, 'x')}${signed(square, '')} = ${fmt(right)}`,
      say: `Add ${fmt(square)} to both sides. The left is now a perfect square.`,
    });
  }

  const bracket = half.isZero() ? 'x' : `(x${signed(half, '')})`;
  append(steps, { working: `${bracket}² = ${fmt(right)}`, say: `Which folds up into ${bracket} squared equals ${fmt(right)}.` });

  const [vertexX, vertexY] = equation.vertex;
  // The line above is the MONIC form: every term was divided by `a` at the
  // start, so what a class reads off `(x - h)² = k` is the vertex of that, not
  // of the original. The x is the same either way; the y is out by a factor of
  // `a`. Saying "read it straight off" when a ≠ 1 asserts a step that does not
  // hold, and a student who checks is right and the board is wrong, in the
  // one place this app promises it cannot be.
  const vertexSay = equation.a.eq(1)
    ? `Read the vertex straight off it: (${fmt(vertexX)}, ${fmt(vertexY)}) — the same point marked on the graph.`
    : `The x of the vertex reads straight off: ${fmt(vertexX)}. For the y, undo the divide — multiply back by ${fmt(equation.a)} — which gives (${fmt(vertexX)}, ${fmt(vertexY)}), the point marked on the graph.`;
  append(steps, { working: `vertex at (${fmt(vertexX)}, ${fmt(vertexY)})`, say: vertexSay });

  if (right.lt(0)) {
    append(steps, {
      working: `${bracket}² = ${fmt(right)}, and no square is negative`,
      say: 'A square can never be negative, so there is no real solution — the curve stays clear of the x-axis.',
    });
  } else {
    // The bracket without its brackets: `(x - 2)² = 1` square-roots to
    // `x - 2 = ±1`, and the parentheses have done their job by then.
    const unwrapped = half.isZero() ? 'x' : `x${signed(half, '')}`;
    append(steps, {
      working: right.isZero() ? `${unwrapped} = 0` : `${unwrapped} = ±${rootValue(right)}`,
      say: right.isZero() ? 'Take the square root of both sides.' : 'Take the square root of both sides, and remember the plus-or-minus.',
    });
  }
  append(steps, rootsLine(equation));
  return steps;
}

/** Substitute, discriminate, divide. The method that never declines. */
export function quadraticFormulaSteps(equation: Equation): Step[] {
  const { a, b, c } = equation;
  const discriminant = equation.discriminant;
  const nature = equation.roots.nature;
  return [
    { working: 'x = (-b ± √(b² - 4ac)) / 2a', say: 'The formula works on every quadratic, so it is the one to fall back on.' },
    { working: `a = ${fmt(a)}, b = ${fmt(b)}, c = ${fmt(c)}`, say: `Read off the coefficients: a is ${fmt(a)}, b is ${fmt(b)}, c is ${fmt(c)}.` },
    { working: `Δ = ${squaredBase(b)}² - 4(${fmt(a)})(${fmt(c)}) = ${fmt(discriminant)}`, say: `The discriminant comes out at ${fmt(discriminant)}.` },
    { working: discriminantReading(discriminant, nature), say: discriminantSay(discriminant, nature) },
    { working: substituted(b.neg(), discriminant, a.mul(2)), say: 'Substitute everything into the formula.' },
    rootsLine(equation),
  ];
}

function discriminantReading(discriminant: Q, nature: Nature): string {
  if (discriminant.lt(0)) return `Δ = ${fmt(discriminant)} < 0 → no real roots`;
  if (discriminant.isZero()) return 'Δ = 0 → one repeated root';
  if (nature === 'two_rational') return `Δ = ${fmt(discriminant)} > 0 and a perfect square → two rational roots`;
  return `Δ = ${fmt(discriminant)} > 0 → two irrational roots`;
}

function discriminantSay(discriminant: Q, nature: Nature): string {
  if (discriminant.lt(0)) return 'A negative discriminant means no real roots at all — the parabola misses the x-axis.';
  if (discriminant.isZero()) return 'A discriminant of zero means the two roots have collapsed into one.';
  if (nature === 'two_rational') return 'It is positive and a perfect square, which is the tell that this one would have factored.';
  return 'Positive but not a perfect square, so the roots are real and irrational — they stay as surds.';
}

const BUILDERS: Record<MethodId, (equation: Equation) => Step[]> = {
  factoring: factoringSteps,
  completing_square: completingSquareSteps,
  quadratic_formula: quadraticFormulaSteps,
};

/** The working for one method. The caller has already validated `method`. */
export function stepsFor(equation: Equation, method: MethodId): Step[] {
  const builder = BUILDERS[method];
  if (!builder) throw new RangeError(`unknown method ${JSON.stringify(method)}`);
  return builder(equation);
}
