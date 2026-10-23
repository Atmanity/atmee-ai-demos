// The wired table: the host's tool calls and the player's buttons in, rulings
// out, Dex playing his own turns (ported from test_table.py, the
// apply_user_turn half of test_user_turn_moves.py and the session half of
// test_rules_and_session.py; the move now reaches the table through the
// host's play_move, checked against the player's own words).
import { describe, expect, test } from 'vitest';
import { spokenCard } from './cards.ts';
import type { Ask } from './decide.ts';
import { speak } from './director.ts';
import { Table } from './table.ts';

const DECK = ['As', 'Kd', 'Ah', 'Kc', '2c', '7d', '9h', '3s', '5c', '5d', '8h', 'Jc', 'Qd'];

/** A dealt hand with the action on the player. Hand 1: the player is on the button and acts first. */
function liveTable(deck = DECK, opts: ConstructorParameters<typeof Table>[0] = {}) {
  const table = new Table(opts);
  table.match.deal(deck);
  expect(table.match.actionTo()).toBe('user');
  return table;
}

/** The player says `said`, and the host calls play_move with `words` (by default, the same words). */
const say = (table: Table, said: string, words = said) => table.playerMove(words, [{ text: said, seq: table.view().seq }]);
const text = (r: { line?: Parameters<typeof speak>[0][number] }) => speak([r.line]);
const safe: Ask = async () => null; // no model: the safe action

describe('a fold ends the hand, and the next one waits for the player', () => {
  test('"I fold" ends the hand, with no model anywhere', () => {
    // The trap: the fold reached nothing, so the hand could not end and the
    // player was stuck in it for the rest of the call.
    const table = liveTable();
    const result = say(table, 'I fold.');
    expect(table.match.handLive).toBe(false);
    expect(result.view.phase).toBe('hand-over');
    expect(result.view.players.user.folded).toBe(true);
    expect(result.changed).toBe(true);
    expect(text(result)).toContain('The table played their fold.');
    expect(text(result)).toContain('The hand is over');
  });

  test('then deal_hand deals it, and a second deal_hand deals nothing', () => {
    const table = liveTable();
    say(table, 'I fold');
    const dealt = table.deal();
    expect(dealt.changed).toBe(true);
    expect(table.match.handLive).toBe(true);
    expect(text(dealt)).toContain('Hand 2 is dealt');
    const again = table.deal();
    expect(again.changed).toBe(false);
    expect(text(again)).toContain('A hand is already in play');
  });
});

test('a question about folding is not a fold', () => {
  const table = liveTable();
  for (const question of ['should I fold?', 'what happens if I fold?', 'is folding bad?']) {
    const result = say(table, question);
    expect(table.match.handLive, question).toBe(true);
    expect(result.changed, question).toBe(false);
    expect(text(result)).toContain('NOTHING was applied');
  }
});

test('a hedged move is asked about rather than played', () => {
  const table = liveTable();
  const seq = table.match.seq;
  const result = say(table, "I'm not folding this one");
  expect(table.match.seq).toBe(seq);
  expect(text(result)).toContain('could not read a move');
});

test('gibberish with a number never becomes a raise, even when the host writes one', () => {
  // Verbatim from the original: "purple banana forty seven?" -> "You raised to 47!".
  const table = liveTable();
  const { seq } = table.match;
  const pot = table.view().pot;
  for (const words of ['purple banana forty seven?', 'raise to 47']) {
    const result = say(table, 'purple banana forty seven?', words);
    expect(table.match.seq, words).toBe(seq);
    expect(table.view().pot).toBe(pot);
    expect(text(result)).toContain('NOTHING was applied');
  }
});

test('real moves reach the table', () => {
  for (const [said, expected] of [['I call', 'call'], ['call it', 'call'], ['raise to 60', 'raise'], ['make it eighty', 'raise'], ['all in', 'raise'], ["I'm out", 'fold']] as const) {
    const table = liveTable();
    say(table, said);
    const last = table.view().last_action;
    expect(last?.by, said).toBe('user');
    expect(last?.kind, said).toBe(expected);
  }
});

