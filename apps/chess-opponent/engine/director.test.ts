import { describe, expect, test } from 'vitest';
import { boardState, materialLead, movesText, NOTES, say } from './director.ts';
import { ChessMatch } from './game.ts';
import { Table } from './table.ts';

const STATE_LIMIT = 3858;
const NOTE_LIMIT = 2000;

describe('limits', () => {
  test('every standing note fits the 2,000-character limit', () => {
    for (const note of NOTES) expect(note.length).toBeLessThanOrEqual(NOTE_LIMIT);
  });

  test('the busiest board in a game gone the distance still fits the state limit', () => {
    // 218 legal moves (the most a position is known to hold) and 400 plies of history.
    const match = new ChessMatch();
    match.board.load('R6R/3Q4/1Q4Q1/4Q3/2Q4Q/Q4Q2/pp1Q4/kBNN1KB1 w - - 0 1');
    match.historySan = Array.from({ length: 400 }, () => 'Qxd7+');
    const snapshot = match.snapshot();
    expect(snapshot.legal_moves.length).toBeGreaterThan(200);
    const state = boardState({ ...snapshot, opening: "Queen's Gambit Declined", difficulty: 'beginner' });
    expect(state.length).toBeLessThanOrEqual(STATE_LIMIT);
    expect(state).toContain('Qxd7+');
  });

  test('every event, with the longest inputs, stays short', () => {
    const t = new Table(new ChessMatch());
    const s = t.snapshot();
    const long = 'x'.repeat(120);
    const why = 'y'.repeat(480);
    for (const text of [say.refused(long, why), say.ambiguous(long, why), say.unreadable(long), say.sideRefused(why), say.start(s), say.resume(s)]) {
      expect(text.length).toBeLessThan(1000);
    }
  });
});

describe('the persona never claims a strength it does not have', () => {
  // The original prompt opened "You play at a strong level" for a one-ply heuristic.
  const all = NOTES.join('\n').toLowerCase();

  test('the honest description is there', () => {
    expect(all).not.toContain('strong level');
    expect(all).toContain('one move ahead');
    expect(all).toContain('two-move tactic');
  });

  test('a rating is only ever mentioned to forbid claiming one', () => {
    expect(all).toContain('never claim a rating, an elo, a title');
    for (const sentence of all.split(/(?<=[.!?:])\s+/)) {
      if (/\b(grandmaster|elo)\b/.test(sentence)) expect(sentence).toContain('never claim');
    }
  });

  test('the hard-won rules are kept', () => {
    expect(all).toContain('no takebacks');
    expect(all).toContain('agreeing is not doing');
    expect(all).toContain('never name or announce a move of yours');
    expect(all).toContain('best move');
  });
});

describe('the state', () => {
  test("describes the board for questions, and stages the player's legal moves only on their turn", () => {
    const t = new Table(new ChessMatch('white', 1));
    const first = t.act({ kind: 'move', text: 'e4' });
    const mid = boardState(first.snapshot);
    expect(mid).toContain('It is your move');
    expect(mid).toContain('Do not name it');
    expect(mid).not.toContain('legal moves right now');
    t.reply(first.next!);
    const yours = boardState(t.snapshot());
    expect(yours).toContain("It is the player's move");
    expect(yours).toContain('legal moves right now');
    expect(yours).toContain(`Position (FEN): ${t.snapshot().fen}`);
    expect(yours).toMatch(/Moves so far: 1\. e4 \S+/);
  });

  test('never carries a refusal: that is said once, as an event, not restated on every turn', () => {
    const t = new Table(new ChessMatch());
    const refused = t.act({ kind: 'move', text: 'e5' });
    expect(refused.snapshot.last_refusal).not.toBeNull();
    expect(boardState(refused.snapshot)).not.toMatch(/refus/i);
  });

  test('stages the predictable answers: a side swap, the side they have, an easier game', () => {
    // "can I play black?" is answered by the avatar before the app can act;
    // the staged answer is what the board will do, so the answer is true.
    const state = boardState(new ChessMatch().snapshot());
    expect(state).toContain('to play Black, the board starts a new game with them on Black and you moving first');
    expect(state).toContain('To play White: they already are White, so nothing changes');
    expect(state).toContain('casual strength from your next move');
    expect(state).toContain('beginner strength if they say they are a beginner');
  });

  test('after the game only the result and a new game are offered', () => {
    const match = new ChessMatch();
    match.resign('user');
    const state = boardState(match.snapshot());
    expect(state).toContain('The game is over: the player resigned, so you won');
    expect(state).not.toContain('legal moves');
    expect(state).not.toContain('Only if the player asks');
  });

  test('material is a count from the player’s side, not an evaluation', () => {
    expect(materialLead('rnbqkbnr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3', 'white')).toBe(1);
    expect(materialLead('rnbqkbnr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3', 'black')).toBe(-1);
    const match = new ChessMatch();
    match.board.load('rnbqkbnr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3');
    expect(boardState(match.snapshot())).toContain('the player is 1 pawn of material ahead (a count of pieces, not an evaluation)');
  });

  test('the move list is numbered like a scoresheet, and its elided head says so', () => {
    expect(movesText(['e4', 'e5', 'Nf3'])).toBe('1. e4 e5 2. Nf3');
    expect(movesText(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], 2)).toBe('… 2... Nc6 3. Bb5');
  });
});

describe('the reply event', () => {
  test('names only the move the board played, with what it does and the opening once', () => {
    const text = say.reply({ userMove: 'Nf3', check: false }, { san: 'Nc6', tags: ['knight'] }, { ...new ChessMatch().snapshot(), history: ['e4', 'e5', 'Nf3', 'Nc6'], opening: 'Open Game' });
    expect(text).toContain('The player played Nf3');
    expect(text).toContain('You replied Nc6, already on the board');
    expect(text).toContain('The opening is Open Game. Name the opening ONLY if you have not named it already');
    expect(text).toContain('Do not narrate any other move');
  });

  test('a check given by the player is acknowledged, and what the move does is said in words, never in scores', () => {
    const text = say.reply({ userMove: 'Bb5+', check: true }, { san: 'c6', tags: ['pawn'] }, new ChessMatch().snapshot());
    expect(text).toContain('It gives you check');
    const capture = say.reply({ userMove: 'e4' }, { san: 'Qxd7#', tags: ['checkmate', 'capture', 'queen'] }, new ChessMatch().snapshot());
    expect(capture).toContain('What your move does: it is checkmate; it captures a piece.');
    expect(capture).not.toMatch(/score|centipawn/i);
  });
});
