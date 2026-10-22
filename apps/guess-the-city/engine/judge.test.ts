import { expect, test } from 'vitest';
import { commandIn, namesCity } from './judge.ts';

test('commands, as people say them', () => {
  const cases: [string, ReturnType<typeof commandIn>][] = [
    ['Can I have a hint?', 'hint'], ['give me another clue please', 'hint'],
    ['I give up.', 'skip'], ["I don't know, tell me the answer", 'skip'], ['skip', 'skip'],
    ['Next city!', 'next'], ['ok next', 'next'], ['let\'s go on to the next one', 'next'],
    ['New game', 'new'], ['can we play again', 'new'],
  ];
  for (const [said, expected] of cases) expect(commandIn(said), said).toBe(expected);
});

test('a guess or a question is not a command', () => {
  for (const said of ['Is it Tokyo?', "What's my score?", 'Rome!', 'Which round is this?', 'Next to the river maybe Paris'])
    expect(commandIn(said), said).not.toBe('hint');
  expect(commandIn('Is it Tokyo?')).toBeNull();
  expect(commandIn('Rome!')).toBeNull();
});

test('naming the city, without a model', () => {
  const city = { name: 'São Paulo' };
  expect(namesCity('Is it Sao Paulo?', city)).toBe(true);
  expect(namesCity('São Paulo!', city)).toBe(true);
  expect(namesCity('Paulo something', city)).toBe(false);
});
