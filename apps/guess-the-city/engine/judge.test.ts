import { expect, test } from 'vitest';
import { matchPrompt, mustDo, namesCity } from './judge.ts';

test('naming the city, without a model', () => {
  const city = { name: 'São Paulo' };
  expect(namesCity('Is it Sao Paulo?', city)).toBe(true);
  expect(namesCity('São Paulo!', city)).toBe(true);
  expect(namesCity('Paulo something', city)).toBe(false);
});

test('the model is asked about the place the host heard, with the city named', () => {
  const prompt = matchPrompt({ name: 'Sydney', country: 'Australia' }, 'sidney');
  expect(prompt).toContain('Sydney, Australia');
  expect(prompt).toContain('"sidney"');
});

test('what the safety net does when the host does not, and only the actions safe to repeat', () => {
  const cases: [string, ReturnType<typeof mustDo>][] = [
    ['I give up.', 'reveal_answer'], ["I don't know, tell me the answer", 'reveal_answer'],
    ['Next city, please.', 'next_city'], ['ok next', 'next_city'], ['New game', 'new_game'], ['can we play again', 'new_game'],
    ['Can I have a clue?', null], ['Is it Paris?', null], ['What is my score?', null], ['Next to the river, maybe Paris', null],
  ];
  for (const [said, expected] of cases) expect(mustDo(said), said).toBe(expected);
});
