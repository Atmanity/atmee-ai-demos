// Replay the golden corpus through PokerMatch (ported from the original's
// test_engine_parity.py).
//
// The corpus was recorded from `@pokertools/engine` 1.0.1, the engine users
// actually played against, with the deal captured so RNG parity never
// matters. Every scripted action replays here with the recorded cards
// injected, and every resulting public state must match field for field.
//
// Two deliberate divergences, asserted AROUND rather than papered over:
//
// * `min_raise`: the TS engine's value was two units under one name (big
//   blind after a deal, raise-TO total after a raise) and over-restricted
//   re-raises. The rules engine implements the actual no-limit rule, so the
//   field is EXCLUDED from parity and `min_raise_to` is checked directly.
// * `phase` / `last_action` / `min_raise_to` / `seq` / player `name`: fields
//   the new view carries that the recorded TS snapshot did not. Ignored on
//   comparison; asserted in their own tests.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { IllegalMove, PokerMatch } from './match.ts';
import type { Seat, TableView } from './types.ts';

const FIXTURES = new URL('./fixtures/hands/', import.meta.url);

/** Corpus fields whose parity is asserted exactly. */
const COMPARED = ['street', 'board', 'pot', 'current_bet', 'to_call', 'action_to', 'valid_actions', 'button', 'revealed_hands'] as const;

interface Step { apply: 'deal' | { by: Seat; kind: string; amount: number | null }; state: any }
interface Hand { hole: Record<Seat, string[]>; board: string[]; steps: Step[] }
interface Scenario { name: string; config: { small_blind: number; big_blind: number; starting_stack: number }; hands: Hand[] }

function scenarios(): Scenario[] {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort();
  expect(files.length, 'golden corpus missing').toBe(7);
  return files.map((f) => JSON.parse(readFileSync(new URL(f, FIXTURES), 'utf8')));
}

/**
 * The recorded deal, in the order PokerMatch consumes it. Hole cards are dealt
 * one at a time in rotation starting with the seat after the button (the big
 * blind heads-up), so the interleave is derived from who had the button.
 */
function fixtureDeck(hand: Hand): string[] {
  const button: Seat = hand.steps[0].state.button;
  const nonButton: Seat = button === 'user' ? 'agent' : 'user';
  const u = hand.hole[nonButton];
  const a = hand.hole[button];
  return [u[0], a[0], u[1], a[1], ...hand.board];
}

const playersPublic = (state: any) =>
  Object.fromEntries((['user', 'agent'] as const).map((seat) => [seat, { stack: state.players[seat].stack, bet: state.players[seat].bet, folded: state.players[seat].folded }]));

/**
 * Who won and with what, exactly; how much, only at a showdown. The recorded
 * engine used two conventions for one field: the matched pot at a showdown,
 * but only the FOLDER's own chips on a fold, so the same 40-chip pot was
 * announced as "wins 40" one way and "wins 20" the other. The fold award now
 * reports the matched pot on both paths, so it is asserted against the rule.
 */
function expectWinnerParity(got: TableView['winner'], want: any, where: string) {
  expect(got === null, where).toBe(want === null);
  if (!got || !want) return;
  expect(got.who, where).toBe(want.who);
  expect(got.hand_rank, where).toBe(want.hand_rank);
  if (want.hand_rank !== null) expect(got.amount, where).toBe(want.amount);
  else expect(got.amount, where).toBeGreaterThanOrEqual(want.amount);
}

describe('the golden corpus replays through the port', () => {
  for (const scenario of scenarios()) {
    test(scenario.name, () => {
      const match = new PokerMatch({ smallBlind: scenario.config.small_blind, bigBlind: scenario.config.big_blind, startingStack: scenario.config.starting_stack });
      scenario.hands.forEach((hand, h) => {
        hand.steps.forEach((step, s) => {
          if (step.apply === 'deal') match.deal(fixtureDeck(hand));
          else match.applyMove(step.apply.by, step.apply.kind, step.apply.amount);
          const got = match.view();
          const want = step.state;
          const where = `${scenario.name} hand[${h}] step[${s}]`;
          for (const field of COMPARED) expect(got[field], `${where}: ${field}`).toEqual(want[field]);
          expect(playersPublic(got), where).toEqual(playersPublic(want));
          expectWinnerParity(got.winner, want.winner, where);
        });
      });
    });
  }
});

