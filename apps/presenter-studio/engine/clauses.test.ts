import { describe, expect, test } from 'vitest';
import { createClauses, weight } from './clauses.ts';

describe('speech cut into clauses to voice', () => {
  test('a pause sends everything held', () => {
    const c = createClauses();
    expect(c.feed('I think we', false)).toEqual([]);
    expect(c.feed('should ship', true)).toEqual(['I think we should ship']);
  });
  test('a long sentence goes at its clause mark, before it ends, and the rest waits', () => {
    const c = createClauses();
    expect(c.feed('If the budget is approved by Friday, we can start', false)).toEqual(['If the budget is approved by Friday,']);
    expect(c.feed('the work next week.', true)).toEqual(['we can start the work next week.']);
  });
  test('a short phrase is not cut off at its comma', () => {
    expect(createClauses().feed('Yes, I agree', false)).toEqual([]);
  });
  test('a number keeps its comma and its point', () => {
    expect(createClauses().feed('We expect the total to come to 3,500 and maybe 2.5 more', false)).toEqual([]);
  });
  test('Chinese joins without spaces and cuts at its own marks', () => {
    const c = createClauses();
    expect(c.feed('如果預算在星期五', false)).toEqual([]);
    expect(c.feed('之前通過，我們就可以', false)).toEqual(['如果預算在星期五之前通過，']);
    expect(c.flush()).toEqual(['我們就可以']);
  });
  test('whole sentences (translating): a comma waits, a sentence end goes', () => {
    const c = createClauses({ wholeSentences: true });
    expect(c.feed('If the budget is approved by Friday, we can start', false)).toEqual([]);
    expect(c.feed('the work next week. Then we', false)).toEqual(['If the budget is approved by Friday, we can start the work next week.']);
    expect(c.feed('celebrate', true)).toEqual(['Then we celebrate']);
  });
  test('whole sentences in Chinese: a 逗號 waits for the 句號', () => {
    const c = createClauses({ wholeSentences: true });
    expect(c.feed('但是預算我們下週，', false)).toEqual([]);
    expect(c.feed('一定要定案。', false)).toEqual(['但是預算我們下週，一定要定案。']);
  });
  test('a flush with nothing held sends nothing', () => {
    expect(createClauses().flush()).toEqual([]);
    expect(createClauses().feed('', true)).toEqual([]);
  });
  test('weight counts words, and two CJK characters as one', () => {
    expect(weight('one two, three')).toBe(3);
    expect(weight('預算通過')).toBe(2);
  });
});
