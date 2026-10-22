// The wired table: intents in, rulings out, the opponent playing its own turns
// (ported from test_table.py, the apply_user_turn half of
// test_user_turn_moves.py, and the session half of test_rules_and_session.py).
import { describe, expect, test } from 'vitest';
import { spokenCard } from './cards.ts';
import type { Ask } from './decide.ts';
import { Table } from './table.ts';

const DECK = ['As', 'Kd', 'Ah', 'Kc', '2c', '7d', '9h', '3s', '5c', '5d', '8h', 'Jc', 'Qd'];

/** A dealt hand with the action on the user: where a player types. Hand 1: the user is on the button and acts first. */
function liveTable(deck = DECK) {
  const table = new Table();
  table.match.deal(deck);
  expect(table.match.actionTo()).toBe('user');
  return table;
}

const typed = (table: Table, text: string) => table.act({ text }, 'typed');
const safe: Ask = async () => null; // no model: the safe action

describe('a fold ends the hand, and a new one starts', () => {
  test('typing "I fold" ends the hand, with no model anywhere', () => {
    // The trap: the fold reached nothing, so the hand could not end and the
    // player was stuck in it for the rest of the call.
    const table = liveTable();
    const outcome = typed(table, 'I fold.');
    expect(table.match.handLive).toBe(false);
    expect(outcome.view.phase).toBe('hand-over');
    expect(outcome.view.players.user.folded).toBe(true);
    expect(outcome.handled).toBe(true);
    expect(outcome.event).toContain('ALREADY applied their fold');
    expect(outcome.event).toContain('The hand is over');
  });

  test('fold and a new hand in one message gets both', () => {
    // Verbatim from the transcript. Answering only the question is how the
    // player got told the hand was still in play.
    const table = liveTable();
    const outcome = typed(table, 'I fold. can we start a new hand?');
    expect(outcome.view.session.hands_played).toBe(1);
    expect(table.match.handLive).toBe(true);
    expect(outcome.event).toContain('NEW HAND IS DEALT');
    expect(outcome.event).not.toContain('They can deal the next hand');
  });

  test('asking for a new hand after one ends deals it', () => {
    const table = liveTable();
    typed(table, 'fold');
    expect(table.match.phase).toBe('hand-over');
    typed(table, 'deal me another one');
    expect(table.match.handLive).toBe(true);
  });

  test('asking for another hand mid-hand changes nothing and is not refused out loud', () => {
    const table = liveTable();
    const seq = table.match.seq;
    const outcome = typed(table, 'deal');
    expect(table.match.seq).toBe(seq);
    expect(outcome.handled).toBe(false);
  });
});

test('a question about folding is not a fold', () => {
  const table = liveTable();
  for (const question of ['should I fold?', 'what happens if I fold?', 'is folding bad?']) {
    const outcome = typed(table, question);
    expect(table.match.handLive, question).toBe(true);
    expect(outcome.event ?? '').not.toContain('ALREADY applied');
  }
});

test('a hedged move is asked about rather than played', () => {
  const table = liveTable();
  const seq = table.match.seq;
  const outcome = typed(table, "I'm not folding this one");
  expect(table.match.seq).toBe(seq);
  expect(outcome.event).toContain('could not read an action');
});

test('gibberish with a number never becomes a raise', () => {
  const table = liveTable();
  const { seq } = table.match;
  const pot = table.view().pot;
  const outcome = typed(table, 'purple banana forty seven?');
  expect(table.match.seq).toBe(seq);
  expect(table.view().pot).toBe(pot);
  expect(outcome.event).toContain('NOTHING was applied');
  expect(outcome.event).toContain('fold, check, call, or raise');
});

test('real moves reach the table', () => {
  for (const [text, expected] of [['I call', 'call'], ['call it', 'call'], ['raise to 60', 'raise'], ['make it eighty', 'raise'], ['all in', 'raise'], ["I'm out", 'fold']] as const) {
    const table = liveTable();
    typed(table, text);
    const last = table.view().last_action;
    expect(last?.by, text).toBe('user');
    expect(last?.kind, text).toBe(expected);
  }
});

test('a raise amount is the number they said', () => {
  // 47 is legal here (the minimum raise-to is 40 preflop) and it is what they
  // said: the parser never rounds, substitutes or picks.
  const table = liveTable();
  typed(table, 'raise to forty seven');
  expect(table.view().last_action).toMatchObject({ kind: 'raise', amount: 47 });
});

test('a raise below the minimum is refused, not rounded up', () => {
  // Found live: "raise to 5" put 40 chips in the pot. The model had helpfully
  // substituted the minimum, so the player was committed to 8x what they asked
  // for. The table refuses the amount, and the avatar is told the legal range.
  const table = liveTable();
  const seq = table.match.seq;
  const outcome = typed(table, 'raise to 5');
  expect(table.match.seq).toBe(seq);
  expect(outcome.event).toContain('refused');
  expect(outcome.event).toContain('NOTHING was applied');
  expect(outcome.event).toContain('from 40 to 1000');
  expect(outcome.message).toMatch(/at least 40/);
});

