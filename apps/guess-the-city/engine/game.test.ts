import { describe, expect, test } from 'vitest';
import { FALLBACK_CITIES } from './deck.ts';
import { Game, hintCost, roundValue } from './game.ts';

const game = () => new Game(structuredClone(FALLBACK_CITIES));

describe('scoring', () => {
  test('4 points cold, one less per hint, never below 1', () => {
    expect([0, 1, 2, 3, 4].map(roundValue)).toEqual([4, 3, 2, 1, 1]);
    expect([0, 1, 2, 3].map(hintCost)).toEqual([1, 1, 1, 0]);
  });
  test('a win after two hints scores 2, and a revealed round cannot score again', () => {
    const g = game();
    g.hint(); g.hint();
    expect(g.win()).toBe(2);
    expect(g.win()).toBe(0);
    expect(g.score).toBe(2);
  });
});

describe('rounds', () => {
  test('next is refused while the city is hidden', () => {
    const g = game();
    expect(g.next()).toBe(false);
    g.skip();
    expect(g.next()).toBe(true);
    expect(g.round).toBe(2);
  });
  test('the deck runs out: after the third city the game is over and nothing scores', () => {
    const g = game();
    for (let i = 0; i < 3; i++) { g.skip(); g.next(); }
    expect(g.over).toBe(true);
    expect(g.win()).toBe(0);
    expect(g.hint()).toBeNull();
    expect(g.view(null).over).toBe(true);
  });
  test('no more than three hints, and none after the reveal', () => {
    const g = game();
    expect([g.hint(), g.hint(), g.hint(), g.hint()].filter(Boolean)).toHaveLength(3);
    g.skip();
    expect(g.hint()).toBeNull();
  });
});

describe('the view never gives the answer away', () => {
  test('masked until revealed', () => {
    const g = game();
    const hidden = JSON.stringify(g.view('/photo/abc'));
    for (const word of [g.city.name, g.city.country, g.city.funFact]) expect(hidden).not.toContain(word);
    g.skip();
    expect(g.view(null).city?.name).toBe(g.city.name);
  });
  test('only the clues already given are in it', () => {
    const g = game();
    g.hint();
    expect(g.view(null).hints).toEqual([g.city.hints[0]]);
  });
});

test('the results list only revealed rounds, with their points', () => {
  const g = new Game(structuredClone(FALLBACK_CITIES));
  expect(g.view(null).results).toEqual([]);
  g.hint(); g.win();
  g.next(); g.skip();
  const results = g.view(null).results;
  expect(results.map((r) => [r.correct, r.points])).toEqual([[true, 3], [false, 0]]);
  g.next();
  expect(g.view(null).results).toHaveLength(2);   // the third city is still hidden
});
