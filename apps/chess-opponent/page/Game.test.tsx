// @vitest-environment jsdom
/**
 * The table as a projection: a snapshot in, intents out, nothing decided
 * here. Ported from the original panel's ChessGame tests, plus tap-to-move,
 * the lock while Sasha is not at the board, and the result.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChessSnapshot } from '../engine/types.ts';
import { Game, sentence, type Intent, type Sent } from './Game.tsx';

beforeEach(() => {
  // react-chessboard measures a square to animate a move; jsdom lays nothing out.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 48, bottom: 48, width: 48, height: 48, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
    legal_moves: [{ san: 'e4', uci: 'e2e4' }, { san: 'e3', uci: 'e2e3' }, { san: 'Nf3', uci: 'g1f3' }],
    history: [],
    last_move: null,
    result: null,
    ...over,
  };
}

/** The page's side of the table: what it was sent, and what it answers. */
function board(answer: Sent = { applied: true, reason: '' }) {
  const intents: Intent[] = [];
  return { intents, send: (intent: Intent) => { intents.push(intent); return Promise.resolve(answer); } };
}

function show(state: ChessSnapshot | null, b = board(), extra: { locked?: string | null; thinking?: boolean } = {}) {
  const props = { send: b.send, thinking: false, host: 'Sasha', ...extra };
  const view = render(<Game state={state} {...props} />);
  return { ...view, ...b, update: (next: ChessSnapshot) => view.rerender(<Game state={next} {...props} />) };
}

const GAME_OVER: Partial<ChessSnapshot> = { phase: 'game-over', turn: null, legal_moves: [] };
const status = () => [...document.querySelectorAll('.kb-status')].map((node) => node.textContent);

