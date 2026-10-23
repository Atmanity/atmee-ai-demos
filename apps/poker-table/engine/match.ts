// The table itself: one heads-up match, ported from the original's
// `engine.py` (`PokerMatch`). Stacks persist across hands and the button
// alternates; the hand's rules are holdem.ts.
//
// It is pure by construction (no server, no avatar, no I/O), so the golden
// fixture corpus, recorded from the exact engine users played against, replays
// through it directly. The corpus pins street progression, blind order, pot
// arithmetic, stacks, showdowns and fold awards.
//
// One field diverges from the corpus ON PURPOSE. The old TS engine's
// `minRaise` was two units in one name (the big blind right after a deal, a
// raise-TO total after any raise) and the panel added `highBet` on top, so a
// re-raise over 60 was gated at 160 when no-limit rules say 100. `min_raise_to`
// here is what the rule says, and the parity test asserts everything else
// while documenting this one deliberate fix.
//
// Cards are injected: every deal consumes from a card sequence the caller
// supplies (tests hand in the fixture's recorded deal; the server a shuffled
// deck). One code path for both is what makes the fixtures evidence.
import { newDeck, secureRandom } from './cards.ts';
import { handRankLabel } from './evaluator.ts';
import { HeadsUpHand } from './holdem.ts';
import {
  BIG_BLIND, SMALL_BLIND, STARTING_STACK,
  type GamePhase, type LastAction, type PokerActionKind, type Seat, type Street, type TableView, type Winner,
} from './types.ts';

export const ACTION_KINDS: PokerActionKind[] = ['fold', 'check', 'call', 'raise'];
const STREET_NAMES: Street[] = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];

// What a player may SAY, mapped onto what the table does. "all in" is the one
// that matters: the table has an All-in button, so being told the phrase "isn't
// possible right now" reads as the table being broken. It is not a fifth
// action: it is a raise to everything you have, or a call when you cannot
// cover the bet, but a player should never have to know that to say it. The
// fold phrasings matter for the same reason: the avatar itself invites "I'm
// out", and without these the table answered its own invitation with "'i'm
// out' is not something this table can do".
const ACTION_ALIASES: Record<string, string> = {
  allin: 'all_in', all_in: 'all_in', 'all in': 'all_in', 'all-in': 'all_in', shove: 'all_in', jam: 'all_in',
  bet: 'raise',
  "i'm out": 'fold', 'im out': 'fold', 'i am out': 'fold', out: 'fold', muck: 'fold', 'lay it down': 'fold', 'i fold': 'fold',
  'i call': 'call', 'call it': 'call',
  'i check': 'check', 'check it': 'check',
  'i raise': 'raise', 'raise it': 'raise',
};

/** The action a spoken kind means. Unknown words pass through, so the table can refuse them by name. */
export function normalizeKind(kind: unknown): string {
  const text = String(kind ?? '').trim().toLowerCase();
  return ACTION_ALIASES[text] ?? text;
}

/** A move the table refuses. The reason is a sentence about the table: it reaches the screen and the avatar. */
export class IllegalMove extends Error {}

/** What the opponent's seat is called in the view: a ROLE, never a person's name. */
export const FALLBACK_SEAT_NAME = 'Opponent';

const other = (who: Seat): Seat => (who === 'user' ? 'agent' : 'user');

export interface MatchOptions {
  random?: () => number;
  smallBlind?: number;
  bigBlind?: number;
  startingStack?: number;
}

export class PokerMatch {
  private readonly random: () => number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly startingStack: number;
  private stacks: Record<Seat, number>;
  // The first hand's button is the user, matching the table users know (and
  // the corpus); deal() flips it before posting blinds.
  private buttonSeat: Seat = 'agent';
  private hand: HeadsUpHand | null = null;
  private hole: Record<Seat, string[]> = { user: [], agent: [] };
  private deck: string[] = [];
  private currentPhase: GamePhase = 'lobby';
  private lastAction: LastAction | null = null;
  private winner: Winner | null = null;
  private showdown = false;
  private folder: Seat | null = null;
  private foldAward = 0;
  // The session line. Stacks are a running total but not a HISTORY, so "how
  // many hands have we played, who's ahead?" was answered from nothing: the
  // avatar said "we've played one hand" in the middle of the first one, and
  // read a live bet as a result. These are the only facts that can answer it.
  private handsPlayed = 0;
  private handsWon: Record<Seat, number> = { user: 0, agent: 0 };
  /** Bumped by every change the table accepts. */
  seq = 0;