test('a raise with no amount is refused with the range', () => {
  const table = liveTable();
  const outcome = typed(table, 'I raise');
  expect(outcome.event).toContain('needs an amount');
  expect(outcome.event).toContain('from 40 to 1000');
});

test('all-in is a first-class spoken action', () => {
  // Found live: "all in", with an All-in button right there, came back as
  // "isn't possible right now".
  const table = liveTable();
  const before = table.view().players.user;
  const outcome = typed(table, 'all in');
  expect(outcome.event).not.toContain('refused');
  const after = table.view().players.user;
  expect(after.stack).toBe(0);
  expect(after.bet).toBe(before.stack + before.bet);
});

test("saying I'm out folds instead of being called impossible", () => {
  for (const phrase of ["I'm out", 'im out', 'muck', 'I fold']) {
    const table = liveTable();
    const outcome = typed(table, phrase);
    expect(outcome.event, phrase).not.toContain('refused');
    expect(table.view().players.user.folded, phrase).toBe(true);
  }
});

test('a negated contraction moves nothing', () => {
  for (const text of ["I won't fold", "you can't check there", "don't call that", "I wouldn't raise here"]) {
    const table = liveTable();
    const seq = table.match.seq;
    const outcome = typed(table, text);
    expect(table.match.seq, text).toBe(seq);
    expect(outcome.event, text).toContain('could not read an action');
  }
});

test('a move out of turn is refused with the reason', () => {
  const table = liveTable();
  typed(table, 'call');
  const outcome = typed(table, 'I check');
  expect(outcome.event).toContain('it is not your turn');
  expect(outcome.message).toBe('it is not your turn');
});

test('chatter and questions go to the avatar untouched', () => {
  const table = liveTable();
  for (const text of ['how do I play?', 'who is winning?', 'nice hat', "what's the pot?"]) {
    expect(typed(table, text).handled, text).toBe(false);
  }
});

describe('their own cards', () => {
  test('the player can be told their own cards, in words', () => {
    // With the screen out of sight this is the only way to know your hand, and
    // the answer was "I can't reveal any cards".
    const table = liveTable();
    const outcome = typed(table, 'what are my cards?');
    const cards = table.view().user_hand;
    for (const card of cards) expect(outcome.event).toContain(spokenCard(card));
    expect(outcome.handled).toBe(true);
  });
  test('with no hand in play it says so', () => {
    const table = liveTable();
    typed(table, 'I fold');
    expect(typed(table, 'what am I holding?').event).toContain('no hand is in play');
  });
  test("the opponent's cards never reach that line", () => {
    const table = liveTable();
    const outcome = typed(table, 'what are my cards?');
    for (const card of table.match.holeCards('agent')) expect(outcome.event).not.toContain(spokenCard(card));
  });
});

describe('buttons', () => {
  test('a refused press becomes a table message, not a crash and not a move', () => {
    const table = liveTable();
    const seq = table.match.seq;
    const outcome = table.act({ intent: { kind: 'check' } }, 'click');
    expect(outcome.message).toMatch(/cannot check facing a bet/);
    expect(outcome.event).toBeUndefined();
    expect(table.match.seq).toBe(seq);
  });
  test('a move by button sends no ruling: the avatar sees the table in its state', () => {
    const table = liveTable();
    const outcome = table.act({ intent: { kind: 'call' } }, 'click');
    expect(outcome.event).toBeUndefined();
    expect(outcome.view.action_to).toBe('agent');
  });
  test('a hand ended by a button is announced', () => {
    const table = liveTable();
    expect(table.act({ intent: { kind: 'fold' } }, 'click').event).toContain('The hand is over');
  });
  test('Deal again, and a rematch only once the match is over', () => {
    const table = liveTable();
    table.act({ intent: { kind: 'fold' } }, 'click');
    expect(table.act({ intent: { kind: 'restart' } }, 'click').message).toMatch(/still on/);
    const dealt = table.act({ intent: { kind: 'deal' } }, 'click');
    expect(dealt.event).toContain('NEW HAND IS DEALT');
    expect(table.act({ intent: { kind: 'deal' } }, 'click').message).toMatch(/already in play/);
  });
  test('unknown words are refused by name', () => {
    const table = liveTable();
    expect(table.act({ intent: { kind: 'moonwalk' as 'fold' } }, 'click').message).toContain('moonwalk');
  });
});

