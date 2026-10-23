// The move chooser: ported from test_engine.py. Two properties matter more
// than any amount of playing strength: the move returned is ALWAYS one the
// board supplied (identity-preserved, so an illegal move cannot be built), and
// it is deterministic given its seed (so a game that misbehaved replays).
// Everything else is "does it play sensibly enough to be worth watching".
import { Chess } from 'chess.js';
import { describe, expect, test } from 'vitest';
import { attackersOf, chooseMove, MATE_BONUS, parseFen, parseMoves, scoreMove } from './engine.ts';

const m = (san: string, uci: string) => ({ san, uci });
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Positions exercising different branches: a capture, a promotion, a quiet
// middlegame choice, and no FEN at all.
const CASES: [string | null, { san: string; uci: string }[]][] = [
  ['3q3k/8/8/8/8/8/8/3RK3 w - - 0 1', [m('Rxd8+', 'd1d8'), m('Ke2', 'e1e2'), m('Rd4', 'd1d4'), m('Rc1', 'd1c1')]],
  ['4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', [m('b8=Q+', 'b7b8q'), m('b8=N', 'b7b8n'), m('Kd2', 'e1d2')]],
  [START, [m('e4', 'e2e4'), m('Nf3', 'g1f3'), m('a3', 'a2a3'), m('Nh3', 'g1h3')]],
  [null, [m('Qh7#', 'h5h7'), m('Qa1', 'h5a1')]],
];

describe('the two structural properties', () => {
  test.each(CASES)('the chosen move is one the board supplied, by identity (%s)', (fen, moves) => {
    // Rebuilding an equal-looking move from notation is exactly the round-trip
    // in which an illegal move could appear, so the test pins the object.
    const choice = chooseMove(fen, moves);
    expect(choice).not.toBeNull();
    expect(moves.some((supplied) => choice!.move.raw === supplied)).toBe(true);
  });

  test.each(CASES)('the same position always produces the same move (%s)', (fen, moves) => {
    expect(chooseMove(fen, moves)!.uci).toBe(chooseMove(fen, moves)!.uci);
  });

  test('ties break on SAN, so move order cannot change the answer', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1';
    const forwards = [m('Rb1', 'a1b1'), m('Rg1', 'h1g1')];
    expect(chooseMove(fen, forwards)!.san).toBe(chooseMove(fen, [...forwards].reverse())!.san);
  });
});

describe('empty and malformed input', () => {
  // Null is a real answer: the turn is reported unplayable and nothing illegal
  // reaches the board. Inventing a move here is the failure this design exists to prevent.
  test.each([
    ['empty list', []],
    ['null', null],
    ['a bare string', 'Nf3'],
    ['a single move, not in a list', { san: 'Nf3', uci: 'g1f3' }],
    ['an entry with no fields', [{}]],
    ['san with no uci', [{ san: 'Nf3' }]],
    ['an empty san', [{ san: '', uci: 'g1f3' }]],
    ['uci that is not squares', [{ san: 'Nf3', uci: 'zz9q' }]],
    ['a truncated uci', [{ san: 'Nf3', uci: 'g1f' }]],
  ])('nothing usable is answered with nothing: %s', (_name, legal) => {
    expect(chooseMove(START, legal)).toBeNull();
  });

  test('one malformed entry does not discard the rest', () => {
    const choice = chooseMove(START, [{ san: 'Nf3' }, m('e4', 'e2e4')]);
    expect(choice?.san).toBe('e4');
  });
});

