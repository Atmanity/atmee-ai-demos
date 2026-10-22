// The parser, on the phrasings that broke the original live (ported from
// test_user_turn_moves.py; the table-side halves are in table.test.ts).
import { describe, expect, test } from 'vitest';
import { parseTurn } from './judge.ts';

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