describe("the opponent's turn", () => {
  test('nothing happens when it is not its turn', async () => {
    const table = liveTable();
    const outcome = await table.opponentTurn(safe);
    expect(outcome.handled).toBe(false);
    expect(outcome.event).toBeUndefined();
  });

  test('it plays, and the avatar is told its own move, not the player\'s', async () => {
    // Live, the commentary for the opponent's raise came back as "You called.
    // Let's see what happens next.": a second acknowledgement of the PLAYER's
    // move, which left the raise itself unspoken.
    const table = liveTable();
    table.act({ intent: { kind: 'call' } }, 'click');
    const outcome = await table.opponentTurn(async () => ({ action: 'raise', amount: 60 }));
    expect(outcome.view.last_action).toMatchObject({ by: 'agent', kind: 'raise', amount: 60 });
    expect(outcome.event).toContain('YOUR OWN raise (to 60)');
    expect(outcome.event).toContain('nothing about the opponent');
    expect(outcome.event).toContain('state no other chip amount');
    // The figure named is the one that LANDED: no other number gets in.
    expect(outcome.event!.match(/\d+/g)).toEqual(['60', '60']);
    expect(table.lastDecision).toMatchObject({ kind: 'raise', amount: 60, source: 'model' });
  });

  test('no model, a late one or a broken one: the safe action, never a stalled table', async () => {
    const never: Ask = () => new Promise(() => undefined);
    const broken: Ask = async () => { throw new Error('boom'); };
    for (const ask of [null, broken, never]) {
      const table = new Table({ decisionTimeoutMs: 50 });
      table.match.deal(DECK);
      table.act({ intent: { kind: 'call' } }, 'click');
      const outcome = await table.opponentTurn(ask);
      expect(outcome.view.last_action).toMatchObject({ by: 'agent', kind: 'check' });
      expect(table.lastDecision?.source).toBe('fallback');
    }
  });

  test('an illegal answer from the model degrades to the safe action', async () => {
    const table = liveTable();
    table.act({ intent: { kind: 'raise', amount: 100 } }, 'click');
    const outcome = await table.opponentTurn(async () => ({ action: 'check', amount: 0 }));
    expect(outcome.view.last_action).toMatchObject({ by: 'agent', kind: 'call' });
  });

  test('consecutive opponent turns: it checks the street closed, then acts first on the next', async () => {
    // The opponent's preflop check can end the street and leave it first to act
    // on the flop: the page asks again until the turn is the player's.
    const table = liveTable();
    table.act({ intent: { kind: 'call' } }, 'click');
    await table.opponentTurn(safe);
    expect(table.view().street).toBe('FLOP');
    expect(table.match.actionTo()).toBe('agent');
    await table.opponentTurn(safe);
    expect(table.match.actionTo()).toBe('user');
  });

  test('two requests at once share one decision', async () => {
    const table = liveTable();
    table.act({ intent: { kind: 'call' } }, 'click');
    let calls = 0;
    const slow: Ask = () => { calls += 1; return new Promise((r) => setTimeout(r, 30, { action: 'check', amount: 0 })); };
    const [a, b] = await Promise.all([table.opponentTurn(slow), table.opponentTurn(slow)]);
    expect(calls).toBe(1);
    expect([a.handled, b.handled].sort()).toEqual([false, true]);
  });

  test('a decision for a table that moved meanwhile is thrown away', async () => {
    const table = liveTable();
    table.act({ intent: { kind: 'call' } }, 'click');
    let release!: (v: { action: string; amount: number }) => void;
    const pending = table.opponentTurn(() => new Promise((r) => { release = r; }));
    table.match.applyMove('agent', 'check'); // something else moved the table
    release({ action: 'raise', amount: 80 });
    const outcome = await pending;
    expect(outcome.handled).toBe(false);
    expect(table.view().last_action).toMatchObject({ by: 'agent', kind: 'check' });
  });

  test('a hand ended by the opponent is announced with the result', async () => {
    const table = liveTable();
    table.act({ intent: { kind: 'raise', amount: 200 } }, 'click');
    const outcome = await table.opponentTurn(async () => ({ action: 'fold', amount: 0 }));
    expect(outcome.event).toContain('YOUR OWN fold');
    expect(outcome.event).toContain('they won 40 when you folded');
  });
});

describe('the session is counted', () => {
  test('no hand is played until one finishes', () => {
    const table = liveTable();
    expect(table.view().session.hands_played).toBe(0);
  });

  test('the session line counts a hand and who won it', () => {
    const table = liveTable();
    typed(table, 'I fold');
    const session = table.view().session;
    expect(session).toMatchObject({ hands_played: 1, hands_won_agent: 1, hands_won_user: 0 });
    // The folder lost the blind they posted; that is a result, not a bet.
    expect(session.chips_up_user).toBe(-10);
  });

  test('restarting the match starts the session over', () => {
    // 20-chip stacks: the big blind (the agent) is all-in from the post, so the
    // user's shove can only call and the board runs out. The agent's aces win.
    const table = new Table({ startingStack: 20 });
    table.match.deal(DECK);
    table.act({ intent: { kind: 'all_in' } }, 'click');
    expect(table.match.phase).toBe('game-over');
    const outcome = typed(table, "let's play again");
    expect(outcome.event).toContain('NEW MATCH');
    // A new match, its first hand dealt: nothing finished, the blind is a bet, not a loss.
    expect(table.view().session).toEqual({ hands_played: 0, hands_won_user: 0, hands_won_agent: 0, chips_up_user: 0 });
  });
});

test('the opening hand is dealt by the table, and the avatar is told not to ask for a deal', () => {
  const table = new Table();
  const outcome = table.open();
  expect(outcome.view.phase).toBe('playing');
  expect(outcome.event).toContain('Do not ask them to deal');
  expect(table.open().view.seq).toBe(outcome.view.seq); // idempotent
});
