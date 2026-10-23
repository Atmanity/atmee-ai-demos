// What words mean to the board, where the app still needs to know. The host
// decides what the teacher asked for and calls the board's tools; the app
// reads two things itself:
//
// - The equation the host passes to `put_up_equation`: rules first
//   (`spoken.ts`), and a model call on the server only for what they cannot
//   read (brackets, "change c to five", mishearings).
// - The safety net's phrases (`mustDo`): when the teacher clearly asks for an
//   action that is safe to do twice and the host does not call it, the page
//   does. Revealing or taking back a line is never one of them: a second
//   "next" would move the board two lines in front of a class.
import { parseQ, type Q } from './fraction.ts';
import type { ToolName } from './director.ts';
import { findQuadratic } from './spoken.ts';
import type { MethodId } from './types.ts';

export type Action =
  | { kind: 'equation'; a: Q; b: Q; c: Q }
  | { kind: 'method'; method: MethodId }
  | { kind: 'next' }
  | { kind: 'back' }
  | { kind: 'all' }
  | { kind: 'graph'; visible: boolean }
  | { kind: 'clear' };

// ------------------------------------------------- the bare "next" (ported)

/**
 * A turn that means "put the next line up", and nothing else. Matched WHOLE,
 * not by substring: "what's next after factoring?" is a question about method,
 * and revealing a line the teacher did not ask for, in front of a class, is
 * the one mistake this app must not make.
 */
export const ADVANCE_PHRASES: ReadonlySet<string> = new Set([
  'next', 'next line', 'next step', 'next one', 'go on', 'go ahead', 'carry on', 'keep going', 'continue',
  'and then', 'and then?', 'then what', 'show them', 'show it', 'ok next', 'okay next', 'right, next', 'go',
]);

