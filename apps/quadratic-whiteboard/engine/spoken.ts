// Spoken (or typed) maths into coefficients, by rules.
//
// The original handed "put up x squared minus four x plus three" to the
// model, which called `put_equation_on_board(a=1, b=-4, c=3)`. The Avatar API
// has no function calling, so the app reads the teacher's words itself: these
// rules first (instant, free, exact), and a model call on the server only for
// what they cannot read (`judge.ts`).
//
// What it reads: digits and number words ("4", "four", "twenty four", "one
// hundred and twenty", "two thousand four hundred"), decimals ("0.5", "point
// five", "two point five"), fractions ("1/2", "a half", "two thirds", "one
// over three"), signs ("minus", "negative", "plus", "take away"), powers
// ("x squared", "x²", "x^2", "x to the power of two"), "times", and an
// equals sign with terms on both sides ("x squared equals five x minus six").
// What it refuses rather than guesses: a cubic, a dangling operator, two
// expressions run together. A refused reading goes to the model.
import { Q, parseQ, q } from './fraction.ts';

export interface Quadratic { a: Q; b: Q; c: Q }

export interface Found extends Quadratic {
  /** How many terms were read: "x squared" is one, "2x + 3" two. */
  terms: number;
  /** The words around the expression ("put up …", "… by factoring"), for the judge. */
  rest: string;
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const DENOMINATORS: Record<string, number> = {
  half: 2, halves: 2, third: 3, thirds: 3, quarter: 4, quarters: 4, fourth: 4, fourths: 4, fifth: 5, fifths: 5,
  sixth: 6, sixths: 6, seventh: 7, sevenths: 7, eighth: 8, eighths: 8, ninth: 9, ninths: 9, tenth: 10, tenths: 10,
};
// Speech recognition's usual slips for a coefficient, trusted only right after
// an operator and right before x: "minus for x" is four x; "change it to x
// squared" is not two x squared.
const HOMOPHONES: Record<string, number> = { for: 4, to: 2, too: 2, won: 1 };
const X_WORDS = new Set(['x', 'ex', 'eks']);
const MINUS = new Set(['minus', 'negative', '-', 'subtract']);
const PLUS = new Set(['plus', '+', 'positive', 'add']);

const isDigits = (tok: string | undefined) => tok !== undefined && /^(\d+(\.\d+)?|\.\d+|\d+\/\d+)$/.test(tok);
const isWordNumber = (tok: string | undefined) => tok !== undefined && (tok in UNITS || tok in TENS);
const digitOf = (tok: string | undefined): string | null => {
  if (tok === undefined) return null;
  if (/^\d+$/.test(tok)) return tok;
  if (tok in UNITS && UNITS[tok] <= 9) return String(UNITS[tok]);
  if (tok === 'oh') return '0';
  return null;
};

/** The words of a line, with the maths symbols people type spelled the way they are said. */
export function tokens(text: string): string[] {
  const t = text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/²/g, ' squared ')
    .replace(/³/g, ' cubed ')
    .replace(/[−–]/g, '-')
    .replace(/—/g, ' ')
    .replace(/(\^|\*\*)\s*2(?![\d.])/g, ' squared ')
    .replace(/(\^|\*\*)\s*3(?![\d.])/g, ' cubed ')
    .replace(/(\^|\*\*)\s*1(?![\d.])/g, ' ')
    .replace(/(?<![a-z])x2(?![\d.])/g, 'x squared ')
    .replace(/[×·]/g, ' * ')
    .replace(/(\d),(?=\d{3}\b)/g, '$1');
  // Punctuation is kept as one mark, ",": it may sit between terms ("x squared,
  // minus five x") but never between a number and its x ("next two: x squared").
  return (t.match(/\d+\.\d+|\d+\s*\/\s*\d+|\.\d+|\d+|[a-z]+|[+\-=*/^()]|[,:;.!?]/g) ?? []).map((tok) => (/^[,:;.!?]$/.test(tok) ? ',' : tok.replace(/\s+/g, '')));
}