describe('does it play sensibly', () => {
  test('it takes a free queen', () => {
    const choice = chooseMove('3q3k/8/8/8/8/8/8/3RK3 w - - 0 1', [m('Ke2', 'e1e2'), m('Rd4', 'd1d4'), m('Rxd8+', 'd1d8'), m('Rc1', 'd1c1')]);
    expect(choice!.san).toBe('Rxd8+');
    expect(choice!.tags).toContain('capture');
  });

  test('it takes mate in one over material', () => {
    // Mate is marked `#` by the board's SAN, the only way this heuristic can see it.
    const choice = chooseMove('3q3k/8/8/8/8/8/8/3RK3 w - - 0 1', [m('Rxd8+', 'd1d8'), m('Rd8#', 'd1d8')]);
    expect(choice!.san).toBe('Rd8#');
    expect(choice!.score).toBe(MATE_BONUS);
    expect(choice!.tags).toContain('checkmate');
  });

  test('it does not park the queen where a pawn can take it', () => {
    // The e6 pawn covers d5; both queen moves are quiet, so only the hang check separates them.
    expect(chooseMove('4k3/8/4p3/8/8/8/8/3QK3 w - - 0 1', [m('Qd5', 'd1d5'), m('Qd3', 'd1d3')])!.san).toBe('Qd3');
  });

  test('a capture that wins material survives the recapture check', () => {
    // Losing a rook for a queen is a good trade; a naive "is it attacked?" test would decline it.
    expect(chooseMove('7k/8/2p5/3q4/8/8/8/3RK3 w - - 0 1', [m('Rxd5', 'd1d5'), m('Rd4', 'd1d4')])!.san).toBe('Rxd5');
  });

  test('it promotes to a queen rather than a knight', () => {
    const choice = chooseMove('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', [m('b8=N', 'b7b8n'), m('b8=Q+', 'b7b8q'), m('Kd2', 'e1d2')]);
    expect(choice!.san).toBe('b8=Q+');
    expect(choice!.tags).toContain('promotion');
  });

  test('it develops rather than shuffling a rook pawn', () => {
    // Without piece-square tables a heuristic opens 1.a3 forever.
    const choice = chooseMove(START, [m('a3', 'a2a3'), m('h3', 'h2h3'), m('e4', 'e2e4'), m('Nh3', 'g1h3'), m('Nf3', 'g1f3')]);
    expect(['e4', 'Nf3']).toContain(choice!.san);
  });

  test('a knight on the rim loses to a knight in the centre', () => {
    const position = parseFen(START)!;
    const [nf3, nh3] = parseMoves([m('Nf3', 'g1f3'), m('Nh3', 'g1h3')]);
    expect(scoreMove(position, nf3)).toBeGreaterThan(scoreMove(position, nh3));
  });
});

describe('a broken position is not a broken turn', () => {
  test.each([null, '', 'not a fen', '8/8/8/8/8/8/8 w - - 0 1', '9999999/8/8/8/8/8/8/8 w - - 0 1', 'rnbqkbnr/ppppXppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'])(
    'an unusable FEN still yields a legal move (%s)',
    (fen) => {
      // Notation-only scoring plays worse chess and keeps the game moving.
      expect(parseFen(fen)).toBeNull();
      expect(chooseMove(fen, [m('e4', 'e2e4'), m('Qh5#', 'd1h5')])?.san).toBe('Qh5#');
    },
  );
});

describe('the pieces of the heuristic, on their own', () => {
  test('pawns attack forwards, not backwards', () => {
    // Getting this backwards is how a heuristic walks a queen into a pawn.
    const { pieces } = parseFen('k7/8/4p3/8/8/4P3/8/7K w - - 0 1')!;
    expect(attackersOf(pieces, 'd5', 'b')).toEqual(['p']);
    expect(attackersOf(pieces, 'd7', 'b')).toEqual([]);
    expect(attackersOf(pieces, 'd4', 'w')).toEqual(['p']);
    expect(attackersOf(pieces, 'd2', 'w')).toEqual([]);
  });

  test('a slider is blocked by the first piece on the ray', () => {
    const { pieces } = parseFen('4k3/8/8/8/8/8/4P3/R3K2R w - - 0 1')!;
    expect(attackersOf(pieces, 'a8', 'w')).toContain('r');
    expect(attackersOf(pieces, 'e4', 'w')).toEqual([]);
  });

  test('parseFen reads the side to move, and defaults to White without one', () => {
    expect(parseFen('4k3/8/8/8/8/8/8/4K3 b - - 0 1')!.turn).toBe('b');
    expect(parseFen('4k3/8/8/8/8/8/8/4K3')!.turn).toBe('w');
  });
});

