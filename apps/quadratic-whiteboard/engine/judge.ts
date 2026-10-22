// What an utterance means to the board. The original agent had eight tools
// and a model that chose between them; the Avatar API has no function
// calling, so the app decides: rules first (a bare "next", the command verbs,
// spoken maths), and a model call on the server only for what the rules
// cannot place. Questions are never board actions: the avatar answers them
// from the state.
import { parseQ, type Q } from './fraction.ts';
import { normaliseMethod } from './methods.ts';
import { findQuadratic, soundsLikeAnEquation } from './spoken.ts';
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
 *
 * In the original this ran in code before the model (`AdvanceWatch`), because
 * the first live run showed the model describing the line already on screen
 * instead of calling `next_line`: the board never moved. Here every action is
 * in code anyway; this stays the first, exact check.
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

/** A question for the avatar, not a request for the board ("what about …" and "how about …" are requests). */
export function isQuestion(text: string): boolean {
  const t = norm(text);
  return QUESTION.test(t) && !/^(what|how) about\b/.test(t);
}

const NEXT = /^(next( (line|step|one|bit))?|go on|carry on|keep going|continue|and then|then what|what'?s next|what comes next|(show|put up|reveal|write|give)( (me|us|them))?( the)? next( (line|step|one|bit))?( up)?|on to the next( (line|step|one))?|another (line|step)|one more( (line|step))?)$/;
const HIDE_GRAPH = /^((hide|remove|lose|drop|close|get rid of|turn off|switch off|take (away|off|down))( the)? (graph|curve|parabola|plot|picture)|(take|put) (the )?(graph|curve|parabola|plot) (away|off|down)|(just |only )?the (working|algebra)( only)?$|no (graph|curve))\b/;
const SHOW_GRAPH = /^((show|see|bring back|put back|turn on|switch on|display|draw)( me| us| them)?( the)? (graph|curve|parabola|plot|picture)|(bring|put) (the )?(graph|curve|parabola|plot) back)\b/;
const BACK = /^((go |step )?back( up)?( (a|one) (step|line))?|undo( that| it)?|take (that|it|this|the last)( (line|step))? (back|down|off)|previous( (line|step))?)$/;
const ALL = /^((show|reveal|put up|write( out)?|give)( (it|them|us|me))? (all|everything|all of it|the (whole|full|rest|lot)( (thing|working|derivation|solution|lot|of it))?|the answer|all the working)( up)?|the whole thing|all of it|everything)$/;
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

// Worth a model call when the rules found nothing: board verbs, or maths.
const COMMANDISH = /\b(next|back|undo|previous|reveal|hide|graph|curve|parabola|clear|wipe|erase|rub|factor\w*|formula|complet\w*|method|instead|change|swap)\b/;
const MATHSY = /\b(x|ex|squared|cubed)\b|²|\^/;

export interface Reading {
  /** What the rules decided, in order (an equation and a method can come together). */
  actions: Action[];
  /** The rules could not place it, and it is worth asking the model. */
  ask: boolean;
  /** It sounded like an equation the rules could not read. */
  attempt: boolean;
}

const none = (ask = false, attempt = false): Reading => ({ actions: [], ask, attempt });

/** What a spoken or typed line asks the board to do, by rules alone. */
export function interpret(text: string): Reading {
  const t = norm(text);
  if (!t) return none();
  if (isAdvanceRequest(text)) return { actions: [{ kind: 'next' }], ask: false, attempt: false };
  const core = imperative(text);
  if (NEXT.test(core)) return { actions: [{ kind: 'next' }], ask: false, attempt: false };
  if (isQuestion(text)) return none(COMMANDISH.test(t));

  const found = findQuadratic(text);
  if (found === 'unreadable') return none(true, true);
  // An equation named in passing ("notice the x squared term is positive",
  // said to the class) is not a request to put it up: the rules act only when
  // everything around it is the language of a request; the model judges the rest.
  if (found && !onlyRequestWords(found.rest)) return none(true, false);
  if (found) {
    const actions: Action[] = [{ kind: 'equation', a: found.a, b: found.b, c: found.c }];
    const method = methodIn(found.rest);
    if (method) actions.push({ kind: 'method', method });
    return { actions, ask: false, attempt: false };
  }

  const method = methodIn(core);
  if (method) return { actions: [{ kind: 'method', method }], ask: false, attempt: false };
  if (HIDE_GRAPH.test(core)) return { actions: [{ kind: 'graph', visible: false }], ask: false, attempt: false };
  if (SHOW_GRAPH.test(core)) return { actions: [{ kind: 'graph', visible: true }], ask: false, attempt: false };
  if (BACK.test(core)) return { actions: [{ kind: 'back' }], ask: false, attempt: false };
  if (ALL.test(core)) return { actions: [{ kind: 'all' }], ask: false, attempt: false };
  if (CLEAR.test(core)) return { actions: [{ kind: 'clear' }], ask: false, attempt: false };
  return none(COMMANDISH.test(t) || MATHSY.test(t), soundsLikeAnEquation(text));
}

// ------------------------------------------------------- the model's half

/** What the board looks like, for the model to read a line against. Nothing hidden. */
export interface BoardContext { equation: string | null; method: string | null; revealed: number; total: number }

const ACTIONS = ['put_equation', 'choose_method', 'next_line', 'previous_line', 'show_all', 'show_graph', 'hide_graph', 'clear_board'] as const;

export const COMMAND_SCHEMA = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      description: 'What the board should do, in order. Empty when the line is not a request to the board.',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: [...ACTIONS] },
          a: { type: 'string', description: 'put_equation only: the x² coefficient, exactly, e.g. "1", "-2", "1/2", "0.5".' },
          b: { type: 'string', description: 'put_equation only: the x coefficient, exactly.' },
          c: { type: 'string', description: 'put_equation only: the constant, exactly.' },
          method: { type: 'string', enum: ['factoring', 'completing_square', 'quadratic_formula', ''], description: 'choose_method only.' },
        },
        required: ['action'],
      },
    },
  },
  required: ['actions'],
};

