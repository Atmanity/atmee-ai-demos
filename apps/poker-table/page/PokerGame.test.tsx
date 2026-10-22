// @vitest-environment jsdom
// The table as a projection: a view in, intents out, nothing decided here
// (ported from the panel's PokerGame.test.tsx). The original drove the panel
// through a scripted agent on the platform bridge; here the view is a prop,
// so the same cases are simpler. The auto-deal cases are gone with the
// auto-deal: the server deals.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Intent, TableView } from '../engine/types.ts';
import { PokerGame, type PokerGameProps } from './PokerGame.tsx';

afterEach(cleanup);

function view(over: Partial<TableView> = {}): TableView {
  return {
    game: 'poker',
    seq: 1,
    phase: 'playing',
    street: 'PREFLOP',
    board: [],
    pot: 30,
    current_bet: 20,
    min_raise: 20,
    min_raise_to: 40,
    max_raise_to: 1000,
    to_call: 10,
    action_to: 'user',
    valid_actions: ['fold', 'call', 'raise'],
    button: 'user',
    players: {
      user: { name: 'You', stack: 990, bet: 10, folded: false },
      agent: { name: 'Opponent', stack: 980, bet: 20, folded: false },
    },
    user_hand: ['Ah', 'Kd'],
    revealed_hands: null,
    winner: null,
    last_action: { by: 'table', kind: 'deal', applied: true },
    session: { hands_played: 0, hands_won_user: 0, hands_won_agent: 0, chips_up_user: -10 },
    ...over,
  };
}

function table(props: Partial<PokerGameProps> = {}) {
  const intents: Intent[] = [];
  const all: PokerGameProps = { view: view(), opponentName: 'Phil', live: true, onIntent: (i) => intents.push(i), ...props };
  const utils = render(<PokerGame {...all} />);
  return { intents, rerender: (next: Partial<PokerGameProps>) => utils.rerender(<PokerGame {...all} {...next} />) };
}

describe('the table, rendered from the view', () => {
  it('renders the view: cards, pot, and live controls', () => {
    table();
    expect(screen.getByText('Call 10')).toBeTruthy();
    // The user's own cards came from the view: there is no engine in the page.
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('K')).toBeTruthy();
  });

  it('a click is an intent; the next view is what re-renders', () => {
    const { intents, rerender } = table();
    fireEvent.click(screen.getByText('Call 10'));
    expect(intents).toEqual([{ kind: 'call' }]);
    rerender({ view: view({ seq: 2, action_to: 'agent', to_call: 0, pot: 40, valid_actions: [] }) });
    expect(screen.getByText('Phil is deciding…')).toBeTruthy();
  });

  it('a refusal shows as a table message, and the table stays as it was', () => {
    table({ message: 'it is not your turn' });
    expect(screen.getByText('it is not your turn')).toBeTruthy();
    expect(screen.getByText('Call 10')).toBeTruthy();
  });

  it("the opponent's move arrives as a new view: the page never asks for it", () => {
    const { intents, rerender } = table({ view: view({ action_to: 'agent', valid_actions: [], to_call: 0 }) });
    expect(screen.getByText('Phil is deciding…')).toBeTruthy();
    expect(intents).toEqual([]);
    rerender({ view: view({ seq: 2, action_to: 'user', to_call: 20, current_bet: 40, pot: 70, last_action: { by: 'agent', kind: 'raise', amount: 40, applied: true } }) });
    expect(screen.getByText('Call 20')).toBeTruthy();
    expect(screen.queryByText('Phil is deciding…')).toBeNull();
  });

  it('no actions until the avatar is at the table', () => {
    const { intents } = table({ live: false });
    fireEvent.click(screen.getByText('Call 10'));
    expect(intents).toEqual([]);
    expect(screen.getByText('Start the session to play.')).toBeTruthy();
  });

  it('before the deal: an empty table and a seat to take', () => {
    table({ view: null, live: false });
    expect(screen.getByText('Sit down (on the left) and the first hand is dealt.')).toBeTruthy();
    expect(screen.queryByText('Fold')).toBeNull();
  });
});

