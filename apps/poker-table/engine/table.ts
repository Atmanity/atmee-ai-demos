// The table wired for Blindside: the host's tool calls and the player's
// buttons in, a masked view and the words Dex speaks from out, and Dex's own
// moves played by the decider. Ported from the original's `table.py` (the
// reducer and the turn driver) and `moves.py`; the server (server.ts) only
// adds HTTP and the model.
//
// Four inputs reach the table:
// * the host's `play_move(words)`: read by judge.ts (rules only), and played
//   only when the player's own words, heard at this point in the hand, contain
//   that very move. A tool call is a model output, not evidence; and words
//   that already moved the table cannot move it again, so a bet never lands twice;
// * a button (an Intent): exact, applied at once;
// * a deal or a rematch, asked for by the host's tools or a button;
// * Dex's turn: a structured decision (decide.ts), applied, and Dex is told
//   the move "he" made.
import { decide, DECISION_TIMEOUT_MS, safeAction, type Ask, type Decided } from './decide.ts';
import { said, type Line } from './director.ts';
import { backs, parseTurn, sameMove, type ParsedMove } from './judge.ts';
import { ACTION_KINDS, IllegalMove, normalizeKind, PokerMatch, type MatchOptions } from './match.ts';
import type { Heard, Intent, Seat, TableView } from './types.ts';

/** What one input did: the table as it now is, and what Dex should hear about it. */
export interface Result {
  view: TableView;
  /** Whether the table accepted a change. */
  changed: boolean;
  /** For Dex. Absent when there is nothing to tell (a refused button, a turn that was not Dex's). */
  line?: Line;
  /** A refusal, for the table's message line. */
  message?: string;
  /** The move was not (yet) in the player's own words at this point in the hand: the page may wait for the transcript and ask again. */
  unbacked?: boolean;
}

/** A button's move as the parser would have read it, to recognise the same move said aloud. */
function asMove(intent: Intent): ParsedMove | null {
  const kind = normalizeKind(intent.kind);
  if (kind === 'raise') return { kind: 'raise', amount: 'amount' in intent && intent.amount != null ? intent.amount : undefined };
  if (kind === 'fold' || kind === 'check' || kind === 'call' || kind === 'all_in') return { kind };
  return null;
}

export class Table {
  readonly match: PokerMatch;
  /** How Dex's last move was chosen, for the server's log. */
  lastDecision: Decided | null = null;
  private deciding: Promise<Result> | null = null;
  private readonly decisionTimeoutMs: number;
  /** The player's last move the table played, and the table's seq once it had: to name a repeat. */
  private lastPlayed: { move: ParsedMove; seq: number } | null = null;

  constructor(opts: MatchOptions & { decisionTimeoutMs?: number } = {}) {
    this.match = new PokerMatch(opts);
    this.decisionTimeoutMs = opts.decisionTimeoutMs ?? DECISION_TIMEOUT_MS;
  }

  view(): TableView { return this.match.view(); }

  /**
   * The only writer. Validation before mutation: a refused intent throws
   * IllegalMove and leaves the table exactly as it was.
   */
  private reduce(intent: Intent, by: Seat) {
    const kind = normalizeKind(intent.kind);
    if (kind === 'deal') return this.match.deal();
    if (kind === 'restart') {
      // A rematch, only once the match is over: between hands it would print chips.
      if (this.match.phase !== 'game-over') throw new IllegalMove('the match is still on — deal the next hand instead');
      this.match.restart();
      return this.match.deal();
    }
    if ((ACTION_KINDS as string[]).includes(kind) || kind === 'all_in') {
      return this.match.applyMove(by, kind, 'amount' in intent ? intent.amount ?? undefined : undefined);
    }
    throw new IllegalMove(`'${kind}' is not something this table can do`);
  }

  /** The opening hand, dealt by the table itself (never by asking the player). */
  open(): Result {
    if (this.match.phase === 'lobby') this.match.deal();
    const view = this.view();
    return { view, changed: true, line: said.opening(view) };
  }