  constructor(opts: MatchOptions = {}) {
    this.random = opts.random ?? secureRandom;
    this.smallBlind = opts.smallBlind ?? SMALL_BLIND;
    this.bigBlind = opts.bigBlind ?? BIG_BLIND;
    this.startingStack = opts.startingStack ?? STARTING_STACK;
    this.stacks = { user: this.startingStack, agent: this.startingStack };
  }

  // ---- queries -----------------------------------------------------------------

  get phase(): GamePhase { return this.currentPhase; }
  get button(): Seat { return this.buttonSeat; }
  get handNumber(): number { return this.handsPlayed + (this.currentPhase === 'playing' ? 1 : 0); }

  private pkIndex(who: Seat) { return who === this.buttonSeat ? 1 : 0; }
  private who(pkIndex: number): Seat { return pkIndex === 1 ? this.buttonSeat : other(this.buttonSeat); }

  get handLive(): boolean {
    return this.currentPhase === 'playing' && this.hand !== null && this.hand.status;
  }

  actionTo(): Seat | null {
    if (!this.handLive) return null;
    const idx = this.hand!.actorIndex;
    return idx === null ? null : this.who(idx);
  }

  /** A seat's own hole cards. The server's business only: the view carries the user's, never the agent's before a showdown. */
  holeCards(who: Seat): string[] { return [...this.hole[who]]; }

  // ---- dealing -------------------------------------------------------------------

  /**
   * Start a hand. `cards` injects the deal (tests); omitted, the deck is shuffled.
   * Card order when injecting: the first four are hole cards in dealing
   * rotation (big blind first); the rest are the board as the streets need it,
   * which is exactly what a fixture records.
   */
  deal(cards?: string[]) {
    if (this.currentPhase === 'playing') throw new IllegalMove('a hand is already in play');
    if (this.currentPhase === 'game-over') throw new IllegalMove('the match is over — restart to play on');
    if (Math.min(this.stacks.user, this.stacks.agent) <= 0) {
      this.currentPhase = 'game-over';
      throw new IllegalMove('a stack is empty — the match is over');
    }
    this.buttonSeat = other(this.buttonSeat);
    const button = this.buttonSeat;
    this.hand = new HeadsUpHand([this.stacks[other(button)], this.stacks[button]], this.smallBlind, this.bigBlind);
    this.deck = cards ? [...cards] : newDeck(this.random);
    this.hole = { user: [], agent: [] };
    this.winner = null;
    this.showdown = false;
    this.folder = null;
    this.foldAward = 0;
    this.currentPhase = 'playing';
    this.lastAction = { by: 'table', kind: 'deal', applied: true };
    while (this.hand.canDealHole()) {
      const seat = this.who(this.hand.holeDealeeIndex()!);
      const [card] = this.take(1);
      this.hole[seat].push(card);
      this.hand.dealHole(card);
    }
    this.advance();
    this.seq += 1;
  }

  private take(n: number): string[] {
    if (this.deck.length < n) throw new IllegalMove('the injected deal ran out of cards');
    return this.deck.splice(0, n);
  }

  /** Deal any board cards the hand is waiting for, then settle. */
  private advance() {
    const hand = this.hand!;
    while (hand.canDealBoard()) hand.dealBoard(this.take(hand.boardDealingCount() || 1));
    if (!hand.status) this.settle();
  }

  private settle() {
    const hand = this.hand!;
    const payoffs = hand.payoffs;
    for (const seat of ['user', 'agent'] as Seat[]) this.stacks[seat] = hand.stacks[this.pkIndex(seat)];
    this.showdown = this.folder === null;
    this.handsPlayed += 1;
    if (this.showdown && payoffs[0] === payoffs[1]) {
      // A split pot. The original read pokerkit's [0, 0] payoffs as a win for
      // the first seat ("Opponent wins 0"); a tie is nobody's hand.
      const rank = handRankLabel([...this.hole.user, ...this.board]);
      this.winner = { who: 'split', amount: hand.potPushed, hand_rank: rank };
    } else {
      const winnerIdx = payoffs[1] > payoffs[0] ? 1 : 0;
      const who = this.who(winnerIdx);
      const amount = this.folder !== null ? this.foldAward : -payoffs[1 - winnerIdx] * 2;
      const rank = this.showdown ? handRankLabel([...this.hole[who], ...this.board]) : null;
      this.winner = { who, amount, hand_rank: rank };
      this.handsWon[who] += 1;
    }
    this.currentPhase = Math.min(this.stacks.user, this.stacks.agent) <= 0 ? 'game-over' : 'hand-over';
  }

  private get board(): string[] { return this.hand ? [...this.hand.board] : []; }

  // ---- moves ---------------------------------------------------------------------

