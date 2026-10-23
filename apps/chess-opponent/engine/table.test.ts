// The table: every change on the board, and the one thing the avatar is told
// about it. The original's wiring tests were about its platform seams (the
// store, the tools, the claim that stopped a change being narrated twice);
// those seams are gone, but each test's lesson is a property of this one, so
// they are re-stated here against it.
import { describe, expect, test } from 'vitest';
import { chooseMove } from './engine.ts';
import { ChessMatch } from './game.ts';
import { Table, type Outcome } from './table.ts';

const MIDGAME = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 1';
const BACK_RANK = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';

const table = (seed = 1) => new Table(new ChessMatch('white', seed));
const at = (fen: string) => {
  const t = table();
  t.match.board.load(fen);
  return t;
};
/** Act, then let the opponent reply if it is its turn (the page waits a beat in between). */
function play(t: Table, text: string): Outcome[] {
  const first = t.act({ kind: 'move', text });
  return first.next ? [first, t.reply(first.next)] : [first];
}
const events = (outcomes: Outcome[]) => outcomes.flatMap((o) => (o.event ? [o.event.text] : []));

describe('the opponent moves on its own', () => {
  test("a player's move is answered by the opponent's, in one event about both", () => {
    const t = table();
    const outcomes = play(t, 'e4');
    expect(t.snapshot().history).toHaveLength(2);
    expect(t.match.turn()).toBe('user');
    expect(events(outcomes)).toHaveLength(1);
    const [line] = events(outcomes);
    expect(line).toContain('The player played e4');
    expect(line).toContain(`You replied ${t.snapshot().history[1]}`);
    expect(line).toContain('why you played it');
  });

  test('the seed reaches the move chooser: same seed, same reply', () => {
    const seen: unknown[] = [];
    const spy = new Table(new ChessMatch('white', 4242), (fen, legal, rank, seed) => {
      seen.push(seed);
      return chooseMove(fen, legal, rank, seed);
    });
    play(spy, 'e4');
    expect(seen).toEqual([4242]);
    const a = table(7);
    const b = table(7);
    play(a, 'e4');
    play(b, 'e4');
    expect(a.snapshot().history).toEqual(b.snapshot().history);
  });

  test('a stale reply is not played: the board moved on before the beat was over', () => {
    const t = table();
    const first = t.act({ kind: 'move', text: 'e4' });
    t.act({ kind: 'new' });
    expect(t.reply(first.next!).kind).toBe('idle');
    expect(t.snapshot().history).toEqual([]);
  });

  test('the opening is named in the line the avatar says', () => {
    // The original handed the commentary `opening=None` on every move while the panel showed the name.
    const t = table();
    t.match.applyMove('user', 'e4');
    t.match.applyMove('agent', 'e5');
    const [line] = events(play(t, 'Nf3'));
    expect(t.snapshot().opening).toBeTruthy();
    expect(line).toContain(`The opening is ${t.snapshot().opening}`);
  });
});

describe('refusals reach both the screen and the avatar', () => {
  test('an illegal move is refused in words, and nothing moves', () => {
    // Found live: an illegal "Qh5" was praised as played while the board sat at the start.
    const t = table();
    const [outcome] = play(t, 'Qh5');
    expect(outcome.kind).toBe('refused');
    expect(outcome.event!.text).toContain('REFUSED');
    expect(outcome.event!.text).toContain('not a legal move');
    expect(outcome.event!.text).toContain('NOT played');
    expect(t.snapshot().history).toEqual([]);
    expect(t.snapshot().last_refusal?.move).toBe('Qh5');
    // And the legal path still plays.
    play(t, 'e4');
    expect(t.snapshot().history[0]).toBe('e4');
    expect(t.snapshot().last_refusal).toBeNull();
  });

  test('a move said a beat early is refused, and the same words later play', () => {
    const t = table();
    const reset = t.act({ kind: 'side', side: 'black' });
    // Impatient: they call their move before the opponent has played.
    expect(t.act({ kind: 'move', text: 'e5' }).reason).toMatch(/not your side/);
    t.reply(reset.next!);
    expect(play(t, 'e5')[0].applied).toBe(true);
    expect(t.snapshot().history[1]).toBe('e5');
  });

  test('a phrasing the board cannot read is never called illegal, and nothing is put on screen', () => {
    const [outcome] = play(at(MIDGAME), 'that knight belongs on g5');
    expect(outcome.kind).toBe('unreadable');
    expect(outcome.snapshot.last_refusal).toBeNull();
    expect(outcome.event!.text).toContain('Do NOT say it is illegal');
  });

  test('an ambiguous move is a question to the player, on screen and to the avatar', () => {
    const t = at(MIDGAME);
    const [outcome] = play(t, 'knight to d2');
    expect(outcome.kind).toBe('ambiguous');
    expect(outcome.event!.text).toContain('Nbd2');
    expect(outcome.event!.text).toContain('Do NOT call it illegal');
    expect(t.snapshot().last_refusal?.reason).toContain('Nfd2');
    expect(play(t, 'Nfd2')[0].applied).toBe(true);
  });

  test('a wall of words reaches the avatar clipped', () => {
    const [outcome] = play(table(), 'Ke2' + 'z'.repeat(5000));
    expect(outcome.snapshot.last_refusal?.reason).toContain('not a legal move');
    expect(outcome.event!.text.length).toBeLessThan(900);
  });
});

