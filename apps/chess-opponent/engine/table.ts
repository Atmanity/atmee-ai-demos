// What happens when: the board, the opponent's turn, and what the host is
// told about each change. Ported from table.py/tools.py, minus the platform
// machinery they needed (the store, the claim, the turn driver), plus the one
// rule those carried: every change is told to the host exactly once (as the
// result of its own tool call, or as an event after a button or a drag).
//
// Pure and synchronous: the page decides when (it waits a beat before the
// opponent's reply, so the player sees their own move land first).
import { chooseMove, type Choice } from './engine.ts';
import { say, type Lead } from './director.ts';
import {
  AmbiguousMove, ChessMatch, clip, IllegalMove, MODEL_QUOTE_MAX_BYTES, REFUSAL_REASON_MAX_BYTES, UnreadableMove,
} from './game.ts';
import type { Action, ChessSnapshot, Side } from './types.ts';

export type OutcomeKind =
  | 'start' | 'move' | 'reply' | 'result' | 'refused' | 'ambiguous' | 'unreadable'
  | 'side' | 'difficulty' | 'resign' | 'new' | 'idle';

export interface Outcome {
  kind: OutcomeKind;
  /** Whether the board changed. */
  applied: boolean;
  /** The board's refusal, in words fit for the player. */
  reason?: string;
  snapshot: ChessSnapshot;
  /** What to tell the host now: a tool's result, or an event (in its own words). */
  event?: { text: string; ttl: number };
  /** It is the opponent's turn: call `reply(next)` (after a beat) for its move and the one text about both. */
  next?: Lead & { fen: string };
}

const TTL = { reply: 45, result: 60, refusal: 20, command: 30, start: 60 } as const;

const opposite = (side: Side): Side => (side === 'white' ? 'black' : 'white');

export class Table {
  constructor(
    readonly match: ChessMatch = new ChessMatch(),
    private readonly choose: (fen: string, legal: unknown, rank: number, seed: unknown) => Choice | null = chooseMove,
  ) {}

  snapshot(): ChessSnapshot {
    return this.match.snapshot();
  }

  /** The opening: what the host says when the board is first set up. */
  start(): Outcome {
    const snapshot = this.snapshot();
    if (this.match.turn() === 'agent') {
      return { kind: 'start', applied: false, snapshot, next: { fen: snapshot.fen, note: say.startLead(snapshot) } };
    }
    return { kind: 'start', applied: false, snapshot, event: { text: say.start(snapshot), ttl: TTL.start } };
  }

  /** The player's action, from any route. */
  act(action: Action): Outcome {
    switch (action.kind) {
      case 'move': return this.move(action.text);
      case 'side': return this.side(action.side);
      case 'difficulty': return this.difficulty(action.level);
      case 'resign': return this.resign();
      case 'new': return this.newGame();
    }
  }

  private move(text: string): Outcome {
    const atFen = this.match.board.fen();
    let played;
    try {
      played = this.match.applyMove('user', text);
    } catch (err) {
      if (!(err instanceof IllegalMove)) throw err;
      const said = clip(text, MODEL_QUOTE_MAX_BYTES);
      const why = clip(err.message, REFUSAL_REASON_MAX_BYTES);
      if (err instanceof UnreadableMove) {
        // This code could not read it: not a fact about the position, so
        // nothing goes on screen claiming it is; the host asks again.
        return { kind: 'unreadable', applied: false, reason: err.message, snapshot: this.snapshot(), event: { text: say.unreadable(said), ttl: TTL.refusal } };
      }
      // On the screen as well as in the host's mouth.
      this.match.noteRefusal(said, err.message, atFen);
      const snapshot = this.snapshot();
      if (err instanceof AmbiguousMove) {
        return { kind: 'ambiguous', applied: false, reason: err.message, snapshot, event: { text: say.ambiguous(said, why), ttl: TTL.refusal } };
      }
      return { kind: 'refused', applied: false, reason: err.message, snapshot, event: { text: say.refused(said, why), ttl: TTL.refusal } };
    }
    const snapshot = this.snapshot();
    if (snapshot.result) {
      // Mate (or a draw) on the player's move: the result is the one line,
      // however the move arrived. A mate said out loud once ended in silence.
      return { kind: 'result', applied: true, snapshot, event: { text: say.result(snapshot, played), ttl: TTL.result } };
    }
    return { kind: 'move', applied: true, snapshot, next: { fen: snapshot.fen, userMove: played.san, check: snapshot.in_check } };
  }

