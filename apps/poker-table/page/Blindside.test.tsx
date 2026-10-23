// @vitest-environment jsdom
// The screens, rendered from the server's view: the front door, the felt
// (which can never show Dex's cards early), the moves under it, the paused
// table and the match's end. Ported in part from the panel's PokerGame tests.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Avatar } from '../../../src/kit/index.ts';
import type { AvatarPhase } from '../../../src/kit/useAvatar.ts';
import type { Intent, TableView } from '../engine/types.ts';
import { Controls, type Finished } from './Controls.tsx';
import { Felt } from './Felt.tsx';
import { HowToPlay } from './HowToPlay.tsx';
import { Lobby } from './Lobby.tsx';

afterEach(cleanup);

function view(over: Partial<TableView> = {}): TableView {
  return {
    game: 'poker', seq: 1, phase: 'playing', street: 'PREFLOP', board: [], pot: 30, current_bet: 20,
    min_raise: 20, min_raise_to: 40, max_raise_to: 1000, to_call: 10, action_to: 'user', valid_actions: ['fold', 'call', 'raise'],
    button: 'user',
    players: { user: { name: 'You', stack: 990, bet: 10, folded: false }, agent: { name: 'Opponent', stack: 980, bet: 20, folded: false } },
    user_hand: ['Ah', 'Kd'], revealed_hands: null, winner: null, last_action: { by: 'table', kind: 'deal', applied: true },
    session: { hands_played: 0, hands_won_user: 0, hands_won_agent: 0, chips_up_user: -10 },
    ...over,
  };
}

function fakeAvatar(phase: AvatarPhase = 'live', over: Partial<Avatar> = {}): Avatar {
  const noop = () => undefined;
  return {
    phase, detail: '', speaking: false, caption: '', heard: '', lines: [], secondsLeft: null, micOn: false, audioBlocked: false,
    videoRef: { current: null }, audioRef: { current: null }, start: vi.fn(async () => undefined), end: async () => undefined,
    say: noop, record: noop, state: noop, note: noop, event: noop, mute: noop, unmute: noop, setMic: noop, resumeAudio: noop,
    ...over,
  };
}

function controls(over: { view?: TableView | null; phase?: AvatarPhase; history?: Finished[] } = {}) {
  const moves: [Intent, string][] = [];
  const calls = { again: 0, fresh: 0 };
  render(
    <Controls
      view={over.view === undefined ? view() : over.view} phase={over.phase ?? 'live'} busy={false} history={over.history ?? []}
      onMove={(intent, label) => moves.push([intent, label])} onCallAgain={() => { calls.again += 1; }} onFresh={() => { calls.fresh += 1; }}
    />,
  );
  return { moves, calls };
}

describe('the front door', () => {
  it('says what it is, how a match goes, and has a way in by voice and by typing', () => {
    const onPlay = vi.fn();
    render(<Lobby onPlay={onPlay} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Dex across the felt');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Take your seat', 'Say it, type it or tap it', 'Last stack standing']);
    fireEvent.click(screen.getByRole('button', { name: 'Play with your voice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play by typing' }));
    expect(onPlay.mock.calls).toEqual([[true], [false]]);
  });

  it("shows Dex's face before the call, next to his name", () => {
    const { container } = render(<Lobby onPlay={() => undefined} />);
    const chip = container.querySelector('.bs-seat-chip')!;
    expect(chip.textContent).toBe('Across the felt tonight: Dex');
    const face = chip.querySelector('img')!;
    expect(face.getAttribute('src')).toMatch(/portrait/);
    expect(face.getAttribute('alt')).toBe('');   // the name sits beside it
    expect(container.querySelector('.bs-preview-face')?.getAttribute('src')).toMatch(/portrait/);
  });

  it('never names the machinery', () => {
    const { container } = render(<Lobby onPlay={() => undefined} />);
    const words = container.textContent!.toLowerCase();
    for (const word of ['session', 'avatar', 'api', 'atmee', 'demo', 'sample', 'mini-app', 'tool']) expect(words, word).not.toMatch(new RegExp(`\\b${word}\\b`));
  });
});

