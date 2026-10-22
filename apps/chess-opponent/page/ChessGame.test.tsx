// @vitest-environment jsdom
/**
 * The panel as a projection: a snapshot in, intents out, nothing decided
 * here. Ported from the original ChessGame.test.tsx; its fake agent (bridge
 * RPCs and broadcasts) is now a snapshot prop and a `send` spy, because the
 * page owns the board.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChessSnapshot } from '../engine/types.ts';
import { ChessGame, type Intent, type Sent } from './ChessGame.tsx';

afterEach(cleanup);

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function snapshot(over: Partial<ChessSnapshot> = {}): ChessSnapshot {
  return {
    game: 'chess',
    phase: 'playing',
    user_color: 'white',
    difficulty: 'full',
    fen: START_FEN,
    turn: 'user',
    in_check: false,
    check_square: null,
    legal_moves: [{ san: 'e4', uci: 'e2e4' }, { san: 'Nf3', uci: 'g1f3' }],
    history: [],
    last_move: null,
    result: null,
    ...over,
  };
}

/** The page's side of the panel: what it was sent, and what it answers. */
function board(answer: Sent = { applied: true, reason: '' }) {
  const intents: Intent[] = [];
  return { intents, send: (intent: Intent) => { intents.push(intent); return Promise.resolve(answer); } };
}

function show(state: ChessSnapshot, b = board(), extra: { disabled?: boolean } = {}) {
  const view = render(<ChessGame state={state} send={b.send} pending={false} opponentName="Jamie Hess" {...extra} />);
  return { ...view, ...b, update: (next: ChessSnapshot) => view.rerender(<ChessGame state={next} send={b.send} pending={false} opponentName="Jamie Hess" {...extra} />) };
}

const GAME_OVER: Partial<ChessSnapshot> = { phase: 'game-over', turn: null, legal_moves: [] };

describe('ChessGame, drawn from the board', () => {
  it('renders the position and the your-move status', () => {
    show(snapshot());
    expect(screen.getByText('Your move')).toBeTruthy();
    expect(screen.getByText('No moves yet.')).toBeTruthy();
  });

  it("the opponent's turn shows thinking, and his move arrives as a new snapshot", async () => {
    const view = show(snapshot({ turn: 'agent', legal_moves: [] }));
    expect(screen.getByText('Thinking…')).toBeTruthy();
    expect(view.intents).toEqual([]);
    act(() => view.update(snapshot({ turn: 'user', history: ['e4', 'e5'], last_move: { san: 'e5', uci: 'e7e5', by: 'agent' } })));
    await waitFor(() => expect(screen.getByText('Your move')).toBeTruthy());
    expect(screen.getByText('e5')).toBeTruthy();
  });

  it('a finished game says how it ended and offers a new one', () => {
    show(snapshot({ ...GAME_OVER, result: { winner: 'draw', reason: 'stalemate' } }));
    expect(screen.getByText('New game')).toBeTruthy();
    expect(screen.getByText('Draw.')).toBeTruthy();
    expect(screen.getByText(/Stalemate/)).toBeTruthy();
  });

  it("the opponent's row is not sat on by the sound button", () => {
    // Found in live testing: "Lost —" rendered as "Los" with a speaker icon over the rest of it.
    const { container } = show(snapshot());
    expect(container.querySelector('.chess-player-row--top')).toBeTruthy();
    const styles = readFileSync('apps/chess-opponent/page/styles.css', 'utf8');
    expect(styles).toMatch(/\.chess-player-row--top\s*\{[^}]*padding-right/);
  });

  it('game over offers a new_game intent', async () => {
    const view = show(snapshot({ ...GAME_OVER, result: { winner: 'agent', reason: 'checkmate' } }));
    expect(screen.getByText('Jamie Hess wins.')).toBeTruthy();
    fireEvent.click(screen.getByText('New game'));
    await waitFor(() => expect(view.intents).toEqual([{ kind: 'new_game' }]));
  });

  it('draws the board from the side the player is on', () => {
    // Seen live: "Can I play black instead?" was agreed to with the board untouched.
    show(snapshot({ user_color: 'black', turn: 'agent' }));
    expect(document.querySelector("[data-column='a']")).toBeTruthy();
    expect(document.querySelector('.chess-player-row--bottom .chess-side-chip')?.textContent).toBe('Black');
    expect(document.querySelector('.chess-player-row--top .chess-side-chip')?.textContent).toBe('White');
  });

  it('a refusal does not outlive the position it was refused in', async () => {
    // It once sat under the board for the rest of the game, in place of the result.
    const view = show(snapshot({ ...GAME_OVER, result: { winner: 'agent', reason: 'checkmate' } }), board({ applied: false, reason: "the board didn't take that" }));
    fireEvent.click(screen.getByText('New game'));
    await waitFor(() => expect(screen.getByText("the board didn't take that")).toBeTruthy());
    act(() => view.update(snapshot()));
    await waitFor(() => expect(screen.queryByText("the board didn't take that")).toBeNull());
  });

  it('shows a refusal that arrived only on the snapshot (a spoken move)', () => {
    // A move said out loud and refused once changed zero pixels.
    show(snapshot({ last_refusal: { move: 'e9', reason: "'e9' is not a legal move" } }));
    expect(screen.getByText("'e9' is not a legal move")).toBeTruthy();
    expect(screen.getByText('Heard as “e9”.')).toBeTruthy();
    expect(document.querySelector('.chess-notice--refusal')?.getAttribute('role')).toBe('status');
  });

  it('shows a softened strength as a chip on the opponent', () => {
    // "go easy on me" was once agreed to and then invisible.
    show(snapshot({ difficulty: 'beginner' }));
    expect(document.querySelector('.chess-player-row--top .chess-difficulty')?.textContent).toBe('beginner');
  });

  it('does not say Waiting for a turn that will never come', () => {
    show(snapshot({ phase: 'game-over', turn: null, result: { winner: 'agent', reason: 'checkmate' } }));
    expect([...document.querySelectorAll('.chess-meta__status')].map((node) => node.textContent)).toEqual(['Won', 'Lost']);
  });
});