describe('every ending is spoken, once', () => {
  test('a mate the player delivers is conceded, however it arrived', () => {
    // A mate said out loud once ended in silence while the same mate dragged conceded.
    for (const words of ['rook to a8', 'Ra8', 'a1a8']) {
      const outcomes = play(at(BACK_RANK), words);
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].snapshot.result).toEqual({ winner: 'opponent', reason: 'checkmate' });
      expect(outcomes[0].event!.text).toContain('game just ended');
      expect(outcomes[0].event!.text).toContain('You lost');
    }
  });

  test("the opponent's own mating move is one result line, not commentary and a goodbye", () => {
    // The player is White; Black (the opponent) to move, with a back-rank mate on a1.
    const t = at('r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1');
    const outcome = t.reply({ fen: t.match.board.fen() });
    expect(outcome.kind).toBe('result');
    expect(outcome.snapshot.result).toEqual({ winner: 'agent', reason: 'checkmate' });
    expect(outcome.event!.text).toContain('You played Ra1#');
    expect(outcome.event!.text).toContain('You won');
    expect(outcome.event!.text).not.toContain('why you played it');
  });

  test('a resignation is thanked for once, not twice', () => {
    // Resigning once got two goodbyes in a row from the same avatar.
    const t = table();
    const outcome = t.act({ kind: 'resign' });
    expect(outcome.snapshot.result).toEqual({ winner: 'agent', reason: 'resignation' });
    expect(events([outcome])).toEqual([expect.stringContaining('resigned')]);
    expect(t.act({ kind: 'resign' }).reason).toMatch(/already over/);
  });

  test("the new-game button is not silent", () => {
    // A reset asked for out loud got a line; the same reset from the button got nothing.
    const t = table();
    play(t, 'e4');
    const outcome = t.act({ kind: 'new' });
    expect(outcome.snapshot.history).toEqual([]);
    expect(outcome.event!.text).toContain('fresh game');
  });
});

describe('sides and strength', () => {
  test('asking to play black seats them on black, and the opponent opens with the news in one event', () => {
    // Seen live: "can I play black?" -> "Sure thing... I'll start, then. e4." with nothing changed.
    const t = table();
    play(t, 'e4');
    const reset = t.act({ kind: 'side', side: 'black' });
    expect(reset.snapshot.user_color).toBe('black');
    expect(reset.snapshot.history).toEqual([]);
    expect(reset.event).toBeUndefined();
    const reply = t.reply(reset.next!);
    expect(reply.snapshot.history).toHaveLength(1);
    expect(reply.event!.text).toContain('player on Black');
    expect(reply.event!.text).toContain(`You opened with ${reply.snapshot.history[0]}`);
  });

  test("'other' swaps, and swapping back seats them on white with their move first", () => {
    const t = table();
    const first = t.act({ kind: 'side', side: 'other' });
    t.reply(first.next!);
    const back = t.act({ kind: 'side', side: 'other' });
    expect(back.snapshot.user_color).toBe('white');
    expect(back.next).toBeUndefined();
    expect(back.event!.text).toContain('they move first');
  });

  test('the side they already have is refused, the game survives, and the host is told nothing changed', () => {
    const t = table();
    play(t, 'e4');
    const outcome = t.act({ kind: 'side', side: 'white' });
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toMatch(/already playing white/);
    expect(outcome.event!.text).toContain('already playing White, so nothing changed and the game goes on');
    expect(t.snapshot().history).toHaveLength(2);
  });

  test('asking twice for Black deals one game, not two: the second ask changes nothing', () => {
    // Seen live: "Can I play black instead?" then "Yes, start over as Black." dealt a second fresh game.
    const t = table();
    const first = t.act({ kind: 'side', side: 'black' });
    t.reply(first.next!);
    const dealt = t.snapshot();
    const again = t.act({ kind: 'side', side: 'black' });
    expect(again.applied).toBe(false);
    expect(again.next).toBeUndefined();
    expect(again.event!.text).toContain('already playing Black, so nothing changed: this game has only just started');
    expect(t.snapshot()).toEqual(dealt);
  });

  test('a difficulty change takes effect without a reset', () => {
    const t = table();
    play(t, 'e4');
    const outcome = t.act({ kind: 'difficulty', level: 'beginner' });
    expect(outcome.applied).toBe(true);
    expect(outcome.snapshot.difficulty).toBe('beginner');
    expect(t.match.rank).toBe(5);
    expect(outcome.snapshot.history).toHaveLength(2);
    expect(outcome.event!.text).toContain('beginner strength from your next move');
  });

  test('the strength it already plays at changes nothing, and says so', () => {
    const t = table();
    const outcome = t.act({ kind: 'difficulty', level: 'full' });
    expect(outcome.applied).toBe(false);
    expect(outcome.event!.text).toContain('already playing at full strength');
  });

  test('the opening line invites the first move, or leads the opening move when the opponent is White', () => {
    expect(table().start().event!.text).toContain('invite their first move');
    const black = new Table(new ChessMatch('black', 3));
    const start = black.start();
    expect(start.event).toBeUndefined();
    const reply = black.reply(start.next!);
    expect(reply.event!.text).toContain('they are Black, so you moved first');
  });
});
