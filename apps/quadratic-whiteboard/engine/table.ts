// The board wired to the app: the reducer, and a `Table` that turns a button,
// a typed line or the teacher's speech into board changes and says what the
// avatar should be told. Ported from the original `table.py` (reducer, the
// narrator's cues) and `tools.py` (what each request answers), framework-free
// so all of it tests without a server, a room or a model.
//
// The reducer is the only writer. A panel button, a typed line and a spoken
// one all arrive as intents; `Board` validates before it mutates, so a refusal
// leaves the board exactly as the class last saw it and carries a sentence the
// teacher can act on.
import { Board, BoardRefusal } from './board.ts';
import { Q, parseQ } from './fraction.ts';
import { eventFor, refusalEvent, say, UNREADABLE } from './director.ts';
import { actionsFrom, commandPrompt, interpret, type Action, type BoardContext } from './judge.ts';
import { normaliseMethod } from './methods.ts';
import { findQuadratic } from './spoken.ts';
import type { Outcome, Source, View } from './types.ts';

export type Intent =
  | { kind: 'set_equation'; a: unknown; b: unknown; c: unknown }
  | { kind: 'set_method'; method: unknown }
  | { kind: 'reveal_step' }
  | { kind: 'back_step' }
  | { kind: 'reveal_all' }
  | { kind: 'set_graph'; visible?: unknown }
  | { kind: 'clear_board' };

/** Intents this board understands. Anything else is refused by name, so a typo is visible rather than a silent no-op. */
export const INTENT_KINDS = ['set_equation', 'set_method', 'reveal_step', 'back_step', 'reveal_all', 'set_graph', 'clear_board'] as const;

export const BAD_NUMBER = "I didn't catch those numbers — give me a, b and c.";

/**
 * One coefficient, exactly. Via its text, so 0.5 becomes one half rather than
 * the binary float nearest to it: a board that renders 3602879701896397/36028797018963968
 * has stopped being a teaching tool.
 */
export function coefficient(value: unknown): Q {
  if (value instanceof Q) return value;
  if (typeof value === 'boolean' || value === null || value === undefined) throw new BoardRefusal(BAD_NUMBER);
  if (typeof value !== 'number' && typeof value !== 'string') throw new BoardRefusal(BAD_NUMBER);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new BoardRefusal(BAD_NUMBER);
  try {
    return parseQ(String(value));
  } catch {
    throw new BoardRefusal(BAD_NUMBER);
  }
}

/** Intents onto the board. Validate-before-mutate: a refused intent leaves the working untouched. */
export function reduce(board: Board, intent: { kind?: unknown } & Record<string, unknown>): void {
  const kind = String(intent?.kind ?? '').trim().toLowerCase();
  switch (kind) {
    case 'set_equation':
      board.setEquation(coefficient(intent.a), coefficient(intent.b), coefficient(intent.c));
      return;
    case 'set_method':
      // Normalised here, so the panel's buttons and the teacher's words go through the same door.
      board.setMethod(normaliseMethod(String(intent.method ?? '')));
      return;
    case 'reveal_step': board.revealStep(); return;
    case 'back_step': board.backStep(); return;
    case 'reveal_all': board.revealAll(); return;
    case 'set_graph': board.setGraph(Boolean(intent.visible ?? true)); return;
    case 'clear_board': board.clear(); return;
    default: throw new BoardRefusal(`'${kind}' is not something this board can do`);
  }
}

/** An action read from words, as the intent a button would have sent. */
export function intentOf(action: Action): Intent {
  switch (action.kind) {
    case 'equation': return { kind: 'set_equation', a: action.a, b: action.b, c: action.c };
    case 'method': return { kind: 'set_method', method: action.method };
    case 'next': return { kind: 'reveal_step' };
    case 'back': return { kind: 'back_step' };
    case 'all': return { kind: 'reveal_all' };
    case 'graph': return { kind: 'set_graph', visible: action.visible };
    case 'clear': return { kind: 'clear_board' };
  }
}

/** The app's own model call: a line (or the equation box's text) in, the model's JSON out. */
export type Ask = (prompt: string) => Promise<unknown>;

/** Shown on the panel when the equation box's text could not be read. */
export const UNREADABLE_BOX = "I couldn't read that as a quadratic. Try x^2 - 4x + 3, or \"x squared minus four x plus three\".";