describe('the end of a hand', () => {
  const showdown = (over: Partial<TableView> = {}) => view({
    phase: 'hand-over', street: 'SHOWDOWN', action_to: null, valid_actions: [], to_call: 0, current_bet: 0, pot: 0,
    revealed_hands: { user: ['Ah', 'Kd'], agent: ['Qc', 'Qs'] },
    winner: { who: 'agent', amount: 120, hand_rank: 'One Pair' },
    ...over,
  });

  it('a showdown shows the revealed hand and the winner line', () => {
    table({ view: showdown() });
    expect(screen.getByText('Phil wins 120 with One Pair')).toBeTruthy();
    expect(screen.getAllByText('Q')).toHaveLength(2);
    expect(screen.getByText('Deal Again')).toBeTruthy();
  });

  it("says 'You win', not 'You wins', when the player takes the pot", () => {
    // The banner read "You wins 200 with One Pair" on every hand the player won.
    table({ view: showdown({ winner: { who: 'user', amount: 200, hand_rank: 'One Pair' } }) });
    expect(screen.getByText('You win 200 with One Pair')).toBeTruthy();
  });

  it('a split pot is said as one', () => {
    table({ view: showdown({ winner: { who: 'split', amount: 40, hand_rank: 'Royal Flush' } }) });
    expect(screen.getByText('Split pot: 40 shared, both with Royal Flush')).toBeTruthy();
  });

  it('Deal Again is a deal intent', () => {
    const { intents } = table({ view: showdown() });
    fireEvent.click(screen.getByText('Deal Again'));
    expect(intents).toEqual([{ kind: 'deal' }]);
  });

  it('game over offers a restart intent', () => {
    const { intents } = table({ view: view({ phase: 'game-over', action_to: null, valid_actions: [], winner: { who: 'user', amount: 2000, hand_rank: null } }) });
    expect(screen.getByText('Game over: You win the match.')).toBeTruthy();
    fireEvent.click(screen.getByText('Restart Game'));
    expect(intents).toEqual([{ kind: 'restart' }]);
  });
});

it('puts the rules one click away, hand rankings included', () => {
  // Seen live, cold: "I've never played poker before. How do I play?" got the
  // three legal actions back. The hand rankings existed nowhere to look at.
  const { intents } = table();
  fireEvent.click(screen.getByRole('button', { name: 'How to play' }));
  const sheet = screen.getByRole('dialog', { name: 'How to play' });
  expect(sheet.textContent).toContain('Royal flush');
  expect(sheet.textContent).toContain('High card');
  expect(sheet.textContent).toContain('Blinds');
  // Reading the rules is not an action at the table.
  expect(intents).toEqual([]);
});

it('shows a session line once a hand has actually finished', () => {
  // "we've played one hand. You're down 20", mid-first-hand.
  table({ view: view({ phase: 'hand-over', action_to: null, valid_actions: [], session: { hands_played: 3, hands_won_user: 1, hands_won_agent: 2, chips_up_user: -60 } }) });
  const line = screen.getByLabelText('Session score');
  expect(line.textContent).toContain('Hand 3');
  expect(line.textContent).toContain('You 1');
  expect(line.textContent).toContain('2 Phil');
  expect(line.textContent).toContain('60 chips');
});

it('shows no session line before the first hand settles', () => {
  table();
  expect(screen.queryByLabelText('Session score')).toBeNull();
});

it("never offers a bet below the table's own minimum", () => {
  // Preflop, in the big blind, after the other seat limps: nothing is owed but
  // the floor is still a raise TO 40. The bar took its floor from the big blind
  // and offered "Bet 20", which the table refused.
  const { intents } = table({
    view: view({
      to_call: 0, current_bet: 20, min_raise_to: 40, pot: 40, valid_actions: ['fold', 'check', 'raise'], button: 'agent',
      players: { user: { name: 'You', stack: 980, bet: 20, folded: false }, agent: { name: 'Opponent', stack: 980, bet: 20, folded: false } },
    }),
  });
  expect(screen.getByText('Check')).toBeTruthy();
  fireEvent.click(screen.getByText('Min'));
  fireEvent.click(screen.getByText('Bet 40'));
  expect(intents).toEqual([{ kind: 'raise', amount: 40 }]);
});

it('facing an all-in, no raise is offered (new: the bar follows the legal actions)', () => {
  table({ view: view({ to_call: 500, valid_actions: ['fold', 'call'], players: { user: { name: 'You', stack: 990, bet: 10, folded: false }, agent: { name: 'Opponent', stack: 0, bet: 510, folded: false } } }) });
  expect(screen.getByText('Call 500')).toBeTruthy();
  expect(screen.queryByText(/^Raise/)).toBeNull();
});
