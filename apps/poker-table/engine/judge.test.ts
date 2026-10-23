// The parser, on the phrasings that broke the original live (ported from
// test_user_turn_moves.py; the table-side halves are in table.test.ts).
import { describe, expect, test } from 'vitest';
import { backs, mustDo, parseTurn, sameMove } from './judge.ts';

const move = (text: string) => parseTurn(text).move;

describe('real moves', () => {
  const cases: [string, ReturnType<typeof move>][] = [
    ['I call', { kind: 'call' }],
    ['call it', { kind: 'call' }],
    ['raise to 60', { kind: 'raise', amount: 60 }],
    ['make it eighty', { kind: 'raise', amount: 80 }],
    ['raise to forty seven', { kind: 'raise', amount: 47 }],
    ['Raised to five.', { kind: 'raise', amount: 5 }],
    ['bet one hundred and twenty', { kind: 'raise', amount: 120 }],
    ['raise to two thousand', { kind: 'raise', amount: 2000 }],
    // Review: the felt prints amounts with a thousands comma, so players type them that way.
    ['raise to 1,000', { kind: 'raise', amount: 1000 }],
    ['Bet 1,250.', { kind: 'raise', amount: 1250 }],
    ['all in', { kind: 'all_in' }],
    ['I shove', { kind: 'all_in' }],
    ["I'm out", { kind: 'fold' }],
    ['I’m out', { kind: 'fold' }],
    ['muck it', { kind: 'fold' }],
    ['I fold.', { kind: 'fold' }],
    ['check', { kind: 'check' }],
    ['raise', { kind: 'raise' }],
  ];
  for (const [said, expected] of cases) test(said, () => expect(move(said)).toEqual(expected));
});

test('a question about folding is not a fold', () => {
  // "should I fold?" is a beginner asking for help; folding for them is
  // unrecoverable: there is no undo at a poker table.
  for (const question of ['should I fold?', 'what happens if I fold?', 'is folding bad?']) {
    expect(move(question), question).toBeNull();
  }
});

test('fold and a new hand in one message gets both', () => {
  const parsed = parseTurn('I fold. can we start a new hand?');
  expect(parsed.move).toEqual({ kind: 'fold' });
  expect(parsed.wantsNewHand).toBe(true);
});

test('a hedged move is asked about rather than played', () => {
  const parsed = parseTurn("I'm not folding this one");
  expect(parsed.move).toBeNull();
  expect(parsed.unclear).toMatch(/without taking it/);
});

test('gibberish with a number never becomes a raise', () => {
  // Verbatim: "purple banana forty seven?" -> "You raised to 47!".
  const parsed = parseTurn('purple banana forty seven?');
  expect(parsed.move).toBeNull();
  expect(parsed.unclear).toMatch(/number but no action/);
});

test('two actions are no action', () => {
  const parsed = parseTurn('call. raise to 80');
  expect(parsed.move).toBeNull();
  expect(parsed.unclear).toMatch(/more than one action/);
});

test('a negated contraction suppresses the move', () => {
  // "I won't fold" folded the hand: the `n't` alternative sat inside \b…\b and
  // could never fire, so every contraction was an unhedged action.
  for (const text of ["I won't fold", "you can't check there", "don't call that", "I wouldn't raise here", 'i dont fold to that']) {
    const parsed = parseTurn(text);
    expect(parsed.move, text).toBeNull();
    expect(parsed.unclear, text).toMatch(/without taking it/);
  }
});

test('a word ending in nt is not a negation', () => {
  // "I want to fold" is a fold, and refusing it is the same stuck player.
  expect(move('I want to fold')).toEqual({ kind: 'fold' });
  expect(move('I meant call')).toEqual({ kind: 'call' });
});

test('a question containing a figure is answered, not interrogated', () => {
  // "is the pot 270?" was ruled unreadable, and the avatar asked whether they
  // meant fold, check, call or raise instead of answering what they asked.
  for (const text of ['is the pot 270?', 'so I have 980 left?', 'how much is 40 to me?', "what's my stack, 1500?"]) {
    const parsed = parseTurn(text);
    expect(parsed.move, text).toBeNull();
    expect(parsed.unclear, text).toBeNull();
  }
});

test('chatter is not a move', () => {
  // The parser has to be silent most of the time: the player talks.
  for (const text of ['hey there', "you're bluffing", 'haha nice one', 'how do I play?', 'let me check my cards', 'check this out', "let's call it a night"]) {
    const parsed = parseTurn(text);
    expect(parsed.move, text).toBeNull();
    expect(parsed.unclear, text).toBeNull();
  }
});