/** Whether a user turn is a bare request for the next line. */
export function isAdvanceRequest(text: string | null | undefined): boolean {
  const cleaned = (text ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ').replace(/^[.!?,]+|[.!?,]+$/g, '');
  return ADVANCE_PHRASES.has(cleaned);
}

// -------------------------------------------------------- the other rules

const norm = (text: string) =>
  text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9'²^+\-=/. ]+/g, ' ').replace(/\s+/g, ' ').replace(/[ .]+$/, '').trim();

const PREFIX = /^(ok(ay)?|right|alright|all right|so|now|and|then|um+|uh+|er+|please|yes|yeah|great|good|cool|perfect|lovely|thanks|thank you|(can|could|would|will) you( please)?|let'?s|let us|go ahead and|just|i'?d like (you )?to|i want (you )?to)\b ?/;
const SUFFIX = / (please|for me|for us|thanks|thank you|now|then|again please)$/;

/** The imperative at the heart of a line: "okay, can you show the next line please" -> "show the next line". */
export function imperative(text: string): string {
  let t = norm(text);
  for (let before = ''; before !== t;) {
    before = t;
    t = t.replace(PREFIX, '').replace(SUFFIX, '').trim();
  }
  return t;
}

const QUESTION = /^(what|what's|whats|why|how|does|do|did|is|isn't|are|aren't|which|where|when|who|would it|will it|can it|could it|should|shouldn't)\b/;

/** A question for the host, not a request for the board ("what about …" and "how about …" are requests). */
export function isQuestion(text: string): boolean {
  const t = norm(text);
  return QUESTION.test(t) && !/^(what|how) about\b/.test(t);
}

const NEXT = /^(next( (line|step|one|bit))?|go on|carry on|keep going|continue|and then|then what|what'?s next|what comes next|(show|put up|reveal|write|give)( (me|us|them))?( the)? next( (line|step|one|bit))?( up)?|on to the next( (line|step|one))?|another (line|step)|one more( (line|step))?)$/;
const HIDE_GRAPH = /^((hide|remove|lose|drop|close|get rid of|turn off|switch off|take (away|off|down))( the)? (graph|curve|parabola|plot|picture)|(take|put) (the )?(graph|curve|parabola|plot) (away|off|down)|(just |only )?the (working|algebra)( only)?$|no (graph|curve))\b/;
const SHOW_GRAPH = /^((show|see|bring back|put back|turn on|switch on|display|draw)( me| us| them)?( the)? (graph|curve|parabola|plot|picture)|(bring|put) (the )?(graph|curve|parabola|plot) back)\b/;
const BACK = /^((go |step )?back( up)?( (a|one) (step|line))?|undo( that| it)?|take (that|it|this|the last)( (line|step))? (back|down|off)|previous( (line|step))?)$/;
// The verb-led half of "show it all": a bare "everything" is left to the host.
const ALL_ASKED = /^(show|reveal|put up|write( out)?|give)( (it|them|us|me))? (all|everything|all of it|the (whole|full|rest|lot)( (thing|working|derivation|solution|lot|of it))?|the answer|all the working)( up)?$/;
const ALL = new RegExp(`${ALL_ASKED.source}|^(the whole thing|all of it|everything)$`);
const CLEAR = /^((clear|wipe|erase|clean)( (it|that|everything|the board|the lot|it all))?( (off|out|clean))?|rub (it |that |everything |the board )?(out|off)|start (fresh|over|again)|clean slate|fresh board|new board)$/;

const METHOD_RULES: [MethodId, RegExp][] = [
  ['completing_square', /\bcomplet(e|ing)( the| a)? square\b/],
  ['quadratic_formula', /\b(quadratic )?formula\b/],
  ['factoring', /\bfactor(ing|ise|ize|ising|izing|isation|ization|s)?\b/],
];

/**
 * A method named in a request. Stricter than `normaliseMethod` (whose bare
 * "square" alias would read "x squared" as completing the square): only the
 * method phrases themselves count.
 */
export function methodIn(text: string): MethodId | null {
  const t = norm(text);
  for (const [method, pattern] of METHOD_RULES) if (pattern.test(t)) return method;
  return null;
}

// The words that can surround an equation in a request to put it up.
const REQUEST_WORDS = new Set((
  'put up on onto the board let lets s us do try how what about write graph plot draw show me now next okay ok so and please ' +
  'equation quadratic here is it this a an new can could would will we you solve then by with using use change to make ' +
  'instead right that just actually go have look at see i want like d for today start our first another alright fine cool ' +
  'great thanks thank yeah yes sure give um uh er hmm heres y equals f of'
).split(' '));

/** Whether the words around an equation are only the language of a request ("put up …", "… by factoring"). */
export function onlyRequestWords(rest: string): boolean {
  let t = norm(rest);
  for (const [, pattern] of METHOD_RULES) t = t.replace(pattern, ' ');
  return t.split(/[^a-z']+/).filter(Boolean).every((word) => REQUEST_WORDS.has(word.replace(/'/g, '')));
}

/**
 * What a spoken or typed line plainly asks the board to do, by rules alone, in
 * order (an equation and a method can come together). Empty for a question, for
 * talk to the class, and for anything the rules cannot place.
 */
export function interpret(text: string): Action[] {
  if (!norm(text)) return [];
  if (isAdvanceRequest(text)) return [{ kind: 'next' }];
  const core = imperative(text);
  if (NEXT.test(core)) return [{ kind: 'next' }];
  if (isQuestion(text)) return [];

  const found = findQuadratic(text);
  if (found === 'unreadable') return [];
  // An equation named in passing ("notice the x squared term is positive",
  // said to the class) is not a request to put it up: the rules act only when
  // everything around it is the language of a request.
  if (found) {
    if (!onlyRequestWords(found.rest)) return [];
    const method = methodIn(found.rest);
    return [{ kind: 'equation', a: found.a, b: found.b, c: found.c }, ...(method ? [{ kind: 'method' as const, method }] : [])];
  }

  const method = methodIn(core);
  if (method) return [{ kind: 'method', method }];
  if (HIDE_GRAPH.test(core)) return [{ kind: 'graph', visible: false }];
  if (SHOW_GRAPH.test(core)) return [{ kind: 'graph', visible: true }];
  if (BACK.test(core)) return [{ kind: 'back' }];
  if (ALL.test(core)) return [{ kind: 'all' }];
  if (CLEAR.test(core)) return [{ kind: 'clear' }];
  return [];
}

// ------------------------------------------------------------ the safety net

/** A method choice and nothing else: "by factoring", "use the formula", "complete the square instead". */
const ONLY_A_METHOD = /^((do it |solve it |do this( one)? |solve this( one)? )?(by|using|use|with|try)( the)? )?(factoring|factorising|factorizing|factorise|factorize|factor it|completing the square|complete the square|(the )?quadratic formula|the formula|formula)( (it|this|this one|instead))*$/;

export interface NetCall { name: ToolName; arguments: Record<string, unknown> }

/**
 * The tool call the teacher's words clearly ask for, among those safe to do
 * twice: putting an equation up (the same equation again changes nothing),
 * choosing a method (the same one again keeps the lines up), showing it all,
 * showing or hiding the graph, clearing the board. Never the next or the
 * previous line: a second one moves the board twice. Stricter than the rules
 * above where a false match would cost the lesson: "everything" alone or
 * "start again" might mean something else.
 */
export function mustDo(text: string): NetCall | null {
  const [first, second] = interpret(text);
  if (!first) return null;
  const core = imperative(text);
  switch (first.kind) {
    case 'equation':
      return { name: 'put_up_equation', arguments: { equation: text.trim().slice(0, 200), ...(second?.kind === 'method' ? { method: second.method } : {}) } };
    case 'method':
      return ONLY_A_METHOD.test(core) ? { name: 'choose_method', arguments: { method: first.method } } : null;
    case 'graph':
      return { name: first.visible ? 'show_graph' : 'hide_graph', arguments: {} };
    case 'all':
      return ALL_ASKED.test(core) ? { name: 'show_all_working', arguments: {} } : null;
    case 'clear':
      return /^start (over|again)$/.test(core) ? null : { name: 'clear_board', arguments: {} };
    default:
      return null;
  }
}

// ------------------------------------------------- the model's half (server)

/** What the board looks like, for the model to read an equation against. Nothing hidden. */
export interface BoardContext { equation: string | null; method: string | null; revealed: number; total: number }

export const EQUATION_SYSTEM = 'You read quadratic equations for a classroom maths board. You never answer questions and never solve anything.';

export const EQUATION_SCHEMA = {
  type: 'object',
  properties: {
    readable: { type: 'boolean', description: 'The text names one polynomial in x of degree 2 or less.' },
    a: { type: 'string', description: 'The x² coefficient, exactly, e.g. "1", "-2", "1/2", "0.5".' },
    b: { type: 'string', description: 'The x coefficient, exactly.' },
    c: { type: 'string', description: 'The constant, exactly.' },
  },
  required: ['readable'],
};

export function equationPrompt(text: string, board: BoardContext): string {
  const now = board.equation
    ? `On the board now: ${board.equation}; method: ${board.method ?? 'none chosen yet'}; ${board.revealed} of ${board.total} lines of working shown.`
    : 'The board is empty.';
  return `A teacher asked for this to go on a classroom maths board, as speech recognition heard it or as they typed it: "${text}"
${now}
Speech recognition may have misheard maths words ("for x" for "four x", "ex" for "x").
Give a, b and c of ax² + bx + c = 0 (expand brackets, move everything to one side) as exact strings like "-4", "1/2" or "0.5". If they asked to change one number of the equation on the board ("change c to five"), give the whole new equation. Never round and never substitute a nicer equation. If it is not a polynomial in x of degree 2 or less, set readable to false.`;
}

/** The model's answer, checked: exact coefficients, or nothing. A missing b or c is zero. */
export function equationFrom(answer: unknown): { a: Q; b: Q; c: Q } | null {
  const { readable, a, b, c } = (answer ?? {}) as Record<string, unknown>;
  if (readable !== true) return null;
  try {
    return { a: parseQ(String(a ?? '')), b: parseQ(String(b ?? '') || '0'), c: parseQ(String(c ?? '') || '0') };
  } catch {
    return null;
  }
}
