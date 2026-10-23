// The board and the spoken-move resolver: ported from the rules half of
// test_game_and_table.py. chess.js is the rules oracle; what these pin is OUR
// layer: spoken-move resolution, the turn gate, the result mapping, the
// refusals, the seating and strength parsers. Every test is named after the
// symptom it prevents, and the comments say where that symptom was seen.
import { Chess } from 'chess.js';
import { describe, expect, test } from 'vitest';
import {
  AmbiguousMove, CASTLE_DETERMINERS, CASTLE_OBJECT_ONLY, CASTLE_OK, CASTLE_TRANSITIVES, ChessMatch, IllegalMove,
  MOVE_FILLER, parseSide, parseStrength, PIECE_LETTER, REFUSAL_MOVE_MAX_BYTES, REFUSAL_REASON_MAX_BYTES, UnreadableMove,
} from './game.ts';
import { looksLikeMoveStatement } from './spoken.ts';

const mover = (match: ChessMatch) => (match.board.turn() === (match.userColor === 'white' ? 'w' : 'b') ? 'user' : 'agent');

/** A mid-game position in which Ng5, Bxf7+, Qe2 and d4 are all legal. */
const MIDGAME = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 1';
/** Both castles legal, so a stray "castle" would land. */
const CASTLE_READY = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
/** Nf3 and f3 both legal: a mis-parse is a silently different LEGAL move, the failure nothing downstream catches. */
const BOTH_LEGAL = 'rnbqkbnr/ppppppp1/8/7p/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
/** Rd5 and d5 both legal. */
const ROOK_AND_PAWN = '7k/8/8/R7/3P4/8/8/4K3 w - - 0 1';

function at(fen: string, seed = 1): ChessMatch {
  const match = new ChessMatch('white', seed);
  match.board.load(fen);
  expect(match.board.fen()).toBe(fen);
  return match;
}

/** The SAN played, or null if the board refused. */
function play(phrase: string, fen: string): string | null {
  try {
    return at(fen).applyMove('user', phrase).san;
  } catch (err) {
    if (err instanceof IllegalMove) return null;
    throw err;
  }
}

