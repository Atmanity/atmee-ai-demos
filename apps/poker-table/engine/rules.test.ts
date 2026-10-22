// What a first-time player asks (ported from the panel's rules.test.ts and the
// rules half of test_rules_and_session.py). Seen cold, in the first two
// minutes of a live session:
//
//     "I've never played poker before. How do I play?"
//     -> "you can fold, call the bet of 10, or raise to at least 40."
//     "what beats what?"
//     -> "a high card beats nothing, while a royal flush beats everything!"
//
// There were no rules in the app. Now the same text is the How to play sheet
// and the avatar's standing notes.
import { expect, test } from 'vitest';
import { NOTES } from './director.ts';
import { CATEGORY_NAMES } from './evaluator.ts';
import { HAND_RANKINGS, RULE_SECTIONS, rankings } from './rules.ts';
import { BIG_BLIND, SMALL_BLIND, STARTING_STACK } from './types.ts';

const teaching = NOTES.slice(2).join(' ').toLowerCase();

test('"how do I play" teaches the game, not the three buttons', () => {
  // The shape of a hand, the moves, and what beats what: all three.
  expect(teaching).toContain('two private cards');
  expect(teaching).toContain('fold');
  expect(teaching).toContain('raise');
  expect(teaching).toContain('royal flush');
  expect(teaching).toContain('high card');
});

test('what beats what names every ranking, in order', () => {
  // Live, this question got two of the ten and stopped.
  expect(HAND_RANKINGS).toHaveLength(10);
  const listed = rankings().toLowerCase().split('strongest to weakest: ')[1].split('.')[0];
  expect(listed.split(', then ')).toEqual(HAND_RANKINGS.map((r) => r.name.toLowerCase()));
  expect(teaching).toContain(listed);
});

test("the sheet's ranking order is the evaluator's, strongest first", () => {
  expect(HAND_RANKINGS.map((r) => r.name.toLowerCase())).toEqual([...CATEGORY_NAMES].reverse().map((n) => n.toLowerCase()));
});

test("the blinds and the stack are taught with the table's own numbers", () => {
  const sheet = RULE_SECTIONS.map((s) => s.body).join(' ');
  for (const figure of [SMALL_BLIND, BIG_BLIND, STARTING_STACK]) {
    expect(sheet).toContain(String(figure));
    expect(teaching).toContain(String(figure));
  }
});

test('the sheet explains every move the action bar can offer', () => {
  const sheet = RULE_SECTIONS.map((s) => s.body).join(' ').toLowerCase();
  for (const move of ['fold', 'check', 'call', 'raise']) expect(sheet).toContain(move);
});