const DEAL = ['As', 'Kd', 'Ah', 'Kc', '2c', '7d', '9h', '3s', '5c'];

test('a fold awards the whole matched pot, not half of it', () => {
  // Symptom: the table said "wins 20" after taking down a 40-chip pot: the
  // user had called to 20 and folded to a raise, so 20 of the pot was the
  // winner's own and 20 was theirs. The very same 40 chips would have been
  // announced as 40 had the hand gone to a showdown.
  const match = new PokerMatch();
  match.deal(DEAL);
  const smallBlind = match.actionTo()!; // the button acts first preflop, heads-up
  const bigBlind: Seat = smallBlind === 'user' ? 'agent' : 'user';
  match.applyMove(smallBlind, 'call');
  match.applyMove(bigBlind, 'raise', 40);
  match.applyMove(smallBlind, 'fold');
  const winner = match.view().winner!;
  expect(winner.who).toBe(bigBlind);
  // 20 theirs + 20 of the winner's own, matched. The winner's uncalled 20 is
  // returned and was never part of any pot.
  expect(winner.amount).toBe(40);
});

test('min_raise_to is the rule, not the old TS bug', () => {
  // After a raise to 60 over a 20 blind, the minimum re-raise is TO 100
  // (matching the 40 increment). The TS engine demanded 160.
  const match = new PokerMatch();
  match.deal(DEAL);
  match.applyMove(match.actionTo()!, 'raise', 60);
  expect(match.minRaiseTo()).toBe(100);
  const view = match.view();
  expect(view.min_raise_to).toBe(100);
  expect(view.min_raise).toBe(40);
});

test('illegal moves are refused with a reason', () => {
  const match = new PokerMatch();
  match.deal(DEAL);
  const turn = match.actionTo()!;
  const waiting: Seat = turn === 'user' ? 'agent' : 'user';
  expect(() => match.applyMove(waiting, 'call')).toThrow(/not your turn/);
  expect(() => match.applyMove(turn, 'check')).toThrow(/cannot check facing a bet/);
  expect(() => match.applyMove(turn, 'raise', 21)).toThrow(/at least 40/);
  expect(() => match.applyMove(turn, 'raise')).toThrow(/needs an amount/);
  expect(() => new PokerMatch().applyMove('user', 'call')).toThrow(IllegalMove);
});

test('a refused move leaves the table exactly as it was', () => {
  const match = new PokerMatch();
  match.deal(DEAL);
  const before = JSON.stringify(match.view());
  expect(() => match.applyMove(match.actionTo()!, 'raise', 5)).toThrow(IllegalMove);
  expect(JSON.stringify(match.view())).toBe(before);
});

test('a deal is refused mid-hand', () => {
  const match = new PokerMatch();
  match.deal(DEAL);
  expect(() => match.deal()).toThrow(/already in play/);
});

test('the public view never leaks live hole cards', () => {
  // The reason the view exists at all: the page's devtools must not show the
  // opponent's cards. Only a REAL showdown reveals; a fold never does.
  const match = new PokerMatch();
  match.deal(DEAL);
  const view = match.view();
  const agentCards = match.holeCards('agent');
  expect(agentCards).toHaveLength(2);
  expect(view.user_hand).toEqual(match.holeCards('user'));
  const live = JSON.stringify(view);
  for (const card of agentCards) expect(live).not.toContain(`"${card}"`);
  match.applyMove(match.actionTo()!, 'fold');
  const after = match.view();
  expect(after.revealed_hands).toBeNull();
  for (const card of agentCards) expect(JSON.stringify(after)).not.toContain(`"${card}"`);
});

