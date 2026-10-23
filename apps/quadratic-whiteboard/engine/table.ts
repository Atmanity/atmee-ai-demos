// The board wired to the product: the reducer, and a `Table` that turns the
// host's tool calls, the teacher's buttons and the equation box into board
// changes and says what the host should hear about each. Ported from the
// original `table.py` (the reducer, the narrator's cues) and `tools.py` (what
// each tool answers), framework-free so all of it tests without a server, a
// call or a model.
//
// The reducer is the only writer. `Board` validates before it mutates, so a
// refusal leaves the board exactly as the class last saw it and carries a
// sentence the teacher can act on.
import { Board, BoardRefusal } from './board.ts';
import { Q, parseQ } from './fraction.ts';
import { eventFor, said, UNREADABLE } from './director.ts';
import { equationFrom, equationPrompt, type BoardContext } from './judge.ts';
import { normaliseMethod } from './methods.ts';
import { findQuadratic } from './spoken.ts';
import type { LastAction, Outcome, ToolOutcome, View } from './types.ts';

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

/** The longest equation text read, from the host or the box. */
export const MAX_EQUATION = 200;

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
      // Normalised here, so the board's buttons and the host's calls go through the same door.
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

/** The app's own model call, on the server: a prompt in, the model's JSON out. */
export type Ask = (prompt: string) => Promise<unknown>;

/** Shown on the board when the equation box's text could not be read. */
export const UNREADABLE_BOX = "That didn't read as a quadratic. Try x^2 - 4x + 3, or \"x squared minus four x plus three\".";

/** Three coefficients as read, before the board checks them. */
type Coefficients = { a: unknown; b: unknown; c: unknown };

// How long each kind of event stays worth saying, in seconds.
const ttlOf = (action: LastAction | null) => (action === 'equation' ? 45 : 25);

/** One teacher's board, and everything that changes it. Server-side: it holds the whole working. */
export class Table {
  readonly board = new Board();
  private seq = 0;

  /** What the page and the host see: the snapshot (revealed lines only) and its version. */
  view(): View {
    return { ...this.board.snapshot(), seq: this.seq };
  }

  context(): BoardContext {
    const v = this.board.snapshot();
    return { equation: v.equation?.display ?? null, method: v.method_label, revealed: v.revealed, total: v.total_steps };
  }

  /** The opening, for a new board. */
  open(): string {
    return said.start();
  }

  /** The opening when the teacher calls back to the board they left. */
  resume(): string {
    return said.resume(this.view());
  }

  /** Intents in order; the first refusal stops the rest and is returned. */
  private apply(...intents: Intent[]): string | null {
    for (const intent of intents) {
      try {
        reduce(this.board, intent as Intent & Record<string, unknown>);
        this.seq += 1;
      } catch (err) {
        if (err instanceof BoardRefusal) return err.reason;
        throw err;
      }
    }
    return null;
  }

  /**
   * An equation from what the teacher said or typed: "1, -4, 3", then the
   * rules ("x squared minus four x plus three", "x^2 - 4x + 3 = 0"), then the
   * model (brackets, "change c to five", mishearings). Null when none can read it.
   */
  async read(text: string, ask?: Ask): Promise<Coefficients | null> {
    // A host may write the power the way it writes maths elsewhere: x^{2}.
    const t = text.slice(0, MAX_EQUATION).replace(/\^\s*\{\s*(\d)\s*\}/g, '^$1');
    const triple = /^\s*(-?[\d./]+)\s*[,;\s]\s*(-?[\d./]+)\s*[,;\s]\s*(-?[\d./]+)\s*$/.exec(t);
    if (triple) return { a: triple[1], b: triple[2], c: triple[3] };
    const found = findQuadratic(t);
    if (found && found !== 'unreadable') return { a: found.a, b: found.b, c: found.c };
    if (!ask) return null;
    try {
      return equationFrom(await ask(equationPrompt(t, this.context())));
    } catch {
      return null; // the model is down or slow: the teacher is asked again
    }
  }

  /** Whether these coefficients are the equation already on the board. */
  private onBoard(read: Coefficients): boolean {
    const equation = this.board.equation;
    if (!equation) return false;
    try {
      return coefficient(read.a).eq(equation.a) && coefficient(read.b).eq(equation.b) && coefficient(read.c).eq(equation.c);
    } catch {
      return false;
    }
  }

  /**
   * One of the host's tool calls. The result is what the host says next; a
   * refusal is also shown on the board. Putting up the equation already there,
   * or choosing the method already chosen, changes nothing: the lines the class
   * has seen stay up (and a doubled call from the safety net is harmless).
   */
  async tool(name: string, args: Record<string, unknown>, ask?: Ask): Promise<ToolOutcome> {
    const done = (result: string, message?: string): ToolOutcome => ({ view: this.view(), result, ...(message ? { message } : {}) });
    const step = (intent: Intent, text: (v: View) => string): ToolOutcome => {
      const reason = this.apply(intent);
      return reason ? done(said.refused(reason), reason) : done(text(this.view()));
    };
    switch (name) {
      case 'put_up_equation': {
        const text = String(args.equation ?? '').trim();
        if (!text) return done(said.noEquation());
        const method = typeof args.method === 'string' && args.method.trim() ? args.method : null;
        const read = await this.read(text, ask);
        if (!read) return done(said.unreadable(text.slice(0, MAX_EQUATION)), UNREADABLE);
        if (this.onBoard(read)) {
          return method && normaliseMethod(method) !== this.board.method ? this.tool('choose_method', { method }) : done(said.alreadyUp(this.view()));
        }
        const reason = this.apply({ kind: 'set_equation', ...read });
        if (reason) return done(said.refused(reason), reason);
        const why = method ? this.apply({ kind: 'set_method', method }) : null;
        return why ? done(said.equationNotMethod(this.view(), why), why) : done(said.equation(this.view(), 'heard'));
      }
      case 'choose_method': {
        const method = normaliseMethod(String(args.method ?? ''));
        if (method && this.board.equation && this.board.method === method) return done(said.sameMethod(this.view()));
        return step({ kind: 'set_method', method: args.method }, said.method);
      }
      case 'next_line': return step({ kind: 'reveal_step' }, said.next);
      case 'previous_line': return step({ kind: 'back_step' }, said.back);
      case 'show_all_working': return step({ kind: 'reveal_all' }, said.revealAll);
      case 'show_graph': return step({ kind: 'set_graph', visible: true }, said.graph);
      case 'hide_graph': return step({ kind: 'set_graph', visible: false }, said.graph);
      case 'clear_board': return step({ kind: 'clear_board' }, said.clear);
      default: return done(said.refused(`'${name}' is not something this board can do.`));
    }
  }

  /**
   * A control on the page. It acts at once; a refusal is shown on the board
   * (the control was the teacher's own hand), and an accepted change is told
   * to the host, which cannot see the screen.
   */
  press(intent: Intent): Outcome {
    const reason = this.apply(intent);
    const view = this.view();
    if (reason) return { view, message: reason };
    const event = eventFor(view);
    return event ? { view, event, ttl: ttlOf(view.last_action) } : { view };
  }

  /**
   * The equation box: "x^2 - 4x + 3", words, or "1, -4, 3". The same reading
   * as the host's calls; a misreading is shown on the board and the host is
   * told only about what went up. The box always rewrites the board, even with
   * the same equation: it is the teacher's explicit fresh start.
   */
  async enter(text: string, ask?: Ask): Promise<Outcome> {
    const read = await this.read(text, ask);
    if (!read) return { view: this.view(), message: UNREADABLE_BOX };
    return this.press({ kind: 'set_equation', ...read });
  }
}
