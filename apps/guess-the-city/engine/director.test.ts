import { expect, test } from 'vitest';
import { FALLBACK_CITIES } from './deck.ts';
import { boardState, INSTRUCTIONS, said, TOOLS } from './director.ts';
import { Game } from './game.ts';

const fresh = () => new Game(structuredClone(FALLBACK_CITIES));

test('the board never names the city before the reveal, and never stages a clue', () => {
  const g = fresh();
  g.hint(); g.hint();
  const hidden = boardState(g.view('/photo/x'));
  for (const word of [g.city.name, g.city.country]) expect(hidden).not.toContain(word);
  expect(hidden).toContain(g.city.hints[1]);
  expect(hidden).not.toContain(g.city.hints[2]);   // the next clue comes only from get_clue
  expect(hidden).toContain('worth 2 points');
  g.win();
  expect(boardState(g.view(null))).toContain(g.city.name);
});

test('the instructions and the state fit the API limits', () => {
  expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
  const g = fresh();
  g.hint(); g.hint(); g.hint();
  expect(boardState(g.view(null)).length).toBeLessThan(3858);
});

test('the tools fit the API: names, descriptions, schemas, all await', () => {
  expect(TOOLS.length).toBeLessThanOrEqual(30);
  const names = TOOLS.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
  for (const tool of TOOLS) {
    expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
    expect(['web_search', 'lookup']).not.toContain(tool.name);
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeLessThanOrEqual(500);
    expect(tool.parameters.type).toBe('object');
    expect(JSON.stringify(tool.parameters).length).toBeLessThanOrEqual(4096);
    expect(tool['x-atmee']?.mode).toBe('await');
    expect(tool['x-atmee']!.timeoutSeconds!).toBeLessThanOrEqual(28);
  }
  expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(24576);
  for (const name of names) expect(INSTRUCTIONS).toContain(name);
});

test('the round-intro result never names the next city; a wrong guess never names this one', () => {
  const g = fresh();
  expect(said.wrong('Paris', g.view(null))).not.toContain(g.city.name);
  g.skip(); g.next();
  expect(said.next(g.view(null))).not.toContain(g.city.name);
});

test('the tool schemas are lenient: an extra field or odd spacing still fits', () => {
  const check = TOOLS.find((t) => t.name === 'check_guess')!;
  expect(check.parameters).not.toHaveProperty('additionalProperties');
  for (const tool of TOOLS) expect(JSON.stringify(tool.parameters)).not.toMatch(/"enum"|"pattern"|"additionalProperties":false/);
});

test('the opening does not greet a second time', () => {
  const g = fresh();
  expect(said.start(g.view(null))).toMatch(/^You have just greeted them; do not greet/);
});

test('a round without a photo is announced as one, never as a photo on screen', () => {
  const g = fresh();
  expect(said.next(g.view('/photo/x'))).toContain("photo is on the player's screen");
  for (const line of [said.next(g.view(null)), said.start(g.view(null))]) {
    expect(line).not.toContain('photo is on');
    expect(line).toContain('no photo');
  }
});