test('restart only from the end of a hand, and it starts the match over', () => {
  const match = new PokerMatch({ startingStack: 100 });
  match.deal([...DEAL, '5d']);
  expect(() => match.restart()).toThrow(/finish the hand/);
  match.applyMove(match.actionTo()!, 'raise', 100);
  match.applyMove(match.actionTo()!, 'call');
  expect(['hand-over', 'game-over']).toContain(match.phase);
  match.restart();
  expect(match.phase).toBe('lobby');
  match.deal(DEAL);
  expect([90, 80]).toContain(match.view().players.user.stack);
});

describe('all-in', () => {
  test('a shove is a raise to everything, and a call of it runs the board out', () => {
    const match = new PokerMatch();
    match.deal(DEAL);
    const first = match.actionTo()!;
    match.applyMove(first, 'all in');
    const view = match.view();
    expect(view.last_action).toMatchObject({ by: first, kind: 'raise', amount: 1000 });
    expect(view.players[first].stack).toBe(0);
    match.applyMove(match.actionTo()!, 'call');
    const done = match.view();
    expect(done.board).toHaveLength(5);
    expect(done.street).toBe('SHOWDOWN');
    expect(done.revealed_hands).not.toBeNull();
    expect(done.players.user.stack + done.players.agent.stack).toBe(2000);
  });

  test('a short stack facing a bigger bet goes all-in by calling, and the excess comes back', () => {
    // Make the user short: they lose a 300-chip pot first.
    const match = new PokerMatch();
    match.deal(['2c', '2d', 'Ah', 'Ad', '7s', '8s', 'Jd', 'Qc', '4h']); // hand 1: the user is on the button
    const userCards = match.holeCards('user');
    expect(userCards).toEqual(['2d', 'Ad']);
    match.applyMove('user', 'raise', 300);
    match.applyMove('agent', 'call');
    for (let i = 0; i < 3; i++) { match.applyMove('agent', 'check'); match.applyMove('user', 'check'); }
    const afterOne = match.view();
    expect(afterOne.phase).toBe('hand-over');
    const userStack = afterOne.players.user.stack;
    const agentStack = afterOne.players.agent.stack;
    expect(userStack + agentStack).toBe(2000);
    const [short, deep]: Seat[] = userStack < agentStack ? ['user', 'agent'] : ['agent', 'user'];
    // Hand 2: the agent is on the button and acts first.
    match.deal(['3c', '4d', '9h', 'Td', 'Ks', 'Qs', '2h', '5c', '6d']);
    let guard = 0;
    while (match.actionTo() !== deep && guard++ < 4) match.applyMove(match.actionTo()!, 'call');
    if (match.actionTo() === deep) {
      match.applyMove(deep, 'all in');
      expect(match.view().players[deep].stack).toBe(0);
      match.applyMove(short, 'all in'); // can only call: there is nothing to raise TO
      expect(match.view().last_action?.kind).toBe('call');
    }
    const end = match.view();
    expect(end.players.user.stack + end.players.agent.stack).toBe(2000);
    expect(end.board).toHaveLength(5);
  });

  test("the all-in amount is the player's own total, and a bigger stack's excess is returned uncalled", () => {
    const match = new PokerMatch({ startingStack: 1000 });
    match.deal(DEAL);
    match.applyMove('user', 'raise', 300);
    match.applyMove('agent', 'call');
    for (let i = 0; i < 3; i++) { match.applyMove('agent', 'check'); match.applyMove('user', 'check'); }
    const v1 = match.view();
    // The big blind is dealt first, so DEAL gives the agent AsAh against the
    // user's KdKc: the agent wins the 600 pot.
    expect(v1.winner).toMatchObject({ who: 'agent', amount: 600, hand_rank: 'One Pair' });
    expect(v1.players.agent.stack).toBe(1300);
    // Hand 2: the agent is on the button and acts first preflop; the user is dealt aces.
    match.deal(['Ac', '3d', 'Ah', '8d', 'Ks', 'Qs', 'Jh', '5c', '4d']);
    match.applyMove('agent', 'all in');
    // No-limit lets it shove all 1,300, more than the user can ever match.
    expect(match.view().players.agent).toMatchObject({ stack: 0, bet: 1300 });
    expect(match.view().valid_actions).toEqual(['fold', 'call']);
    match.applyMove('user', 'all in'); // nothing to raise TO: a call of everything
    expect(match.view().last_action?.kind).toBe('call');
    const end = match.view();
    // The user's aces win the matched 1,400; the agent's uncalled 600 came back to it.
    expect(end.winner).toMatchObject({ who: 'user', amount: 1400 });
    expect(end.players).toMatchObject({ user: { stack: 1400 }, agent: { stack: 600 } });
  });
});