  /** One player's move. Throws IllegalMove with a table-shaped reason. */
  applyMove(who: Seat, kindIn: unknown, amountIn?: unknown) {
    const spoken = String(kindIn ?? '').trim().toLowerCase();
    let kind = normalizeKind(kindIn);
    if (!(ACTION_KINDS as string[]).includes(kind) && kind !== 'all_in') throw new IllegalMove(`'${spoken}' is not a poker action`);
    if (!this.handLive) throw new IllegalMove('there is no hand in play');
    const turn = this.actionTo();
    if (turn !== who) throw new IllegalMove(turn ? 'it is not your turn' : 'the hand is settling');

    const st = this.hand!;
    const toCall = st.checkingOrCallingAmount ?? 0;
    let amount: number | null = typeof amountIn === 'number' && Number.isFinite(amountIn) ? amountIn : null;
    if (kind === 'fold') {
      if (toCall === 0) {
        // Courtesy the table users know: never fold for free. The original
        // still reported it as a fold; it is a check, and the table says so.
        st.checkOrCall();
        kind = 'check';
      } else {
        // The fold award is decided by what the table looked like at the
        // moment of the fold: it cannot be reconstructed after uncalled bets
        // are returned. It is the MATCHED pot, the same convention a showdown
        // uses: everything already collected, plus both halves of the
        // street's matched action. The folder always has the smaller bet, so
        // their bet is what the winner matched. Counting only the folder's
        // half made the table announce "wins 20" after a fold to a 40 pot;
        // the same spot pays 40 at a showdown.
        const bets = this.bets();
        const collected = this.pot() - bets.user - bets.agent;
        this.folder = who;
        this.foldAward = collected + bets[who] * 2;
        st.fold();
      }
    } else if (kind === 'check') {
      if (toCall > 0) throw new IllegalMove('you cannot check facing a bet — call, raise or fold');
      st.checkOrCall();
    } else if (kind === 'call') {
      st.checkOrCall();
    } else if (kind === 'all_in') {
      // Everything you have. When the stack cannot cover the bet there is
      // nothing to raise TO: the call is capped at the stack, which is exactly
      // the all-in a short player means.
      const top = this.maxRaiseTo(who);
      if (st.canCompleteBetOrRaiseTo(top)) {
        st.completeBetOrRaiseTo(top);
        amount = top;
        kind = 'raise';
      } else {
        st.checkOrCall();
        kind = toCall > 0 ? 'call' : 'check';
        amount = null;
      }
    } else {
      // raise (an opening bet travels as 'raise' too)
      this.raiseTo(amountIn);
      amount = Math.trunc(Number(amountIn));
    }

    this.lastAction = { by: who, kind: kind as PokerActionKind, ...(kind === 'raise' && amount !== null ? { amount } : {}), applied: true };
    this.advance();
    this.seq += 1;
  }

  private raiseTo(amount: unknown) {
    if (amount === null || amount === undefined) throw new IllegalMove('a raise needs an amount (a raise-to total)');
    const total = Math.trunc(Number(amount));
    if (!Number.isFinite(total)) throw new IllegalMove('that raise amount is not a number');
    const st = this.hand!;
    if (!st.canCompleteBetOrRaiseTo(total)) {
      const lo = st.minCompletionBettingOrRaisingToAmount;
      const hi = st.maxCompletionBettingOrRaisingToAmount;
      if (lo === null || hi === null) throw new IllegalMove('nobody can raise now — call or fold');
      throw new IllegalMove(`a raise must be to at least ${lo} and at most ${hi} chips`);
    }
    st.completeBetOrRaiseTo(total);
  }

  // ---- projections ---------------------------------------------------------------

  street(): Street | null {
    if ((this.currentPhase === 'hand-over' || this.currentPhase === 'game-over') && this.winner) return 'SHOWDOWN';
    if (!this.handLive) return null;
    const idx = this.hand!.streetIndex;
    return idx === null ? 'SHOWDOWN' : STREET_NAMES[Math.min(idx, 3)];
  }

  private bets(): Record<Seat, number> {
    if (!this.hand || !this.hand.status) return { user: 0, agent: 0 };
    return { user: this.hand.bets[this.pkIndex('user')], agent: this.hand.bets[this.pkIndex('agent')] };
  }

  pot(): number {
    if (!this.hand || !this.hand.status) return 0;
    return this.hand.totalPotAmount;
  }

  validActions(who: Seat): PokerActionKind[] {
    if (this.actionTo() !== who) return [];
    const st = this.hand!;
    const toCall = st.checkingOrCallingAmount ?? 0;
    const actions: PokerActionKind[] = ['fold', toCall === 0 ? 'check' : 'call'];
    if (st.canCompleteBetOrRaiseTo()) actions.push('raise');
    return actions;
  }

