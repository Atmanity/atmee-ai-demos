// One heads-up no-limit hold'em hand: blinds, the four betting rounds, the
// min-raise rule, all-ins, uncalled bets and the showdown.
//
// The original ran on pokerkit (`NoLimitTexasHoldem`, tournament mode, every
// automation but the dealing). There is no mature JavaScript equivalent (the
// old panel's `@pokertools/engine` had the min-raise bug documented in
// match.ts), so this is the subset of pokerkit's state machine that
// `engine.py` relies on, ported for two seats with pokerkit's own names and
// order of operations, so the golden fixtures pin it the same way.
//
// Seats are pokerkit's indices: 0 is the big blind, 1 the button (it posts the
// small blind, acts first before the flop and last after it). The caller deals
// every card (hole cards one at a time, the board as the streets need it);
// burn cards are pokerkit's own business and never come out of the caller's
// deck, so they are not modelled.
import { bestScore, compareScores } from './evaluator.ts';

export class HandError extends Error {}

const STREET_BOARD_COUNTS = [0, 3, 1, 1];

export class HeadsUpHand {
  /** Chips behind, per seat. */
  readonly stacks: number[];
  /** Chips in front of each seat this street, not yet collected. */
  readonly bets = [0, 0];
  /** Still in the hand (not folded). */
  readonly statuses = [true, true];
  readonly hole: string[][] = [[], []];
  readonly board: string[] = [];
  /** Chips already collected into the pot from finished streets. */
  collected = 0;
  /** 0 preflop … 3 river; null before the deal and once the hand is over. */
  streetIndex: number | null = null;
  /** True while the hand is being played. */
  status = true;
  /** Per seat, once the hand is over: the change in chips (pokerkit's `payoffs`). */
  payoffs: number[] = [0, 0];
  /** The pot the winner (or both, on a split) took, uncalled bets excluded. */
  potPushed = 0;

  private readonly starting: number[];
  private actors: number[] = [];
  private readonly acted = new Set<number>();
  /** pokerkit's `completion_betting_or_raising_amount`: the last full raise's size. */
  private raiseIncrement = 0;
  /** Short all-in raise sizes in a row, which can add up to a full raise. */
  private shortAllIns: number[] = [];
  private allInStatus = false;
  private holePending = 0;
  private boardPending = 0;

  /** `stacks` is [big blind seat, button seat], as pokerkit takes them heads-up. */
  constructor(stacks: [number, number], readonly smallBlind: number, readonly bigBlind: number, readonly minBet = bigBlind) {
    this.stacks = [...stacks];
    this.starting = [...stacks];
    // Blinds, reversed heads-up: the big blind is seat 0. A short stack posts what it has.
    this.post(0, Math.min(bigBlind, this.stacks[0]));
    this.post(1, Math.min(smallBlind, this.stacks[1]));
    this.beginDealing();
  }

  private post(seat: number, amount: number) {
    this.bets[seat] += amount;
    this.stacks[seat] -= amount;
  }

  // ---- dealing ---------------------------------------------------------------

  canDealHole(): boolean { return this.holePending > 0; }

  /** Whose hole card comes next: seat 0 first, then alternating. */
  holeDealeeIndex(): number | null {
    if (!this.canDealHole()) return null;
    return this.hole[0].length <= this.hole[1].length ? 0 : 1;
  }

  dealHole(card: string) {
    const seat = this.holeDealeeIndex();
    if (seat === null) throw new HandError('no hole card is due');
    this.hole[seat].push(card);
    this.holePending -= 1;
    if (!this.holePending) this.beginBetting();
  }

  canDealBoard(): boolean { return this.boardPending > 0; }

  /** How many board cards the state is waiting for. */
  boardDealingCount(): number { return this.boardPending; }

  dealBoard(cards: string[]) {
    if (cards.length !== this.boardPending) throw new HandError(`${this.boardPending} board card(s) are due`);
    this.board.push(...cards);
    this.boardPending = 0;
    this.beginBetting();
  }

