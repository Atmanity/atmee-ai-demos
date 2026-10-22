// The decision, minus the model (ported from test_decide.py). Everything that
// decides what reaches the table is here; the model call is server.ts. The
// original bug was a model that answered in prose and a table that was never
// told, so these cover the two ways an answer can be useless: absent, and illegal.
import { describe, expect, test } from 'vitest';
import { decide, decisionPrompt, decisionSchema, normalizeDecision, safeAction } from './decide.ts';
import type { DecisionRequest } from './match.ts';

describe('safeAction', () => {
  test('checks when checking is free', () => expect(safeAction(['check', 'raise'], 0)).toEqual({ kind: 'check', amount: null }));
  test('calls when there is a price', () => expect(safeAction(['fold', 'call', 'raise'], 20)).toEqual({ kind: 'call', amount: null }));
  test('folds only when nothing else is legal', () => expect(safeAction(['fold'], 20)).toEqual({ kind: 'fold', amount: null }));
  test('survives a junk to_call', () => {
    // The one path whose whole job is to always answer must not throw on junk.
    expect(safeAction(['check'], 'not a number').kind).toBe('check');
  });
  test('empty valid actions still answers', () => expect(safeAction([], 0)).toEqual({ kind: 'fold', amount: null }));
});

describe('normalizeDecision', () => {
  const request = (over: Partial<DecisionRequest> = {}): Partial<DecisionRequest> => ({ valid_actions: ['fold', 'check', 'raise'], to_call: 0, min_raise_to: 40, ...over });

  test('passes a legal action through', () => expect(normalizeDecision('check', null, request())).toEqual({ kind: 'check', amount: null }));
  test('rewrites a free fold into a check', () => {
    // Folding for nothing is legal and never right; the player would rightly read it as a bug.
    expect(normalizeDecision('fold', null, request())).toEqual({ kind: 'check', amount: null });
  });
  test('keeps a fold when folding actually costs something', () => {
    expect(normalizeDecision('fold', null, request({ valid_actions: ['fold', 'call'], to_call: 80 })).kind).toBe('fold');
  });
  test('falls back when the action is not on the list', () => {
    expect(normalizeDecision('check', null, request({ valid_actions: ['fold', 'call'], to_call: 20 })).kind).toBe('call');
  });
  test('a raise with no amount uses the minimum', () => expect(normalizeDecision('raise', null, request())).toEqual({ kind: 'raise', amount: 40 }));
  test('a raise with a junk amount uses the minimum', () => expect(normalizeDecision('raise', 'forty', request()).amount).toBe(40));
  test('a raise with no minimum to fall back on degrades', () => expect(normalizeDecision('raise', null, request({ min_raise_to: 0 })).kind).toBe('check'));
  test('amounts reach the table as whole chips', () => expect(normalizeDecision('raise', 61.5, request()).amount).toBe(61));
  test('an amount outside the legal range is pulled into it (new in the port)', () => {
    expect(normalizeDecision('raise', 25, request({ max_raise_to: 1000 })).amount).toBe(40);
    expect(normalizeDecision('raise', 5000, request({ max_raise_to: 980 })).amount).toBe(980);
  });
});

const REQUEST: DecisionRequest = {
  hand: ['As', 'Kd'], board: ['2c', '7d', '9h'], street: 'FLOP', pot: 40, your_stack: 980, opponent_stack: 980,
  to_call: 0, current_bet: 0, min_raise_to: 20, max_raise_to: 980, valid_actions: ['fold', 'check', 'raise'],
};

test('the prompt carries the table and the own hand, and asks for totals', () => {
  const prompt = decisionPrompt(REQUEST);
  expect(prompt).toContain('Your hand: As Kd');
  expect(prompt).toContain('Board: 2c 7d 9h');
  expect(prompt).toContain('Minimum raise-to (a TOTAL, not an increment): 20');
  expect(prompt).toContain('Valid actions: fold check raise');
});

test('the schema only offers the legal actions', () => {
  expect((decisionSchema(REQUEST).properties.action as { enum: string[] }).enum).toEqual(['fold', 'check', 'raise']);
});

test('decide: the model answer, normalized; or the safe action', async () => {
  expect(await decide(REQUEST, async () => ({ action: 'raise', amount: 60 }))).toEqual({ kind: 'raise', amount: 60, source: 'model' });
  expect(await decide(REQUEST, null)).toEqual({ kind: 'check', amount: null, source: 'fallback' });
  expect(await decide(REQUEST, async () => null)).toMatchObject({ kind: 'check', source: 'fallback' });
  expect(await decide(REQUEST, () => new Promise(() => undefined), 20)).toMatchObject({ kind: 'check', source: 'fallback' });
});
