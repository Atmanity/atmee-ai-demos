import { expect, test } from 'vitest';
import { matchPrompt, namesCity } from './judge.ts';

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