export const COMMAND_SYSTEM = 'You turn what a teacher says into commands for a classroom whiteboard of quadratic equations. You never answer questions yourself.';

export function commandPrompt(utterance: string, board: BoardContext, equationOnly = false): string {
  const now = board.equation
    ? `On the board now: ${board.equation}; method: ${board.method ?? 'none chosen yet'}; ${board.revealed} of ${board.total} lines of working shown.`
    : 'The board is empty.';
  if (equationOnly) {
    return `A teacher typed a quadratic into the whiteboard's equation box: "${utterance}"
${now}
Give it as ONE put_equation action: a, b and c of ax² + bx + c = 0 (expand brackets, move everything to one side), as exact strings like "-4", "1/2" or "0.5". Never round and never substitute a nicer equation. If it is not a polynomial in x of degree 2 or less, give no actions.`;
  }
  return `A teacher is driving a classroom whiteboard by voice. Speech recognition may have misheard maths words ("for x" for "four x", "ex" for "x").
${now}
The teacher said: "${utterance}"
Decide what they want the BOARD to do, if anything. A question about the maths or the board ("what's the discriminant?", "what's next after factoring?", "why doesn't it factor?") is no action: the assistant answers it. Talk to the class is no action.
- put_equation: they named a quadratic to put up, or asked to change one coefficient of the one on the board. Give a, b, c of ax² + bx + c = 0 exactly as said (expand brackets, move everything to one side), as strings like "-4", "1/2", "0.5". Never round and never substitute a nicer equation.
- choose_method: factoring, completing the square or the quadratic formula.
- next_line, previous_line, show_all (every remaining line), show_graph, hide_graph, clear_board.
Usually one action; "put up x² - 1 and factor it" is two, in order.`;
}

export interface ModelReading { actions: Action[]; unreadable: boolean }

/** The model's answer as actions, checked: coefficients must parse exactly, or the equation is unreadable. */
export function actionsFrom(answer: unknown): ModelReading {
  const out: Action[] = [];
  let unreadable = false;
  const list = (answer as { actions?: unknown })?.actions;
  if (!Array.isArray(list)) return { actions: [], unreadable: false };
  for (const item of list.slice(0, 3)) {
    const { action, a, b, c, method } = (item ?? {}) as Record<string, unknown>;
    switch (action) {
      case 'put_equation':
        try {
          out.push({ kind: 'equation', a: parseQ(String(a ?? '')), b: parseQ(String(b ?? '0') || '0'), c: parseQ(String(c ?? '0') || '0') });
        } catch {
          unreadable = true;
        }
        break;
      case 'choose_method': {
        const id = normaliseMethod(typeof method === 'string' ? method : '');
        if (id) out.push({ kind: 'method', method: id });
        break;
      }
      case 'next_line': out.push({ kind: 'next' }); break;
      case 'previous_line': out.push({ kind: 'back' }); break;
      case 'show_all': out.push({ kind: 'all' }); break;
      case 'show_graph': out.push({ kind: 'graph', visible: true }); break;
      case 'hide_graph': out.push({ kind: 'graph', visible: false }); break;
      case 'clear_board': out.push({ kind: 'clear' }); break;
      default: break;
    }
  }
  return { actions: out, unreadable };
}