  private beginDealing() {
    this.streetIndex = this.streetIndex === null ? 0 : this.streetIndex + 1;
    if (this.streetIndex === 0) this.holePending = 4;
    else this.boardPending = STREET_BOARD_COUNTS[this.streetIndex];
  }

  // ---- betting -----------------------------------------------------------------

  /** What a seat "can possibly lose": capped by the other seat's total. */
  effectiveStack(seat: number): number {
    if (this.streetIndex === null || !this.statuses[seat]) return 0;
    const totals = [0, 1].filter((i) => this.statuses[i]).map((i) => this.bets[i] + this.stacks[i]).sort((a, b) => a - b);
    if (totals.length < 2) return 0;
    return Math.min(this.stacks[seat], Math.max(0, totals[totals.length - 2] - this.bets[seat]));
  }

  private beginBetting() {
    // The opener: the seat after the biggest blind preflop (the button), the
    // big blind on later streets (bets are level, ties go to the higher index).
    const maxBetSeat = this.bets[1] > this.bets[0] || this.bets[1] === this.bets[0] ? 1 : 0;
    const opener = (maxBetSeat + 1) % 2;
    this.actors = [opener, 1 - opener].filter((i) => this.statuses[i] && this.stacks[i] > 0 && this.effectiveStack(i) > 0);
    this.raiseIncrement = 0;
    this.acted.clear();
    this.shortAllIns = [];
    this.updateBetting(this.actors.length === 1 && this.bets[this.actors[0]] >= Math.max(...this.bets));
  }

  private updateBetting(done = false) {
    if (!this.actors.length || this.statuses.filter(Boolean).length <= 1 || done) this.endBetting();
  }

  private endBetting() {
    this.actors = [];
    if (this.statuses.filter(Boolean).length > 1) {
      const withChips = [0, 1].filter((i) => this.statuses[i] && this.stacks[i] > 0).length;
      if (withChips <= 1) this.allInStatus = true;
    }
    this.collectBets();
    this.endBetCollection();
  }

  /** Into the pot; an uncalled excess goes back to its owner. A folded hand's winner keeps their own bet in front. */
  private collectBets() {
    if (!this.bets.some(Boolean)) return;
    const live = this.statuses.filter(Boolean).length;
    const seats = live === 1 ? [this.statuses.indexOf(false)] : [0, 1];
    const cutoff = Math.min(...this.bets);
    for (const i of seats) {
      if (this.bets[i] > cutoff) {
        this.stacks[i] += this.bets[i] - cutoff;
        this.bets[i] = cutoff;
      }
      this.collected += this.bets[i];
      this.bets[i] = 0;
    }
  }

  private endBetCollection() {
    if (this.statuses.filter(Boolean).length === 1) return this.pushChips([this.statuses.indexOf(true)]);
    if (this.streetIndex === 3) return this.showdown();
    // Otherwise the next street. After an all-in pokerkit shows the hands first,
    // then deals the rest of the board with no betting (nobody is left to act).
    this.beginDealing();
  }

  private showdown() {
    const scores = [0, 1].map((i) => bestScore([...this.hole[i], ...this.board]));
    const cmp = compareScores(scores[0], scores[1]);
    this.pushChips(cmp > 0 ? [0] : cmp < 0 ? [1] : [0, 1]);
  }

  private pushChips(winners: number[]) {
    const pot = this.collected + this.bets[0] + this.bets[1];
    this.potPushed = winners.length === 1 ? pot - this.bets[winners[0]] : pot;
    const share = Math.floor(pot / winners.length);
    // Heads-up the matched pot is always even, so a split never leaves an odd chip.
    winners.forEach((w, n) => { this.stacks[w] += n === 0 ? pot - share * (winners.length - 1) : share; });
    this.bets[0] = this.bets[1] = 0;
    this.collected = 0;
    this.payoffs = [0, 1].map((i) => this.stacks[i] - this.starting[i]);
    this.status = false;
    this.streetIndex = null;
  }

  // ---- actions -------------------------------------------------------------------

  get actorIndex(): number | null { return this.actors[0] ?? null; }