test('asking for another hand', () => {
  for (const text of ['deal me another one', 'deal', 'next hand please', 'one more', "let's play again", 'Deal again!']) {
    expect(parseTurn(text).wantsNewHand, text).toBe(true);
  }
  expect(parseTurn('I call').wantsNewHand).toBe(false);
});

describe('asking for their own cards', () => {
  test('the ways people ask', () => {
    for (const text of ['what are my cards?', 'What am I holding?', "what's my hand", 'remind me what I have', 'tell me my hole cards', 'which cards do I have?', 'what cards did I get?']) {
      expect(parseTurn(text).asksOwnCards, text).toBe(true);
    }
  });
  test('and what is not that', () => {
    // The original's pattern also matched "what's my stack?" and "I fold my hand".
    for (const text of ["what's my stack?", 'what do I have to call?', 'I fold my hand', 'do I have to call?', "what's in the pot?", 'how do I play?', 'what beats what?']) {
      expect(parseTurn(text).asksOwnCards, text).toBe(false);
    }
  });
});

describe("the host's move, checked against the player's own words", () => {
  test('the move must be in what they said, amount and all', () => {
    expect(backs({ kind: 'call' }, ['I call'])).toBe(true);
    expect(backs({ kind: 'raise', amount: 60 }, ['Raise it to sixty.'])).toBe(true);
    expect(backs({ kind: 'raise', amount: 60 }, ['raise to 40'])).toBe(false);
    expect(backs({ kind: 'call' }, ['nice hat'])).toBe(false);
    expect(backs({ kind: 'call' }, [])).toBe(false);
  });

  test('gibberish with a number backs no raise, however the host words it', () => {
    // "purple banana forty seven?" became a 47-chip raise when the model was
    // free to write the move. The words have to carry it.
    expect(backs({ kind: 'raise', amount: 47 }, ['purple banana forty seven?'])).toBe(false);
  });

  test('a question or a hedge backs nothing', () => {
    for (const text of ['should I fold?', "I'm not folding this one", "I won't fold"]) expect(backs({ kind: 'fold' }, [text]), text).toBe(false);
  });

  test('a move split across two recognised lines still counts', () => {
    expect(backs({ kind: 'raise', amount: 60 }, ['Raise to.', 'sixty.'])).toBe(true);
  });

  test('the same move, the same amount', () => {
    expect(sameMove({ kind: 'raise', amount: 60 }, { kind: 'raise', amount: 60 })).toBe(true);
    expect(sameMove({ kind: 'raise', amount: 60 }, { kind: 'raise', amount: 80 })).toBe(false);
    expect(sameMove({ kind: 'call' }, { kind: 'check' })).toBe(false);
    expect(sameMove(null, { kind: 'call' })).toBe(false);
  });
});

test('what the safety net does when the host does not, and never a move', () => {
  const cases: [string, ReturnType<typeof mustDo>][] = [
    ['Deal.', 'deal_hand'], ['deal me in', 'deal_hand'], ["Deal 'em.", 'deal_hand'], ['deal em', 'deal_hand'], ['Okay, deal again', 'deal_hand'], ['next hand please', 'deal_hand'],
    ['I fold. Can we start a new hand?', 'deal_hand'], ['one more hand', 'deal_hand'],
    ['Rematch!', 'new_match'], ["let's play again", 'new_match'], ['run it back', 'new_match'],
    ['what are my cards?', 'read_my_cards'], ['What am I holding?', 'read_my_cards'],
    // Live, "What beats what?" got the rankings recited and the chart offered, not opened.
    ['What beats what?', 'show_hand_rankings'], ["What's the best hand?", 'show_hand_rankings'], ['show me the rankings', 'show_hand_rankings'],
    ['Which hand wins, a flush or a straight?', 'show_hand_rankings'],
    // Moves are never the net's: a bet it played on top of the host's would land twice.
    ['I call', null], ['raise to 60', null], ['all in', null], ['I fold', null], ['check', null],
    // Chatter that only sounds like a deal.
    ["what's the deal with the blinds?", null], ['big deal', null], ["it's a deal", null], ["what's my stack?", null], ['', null],
  ];
  for (const [said, expected] of cases) expect(mustDo(said), said).toBe(expected);
});