  /** The smallest legal raise-TO total: the RULE's number, not the old TS engine's. */
  minRaiseTo(): number {
    if (!this.handLive) return this.bigBlind * 2;
    return this.hand!.minCompletionBettingOrRaisingToAmount ?? this.bigBlind * 2;
  }

  maxRaiseTo(who: Seat): number {
    return this.bets()[who] + this.stacksLive()[who];
  }

  private stacksLive(): Record<Seat, number> {
    if (!this.hand || !this.hand.status) return { ...this.stacks };
    return { user: this.hand.stacks[this.pkIndex('user')], agent: this.hand.stacks[this.pkIndex('agent')] };
  }

  private folded(who: Seat): boolean {
    if (!this.hand) return false;
    if (this.winner) return this.folder === who;
    return !this.hand.statuses[this.pkIndex(who)];
  }

  /**
   * The PUBLIC view: the corpus shape, the opponent's hole cards only at a real
   * showdown. This is what the page draws and what the avatar's state is built from.
   */
  view(names: Record<Seat, string> = { user: 'You', agent: FALLBACK_SEAT_NAME }): TableView {
    const bets = this.bets();
    const stacks = this.stacksLive();
    const acting = this.actionTo();
    const high = Math.max(bets.user, bets.agent);
    const minTo = this.minRaiseTo();
    return {
      game: 'poker',
      seq: this.seq,
      phase: this.currentPhase,
      street: this.street(),
      board: this.board,
      pot: this.pot(),
      current_bet: high,
      min_raise: Math.max(minTo - high, 0),
      min_raise_to: minTo,
      max_raise_to: acting ? this.maxRaiseTo(acting) : 0,
      to_call: acting ? this.hand!.checkingOrCallingAmount ?? 0 : 0,
      action_to: acting,
      valid_actions: acting ? this.validActions(acting) : [],
      button: this.buttonSeat,
      players: {
        user: { name: names.user, stack: stacks.user, bet: bets.user, folded: this.folded('user') },
        agent: { name: names.agent, stack: stacks.agent, bet: bets.agent, folded: this.folded('agent') },
      },
      // The user's OWN cards: the page is the user's surface. The opponent's
      // stay hidden until a real showdown; a fold never reveals them.
      user_hand: [...this.hole.user],
      revealed_hands: this.showdown ? { user: [...this.hole.user], agent: [...this.hole.agent] } : null,
      winner: this.winner ? { ...this.winner } : null,
      last_action: this.lastAction ? { ...this.lastAction } : null,
      // Counted at settle, so a hand in progress is not one played.
      session: {
        hands_played: this.handsPlayed,
        hands_won_user: this.handsWon.user,
        hands_won_agent: this.handsWon.agent,
        chips_up_user: stacks.user + bets.user - this.startingStack,
      },
    };
  }

  /** What the opponent's decision needs: its own private view of its turn. Never the user's cards. */
  decisionRequest(): DecisionRequest {
    const bets = this.bets();
    const stacks = this.stacksLive();
    const high = Math.max(bets.user, bets.agent);
    return {
      hand: [...this.hole.agent],
      board: this.board,
      street: this.street(),
      pot: this.pot(),
      your_stack: stacks.agent,
      opponent_stack: stacks.user,
      // What Dex can actually put in: a short stack calls all in for less, as the table's own view says.
      to_call: Math.min(high - bets.agent, stacks.agent),
      current_bet: high,
      min_raise_to: this.minRaiseTo(),
      max_raise_to: this.maxRaiseTo('agent'),
      valid_actions: this.validActions('agent'),
    };
  }

  /** A fresh match: full stacks, the button resets. Only between hands; mid-hand this would be a chip printer. */
  restart() {
    if (this.currentPhase === 'playing') throw new IllegalMove('finish the hand before restarting the match');
    this.stacks = { user: this.startingStack, agent: this.startingStack };
    this.buttonSeat = 'agent';
    this.handsPlayed = 0;
    this.handsWon = { user: 0, agent: 0 };
    this.hand = null;
    this.currentPhase = 'lobby';
    this.winner = null;
    this.lastAction = null;
    this.hole = { user: [], agent: [] };
    this.seq += 1;
  }
}

export interface DecisionRequest {
  hand: string[];
  board: string[];
  street: Street | null;
  pot: number;
  your_stack: number;
  opponent_stack: number;
  to_call: number;
  current_bet: number;
  min_raise_to: number;
  max_raise_to: number;
  valid_actions: PokerActionKind[];
}