/** A whole number said in words, from `i`: "twenty four", "one hundred and twenty", "a thousand". */
function wholeWords(toks: string[], i: number): [number, number] | null {
  let total = 0;
  let current = 0;
  let j = i;
  let any = false;
  if (toks[j] === 'a' && (toks[j + 1] === 'hundred' || toks[j + 1] === 'thousand')) {
    current = 1;
    j += 1;
  }
  while (j < toks.length) {
    const tok = toks[j];
    if (tok in UNITS) current += UNITS[tok];
    else if (tok in TENS) current += TENS[tok];
    else if (tok === 'hundred') current = (current || 1) * 100;
    else if (tok === 'thousand') {
      total += (current || 1) * 1000;
      current = 0;
    } else if (tok === 'and' && (toks[j - 1] === 'hundred' || toks[j - 1] === 'thousand') && isWordNumber(toks[j + 1])) {
      // "one hundred and twenty"; not "four and two" or "one and a half"
    } else break;
    any = true;
    j += 1;
  }
  return any ? [total + current, j] : null;
}

/** A number from `i`, or null. Never negative: signs belong to the expression. */
export function numberAt(toks: string[], i: number): [Q, number] | null {
  let j = i;
  let value: Q;
  let decimal = false;
  const tok = toks[j];
  if (isDigits(tok)) {
    value = parseQ(tok);
    decimal = tok.includes('.');
    j += 1;
  } else if (isWordNumber(tok) || (tok === 'a' && (toks[j + 1] === 'hundred' || toks[j + 1] === 'thousand'))) {
    const whole = wholeWords(toks, j)!;
    value = q(whole[0]);
    j = whole[1];
  } else if (tok === 'a' && toks[j + 1] !== undefined && toks[j + 1] in DENOMINATORS) {
    value = q(1); // "a half", "a third"
    j += 1;
  } else if (tok === 'half') {
    return [q(1, 2), j + 1];
  } else if (tok === 'point' && digitOf(toks[j + 1]) !== null) {
    value = q(0);
  } else {
    return null;
  }

  // "two point five", "point two five", "2 point 5"
  if (toks[j] === 'point' && digitOf(toks[j + 1]) !== null && !decimal) {
    let digits = '';
    j += 1;
    while (digitOf(toks[j]) !== null) {
      digits += digitOf(toks[j]);
      j += 1;
    }
    value = value.add(parseQ(`0.${digits}`));
    decimal = true;
  }
  // "one and a half"
  if (toks[j] === 'and' && toks[j + 1] === 'a' && toks[j + 2] !== undefined && toks[j + 2] in DENOMINATORS) {
    value = value.add(q(1, DENOMINATORS[toks[j + 2]]));
    j += 3;
  } else if (!decimal && value.isInteger() && toks[j] !== undefined && toks[j] in DENOMINATORS) {
    // "two thirds", "one half", "a quarter"
    value = value.div(DENOMINATORS[toks[j]]);
    j += 1;
  }
  // "one over three", "3 / 4", "five divided by two"
  const over = toks[j] === 'over' || toks[j] === '/' ? 1 : toks[j] === 'divided' && toks[j + 1] === 'by' ? 2 : 0;
  if (over) {
    const below = numberAt(toks, j + over);
    if (below && !below[0].isZero()) {
      value = value.div(below[0]);
      j = below[1];
    }
  }
  return [value, j];
}

interface Term { coefficient: Q; power: 0 | 1 | 2; next: number }