  /** What the player to act puts in to check (0) or call (capped at their stack). */
  get checkingOrCallingAmount(): number | null {
    const p = this.actorIndex;
    if (p === null) return null;
    return Math.min(this.stacks[p], Math.max(...this.bets) - this.bets[p]);
  }

  private popActor(): number {
    const p = this.actors.shift()!;
    this.acted.add(p);
    return p;
  }

  fold() {
    const p = this.actorIndex;
    if (p === null) throw new HandError('there is no player to act');
    // Tournament mode: folding when nothing is owed is refused.
    if (this.bets[p] >= Math.max(...this.bets)) throw new HandError('there is no reason for this player to fold');
    this.popActor();
    this.statuses[p] = false;
    this.updateBetting();
  }

  checkOrCall() {
    const amount = this.checkingOrCallingAmount;
    if (amount === null) throw new HandError('there is no player to act');
    const p = this.popActor();
    this.post(p, amount);
    this.updateBetting();
  }

  /** Why the player to act may not bet or raise, or null if they may. */
  private raiseRefusal(): string | null {
    const p = this.actorIndex;
    if (p === null) return 'there is no player to act';
    const owed = this.checkingOrCallingAmount!;
    if (owed < this.raiseIncrement) return 'a short all-in cannot be raised';
    if (this.shortAllIns.length && this.shortAllIns.reduce((a, b) => a + b, 0) < this.raiseIncrement && this.acted.has(p)) {
      return 'the player already acted and cannot raise a non-full all-in';
    }
    if (this.stacks[p] <= Math.max(...this.bets) - this.bets[p]) return 'the player is already covered by the bet';
    const other = 1 - p;
    if (!(this.statuses[other] && this.stacks[other] + this.bets[other] > Math.max(...this.bets))) {
      return 'every other player has folded or gone all-in';
    }
    return null;
  }

  /** The smallest legal raise-TO total (all-in when the stack is shorter), or null if no raise is possible. */
  get minCompletionBettingOrRaisingToAmount(): number | null {
    if (this.raiseRefusal()) return null;
    const p = this.actorIndex!;
    const amount = Math.max(this.raiseIncrement, this.minBet) + Math.max(...this.bets);
    return Math.min(this.stacks[p] + this.bets[p], amount);
  }

  /** No limit: everything the player has. */
  get maxCompletionBettingOrRaisingToAmount(): number | null {
    if (this.raiseRefusal()) return null;
    const p = this.actorIndex!;
    return this.stacks[p] + this.bets[p];
  }

  canCompleteBetOrRaiseTo(amount?: number): boolean {
    const lo = this.minCompletionBettingOrRaisingToAmount;
    const hi = this.maxCompletionBettingOrRaisingToAmount;
    if (lo === null || hi === null) return false;
    const to = amount ?? lo;
    return Number.isInteger(to) && to >= lo && to <= hi;
  }

  completeBetOrRaiseTo(amount: number) {
    if (!this.canCompleteBetOrRaiseTo(amount)) throw new HandError(`cannot raise to ${amount}`);
    const p = this.popActor();
    const increment = amount - Math.max(...this.bets);
    this.post(p, amount - this.bets[p]);
    // Everyone else with chips acts again.
    const other = 1 - p;
    this.actors = this.statuses[other] && this.stacks[other] > 0 ? [other] : [];
    if (increment >= this.raiseIncrement) {
      this.acted.clear();
      this.acted.add(p);
    }
    this.raiseIncrement = Math.max(this.raiseIncrement, increment);
    if (this.stacks[p]) this.shortAllIns = [];
    else this.shortAllIns.push(increment);
    if (this.shortAllIns.reduce((a, b) => a + b, 0) >= this.raiseIncrement) this.shortAllIns = [];
    this.updateBetting();
  }

  /** Everything in the middle, uncollected bets included (pokerkit's `total_pot_amount`). */
  get totalPotAmount(): number {
    return this.status ? this.collected + this.bets[0] + this.bets[1] : 0;
  }
}
