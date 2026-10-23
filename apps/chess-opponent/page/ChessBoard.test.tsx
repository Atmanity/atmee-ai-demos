// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ChessBoardView } from './ChessBoard.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('a board that cannot measure itself to animate a move is redrawn, not crashed', async () => {
  // jsdom lays nothing out, so every square is 0 px wide: exactly the case in
  // which react-chessboard throws, and the throw would take the avatar's
  // video down with it (same React tree).
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const props = { boardOrientation: 'white' as const, draggable: false, turnState: 'yours' as const, onPieceDrop: () => false };
  const view = render(<ChessBoardView fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" {...props} />);
  act(() => view.rerender(<ChessBoardView fen="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" {...props} />));
  await new Promise((r) => setTimeout(r, 300));
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('redrawing'), expect.anything());
  expect(document.querySelector("[data-column='e']")).toBeTruthy();
  expect(document.body.textContent).not.toContain('could not be drawn');
});