  private side(side: Side | 'other' | string): Outcome {
    const want = side === 'other' ? opposite(this.match.userColor) : side;
    // Asked twice ("can I play black?", then "yes, start over as Black"): the
    // board stays as it is, and says so. A second fresh game was once dealt here.
    if (want === this.match.userColor) {
      const s = this.snapshot();
      const played = s.history.length > (s.user_color === 'black' ? 1 : 0);
      return { kind: 'refused', applied: false, reason: `you are already playing ${want}`, snapshot: s, event: { text: say.sideSame(s, played), ttl: TTL.command } };
    }
    try {
      this.match.setSide(want);
    } catch (err) {
      if (!(err instanceof IllegalMove)) throw err;
      return { kind: 'refused', applied: false, reason: err.message, snapshot: this.snapshot(), event: { text: say.sideRefused(err.message), ttl: TTL.command } };
    }
    return this.reset('side');
  }

  private newGame(): Outcome {
    this.match.newGame();
    return this.reset('new');
  }

  /** After a reset: the player moves first (one event now), or the opponent does (its reply carries the news). */
  private reset(why: 'new' | 'side'): Outcome {
    const snapshot = this.snapshot();
    const kind = why === 'side' ? 'side' : 'new';
    if (this.match.turn() === 'agent') {
      return { kind, applied: true, snapshot, next: { fen: snapshot.fen, note: say.freshBoardLead(snapshot, why) } };
    }
    return { kind, applied: true, snapshot, event: { text: say.freshBoard(snapshot, why), ttl: TTL.command } };
  }

  private difficulty(level: string): Outcome {
    try {
      const before = this.match.strength;
      const name = this.match.setStrength(level);
      if (name === before) return { kind: 'difficulty', applied: false, snapshot: this.snapshot(), event: { text: say.difficultySame(name), ttl: TTL.command } };
      return { kind: 'difficulty', applied: true, snapshot: this.snapshot(), event: { text: say.difficulty(name), ttl: TTL.command } };
    } catch (err) {
      if (!(err instanceof IllegalMove)) throw err;
      return { kind: 'refused', applied: false, reason: err.message, snapshot: this.snapshot(), event: { text: say.difficultyRefused(err.message), ttl: TTL.command } };
    }
  }

  private resign(): Outcome {
    try {
      this.match.resign('user');
    } catch (err) {
      if (!(err instanceof IllegalMove)) throw err;
      return { kind: 'refused', applied: false, reason: err.message, snapshot: this.snapshot(), event: { text: say.refusedCommand(err.message), ttl: TTL.command } };
    }
    // One event: the thanks. Resigning once got two goodbyes from one avatar.
    return { kind: 'resign', applied: true, snapshot: this.snapshot(), event: { text: say.resigned(), ttl: TTL.result } };
  }

  /**
   * The opponent's move. `lead` is what made it its turn; it is ignored (and
   * nothing is played) if the board has moved on since it was scheduled.
   */
  reply(lead: Lead & { fen: string }): Outcome {
    const before = this.snapshot();
    if (this.match.turn() !== 'agent' || before.fen !== lead.fen) return { kind: 'idle', applied: false, snapshot: before };
    const choice = this.choose(before.fen, before.legal_moves, this.match.rank, this.match.seed);
    if (!choice) {
      console.warn('[chess-opponent] no usable move from a legal position');
      return { kind: 'idle', applied: false, snapshot: before };
    }
    const played = this.match.applyMove('agent', choice.uci);
    const snapshot = this.snapshot();
    if (snapshot.result) {
      // The result line covers the final move: saying both said goodbye twice.
      return { kind: 'result', applied: true, snapshot, event: { text: (lead.note ? lead.note + ' ' : '') + say.result(snapshot, played), ttl: TTL.result } };
    }
    return { kind: 'reply', applied: true, snapshot, event: { text: say.reply(lead, choice, snapshot), ttl: TTL.reply } };
  }
}