/** One term from `i`: "3", "four x", "x squared", "two times x squared", "x² over 2". 'bad' for a power above 2. */
function termAt(toks: string[], i: number, afterOperator: boolean): Term | 'bad' | null {
  let j = i;
  let coefficient = q(1);
  let numbered = false;
  if (afterOperator && toks[j] in HOMOPHONES && X_WORDS.has(toks[j + 1])) {
    coefficient = q(HOMOPHONES[toks[j]]);
    j += 1;
    numbered = true;
  } else {
    const n = numberAt(toks, j);
    if (n) {
      [coefficient, j] = n;
      numbered = true;
    }
  }
  if (numbered && X_WORDS.has(toks[j + 1]) && (toks[j] === 'times' || toks[j] === '*')) j += 1;
  if (numbered && toks[j] === 'multiplied' && toks[j + 1] === 'by' && X_WORDS.has(toks[j + 2])) j += 2;

  if (!X_WORDS.has(toks[j])) return numbered ? { coefficient, power: 0, next: j } : null;
  j += 1;
  let power: 0 | 1 | 2 = 1;
  if (toks[j] === 'squared' || toks[j] === 'square') {
    power = 2;
    j += 1;
  } else if (toks[j] === 'cubed') {
    return 'bad';
  } else if (toks[j] === 'to' && toks[j + 1] === 'the') {
    let k = j + 2;
    if (toks[k] === 'power' && toks[k + 1] === 'of') k += 2;
    const p = toks[k];
    if (p === 'second' || p === 'two' || p === '2') power = 2;
    else if (p === 'first' || p === 'one' || p === '1') power = 1;
    else if (p !== undefined && (p in UNITS || /^\d+$/.test(p) || /^(third|fourth|fifth)$/.test(p))) return 'bad';
    else k = j - 1; // not a power after all
    j = k + 1;
    if (toks[j] === 'power') j += 1;
  } else if ((toks[j] === 'times' || toks[j] === '*') && X_WORDS.has(toks[j + 1])) {
    power = 2; // "x times x"
    j += 2;
  }
  // "x squared over two"
  if (toks[j] === 'over' || toks[j] === '/') {
    const below = numberAt(toks, j + 1);
    if (below && !below[0].isZero()) {
      coefficient = coefficient.div(below[0]);
      j = below[1];
    }
  }
  return { coefficient, power, next: j };
}

/** How many tokens an equals sign takes at `j` ("=", "equals", "is equal to"), or 0. */
function equalsAt(toks: string[], j: number): number {
  if (toks[j] === 'equals' && toks[j + 1] === 'to' && !X_WORDS.has(toks[j + 2])) return 2;
  if (toks[j] === '=' || toks[j] === 'equals') return 1;
  if (toks[j] === 'equal' && toks[j + 1] === 'to') return 2;
  if (toks[j] === 'equal') return 1;
  if (toks[j] === 'is' && toks[j + 1] === 'equal' && toks[j + 2] === 'to') return 3;
  return 0;
}

/** How many tokens a sign takes at `j`, and which way it points. */
function signAt(toks: string[], j: number): [number, -1 | 1] {
  if (MINUS.has(toks[j])) return [1, -1];
  if (toks[j] === 'take' && toks[j + 1] === 'away') return [2, -1];
  if (PLUS.has(toks[j])) return [1, 1];
  return [0, 1];
}

interface Parsed { coefficients: [Q, Q, Q]; terms: number; end: number }

/** An expression from `i`, terms on both sides of an equals moved to the left. */
function expressionAt(toks: string[], i: number): Parsed | 'bad' | null {
  const coefficients: [Q, Q, Q] = [q(0), q(0), q(0)]; // by power: c, b, a
  let side = 1;
  let terms = 0;
  let j = i;
  let expectTerm = false;
  const skip = (k: number) => {
    while (toks[k] === ',') k += 1;
    return k;
  };
  for (;;) {
    let sign = 1;
    let operator = false;
    for (;;) {
      const k = terms ? skip(j) : j;
      const [width, s] = signAt(toks, k);
      if (!width) break;
      sign *= s;
      j = k + width;
      operator = true;
    }
    if (operator || expectTerm) j = skip(j);
    const t = termAt(toks, j, operator || expectTerm);
    if (t === 'bad') return 'bad';
    if (!t) {
      // Brackets are products ("(x - 2)(x + 3)"): the model expands those.
      if (toks[j] === '(') return 'bad';
      // A sign or an equals with nothing after it: the line was cut off or misheard.
      if ((operator || expectTerm) && terms > 0) return 'bad';
      break;
    }
    coefficients[t.power] = coefficients[t.power].add(t.coefficient.mul(sign * side));
    terms += 1;
    const end = t.next;
    j = skip(end);
    expectTerm = false;
    if (signAt(toks, j)[0]) continue;
    const equals = equalsAt(toks, j);
    if (equals && side === 1) {
      side = -1;
      j += equals;
      expectTerm = true;
      continue;
    }
    j = end;
    break;
  }
  if (!terms) return null;
  // Maths straight after the expression ("x squared five x plus six") means a
  // word was lost; reading only the first part would put up the wrong equation.
  if (toks[j] === '(') return 'bad';
  const after = termAt(toks, j, false);
  if (after && after !== 'bad' && (after.power > 0 || isDigits(toks[j]))) return 'bad';
  return { coefficients, terms, end: j };
}