  /**
   * The host's `play_move`: the move in `words`, played only if the player's
   * own lines heard at this seq contain it. `heard` lines from earlier seqs are
   * words about a hand that has moved on (including the words that asked for
   * the move that moved it), so they never count.
   */
  playerMove(words: string, heard: readonly Heard[] = []): Result {
    const before = this.view();
    const text = String(words ?? '').trim().replace(/^["'“]+|["'”]+$/g, '').slice(0, 160);
    if (!text) return { view: before, changed: false, line: said.noWords() };
    const parsed = parseTurn(text);
    if (!parsed.move) return { view: before, changed: false, line: said.unclear(text, parsed.unclear ?? 'there is no move in it') };
    const move = parsed.move;
    const fresh = heard.filter((h) => h.seq === before.seq).map((h) => h.text);
    if (!backs(move, fresh)) {
      const last = this.lastPlayed;
      const repeat = last !== null && sameMove(last.move, move) && before.seq - last.seq <= 2;
      return { view: before, changed: false, unbacked: true, line: repeat ? said.repeat(move) : said.unheard(text, fresh) };
    }
    return this.play(move, before);
  }

  /** A button. Exact, so nothing is read; a refusal shows on the table and Dex need not hear it. */
  press(intent: Intent): Result {
    const kind = normalizeKind(intent.kind);
    if (kind === 'deal' || kind === 'restart') {
      const before = this.view();
      try {
        this.reduce({ kind } as Intent, 'user');
      } catch (err) {
        if (!(err instanceof IllegalMove)) throw err;
        return { view: before, changed: false, message: err.message };
      }
      const view = this.view();
      return { view, changed: true, line: said.dealt(view, kind === 'restart') };
    }
    const move = asMove(intent);
    if (!move) return { view: this.view(), changed: false, message: `'${String(intent.kind)}' is not something this table can do` };
    const result = this.play(move, this.view());
    return result.changed ? result : { view: result.view, changed: false, message: result.message };
  }

  private play(move: ParsedMove, before: TableView): Result {
    const amount = move.kind === 'raise' ? move.amount : undefined;
    try {
      this.reduce({ kind: move.kind, amount } as Intent, 'user');
    } catch (err) {
      if (!(err instanceof IllegalMove)) throw err;
      const view = this.view();
      return { view, changed: false, line: said.refused(move, err.message, view), message: err.message };
    }
    const after = this.view();
    this.lastPlayed = { move, seq: after.seq };
    return { view: after, changed: true, line: said.played(before, after, move.kind) };
  }

  /** The host's `deal_hand`: the next hand, only between hands. */
  deal(): Result {
    const view = this.view();
    if (view.phase === 'playing') return { view, changed: false, line: said.handInPlay(view) };
    if (view.phase === 'game-over') return { view, changed: false, line: said.matchOver(view) };
    try {
      this.reduce({ kind: 'deal' }, 'user');
    } catch (err) {
      if (!(err instanceof IllegalMove)) throw err;
      const now = this.view();
      return { view: now, changed: false, line: now.phase === 'game-over' ? said.matchOver(now) : said.handInPlay(now), message: err.message };
    }
    const after = this.view();
    return { view: after, changed: true, line: said.dealt(after, false) };
  }

  /** The host's `new_match`: a rematch, only once a stack is empty. */
  rematch(): Result {
    const view = this.view();
    if (view.phase !== 'game-over') return { view, changed: false, line: said.matchOn(view) };
    this.reduce({ kind: 'restart' }, 'user');
    const after = this.view();
    return { view: after, changed: true, line: said.dealt(after, true) };
  }

  /** The host's `read_my_cards`: the player's own cards, which they are entitled to. Never Dex's. */
  ownCards(): Result {
    const view = this.view();
    const line = view.phase === 'playing' && view.user_hand.length ? said.cards(view.user_hand) : said.noCards();
    return { view, changed: false, line };
  }

  /**
   * Dex's turn, if it is one: decide (the model, or the safe action), apply,
   * and say what was played. Concurrent calls share one decision; a table that
   * moved while the model was thinking discards it.
   */
  async opponentTurn(ask: Ask | null, again = false): Promise<Result> {
    if (this.deciding) {
      await this.deciding.catch(() => undefined);
      return { view: this.view(), changed: false };
    }
    this.deciding = this.playOpponent(ask, again);
    try {
      return await this.deciding;
    } finally {
      this.deciding = null;
    }
  }

  private async playOpponent(ask: Ask | null, again: boolean): Promise<Result> {
    if (this.match.actionTo() !== 'agent') return { view: this.view(), changed: false };
    const before = this.view();
    const request = this.match.decisionRequest();
    const decision = await decide(request, ask, this.decisionTimeoutMs);
    if (this.match.seq !== before.seq || this.match.actionTo() !== 'agent') return { view: this.view(), changed: false };
    try {
      this.reduce({ kind: decision.kind, amount: decision.amount }, 'agent');
      this.lastDecision = decision;
    } catch (err) {
      if (!(err instanceof IllegalMove)) throw err;
      // Only reachable if a normalized decision is still illegal; never stall the table on it.
      const safe = safeAction(request.valid_actions, request.to_call);
      this.reduce(safe, 'agent');
      this.lastDecision = { ...safe, source: 'fallback', ms: decision.ms, reason: `the table refused the model's ${decision.kind}: ${(err as Error).message}` };
    }
    const after = this.view();
    return { view: after, changed: true, line: said.yours(before, after, again) };
  }
}