test('the host may word it its own way, as long as the move is the one they said', () => {
  const table = liveTable();
  const result = say(table, 'Yeah, make it sixty.', 'raise to 60');
  expect(result.changed).toBe(true);
  expect(table.view().last_action).toMatchObject({ by: 'user', kind: 'raise', amount: 60 });
});

test('a move the player did not say is never played', () => {
  // The host heard "raise to 60" as a call, or invented one: the words decide.
  const table = liveTable();
  const seq = table.match.seq;
  const result = say(table, 'raise to 60', 'I call');
  expect(result.changed).toBe(false);
  expect(result.unbacked).toBe(true);
  expect(table.match.seq).toBe(seq);
  expect(text(result)).toContain('did not hear "I call"');
  expect(text(result)).toContain('raise to 60');
});

test('the host may write the move in capitals or quotes; an empty one gets a question, not silence', () => {
  for (const [words, kind] of [['I CALL', 'call'], ['"All In"', 'raise'], ['  Raise To 60.  ', 'raise']] as const) {
    const table = liveTable();
    const result = table.playerMove(words, [{ text: words.toLowerCase().replace(/"/g, ''), seq: table.view().seq }]);
    expect(result.changed, words).toBe(true);
    expect(table.view().last_action?.kind, words).toBe(kind);
  }
  const table = liveTable();
  const empty = table.playerMove('   ', [{ text: 'I call', seq: table.view().seq }]);
  expect(empty.changed).toBe(false);
  expect(text(empty)).toContain('Ask them what they want to do');
});

test('a raise amount is the number they said', () => {
  // 47 is legal here (the minimum raise-to is 40 preflop) and it is what they
  // said: the parser never rounds, substitutes or picks.
  const table = liveTable();
  say(table, 'raise to forty seven');
  expect(table.view().last_action).toMatchObject({ kind: 'raise', amount: 47 });
});

test('a raise below the minimum is refused, not rounded up', () => {
  // Found live: "raise to 5" put 40 chips in the pot. The model had helpfully
  // substituted the minimum, so the player was committed to 8x what they asked
  // for. The table refuses the amount, and the host is told the legal range;
  // a host that "fixes" it to 40 finds 40 is not in their words.
  const table = liveTable();
  const seq = table.match.seq;
  const result = say(table, 'raise to 5');
  expect(table.match.seq).toBe(seq);
  expect(text(result)).toContain('refused');
  expect(text(result)).toContain('NOTHING was applied');
  expect(text(result)).toContain('from 40 to 1000');
  expect(result.message).toMatch(/at least 40/);
  expect(say(table, 'raise to 5', 'raise to 40').changed).toBe(false);
});

test('a raise with no amount is refused with the range', () => {
  const table = liveTable();
  const result = say(table, 'I raise');
  expect(text(result)).toContain('needs an amount');
  expect(text(result)).toContain('from 40 to 1000');
});

test('all-in is a first-class spoken action', () => {
  // Found live: "all in", with an All-in button right there, came back as
  // "isn't possible right now".
  const table = liveTable();
  const before = table.view().players.user;
  const result = say(table, 'all in');
  expect(text(result)).not.toContain('refused');
  expect(text(result)).toContain('their raise to 1000, all in');
  const after = table.view().players.user;
  expect(after.stack).toBe(0);
  expect(after.bet).toBe(before.stack + before.bet);
});

test("saying I'm out folds instead of being called impossible", () => {
  for (const phrase of ["I'm out", 'im out', 'muck', 'I fold']) {
    const table = liveTable();
    const result = say(table, phrase);
    expect(text(result), phrase).not.toContain('refused');
    expect(table.view().players.user.folded, phrase).toBe(true);
  }
});

test('a negated contraction moves nothing', () => {
  for (const said of ["I won't fold", "you can't check there", "don't call that", "I wouldn't raise here"]) {
    const table = liveTable();
    const seq = table.match.seq;
    const result = say(table, said);
    expect(table.match.seq, said).toBe(seq);
    expect(text(result), said).toContain('could not read a move');
  }
});

test('a call with nothing to call is played and said as a check', async () => {
  const table = liveTable();
  say(table, 'call');
  await table.opponentTurn(safe);
  await table.opponentTurn(safe);
  const result = say(table, 'I call');
  expect(result.changed).toBe(true);
  expect(text(result)).toContain('The table played their check.');
});

test('a check facing a bet goes to the table, which refuses it with the options', () => {
  // Round 2, live: "Check." facing a bet got a needle from Dex and no call.
  const table = liveTable();
  const result = say(table, 'Check.');
  expect(result.changed).toBe(false);
  expect(text(result)).toMatch(/^Refused\. They asked to check and the table refused it: you cannot check facing a bet/);
  expect(text(result)).toContain('They can fold, call 10 or raise to anything from 40 up to 1000');
});

test('a move out of turn is refused with the reason', () => {
  const table = liveTable();
  say(table, 'call');
  const result = say(table, 'I check');
  expect(text(result)).toContain('it is not your turn');
  expect(result.message).toBe('it is not your turn');
});

test('folding for free is played as a check, and the table says so', () => {
  const table = liveTable(DECK);
  say(table, 'call');
  // Dex checks: the flop, and Dex (not on the button) acts first; he checks again.
  return table.opponentTurn(safe).then(() => table.opponentTurn(safe)).then(() => {
    const result = say(table, 'I fold');
    expect(table.view().last_action).toMatchObject({ by: 'user', kind: 'check' });
    expect(text(result)).toContain('a fold is played as a check');
  });
});

describe('a bet never lands twice', () => {
  test('the host calling play_move twice for one sentence plays it once', () => {
    const table = liveTable();
    const seq = table.view().seq;
    const heard = [{ text: 'raise to 60', seq }];
    const first = table.playerMove('raise to 60', heard);
    expect(first.changed).toBe(true);
    const second = table.playerMove('raise to 60', heard);
    expect(second.changed).toBe(false);
    expect(text(second)).toContain('already landed');
    expect(table.view().players.user.bet).toBe(60);
  });

  test('a repeat after Dex has answered, on a new street, still plays nothing', async () => {
    // The dangerous one: "call", called, Dex checks, the flop comes and the
    // action is back on the player. A late second play_move("call") would
    // have been a check on the flop they never made.
    const table = liveTable();
    table.match.applyMove('user', 'call');
    table.match.applyMove('agent', 'check');
    table.match.applyMove('agent', 'check');
    expect(table.match.actionTo()).toBe('user');
    const stale = table.playerMove('check', [{ text: 'check', seq: 1 }]);
    expect(stale.changed).toBe(false);
    expect(table.view().last_action).toMatchObject({ by: 'agent', kind: 'check' });
  });

  test('a tapped move and the same move said aloud land once', () => {
    const table = liveTable();
    const said = { text: 'I call', seq: table.view().seq };
    expect(table.press({ kind: 'call' }).changed).toBe(true);
    const voiced = table.playerMove('I call', [said]);
    expect(voiced.changed).toBe(false);
    expect(text(voiced)).toContain('Their call already landed');
  });

  test('new words at the new decision play the new move', async () => {
    const table = liveTable();
    say(table, 'call');
    await table.opponentTurn(safe); // Dex checks: the flop, Dex first
    await table.opponentTurn(safe); // Dex checks again
    const result = say(table, 'check');
    expect(result.changed).toBe(true);
    expect(table.view().street).toBe('TURN');
  });
});

describe('their own cards', () => {
  test('the player can be told their own cards, in words', () => {
    // With the screen out of sight this is the only way to know your hand, and
    // the answer was "I can't reveal any cards".
    const table = liveTable();
    const result = table.ownCards();
    for (const card of table.view().user_hand) expect(text(result)).toContain(spokenCard(card));
    expect(result.changed).toBe(false);
  });
  test('with no hand in play it says so', () => {
    const table = liveTable();
    say(table, 'I fold');
    expect(text(table.ownCards())).toContain('No hand is in play');
  });
  test("Dex's cards never reach that line", () => {
    const table = liveTable();
    const result = table.ownCards();
    for (const card of table.match.holeCards('agent')) expect(text(result)).not.toContain(spokenCard(card));
  });
});

describe('buttons', () => {
  test('a refused press becomes a table message, not a crash and not a move', () => {
    const table = liveTable();
    const seq = table.match.seq;
    const result = table.press({ kind: 'check' });
    expect(result.message).toMatch(/cannot check facing a bet/);
    expect(result.line).toBeUndefined();
    expect(table.match.seq).toBe(seq);
  });
  test('a move by button is told to Dex like a spoken one', () => {
    const table = liveTable();
    const result = table.press({ kind: 'call' });
    expect(text(result)).toContain('The table played their call of 10.');
    expect(result.view.action_to).toBe('agent');
  });
  test('a hand ended by a button is announced', () => {
    const table = liveTable();
    expect(text(table.press({ kind: 'fold' }))).toContain('The hand is over');
  });
  test('Deal, and a rematch only once the match is over', () => {
    const table = liveTable();
    table.press({ kind: 'fold' });
    expect(table.press({ kind: 'restart' }).message).toMatch(/still on/);
    const dealt = table.press({ kind: 'deal' });
    expect(text(dealt)).toContain('Hand 2 is dealt');
    expect(table.press({ kind: 'deal' }).message).toMatch(/already in play/);
  });
  test('unknown words are refused by name', () => {
    const table = liveTable();
    expect(table.press({ kind: 'moonwalk' as 'fold' }).message).toContain('moonwalk');
  });
});

describe("Dex's turn", () => {
  test('nothing happens when it is not his turn', async () => {
    const table = liveTable();
    const result = await table.opponentTurn(safe);
    expect(result.changed).toBe(false);
    expect(result.line).toBeUndefined();
  });

  test("he plays, and is told his own move, not the player's", async () => {
    // Live, the commentary for the opponent's raise came back as "You called.
    // Let's see what happens next.": a second acknowledgement of the PLAYER's
    // move, which left the raise itself unspoken.
    const table = liveTable();
    table.press({ kind: 'call' });
    const result = await table.opponentTurn(async () => ({ action: 'raise', amount: 60 }));
    expect(result.view.last_action).toMatchObject({ by: 'agent', kind: 'raise', amount: 60 });
    expect(text(result)).toContain('The table played your move: you raised to 60.');
    expect(text(result)).toContain('name your own move as done, never as a plan');
    expect(table.lastDecision).toMatchObject({ kind: 'raise', amount: 60, source: 'model' });
  });

  test('no model, a late one or a broken one: the safe action, never a stalled table', async () => {
    const never: Ask = () => new Promise(() => undefined);
    const broken: Ask = async () => { throw new Error('boom'); };
    for (const ask of [null, broken, never]) {
      const table = new Table({ decisionTimeoutMs: 50 });
      table.match.deal(DECK);
      table.press({ kind: 'call' });
      const result = await table.opponentTurn(ask);
      expect(result.view.last_action).toMatchObject({ by: 'agent', kind: 'check' });
      expect(table.lastDecision?.source).toBe('fallback');
    }
  });

  test('an illegal answer from the model degrades to the safe action', async () => {
    const table = liveTable();
    table.press({ kind: 'raise', amount: 100 });
    const result = await table.opponentTurn(async () => ({ action: 'check', amount: 0 }));
    expect(result.view.last_action).toMatchObject({ by: 'agent', kind: 'call' });
  });

  test('consecutive turns: he checks the street closed, then acts first on the next', async () => {
    // His preflop check can end the street and leave him first to act on the
    // flop: the page asks again until the turn is the player's.
    const table = liveTable();
    table.press({ kind: 'call' });
    const first = await table.opponentTurn(safe);
    expect(table.view().street).toBe('FLOP');
    expect(text(first)).toContain('The flop is out: two of clubs, seven of diamonds and nine of hearts.');
    expect(table.match.actionTo()).toBe('agent');
    const second = await table.opponentTurn(safe, true);
    expect(text(second)).toContain('Then the table played your next move: you checked.');
    expect(table.match.actionTo()).toBe('user');
  });

  test('two requests at once share one decision', async () => {
    const table = liveTable();
    table.press({ kind: 'call' });
    let calls = 0;
    const slow: Ask = () => { calls += 1; return new Promise((r) => setTimeout(r, 30, { action: 'check', amount: 0 })); };
    const [a, b] = await Promise.all([table.opponentTurn(slow), table.opponentTurn(slow)]);
    expect(calls).toBe(1);
    expect([a.changed, b.changed].sort()).toEqual([false, true]);
  });

  test('a decision for a table that moved meanwhile is thrown away', async () => {
    const table = liveTable();
    table.press({ kind: 'call' });
    let release!: (v: { action: string; amount: number }) => void;
    const pending = table.opponentTurn(() => new Promise((r) => { release = r; }));
    table.match.applyMove('agent', 'check'); // something else moved the table
    release({ action: 'raise', amount: 80 });
    const result = await pending;
    expect(result.changed).toBe(false);
    expect(table.view().last_action).toMatchObject({ by: 'agent', kind: 'check' });
  });

  test('a hand he ends is announced with the result', async () => {
    const table = liveTable();
    table.press({ kind: 'raise', amount: 200 });
    const result = await table.opponentTurn(async () => ({ action: 'fold', amount: 0 }));
    expect(text(result)).toContain('you folded');
    expect(text(result)).toContain('they won 40 when you folded');
    expect(text(result)).toContain('never deal it yourself');
  });
});

describe('the session is counted', () => {
  test('no hand is played until one finishes', () => {
    const table = liveTable();
    expect(table.view().session.hands_played).toBe(0);
  });

  test('the session line counts a hand and who won it', () => {
    const table = liveTable();
    say(table, 'I fold');
    const session = table.view().session;
    expect(session).toMatchObject({ hands_played: 1, hands_won_agent: 1, hands_won_user: 0 });
    // The folder lost the blind they posted; that is a result, not a bet.
    expect(session.chips_up_user).toBe(-10);
  });

  test('a rematch only once the match is over, and it starts the session over', () => {
    // 20-chip stacks: the big blind (Dex) is all-in from the post, so the
    // player's shove can only call and the board runs out. Dex's aces win.
    const table = liveTable(DECK, { startingStack: 20 });
    expect(text(table.rematch())).toContain('The match is still on');
    table.press({ kind: 'all_in' });
    expect(table.match.phase).toBe('game-over');
    expect(text(table.deal())).toContain('The match is over');
    const result = table.rematch();
    expect(text(result)).toContain('A rematch');
    // A new match, its first hand dealt: nothing finished, the blind is a bet, not a loss.
    expect(table.view().session).toEqual({ hands_played: 0, hands_won_user: 0, hands_won_agent: 0, chips_up_user: 0 });
  });
});

test('the opening hand is dealt by the table, and Dex is told not to ask for a deal', () => {
  const table = new Table();
  const result = table.open();
  expect(result.view.phase).toBe('playing');
  expect(text(result)).toContain('never ask them to deal');
  expect(table.open().view.seq).toBe(result.view.seq); // idempotent
});
