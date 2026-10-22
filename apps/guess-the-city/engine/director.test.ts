import { expect, test } from 'vitest';
import { FALLBACK_CITIES } from './deck.ts';
import { boardState, NOTES, say } from './director.ts';
import { Game } from './game.ts';

const fresh = () => new Game(structuredClone(FALLBACK_CITIES));

test('the board never names the city before the reveal, whatever was asked', () => {
  const g = fresh();
  g.hint(); g.hint();
  const hidden = boardState(g.view('/photo/x'));
  for (const word of [g.city.name, g.city.country]) expect(hidden).not.toContain(word);
  expect(hidden).toContain(g.city.hints[1]);
  expect(hidden).toContain('worth 2 points');
  g.win();
  expect(boardState(g.view(null))).toContain(g.city.name);
});

test('every standing note fits the 2,000-character limit, and the state stays under 3,858', () => {
  for (const note of NOTES) expect(note.length).toBeLessThanOrEqual(2000);
  const g = fresh();
  g.hint(); g.hint(); g.hint();
  expect(boardState(g.view(null)).length).toBeLessThan(3858);
});

test('the round-intro line never names the next city', () => {
  const g = fresh();
  g.skip(); g.next();
  const line = say.next(g.view(null));
  expect(line).not.toContain(g.city.name);
});

test('the next clue is staged in the state while the round is open, and only then', () => {
  const g = fresh();
  expect(boardState(g.view(null))).toContain(g.city.hints[0]);
  g.hint();
  expect(boardState(g.view(null))).toContain(g.city.hints[1]);
  g.skip();
  const after = boardState(g.view(null));
  expect(after).not.toContain('give them this one');
});