describe('the felt', () => {
  it("shows the player's cards and Dex's face down, never his real ones before a showdown", () => {
    render(<Felt view={view()} avatar={fakeAvatar()} />);
    expect(screen.getByRole('img', { name: 'ace of hearts' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'king of diamonds' })).toBeTruthy();
    expect(screen.getAllByRole('img', { name: 'A face-down card' })).toHaveLength(2);
    expect(screen.getByText('990')).toBeTruthy();
  });

  it('a showdown turns his cards over and names the winner', () => {
    render(<Felt view={view({
      phase: 'hand-over', street: 'SHOWDOWN', action_to: null, valid_actions: [], to_call: 0, pot: 0, board: ['2c', '7d', '9h', '3s', '5c'],
      revealed_hands: { user: ['Ah', 'Kd'], agent: ['Qc', 'Qs'] }, winner: { who: 'agent', amount: 120, hand_rank: 'One Pair' },
    })} avatar={fakeAvatar()} />);
    expect(screen.getByRole('img', { name: 'queen of clubs' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Dex wins 120with one pair');
    expect(screen.queryByRole('img', { name: 'A face-down card' })).toBeNull();
  });

  it('a fold shows no cards of his, and says who folded', () => {
    render(<Felt view={view({ phase: 'hand-over', action_to: null, valid_actions: [], winner: { who: 'user', amount: 40, hand_rank: null } })} avatar={fakeAvatar()} />);
    expect(screen.getByRole('status').textContent).toContain('You win 40');
    expect(screen.getByRole('status').textContent).toContain('Dex folded');
    expect(screen.getAllByRole('img', { name: 'A face-down card' })).toHaveLength(2);
  });

  it("while it is Dex's turn, his seat says he is thinking", () => {
    render(<Felt view={view({ action_to: 'agent', valid_actions: [] })} avatar={fakeAvatar()} />);
    expect(screen.getByText('thinking…')).toBeTruthy();
  });

  it("before the first deal: an empty table, and Dex's face in his seat while he is on his way", () => {
    const { container } = render(<Felt view={null} avatar={fakeAvatar('starting')} />);
    expect(container.querySelector('.bs-dex-video .call-poster')?.getAttribute('src')).toMatch(/portrait/);
    expect(screen.getByText('Dex is shuffling up…')).toBeTruthy();
    expect(screen.getByText('Calling Dex…')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'A face-down card' })).toBeNull();
  });

  it("a refusal shows on the table as a sentence, and the player's best hand is named", () => {
    render(<Felt view={view({ board: ['Ac', '7d', '2s'], street: 'FLOP' })} avatar={fakeAvatar()} message="it is not your turn" />);
    expect(screen.getByRole('alert').textContent).toBe('It is not your turn.');
    expect(screen.getByText('One Pair')).toBeTruthy();
  });
});

describe('the moves under the felt', () => {
  it('a press is an intent with the label Dex is told', () => {
    const { moves } = controls();
    fireEvent.click(screen.getByRole('button', { name: 'Call 10' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fold' }));
    expect(moves).toEqual([[{ kind: 'call' }, 'Call 10'], [{ kind: 'fold' }, 'Fold']]);
    expect(screen.getByText('Your move. Say it, type it or tap it.')).toBeTruthy();
  });

  it('the sizer: presets, the pot, and all in', () => {
    const { moves } = controls();
    fireEvent.click(screen.getByRole('button', { name: 'Pot' }));
    // A pot-sized raise: the 20 in front of you, plus the 30 pot and your 10 to call.
    fireEvent.click(screen.getByRole('button', { name: 'Raise to 60' }));
    fireEvent.click(screen.getByRole('button', { name: 'All in' }));
    fireEvent.click(screen.getByRole('button', { name: 'All in · 1,000' }));
    expect(moves).toEqual([[{ kind: 'raise', amount: 60 }, 'Raise to 60'], [{ kind: 'raise', amount: 1000 }, 'All in · 1,000']]);
  });

  it("never offers a raise below the table's own minimum", () => {
    // Preflop, in the big blind, after a limp: nothing is owed but the floor is
    // still a raise TO 40. The bar once took its floor from the big blind and
    // offered 20, which the table refused.
    const { moves } = controls({
      view: view({
        to_call: 0, current_bet: 20, min_raise_to: 40, pot: 40, valid_actions: ['fold', 'check', 'raise'], button: 'agent',
        players: { user: { name: 'You', stack: 980, bet: 20, folded: false }, agent: { name: 'Opponent', stack: 980, bet: 20, folded: false } },
      }),
    });
    expect(screen.queryByRole('button', { name: 'Fold' })).toBeNull();   // folding for free is never offered
    fireEvent.click(screen.getByRole('button', { name: 'Min' }));
    fireEvent.click(screen.getByRole('button', { name: 'Raise to 40' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(moves.map(([intent]) => intent)).toEqual([{ kind: 'raise', amount: 40 }, { kind: 'check' }]);
  });

  it('facing an all-in, no raise is offered, and the call says it is all in', () => {
    controls({ view: view({ to_call: 1200, valid_actions: ['fold', 'call'], players: { user: { name: 'You', stack: 990, bet: 10, folded: false }, agent: { name: 'Opponent', stack: 0, bet: 1210, folded: false } } }) });
    expect(screen.getByRole('button', { name: 'Call 990 · all in' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Raise/ })).toBeNull();
  });

  it("on Dex's turn nothing can be pressed", () => {
    controls({ view: view({ action_to: 'agent', valid_actions: [], to_call: 0 }) });
    expect(screen.getByText('Dex to act…')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('between hands: the next deal', () => {
    const { moves } = controls({ view: view({ phase: 'hand-over', action_to: null, valid_actions: [], winner: { who: 'user', amount: 40, hand_rank: null } }) });
    fireEvent.click(screen.getByRole('button', { name: 'Deal next hand' }));
    expect(moves).toEqual([[{ kind: 'deal' }, 'Deal next hand']]);
  });

  it('after a call: the table is paused, with the standing and both ways back', () => {
    const { calls } = controls({ phase: 'ended', view: view({ phase: 'hand-over', action_to: null, valid_actions: [], session: { hands_played: 6, hands_won_user: 4, hands_won_agent: 2, chips_up_user: 140 } }) });
    expect(screen.getByText('Table paused')).toBeTruthy();
    expect(screen.getByText('After 6 hands, you’re up 140 chips.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Call Dex again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start a fresh match' }));
    expect(calls).toEqual({ again: 1, fresh: 1 });
  });

  it("the match's end: who took every chip, the hands, and a rematch", () => {
    const history: Finished[] = [
      { hand: 1, winner: { who: 'user', amount: 40, hand_rank: null } },
      { hand: 2, winner: { who: 'user', amount: 1960, hand_rank: 'Flush' } },
    ];
    const { moves } = controls({
      history,
      view: view({ phase: 'game-over', action_to: null, valid_actions: [], players: { user: { name: 'You', stack: 2000, bet: 0, folded: false }, agent: { name: 'Opponent', stack: 0, bet: 0, folded: false } }, session: { hands_played: 2, hands_won_user: 2, hands_won_agent: 0, chips_up_user: 1000 } }),
    });
    expect(screen.getByRole('heading', { name: 'You took every chip.' })).toBeTruthy();
    expect(screen.getAllByText('1,960')).toHaveLength(2);   // the hand, and the biggest pot
    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));
    expect(moves).toEqual([[{ kind: 'restart' }, 'Rematch']]);
  });
});

it('puts the rules one click away, hand rankings first, and Escape closes them', () => {
  // Seen live, cold: "I've never played poker before. How do I play?" got the
  // three legal actions back. The hand rankings existed nowhere to look at.
  const onClose = vi.fn();
  render(<HowToPlay onClose={onClose} />);
  const sheet = screen.getByRole('dialog', { name: 'How to play' });
  expect(sheet.textContent).toContain('Royal flush');
  expect(sheet.textContent).toContain('High card');
  expect(sheet.textContent).toContain('Blinds');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
});