describe('variety, without giving up reproducibility', () => {
  const fen = '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1';
  const tied = [m('Rb1', 'a1b1'), m('Rg1', 'h1g1')];

  test('two sessions do not replay the identical game', () => {
    // A total tie-break replayed the same game move for move against the same
    // opening, and "play it again" is the first thing a sceptical player does.
    const picked = new Set(Array.from({ length: 8 }, (_, seed) => chooseMove(fen, tied, 0, seed)!.san));
    expect(picked).toEqual(new Set(['Rb1', 'Rg1']));
  });

  test('the same seed plays the same move every time, whatever the list order', () => {
    for (const seed of [0, 1, 12345]) {
      const answers = new Set(Array.from({ length: 5 }, () => chooseMove(fen, tied, 0, seed)!.san));
      expect(answers.size).toBe(1);
    }
    expect(chooseMove(fen, tied, 0, 7)!.san).toBe(chooseMove(fen, [...tied].reverse(), 0, 7)!.san);
  });

  test.each([null, 0, 1, 99, 12345])('the seed never costs a mate or reorders unequal moves (seed %s)', (seed) => {
    // Mate is always taken, and a weaker setting plays a move the engine itself ranked lower.
    const position = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
    const legal = [m('Ra8#', 'a1a8'), m('Ra2', 'a1a2'), m('Ra3', 'a1a3'), m('Ra4', 'a1a4'), m('Ra5', 'a1a5'), m('Kf1', 'g1f1')];
    for (const rank of [0, 2, 5]) expect(chooseMove(position, legal, rank, seed)!.san).toBe('Ra8#');
    const quiet = legal.filter((entry) => !entry.san.includes('#'));
    const best = chooseMove(position, quiet, 0, seed)!;
    const easy = chooseMove(position, quiet, 5, seed)!;
    expect(quiet.map((e) => e.uci)).toContain(easy.uci);
    expect(easy.score).toBeLessThanOrEqual(best.score);
  });
});

describe('strength (from test_game_and_table.py)', () => {
  test('a weakened opponent still takes mate', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
    const legal = [m('Ra8#', 'a1a8'), m('Ra2', 'a1a2'), m('Ra3', 'a1a3'), m('Ra4', 'a1a4'), m('Ra5', 'a1a5'), m('Ra6', 'a1a6'), m('Kf1', 'g1f1')];
    for (const rank of [0, 2, 5]) expect(chooseMove(fen, legal, rank)?.san).toBe('Ra8#');
  });

  test('a weaker setting plays a move it ranked lower, not an illegal one', () => {
    const legal = [m('e4', 'e2e4'), m('d4', 'd2d4'), m('Nf3', 'g1f3'), m('a3', 'a2a3'), m('h3', 'h2h3'), m('Na3', 'b1a3')];
    const best = chooseMove(START, legal, 0)!;
    const easy = chooseMove(START, legal, 5)!;
    expect(legal.map((e) => e.uci)).toContain(easy.uci);
    expect(easy.uci).not.toBe(best.uci);
    expect(easy.score).toBeLessThanOrEqual(best.score);
  });
});

describe('the one deliberate change from engine.py', () => {
  test('a pawn the enemy could take only by losing its taker is not a gift: 1.e4 is not met by 1...h5', () => {
    // engine.py scored 1...h5 at +795 here ("their queen takes, our rook takes
    // the queen"), and the a-pawn at +230 against a bishop the next move: the
    // full-strength opponent opened 1.e4 h5 2.Nf3 a6. No opponent makes a
    // capture that loses it material, so the exchange can only cost.
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const legal = new Chess(fen).moves({ verbose: true }).map((mv) => m(mv.san, mv.lan));
    expect(['e5', 'd5', 'Nf6', 'Nc6']).toContain(chooseMove(fen, legal, 0, 1)!.san);
    expect(scoreMove(parseFen(fen)!, parseMoves([m('h5', 'h7h5')])[0])).toBeLessThanOrEqual(0);
  });

  test('a capture that loses the exchange is still scored as a loss', () => {
    // The clamp is on what the exchange can GIVE, not on what it can cost.
    const position = parseFen('4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1')!;
    const [qxd5] = parseMoves([m('Qxd5', 'd1d5')]);
    expect(scoreMove(position, qxd5)).toBeLessThan(0);
  });
});