// How long each kind of event stays worth saying, in seconds.
const TTL: Record<string, number> = { equation: 45, start: 60 };
const ttlOf = (kind: string) => TTL[kind] ?? 25;

/** One teacher's board, and everything that changes it. Server-side: it holds the whole working. */
export class Table {
  readonly board = new Board();
  private seq = 0;

  /** The page's view: the snapshot, the version, and the one staged line. */
  view(): View {
    const next = this.board.nextStep();
    return { ...this.board.snapshot(), seq: this.seq, next: next ? { n: this.board.revealed + 1, say: next.say } : null };
  }

  context(): BoardContext {
    const v = this.board.snapshot();
    return { equation: v.equation?.display ?? null, method: v.method_label, revealed: v.revealed, total: v.total_steps };
  }

  /** The opening: an empty board and the line that introduces it. */
  open(): Outcome {
    return { view: this.view(), handled: true, kind: 'start', event: say.start(), ttl: ttlOf('start') };
  }

  /**
   * Apply intents in order; the first refusal stops the rest. The event is
   * chosen for the whole request, from the board as it ends up.
   */
  run(intents: Intent[], from: Source): Outcome {
    let equation = false;
    for (const intent of intents) {
      try {
        reduce(this.board, intent as Intent & Record<string, unknown>);
        this.seq += 1;
        if (intent.kind === 'set_equation') equation = true;
      } catch (err) {
        if (!(err instanceof BoardRefusal)) throw err;
        const event = refusalEvent(err.reason, from, intent.kind);
        return { view: this.view(), handled: true, kind: intent.kind, message: err.reason, event, ttl: event ? 20 : undefined };
      }
    }
    const view = this.view();
    // An equation and a method in one breath are read back together.
    const event = equation ? say.equation(view, from === 'spoken') : eventFor(view, from);
    const kind = equation ? 'equation' : view.last_action ?? undefined;
    return { view, handled: true, kind, event, ttl: event ? ttlOf(kind ?? '') : undefined };
  }

  /** A control on the page. */
  press(intent: Intent): Outcome {
    return this.run([intent], 'button');
  }

  /**
   * A spoken or typed line. Rules first; the model only for what they cannot
   * place. A line that is not a board request is not handled: a typed one then
   * goes to the avatar as a turn, a spoken one the avatar has already heard.
   */
  async hear(text: string, how: 'spoken' | 'typed', ask?: Ask): Promise<Outcome> {
    const reading = interpret(text);
    let actions = reading.actions;
    let unreadable = reading.attempt;
    if (!actions.length && reading.ask && ask) {
      try {
        const answer = actionsFrom(await ask(commandPrompt(text, this.context())));
        actions = answer.actions;
        unreadable = answer.unreadable || (reading.attempt && !actions.length);
      } catch {
        // The model is down: the rules' reading stands.
      }
    }
    if (actions.length) return this.run(actions.map(intentOf), how);
    if (unreadable) return { view: this.view(), handled: true, kind: 'unreadable', message: UNREADABLE, event: say.unreadable(), ttl: 20 };
    return { view: this.view(), handled: false };
  }

  /**
   * The equation box: "x^2 - 4x + 3", words, or "1, -4, 3". Rules first, then
   * the model (which also expands brackets). A misreading is shown on the
   * panel; the avatar is told only about what went up.
   */
  async enter(text: string, ask?: Ask): Promise<Outcome> {
    const triple = /^\s*(-?[\d./]+)\s*[,;\s]\s*(-?[\d./]+)\s*[,;\s]\s*(-?[\d./]+)\s*$/.exec(text);
    if (triple) return this.press({ kind: 'set_equation', a: triple[1], b: triple[2], c: triple[3] });
    const found = findQuadratic(text);
    if (found && found !== 'unreadable') return this.press({ kind: 'set_equation', a: found.a, b: found.b, c: found.c });
    if (ask) {
      try {
        const answer = actionsFrom(await ask(commandPrompt(text, this.context(), true)));
        const equation = answer.actions.find((action) => action.kind === 'equation');
        if (equation) return this.press(intentOf(equation));
      } catch {
        // fall through to the misreading
      }
    }
    return { view: this.view(), handled: true, kind: 'unreadable', message: UNREADABLE_BOX };
  }
}