/** Where an expression could begin: a number, an x, or a sign before one. */
function canStart(toks: string[], i: number): boolean {
  const tok = toks[i];
  if (X_WORDS.has(tok) || isDigits(tok) || isWordNumber(tok) || tok === 'half' || tok === '(') return true;
  if (tok === 'a' && toks[i + 1] !== undefined && (toks[i + 1] in DENOMINATORS || toks[i + 1] === 'hundred' || toks[i + 1] === 'thousand')) return true;
  if (tok === 'point' && digitOf(toks[i + 1]) !== null) return true;
  if (MINUS.has(tok) && tok !== 'subtract') return canStart(toks, i + 1);
  return false;
}

/**
 * The quadratic in a line of speech or text, or null if there is none, or
 * 'unreadable' if there is maths in it these rules cannot read safely.
 *
 * Accepted: anything with an x² term ("x squared" alone is y = x²), and a
 * linear expression of two terms or more ("2x + 3"), which the board then
 * refuses out loud ("That's linear"). A lone "x" (as in "the x axis") is not
 * an equation.
 */
export function findQuadratic(text: string): Found | 'unreadable' | null {
  const toks = tokens(text);
  const maths = soundsLikeAnEquation(text) || toks.includes('(');
  for (let i = 0; i < toks.length; i += 1) {
    let start = i;
    // "y equals …", "y = …", "f of x equals …", "f(x) = …"
    if (toks[i] === 'y' && equalsAt(toks, i + 1)) start = i + 1 + equalsAt(toks, i + 1);
    else if (toks[i] === 'f' && toks[i + 1] === 'of' && X_WORDS.has(toks[i + 2]) && equalsAt(toks, i + 3)) start = i + 3 + equalsAt(toks, i + 3);
    else if (toks[i] === 'f' && toks[i + 1] === '(' && X_WORDS.has(toks[i + 2]) && toks[i + 3] === ')' && equalsAt(toks, i + 4)) start = i + 4 + equalsAt(toks, i + 4);
    else if (!canStart(toks, i)) continue;
    const parsed = expressionAt(toks, start);
    // Maths the rules cannot read safely; but a stray "x-axis" is not maths.
    if (parsed === 'bad') {
      if (maths) return 'unreadable';
      continue;
    }
    if (!parsed) continue;
    const [c, b, a] = parsed.coefficients;
    if (!a.isZero() || (parsed.terms >= 2 && !b.isZero())) {
      return { a, b, c, terms: parsed.terms, rest: [...toks.slice(0, i), ...toks.slice(parsed.end)].filter((tok) => tok !== ',').join(' ') };
    }
    i = Math.max(i, parsed.end - 1);
  }
  return null;
}

/** Whether a line reads like an attempt at naming an equation (a power of x in it). */
export function soundsLikeAnEquation(text: string): boolean {
  const toks = tokens(text);
  return toks.some((tok, i) => (tok === 'squared' || tok === 'cubed') || (X_WORDS.has(tok) && toks[i + 1] === 'to' && toks[i + 2] === 'the'));
}