describe('the rules layer', () => {
  test('spoken forms resolve onto the board', () => {
    const match = new ChessMatch();
    expect(match.applyMove('user', 'e4').san).toBe('e4');
    expect(match.applyMove('agent', 'e7 to e5').san).toBe('e5');
    expect(match.applyMove('user', 'knight to f3').san).toBe('Nf3');
    expect(match.applyMove('agent', 'knight c6').san).toBe('Nc6');
    expect(match.applyMove('user', 'bishop to c4').san).toBe('Bc4');
    expect(match.applyMove('agent', 'g8f6').san).toBe('Nf6');
    expect(match.applyMove('user', 'castle kingside').san).toBe('O-O');
  });

  test('the turn gate and illegal moves carry three different reasons', () => {
    // "e9" never read as a move; "Ke2" reads perfectly and the position will
    // not have it. Collapsing the two is how a phrasing this parser cannot
    // take apart ends up reported as an illegal move.
    const match = new ChessMatch();
    expect(() => match.applyMove('agent', 'e5')).toThrow(/not your side/);
    expect(() => match.applyMove('user', 'e9')).toThrow(UnreadableMove);
    expect(() => match.applyMove('user', 'e9')).toThrow(/did not read as a move/);
    expect(() => match.applyMove('user', 'Ke2')).toThrow(/not a legal move/);
  });

  test('checkmate ends the game with the right winner', () => {
    const match = new ChessMatch();
    // Fool's mate: the opponent (Black) delivers it.
    match.applyMove('user', 'f3');
    match.applyMove('agent', 'e5');
    match.applyMove('user', 'g4');
    match.applyMove('agent', 'Qh4');
    const snap = match.snapshot();
    expect(snap.result).toEqual({ winner: 'agent', reason: 'checkmate' });
    expect(snap.turn).toBeNull();
    expect(snap.legal_moves).toEqual([]);
    expect(() => match.applyMove('user', 'a3')).toThrow(/game is over/);
  });

  test('resign and new game', () => {
    const match = new ChessMatch();
    match.applyMove('user', 'e4');
    match.resign('user');
    expect(match.snapshot().result).toEqual({ winner: 'agent', reason: 'resignation' });
    expect(() => match.resign('user')).toThrow(/already over/);
    match.newGame();
    const snap = match.snapshot();
    expect(snap.result).toBeNull();
    expect(snap.history).toEqual([]);
    expect(snap.turn).toBe('user');
  });

  test('the snapshot carries what the panel renders', () => {
    const match = new ChessMatch();
    match.applyMove('user', 'e4');
    const snap = match.snapshot();
    expect(snap.fen.split(' ')[1]).toBe('b');
    expect(snap.last_move).toEqual({ san: 'e4', uci: 'e2e4', by: 'user' });
    expect(snap.legal_moves).toContainEqual({ san: 'e5', uci: 'e7e5' });
  });

  test('the busiest board there is still lists every legal move', () => {
    // 218 legal moves: the most a position is known to hold.
    const match = at('R6R/3Q4/1Q4Q1/4Q3/2Q4Q/Q4Q2/pp1Q4/kBNN1KB1 w - - 0 1');
    expect(match.legalMoves().length).toBeGreaterThan(200);
  });

  test('a check is marked on the king of the side to move', () => {
    const match = at('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    match.applyMove('user', 'Ra8');
    const snap = match.snapshot();
    expect(snap.in_check).toBe(true);
    expect(snap.check_square).toBe('e8');
  });
});

describe('draw detection', () => {
  test('a game one move from a repetition is still playable', () => {
    // A "could claim" test fires a ply early; this app does not offer a claim,
    // it ends the game, and it once froze a live game as a draw.
    const match = new ChessMatch();
    for (const san of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1']) match.applyMove(mover(match), san);
    expect(match.snapshot().result).toBeNull();
  });

  test('the third repetition itself is a draw', () => {
    const match = new ChessMatch();
    for (const san of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) match.applyMove(mover(match), san);
    expect(match.snapshot().result?.reason).toBe('threefold_repetition');
  });

  test('the fifty-move rule ends at a hundred halfmoves, not ninety-nine', () => {
    const match = at('8/8/8/4k3/8/8/4K3/7R w - - 99 60');
    match.detectResult();
    expect(match.snapshot().result).toBeNull();
    match.board.load('8/8/8/4k3/8/8/4K3/7R w - - 100 60');
    match.detectResult();
    expect(match.snapshot().result?.reason).toBe('fifty_moves');
  });
});

describe('spoken ranks', () => {
  test.each([
    ['e four', 'e4'], ['pawn to e four', 'e4'], ['knight to f three', 'Nf3'], ['e4', 'e4'], ['Nf3', 'Nf3'],
  ])('a rank said as a word still reaches the board: %s', (phrase, expected) => {
    // STT writes "e4" as "e four" most of the time; the commonest spoken move once failed silently.
    expect(looksLikeMoveStatement(phrase)).toBe(true);
    expect(new ChessMatch().applyMove('user', phrase).san).toBe(expected);
  });

  test.each(['should I play e four?', 'two moves ago', 'for the centre', 'what about e four'])(
    'spelling a rank does not turn musing into a move: %s',
    (phrase) => expect(looksLikeMoveStatement(phrase)).toBe(false),
  );
});

describe('what the side and strength parsers promise', () => {
  test.each([
    ['too hard', 'casual'], ['this is too hard', 'casual'], ['go easier', 'casual'], ["I'm a beginner", 'beginner'],
    ['play properly', 'full'], ['make it harder', 'full'], ['full strength', 'full'],
  ])('every advertised difficulty phrase resolves: %s', (phrase, expected) => {
    // "too hard" contains "hard", so it once resolved to FULL: the opposite of the request.
    expect(parseStrength(phrase)).toBe(expected);
  });

  test.each([
    ['black', 'black'], ['white', 'white'], ['let me go second', 'black'], ["I'd rather be white", 'white'], ['go first', 'white'],
    ['go second', 'black'], ['you go first', 'black'], ['I start', 'white'], ['me first', 'white'],
  ])('every advertised side phrase resolves: %s', (phrase, side) => {
    // "let me go second" was advertised and only colour words were accepted.
    expect(parseSide(phrase)).toBe(side);
  });

  test.each([
    ['can I have white? can you start us off', 'white'],
    ["give me the black pieces, I'll go first", 'black'],
    ["white please, after you're ready", 'white'],
  ])('a colour they named beats a turn-order phrase: %s', (phrase, side) => {
    // "can you start" matched `you start` and an explicit request for white seated the player on BLACK.
    expect(parseSide(phrase)).toBe(side);
  });

  test.each(['can I start over', "I'll start over", 'I start again', "I'll start a new game", 'I start afresh', 'you start over', "I'll start another one"])(
    'starting over is a new game, not a seat: %s',
    // "I start" inside "can I start over" once seated a player on White instead of dealing a rematch.
    (phrase) => expect(parseSide(phrase)).toBeNull(),
  );

  test.each([["I'll start", 'white'], ['I start', 'white'], ["let's go, I'll start then", 'white'], ['I start, okay?', 'white']])(
    'starting the game is still a seat: %s',
    (phrase, side) => expect(parseSide(phrase)).toBe(side),
  );

  test.each(["I'll take the second one", 'wait a second', "come on, after you're done thinking", 'can you start us off'])(
    'filler does not decide the seating: %s',
    (phrase) => expect(parseSide(phrase)).toBeNull(),
  );

  test('a remark about the squares is not a request for a colour', () => {
    expect(parseSide('the dark squares are nice')).toBeNull();
    expect(parseSide('I like the light squares')).toBeNull();
    expect(parseSide('dark')).toBe('black');
  });
});

describe('seating and strength on the board', () => {
  test('asking to play black seats them on black, and the opponent moves first', () => {
    const match = new ChessMatch();
    match.setSide('black');
    expect(match.snapshot().user_color).toBe('black');
    expect(match.turn()).toBe('agent');
  });

  test('choosing a side starts a fresh board rather than swapping mid-game', () => {
    const match = new ChessMatch();
    match.applyMove('user', 'e4');
    match.setSide("I'd rather have black");
    expect(match.snapshot().history).toEqual([]);
    expect(match.snapshot().user_color).toBe('black');
  });

  test('a side nobody plays is refused, not invented', () => {
    const match = new ChessMatch();
    expect(() => match.setSide('purple')).toThrow(/not a side/);
    expect(match.snapshot().user_color).toBe('white');
  });

  test('asking for the side you already have does not wipe the game', () => {
    // "I'll stay white" once reset a game in progress and handed it back as a favour.
    const match = new ChessMatch();
    match.applyMove('user', 'e4');
    match.applyMove('agent', 'e5');
    expect(() => match.setSide('white')).toThrow(/already playing white/);
    expect(match.snapshot().history).toEqual(['e4', 'e5']);
    match.setSide('black');
    expect(match.snapshot().user_color).toBe('black');
  });

  test('asking it to go easier changes what it plays', () => {
    const match = new ChessMatch();
    expect(match.setStrength("go easy on me, I'm a beginner")).toBe('beginner');
    expect(match.rank).toBeGreaterThan(0);
    expect(() => match.setStrength('ludicrous')).toThrow(/not a level/);
  });

  test('sessions differ in seed, and a reported seed is kept', () => {
    expect(new Set(Array.from({ length: 8 }, () => new ChessMatch().seed)).size).toBeGreaterThan(1);
    expect(new ChessMatch('white', 42).seed).toBe(42);
  });
});

describe('a move said in a sentence', () => {
  test.each(['e4', 'play e4', 'move e4', 'e4 then', "I'll play e4", 'e four please', 'the e pawn to e4', "king's pawn to e4", 'B4', 'e4?'])(
    'still reaches the board: %s',
    (phrase) => {
      // The gate said yes and the resolver said "not a legal move in this position".
      expect(looksLikeMoveStatement(phrase)).toBe(true);
      const match = new ChessMatch();
      const played = match.applyMove('user', phrase);
      expect(['e4', 'b4']).toContain(played.san);
      expect(match.snapshot().history).toEqual([played.san]);
    },
  );
});

/**
 * Sentences the GATE accepts (short, hedge-free, a square in them) that are
 * talk ABOUT the board. "your knight on f3 is strong" once pushed the f-pawn.
 */
const COMMENTARY = [
  'your knight on f3 is strong', 'my knight is on f3', 'your e4 was strong', 'the e4 square looks weak', 'I like e4',
  'e4 is a great square', 'e4 then d4', 'f3 looks weak', 'nice e4', 'your e4',
  // A stated PLAN is not a move: thinking out loud at a board, and no takeback.
  "i'll play d4 next", 'd4 next', 'next i play d4', 'then i play d4', 'then d4', 'd4 next time', 'd4 then c4',
  // A bare copula turns an instruction whitelist into a DESCRIPTION whitelist.
  'my knight is f3', 'a knight is f3', 'the bishop is c4', 'my pawn is d4', 'the pawn is e4', 'e4 is my pawn', 'e4 is the move',
  'the queen is e4', 'is e4 my move', 'is it e4', 'is d4 the move', 'e4 is it', "d4 is my king's pawn", 'e4 is a pawn move',
  'the move is e4', 'my queen is for e4', 'e4 is for me', 'e4 is my king', 'e4 is my move',
  // The cost, accepted deliberately: one repetition against an un-takebackable false positive.
  'my move is d4',
];
/** The gate already refuses these ("or", "better" are hedges); the resolver must not depend on that. */
const HEDGED_COMMENTARY = ['e4 or d4', 'e4 was better than d4', 'd4 instead of e4'];

describe('commentary is not a move', () => {
  const afterE4H5 = () => {
    const match = new ChessMatch();
    match.applyMove('user', 'e4');
    match.applyMove('agent', 'h5');
    return match;
  };

  test.each(HEDGED_COMMENTARY)('the board refuses what the gate already refused: %s', (phrase) => {
    expect(() => afterE4H5().applyMove('user', phrase)).toThrow(IllegalMove);
  });

  test.each(COMMENTARY)('commenting on a piece does not move it: %s', (phrase) => {
    // The gate says yes to these and always has; the RESOLVER must say no.
    expect(looksLikeMoveStatement(phrase)).toBe(true);
    const match = afterE4H5();
    const before = match.snapshot().fen;
    expect(() => match.applyMove('user', phrase)).toThrow(IllegalMove);
    expect(match.snapshot().fen).toBe(before);
  });

  test.each(['should I play e4?', 'what about e4', 'is e4 any good'])('a question about a move is answered, not played: %s', (musing) => {
    expect(looksLikeMoveStatement(musing)).toBe(false);
  });
});

describe('castling', () => {
  test.each([
    ['O-O', 'O-O'], ['o-o', 'O-O'], ['0-0', 'O-O'], ['O-O-O', 'O-O-O'], ['o-o-o', 'O-O-O'], ['0-0-0', 'O-O-O'],
    ['castle kingside', 'O-O'], ['castle queenside', 'O-O-O'], ['castles long', 'O-O-O'],
  ])('a castle written with letters castles: %s', (spoken, expected) => {
    // STT returns the letter O far more often than the digit, and only the digit form once parsed.
    expect(looksLikeMoveStatement(spoken)).toBe(true);
    expect(at(CASTLE_READY).applyMove('user', spoken).san).toBe(expected);
  });

  test.each(['i like my castle', 'my castle', 'my castle is on h1', 'castle is my rook', 'nice castle', 'my castling rights', 'i want to castle later'])(
    'talking about a rook does not castle: %s',
    (phrase) => {
      // "Castle" is the colloquial rook, and a bare search for the word castled on all of these.
      const match = at(CASTLE_READY);
      expect(() => match.applyMove('user', phrase)).toThrow(IllegalMove);
      expect(match.snapshot().history).toEqual([]);
    },
  );

  test.each([
    ['castle', 'O-O'], ['castles', 'O-O'], ['castle kingside', 'O-O'], ['castle queenside', 'O-O-O'], ['castle short', 'O-O'],
    ['castle long', 'O-O-O'], ['castles long', 'O-O-O'], ['castle king side', 'O-O'], ['castle queen side', 'O-O-O'],
    ["let's castle kingside", 'O-O'], ['please castle', 'O-O'], ["i'll castle queenside", 'O-O-O'],
  ])('asking to castle still castles: %s', (phrase, expected) => {
    expect(at(CASTLE_READY).applyMove('user', phrase).san).toBe(expected);
  });

  test.each([
    'move the castle', 'play the castle', 'the castle moves', 'the castle', "the king's castle", 'king and castle', 'queen castle',
    'castle to the king', 'i like my castle', 'my castle', 'my castle is on h1', 'castle is my rook', 'nice castle',
    'my castling rights', 'i want to castle later',
  ])('rook talk does not castle: %s', (phrase) => expect(play(phrase, CASTLE_READY)).toBeNull());

  test.each([
    ['i want to castle', 'O-O'], ['let me castle', 'O-O'], ["i'm going to castle", 'O-O'], ['we castle', 'O-O'], ['castle it', 'O-O'],
    ['castle my king', 'O-O'], ['just castle', 'O-O'], ["i'll castle now", 'O-O'], ['castle king side', 'O-O'], ['castle queen side', 'O-O-O'],
  ])('the natural ways of asking to castle all castle: %s', (phrase, expected) => {
    expect(play(phrase, CASTLE_READY)).toBe(expected);
  });
});

describe('piece phrasings, and never calling a legal move illegal', () => {
  test.each([
    ['knight to g5', 'Ng5'], ['play knight to g5', 'Ng5'], ["let's play knight to g5", 'Ng5'], ["i'll play knight to g5", 'Ng5'],
    ['knight to g5 please', 'Ng5'], ['play the knight to g5', 'Ng5'], ['my knight to g5', 'Ng5'], ["king's knight to g5", 'Ng5'],
    ['play bishop takes f7', 'Bxf7+'], ['play queen to e2', 'Qe2'], ['push d4', 'd4'], ['just play d4', 'd4'], ["i'm playing d4", 'd4'],
    ['d4 for me', 'd4'],
  ])('asking for a piece by name moves it: %s', (phrase, expected) => {
    // "knight to g5" played and "play knight to g5" was once told it was not legal.
    expect(looksLikeMoveStatement(phrase)).toBe(true);
    expect(at(MIDGAME).applyMove('user', phrase).san).toBe(expected);
  });

  test('a phrasing this parser cannot read is unreadable, never illegal', () => {
    expect(looksLikeMoveStatement('that knight belongs on g5')).toBe(true);
    expect(() => at(MIDGAME).applyMove('user', 'that knight belongs on g5')).toThrow(UnreadableMove);
  });

  test('an ambiguous move is a question, and the question names forms that work', () => {
    // Both knights reach d2: once swallowed as "not a legal move". And "name
    // the square it comes from" sent players to "knight from b1 to d2", which
    // is unreadable, so the question has to suggest a form that resolves.
    let reason = '';
    try {
      at(MIDGAME).applyMove('user', 'knight to d2');
    } catch (err) {
      expect(err).toBeInstanceOf(AmbiguousMove);
      reason = (err as Error).message;
    }
    expect(reason).toContain('Nbd2');
    expect(reason).toContain('Nfd2');
    expect(reason).toContain('b1d2');
    expect(reason).not.toContain('comes from');
    for (const suggestion of ['Nbd2', 'Nfd2', 'b1d2']) expect(at(MIDGAME).applyMove('user', suggestion).san.endsWith('d2')).toBe(true);
  });

  test('a pawn capture without its file is completed, or asked about', () => {
    // "pawn takes f6" compacts to "xf6", which is not SAN; only the board knows which file took.
    expect(at('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3').applyMove('user', 'pawn takes f6').san).toBe('exf6');
    expect(() => at('rnbqkbnr/pppp1ppp/8/4p3/3P1P2/8/PPP1P1PP/RNBQKBNR w KQkq - 0 1').applyMove('user', 'pawn takes e5')).toThrow(/dxe5 or fxe5/);
  });

  test('saying "takes" onto an empty square is refused, not quietly played as a push', () => {
    expect(() => new ChessMatch().applyMove('user', 'pawn takes e4')).toThrow(/nothing to take on e4/);
  });

  test.each([
    ['e4 then', true], ['then e4', false], ['then i play e4', false], ['e4 next', false], ['next e4', false],
  ] as const)('where "then" sits decides instruction or plan: %s', (phrase, plays) => {
    expect(looksLikeMoveStatement(phrase)).toBe(true);
    const match = new ChessMatch();
    if (plays) expect(match.applyMove('user', phrase).san).toBe('e4');
    else {
      expect(() => match.applyMove('user', phrase)).toThrow(IllegalMove);
      expect(match.snapshot().history).toEqual([]);
    }
  });

  test('a long but real instruction still plays', () => {
    expect(at(MIDGAME).applyMove('user', "ok let's play the king's knight to g5 please").san).toBe('Ng5');
  });

  test('the same words in a later turn still reach the board', () => {
    // The knight goes out, comes back, and is sent out again by the same sentence.
    const match = new ChessMatch();
    for (const [who, words] of [['user', 'e4'], ['agent', 'e5'], ['user', 'knight to f3'], ['agent', 'Nc6'], ['user', 'Ng1'], ['agent', 'Nb8'], ['user', 'knight to f3']] as const) {
      match.applyMove(who, words);
    }
    expect(match.snapshot().history).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Ng1', 'Nb8', 'Nf3']);
  });
});

describe('class sweeps over the vocabulary sets', () => {
  // These sweep the SETS, not a list of sentences: each review round once
  // closed a defect at its exemplars and left the rule that generated them.
  test('the positions the sweeps rely on really are ambiguous', () => {
    const both = new Chess(BOTH_LEGAL);
    expect(both.move('Nf3')).toBeTruthy();
    expect(new Chess(BOTH_LEGAL).move('f3')).toBeTruthy();
    expect(new Chess(ROOK_AND_PAWN).move('Rd5')).toBeTruthy();
    expect(new Chess(ROOK_AND_PAWN).move('d5')).toBeTruthy();
  });

  test.each([['knight', 'N'], ['bishop', 'B'], ['rook', 'R'], ['queen', 'Q']])('naming a %s never moves a different piece', (noun, letter) => {
    // "knight moves to f3" once played the f-PAWN.
    const offenders = [...MOVE_FILLER].sort().flatMap((word) => {
      const played = play(`my ${noun} ${word} f3`, BOTH_LEGAL);
      return played !== null && !played.startsWith(letter) ? [`'my ${noun} ${word} f3' -> ${played}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  test.each([
    ['knight to f3', 'Nf3'], ['knight moves to f3', 'Nf3'], ['knight goes to f3', 'Nf3'], ['my knight moves f3', 'Nf3'],
    ['knight plays f3', 'Nf3'], ['play the knight to f3', 'Nf3'], ['knight f3', 'Nf3'],
  ])('an instruction naming a knight moves the knight: %s', (phrase, expected) => expect(play(phrase, BOTH_LEGAL)).toBe(expected));

  test('no determiner or transitive verb turns rook talk into a castle', () => {
    const offenders = [...new Set([...CASTLE_DETERMINERS, ...CASTLE_TRANSITIVES])].sort()
      .flatMap((word) => [`${word} castle`, `${word} castle kingside`].filter((phrase) => play(phrase, CASTLE_READY) !== null));
    expect(offenders).toEqual([]);
  });

  test('every castle word is swept, not just the determiners', () => {
    expect([...CASTLE_OK].sort().filter((word) => play(`the ${word} castle`, CASTLE_READY) !== null)).toEqual([]);
  });

  const PIECE_SYNONYMS = new Set([
    'pawn', 'pawns', 'knight', 'knights', 'night', 'nights', 'horse', 'horses', 'bishop', 'bishops', 'rook', 'rooks',
    'castle', 'castles', 'tower', 'towers', 'queen', 'queens', 'king', 'kings', 'piece', 'pieces',
  ]);
  const DESCRIPTIVE_WORDS = new Set([
    'is', 'was', 'were', 'are', 'be', 'been', 'on', 'at', 'from', 'near', 'beside', 'over', 'under', 'looks', 'look', 'looking',
    'like', 'likes', 'nice', 'strong', 'weak', 'great', 'good', 'bad', 'your', 'yours', 'his', 'her', 'their', 'sits', 'stands',
    'belongs', 'has', 'had', 'seems',
  ]);

  test('no word that names a piece is content-free filler', () => {
    // "castle" sat in the filler set with no letter, so agreement could not
    // engage and "move my castle to d5" pushed the d-PAWN.
    expect([...PIECE_SYNONYMS].filter((w) => MOVE_FILLER.has(w) && !(w in PIECE_LETTER))).toEqual([]);
    expect([...PIECE_SYNONYMS].filter((w) => CASTLE_OK.has(w) && !CASTLE_OBJECT_ONLY.has(w))).toEqual([]);
    for (const word of CASTLE_OBJECT_ONLY) {
      expect(play(`${word} castle`, CASTLE_READY)).toBeNull();
      expect(play(`castle my ${word}`, CASTLE_READY)).toBe('O-O');
    }
  });

  test('no descriptive word is treated as an instruction', () => {
    // Add "on" and "looks" and "the knight on f3" plays Nf3 with the suite green.
    expect([...DESCRIPTIVE_WORDS].filter((w) => MOVE_FILLER.has(w))).toEqual([]);
    expect([...DESCRIPTIVE_WORDS].filter((w) => CASTLE_OK.has(w))).toEqual([]);
  });

  test('a noun phrase with a square never moves a pawn instead', () => {
    const pawnWords = new Set(Object.entries(PIECE_LETTER).filter(([, letter]) => letter === '').map(([word]) => word));
    const offenders = [...PIECE_SYNONYMS].filter((w) => !pawnWords.has(w) && play(`my ${w} to d5`, ROOK_AND_PAWN) === 'd5');
    expect(offenders).toEqual([]);
    expect(play('my pawn to d5', ROOK_AND_PAWN)).toBe('d5');
  });

  test('naming a rook by its nickname never pushes a pawn', () => {
    for (const phrase of ['move my castle to d5', 'my castle to d5', 'push the castle to d5', 'castle to d5']) {
      expect(play(phrase, ROOK_AND_PAWN)).not.toBe('d5');
    }
    expect(play('castle', CASTLE_READY)).toBe('O-O');
    expect(play('castle kingside', CASTLE_READY)).toBe('O-O');
    expect(play('rook to d5', ROOK_AND_PAWN)).toBe('Rd5');
  });
});

describe('refusals', () => {
  test('a very long move cannot flood the screen or the avatar', () => {
    // A 30 KB "move" once produced a 31 KB broadcast the shell silently dropped.
    const match = new ChessMatch();
    match.noteRefusal('日'.repeat(10_000), `'${'日'.repeat(10_000)}' is not a legal move`);
    const refusal = match.snapshot().last_refusal!;
    expect(new TextEncoder().encode(refusal.move!).length).toBeLessThanOrEqual(REFUSAL_MOVE_MAX_BYTES);
    expect(new TextEncoder().encode(refusal.reason!).length).toBeLessThanOrEqual(REFUSAL_REASON_MAX_BYTES);
    // Whole characters only: a cut mid-character would not survive.
    expect(refusal.move).toBe('日'.repeat(REFUSAL_MOVE_MAX_BYTES / 3));
  });

  test('a refusal is not re-attached to a position that moved on', () => {
    const match = new ChessMatch();
    const atFen = match.board.fen();
    match.applyMove('user', 'e4');
    expect(() => match.noteRefusal('e5', 'it is not your side to move', atFen)).toThrow(/stale/);
    expect(match.snapshot().last_refusal).toBeNull();
    match.noteRefusal('e5', 'it is not your side to move', match.board.fen());
    expect(match.snapshot().last_refusal?.move).toBe('e5');
  });

  test('the next accepted move clears a refusal', () => {
    const match = new ChessMatch();
    match.noteRefusal('e5', 'nope');
    match.applyMove('user', 'e4');
    expect(match.snapshot().last_refusal).toBeNull();
  });

  test('a wall of words is quoted back clipped, with the explanation intact', () => {
    let reason = '';
    try {
      new ChessMatch().applyMove('user', 'Ke2' + 'z'.repeat(5000));
    } catch (err) {
      reason = (err as Error).message;
    }
    expect(reason).toMatch(/is not a legal move in this position$/);
    expect(reason.length).toBeLessThan(REFUSAL_REASON_MAX_BYTES);
  });
});
