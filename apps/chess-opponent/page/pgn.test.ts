import { Chess } from 'chess.js';
import { describe, expect, test } from 'vitest';
import { ChessMatch } from '../engine/game.ts';
import { pgnFileName, pgnOf, resultToken } from './pgn.ts';

const DAY = new Date(2026, 9, 23);

describe('the scoresheet as PGN', () => {
  test('a finished game: the seats, the opening, the result and every move, readable by a chess program', () => {
    const match = new ChessMatch('white', 1);
    for (const [who, move] of [['user', 'f3'], ['agent', 'e5'], ['user', 'g4'], ['agent', 'Qh4#']] as const) match.applyMove(who, move);
    const pgn = pgnOf(match.snapshot(), { host: 'Sasha', date: DAY });
    expect(pgn).toContain('[White "You"]');
    expect(pgn).toContain('[Black "Sasha"]');
    expect(pgn).toContain('[Date "2026.10.23"]');
    expect(pgn).toContain('[Result "0-1"]');
    expect(pgn).toContain('[Termination "Checkmate"]');
    expect(pgn.trim().endsWith('1. f3 e5 2. g4 Qh4# 0-1')).toBe(true);
    const replay = new Chess();
    replay.loadPgn(pgn);
    expect(replay.isCheckmate()).toBe(true);
  });

  test('the result token is from White and Black, not from the player', () => {
    expect(resultToken({ user_color: 'black', result: { winner: 'opponent', reason: 'resignation' } })).toBe('0-1');
    expect(resultToken({ user_color: 'black', result: { winner: 'agent', reason: 'checkmate' } })).toBe('1-0');
    expect(resultToken({ user_color: 'white', result: { winner: 'draw', reason: 'stalemate' } })).toBe('1/2-1/2');
    expect(resultToken({ user_color: 'white', result: null })).toBe('*');
  });

  test('a long game wraps at 80 columns and a game in progress ends in *', () => {
    const match = new ChessMatch('black', 1);
    match.historySan = Array.from({ length: 120 }, (_, i) => (i % 2 ? 'Nf6' : 'Ng1'));
    const pgn = pgnOf(match.snapshot(), { host: 'Sasha', date: DAY });
    expect(pgn).toContain('[White "Sasha"]');
    for (const line of pgn.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    expect(pgn.trim().endsWith('*')).toBe(true);
  });

  test('the file is named for the product and the day', () => {
    expect(pgnFileName(DAY)).toBe('kibitz-2026-10-23.pgn');
  });
});