describe('the controls the original left to voice', () => {
  it('a side swap before the first move acts at once', async () => {
    const view = show(snapshot());
    fireEvent.click(screen.getByRole('button', { name: 'Black' }));
    await waitFor(() => expect(view.intents).toEqual([{ kind: 'set_side', side: 'black' }]));
  });

  it('a side swap mid-game asks for a second press, because it throws the game away', async () => {
    const view = show(snapshot({ history: ['e4', 'e5'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Black' }));
    expect(view.intents).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Restart as Black?' }));
    await waitFor(() => expect(view.intents).toEqual([{ kind: 'set_side', side: 'black' }]));
  });

  it('the side you already have is not a button that does anything', () => {
    const view = show(snapshot());
    const white = screen.getByRole('button', { name: 'White' });
    expect(white.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(white);
    expect(view.intents).toEqual([]);
  });

  it('difficulty acts at once and shows which is on', async () => {
    const view = show(snapshot({ difficulty: 'casual', history: ['e4', 'e5'] }));
    expect(screen.getByRole('button', { name: 'Casual' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Beginner' }));
    await waitFor(() => expect(view.intents).toEqual([{ kind: 'set_difficulty', level: 'beginner' }]));
  });

  it('resigning always asks twice', async () => {
    const view = show(snapshot());
    fireEvent.click(screen.getByRole('button', { name: 'Resign' }));
    expect(view.intents).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Really resign?' }));
    await waitFor(() => expect(view.intents).toEqual([{ kind: 'resign' }]));
  });

  it('a new game mid-game asks twice; before the first move it does not', async () => {
    const mid = show(snapshot({ history: ['e4'], turn: 'agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(mid.intents).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Start over?' }));
    await waitFor(() => expect(mid.intents).toEqual([{ kind: 'new_game' }]));
  });

  it('nothing can be pressed before the opponent is at the table', () => {
    show(snapshot(), board(), { disabled: true });
    for (const name of ['White', 'Black', 'Full', 'Casual', 'Beginner', 'Resign', 'New game']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
