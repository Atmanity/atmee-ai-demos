// The table wired for the app: intents in, a masked view and the avatar's
// event text out, and the opponent playing its own turns. Ported from the
// original's `table.py` (the reducer and the turn driver) and `moves.py`
// (`apply_user_turn`); the server (server.ts) only adds HTTP and the model.
//
// Three inputs reach the table, and none of them is the avatar:
// * a button press (an Intent): applied, and the avatar hears only what it
//   cannot see from its state (a new hand, a finished hand);
// * a typed or spoken line: read by judge.ts (rules only), applied, and the
//   ruling goes to the avatar as an event;
// * the opponent's turn: a structured decision (decide.ts), applied, then the
//   avatar is told the move it "made".
import { decide, DECISION_TIMEOUT_MS, safeAction, type Ask } from './decide.ts';
import { say } from './director.ts';
import { parseTurn } from './judge.ts';
import { ACTION_KINDS, IllegalMove, normalizeKind, PokerMatch, type MatchOptions } from './match.ts';
import type { Intent, Outcome, Seat, TableView } from './types.ts';

export type Source = 'click' | 'typed' | 'spoken';

export class Table {
  readonly match: PokerMatch;
  /** How the opponent's last move was chosen, for the server's log. */
  lastDecision: { kind: string; amount: number | null; source: 'model' | 'fallback' } | null = null;
  private deciding: Promise<Outcome> | null = null;

  private readonly decisionTimeoutMs: number;

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
  open(): Outcome {
    if (this.match.phase === 'lobby') this.match.deal();
    return { view: this.view(), handled: true, event: say.start(), ttl: 60 };
  }

  act(input: { intent?: Intent; text?: string }, source: Source): Outcome {
    if (input.intent) return this.press(input.intent);
    const text = (input.text ?? '').trim();
    if (text) return this.userTurn(text);
    return { view: this.view(), handled: false };
  }

  /** A button. The avatar sees the table in its state; it is told only what changed beyond a move. */
  private press(intent: Intent): Outcome {
    const kind = normalizeKind(intent.kind);
    try {
      this.reduce(intent, 'user');
    } catch (err) {
      if (err instanceof IllegalMove) return { view: this.view(), handled: true, message: err.message };
      throw err;
    }
    const view = this.view();
    if (kind === 'deal' || kind === 'restart') return { view, handled: true, event: say.dealt(kind === 'restart'), ttl: 15 };
    if (view.phase !== 'playing') return { view, handled: true, event: say.result(view), ttl: 30 };
    return { view, handled: true };
  }

  /**
   * What the player said or typed, applied before the avatar is told anything.
   * The avatar heard a spoken line too and has already started its own reply;
   * the ruling (what the table did, or why it did nothing) follows as an event.
   */
  private userTurn(text: string): Outcome {
    const parsed = parseTurn(text);
    const rulings: string[] = [];
    let message: string | undefined;
    let ended = false;

    if (parsed.move) {
      const { kind } = parsed.move;
      try {
        this.reduce({ kind, amount: 'amount' in parsed.move ? parsed.move.amount : undefined } as Intent, 'user');
        const view = this.view();
        rulings.push(say.applied(view.last_action));
        if (view.phase !== 'playing') {
          ended = true;
          // A new hand asked for in the same breath ("I fold. can we start a
          // new hand?") follows at once; no need to invite it first.
          const result = say.result(view);
          rulings.push(parsed.wantsNewHand ? result.replace(/ They can deal the next hand\.$/, '') : result);
        }
      } catch (err) {
        if (!(err instanceof IllegalMove)) throw err;
        rulings.push(say.refused(kind, err.message, this.view()));
        message = err.message;
      }
    } else if (parsed.unclear) {
      rulings.push(say.unclear(parsed.unclear));
    }

    if (parsed.wantsNewHand) {
      const phase = this.match.phase;
      // A hand in play is not refused out loud: they usually asked for a new
      // hand in the same breath as folding, and the fold above ended it.
      if (phase !== 'playing') {
        const kind = phase === 'game-over' ? 'restart' : 'deal';
        try {
          this.reduce({ kind }, 'user');
          rulings.push(say.dealt(kind === 'restart'));
        } catch (err) {
          if (!(err instanceof IllegalMove)) throw err;
          rulings.push(say.dealRefused(err.message));
          message = err.message;
        }
      }
    }

    if (parsed.asksOwnCards) {
      // With the screen out of sight this is the only way to know your hand,
      // and "I can't reveal any cards" (the answer a player got) is the
      // card-secrecy rule aimed at the wrong player.
      const view = this.view();
      rulings.push(view.phase === 'playing' && view.user_hand.length ? say.ownCards(view.user_hand) : say.noCards());
    }

    if (!rulings.length) return { view: this.view(), handled: false };
    return { view: this.view(), handled: true, event: rulings.join(' '), ttl: ended ? 30 : 15, message };
  }

  /**
   * The opponent's turn, if it is one: decide (the model, or the safe action),
   * apply, and say what was played. Concurrent calls share one decision; a
   * table that moved while the model was thinking discards it.
   */
  async opponentTurn(ask: Ask | null): Promise<Outcome> {
    if (this.deciding) {
      await this.deciding.catch(() => undefined);
      return { view: this.view(), handled: false };
    }
    this.deciding = this.playOpponent(ask);
    try {
      return await this.deciding;
    } finally {
      this.deciding = null;
    }
  }

  private async playOpponent(ask: Ask | null): Promise<Outcome> {
    if (this.match.actionTo() !== 'agent') return { view: this.view(), handled: false };
    const seq = this.match.seq;
    const request = this.match.decisionRequest();
    const decision = await decide(request, ask, this.decisionTimeoutMs);
    if (this.match.seq !== seq || this.match.actionTo() !== 'agent') return { view: this.view(), handled: false };
    try {
      this.reduce({ kind: decision.kind, amount: decision.amount }, 'agent');
      this.lastDecision = decision;
    } catch (err) {
      if (!(err instanceof IllegalMove)) throw err;
      // Only reachable if a normalized decision is still illegal; never stall the table on it.
      const safe = safeAction(request.valid_actions, request.to_call);
      this.reduce(safe, 'agent');
      this.lastDecision = { ...safe, source: 'fallback' };
    }
    const view = this.view();
    const parts = [say.yourMove(view.last_action!)];
    if (view.phase !== 'playing') parts.push(say.result(view));
    return { view, handled: true, event: parts.join(' '), ttl: view.phase !== 'playing' ? 30 : 20 };
  }
}