describe('the table, drawn from the board', () => {
  it('says the board is being set up before there is one', () => {
    show(null);
    expect(screen.getByText('Sasha is setting up the board…')).toBeTruthy();
  });

  it('renders the position and whose move it is', () => {
    show(snapshot());
    expect(status()).toEqual(['Waiting', 'Your move']);
    expect(document.querySelector('.kb-frame.is-yours')).toBeTruthy();
  });

  it("Sasha's turn shows thinking, and her move arrives as a new snapshot", async () => {
    const view = show(snapshot({ turn: 'agent', legal_moves: [] }), board(), { thinking: true });
    expect(screen.getByText('Thinking…')).toBeTruthy();
    expect(view.intents).toEqual([]);
    act(() => view.update(snapshot({ turn: 'user', history: ['e4', 'e5'], last_move: { san: 'e5', uci: 'e7e5', by: 'agent' } })));
    await waitFor(() => expect(status()).toContain('Your move'));
  });

  it('draws the board from the side the player is on', () => {
    // Seen live: "Can I play black instead?" was agreed to with the board untouched.
    show(snapshot({ user_color: 'black', turn: 'agent' }));
    expect(document.querySelector("[data-column='a']")).toBeTruthy();
    expect(document.querySelector('.kb-strip.is-you .kb-chip')?.textContent).toBe('Black');
    expect(document.querySelector('.kb-strip.is-them .kb-chip')?.textContent).toBe('White');
  });

  it('shows a refusal that arrived only on the snapshot (a spoken move), as a sentence', () => {
    // A move said out loud and refused once changed zero pixels.
    show(snapshot({ last_refusal: { move: 'e9', reason: "'e9' is not a legal move in this position" } }));
    expect(screen.getByText(/'e9' is not a legal move in this position\./)).toBeTruthy();
    expect(screen.getByText('Heard as “e9”.')).toBeTruthy();
    expect(document.querySelector('.kb-refusal')?.getAttribute('role')).toBe('status');
  });

  it('a refusal does not outlive the position it was refused in', async () => {
    const view = show(snapshot({ last_refusal: { move: 'Ra5', reason: "'Ra5' is not a legal move in this position" } }));
    act(() => view.update(snapshot({ history: ['e4', 'e5'], last_move: { san: 'e5', uci: 'e7e5', by: 'agent' } })));
    await waitFor(() => expect(document.querySelector('.kb-refusal')).toBeNull());
  });

  it("shows a softened strength as a chip on Sasha's side", () => {
    // "go easy on me" was once agreed to and then invisible.
    show(snapshot({ difficulty: 'beginner' }));
    expect(document.querySelector('.kb-strip.is-them .kb-chip.is-strength')?.textContent).toBe('beginner');
  });

  it('does not say Waiting for a turn that will never come', () => {
    show(snapshot({ ...GAME_OVER, result: { winner: 'agent', reason: 'checkmate' } }));
    expect(status()).toEqual(['Won', 'Lost']);
  });

  it('says what the board is waiting for while Sasha is not at it, and nothing can be played', () => {
    show(snapshot(), board(), { locked: 'Sasha is taking her seat…' });
    expect(screen.getByText('Sasha is taking her seat…')).toBeTruthy();
    for (const name of ['White', 'Black', 'Full', 'Casual', 'Beginner', 'Resign', 'New game']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('a board reason reads as a sentence', () => {
    expect(sentence('that could be Nbd2 or Nfd2 — say which one')).toBe('That could be Nbd2 or Nfd2 — say which one.');
    expect(sentence("'e9' is not a legal move")).toBe("'e9' is not a legal move.");
    expect(sentence('The board is not set up yet.')).toBe('The board is not set up yet.');
  });
});

describe('moving by hand', () => {
  it('tap a piece, then tap where it goes: one move intent, in the board’s own notation', async () => {
    const view = show(snapshot());
    fireEvent.click(document.querySelector("[data-square='e2']")!);
    fireEvent.click(document.querySelector("[data-square='e4']")!);
    await waitFor(() => expect(view.intents).toEqual([{ kind: 'move', move: 'e2e4' }]));
  });

  it('a tap on a square the piece cannot reach picks nothing up and plays nothing', () => {
    const view = show(snapshot());
    fireEvent.click(document.querySelector("[data-square='e2']")!);
    fireEvent.click(document.querySelector("[data-square='e5']")!);
    expect(view.intents).toEqual([]);
  });

  it('nothing moves while it is not your turn or Sasha is not at the board', () => {
    const cases: [ChessSnapshot, string | null][] = [[snapshot({ turn: 'agent' }), null], [snapshot(), 'Call ended.']];
    for (const [state, locked] of cases) {
      const view = show(state, board(), { locked });
      fireEvent.click(document.querySelector("[data-square='e2']")!);
      fireEvent.click(document.querySelector("[data-square='e4']")!);
      expect(view.intents).toEqual([]);
      cleanup();
    }
  });
});

describe('the end of a game', () => {
  it('says who won and how, and offers another game either way round', async () => {
    const view = show(snapshot({ ...GAME_OVER, history: ['f3', 'e5', 'g4', 'Qh4#'], result: { winner: 'agent', reason: 'checkmate' } }));
    expect(screen.getByText('Sasha wins.')).toBeTruthy();
    expect(screen.getByText(/Checkmate/)).toBeTruthy();
    expect(screen.getByText('Download the scoresheet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play again as Black' }));
    await waitFor(() => expect(view.intents).toEqual([{ kind: 'new_game' }, { kind: 'set_side', side: 'black' }]));
  });

  it('a draw explains itself', () => {
    show(snapshot({ ...GAME_OVER, result: { winner: 'draw', reason: 'stalemate' } }));
    expect(screen.getByText('Draw.')).toBeTruthy();
    expect(screen.getByText(/Stalemate/)).toBeTruthy();
  });

  it('a refusal and the result can both stand', async () => {
    const view = show(snapshot({ ...GAME_OVER, result: { winner: 'opponent', reason: 'resignation' } }), board({ applied: false, reason: "the board didn't take that" }));
    expect(screen.getByText('You win.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    await waitFor(() => expect(screen.getByText("The board didn't take that.")).toBeTruthy());
    expect(screen.getByText('You win.')).toBeTruthy();
    expect(view.intents).toEqual([{ kind: 'new_game' }]);
  });
});

describe('the controls', () => {
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

  it('strength acts at once and shows which is on', async () => {
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
});