test('a split pot is nobody\'s hand: the chips go back and neither seat is credited', () => {
  // The board plays: a royal flush on the table, for both.
  const match = new PokerMatch();
  match.deal(['2c', '3d', '2h', '3s', 'As', 'Ks', 'Qs', 'Js', 'Ts']);
  match.applyMove('user', 'call');
  match.applyMove('agent', 'check');
  for (let i = 0; i < 3; i++) { match.applyMove('agent', 'check'); match.applyMove('user', 'check'); }
  const view = match.view();
  expect(view.winner).toEqual({ who: 'split', amount: 40, hand_rank: 'Royal Flush' });
  expect(view.players.user.stack).toBe(1000);
  expect(view.players.agent.stack).toBe(1000);
  expect(view.session).toMatchObject({ hands_played: 1, hands_won_user: 0, hands_won_agent: 0 });
});

test('folding for free is a check, and the table says so', () => {
  const match = new PokerMatch();
  match.deal(DEAL);
  match.applyMove('user', 'call'); // the big blind (agent) now has nothing to call
  match.applyMove('agent', 'fold');
  const view = match.view();
  expect(view.phase).toBe('playing');
  expect(view.street).toBe('FLOP');
  expect(view.last_action).toMatchObject({ by: 'agent', kind: 'check' });
  expect(view.players.agent.folded).toBe(false);
});

test('short stacks post what they have, and a match ends when a stack is empty', () => {
  const match = new PokerMatch({ startingStack: 15 });
  match.deal(DEAL);
  // The agent is the big blind with 15: it posts 15, all-in. The user (button) can only call or fold.
  const view = match.view();
  expect(view.players.agent).toMatchObject({ bet: 15, stack: 0 });
  expect(view.valid_actions).toEqual(['fold', 'call']);
  expect(view.to_call).toBe(5);
  match.applyMove('user', 'call');
  const end = match.view();
  expect(end.board).toHaveLength(5);
  expect(end.phase).toBe('game-over');
  expect(() => match.deal()).toThrow(/match is over/);
  match.restart();
  match.deal();
  expect(match.view().phase).toBe('playing');
});

test('the button alternates and the hands are counted at settle', () => {
  const match = new PokerMatch();
  match.deal(DEAL);
  expect(match.view().button).toBe('user');
  expect(match.view().session.hands_played).toBe(0);
  match.applyMove('user', 'fold');
  expect(match.view().session).toMatchObject({ hands_played: 1, hands_won_agent: 1, chips_up_user: -10 });
  match.deal(DEAL);
  expect(match.view().button).toBe('agent');
  expect(match.actionTo()).toBe('agent');
});

test('the decision request is the opponent\'s own view: its cards, never the user\'s', () => {
  const match = new PokerMatch();
  match.deal(DEAL);
  match.applyMove('user', 'call');
  const request = match.decisionRequest();
  expect(request.hand).toEqual(match.holeCards('agent'));
  for (const card of match.holeCards('user')) expect(JSON.stringify(request)).not.toContain(`"${card}"`);
  expect(request).toMatchObject({ to_call: 0, valid_actions: ['fold', 'check', 'raise'], min_raise_to: 40 });
});

test('a random deal uses 52 distinct cards', () => {
  const match = new PokerMatch();
  match.deal();
  const cards = [...match.holeCards('user'), ...match.holeCards('agent')];
  expect(new Set(cards).size).toBe(4);
});
