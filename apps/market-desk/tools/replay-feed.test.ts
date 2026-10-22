// The offline replay never passes for the market: the recorded symbol answers
// as itself, every other one is relabelled as replay data with its own numbers.
import { expect, test } from 'vitest';
import { entryFromChart } from '../engine/board.ts';
import { payloadFor } from './replay-feed.ts';

test('the recorded symbol answers as itself', () => {
  const row = entryFromChart(payloadFor('AAPL'), { symbol: 'AAPL', now: 0 });
  expect(row.name).toBe('Apple Inc.');
  expect(row.price).toBe(306.83);
});

test('any other symbol is relabelled as replay data, with numbers of its own', () => {
  const msft = entryFromChart(payloadFor('MSFT'), { symbol: 'MSFT', now: 0 });
  const tsla = entryFromChart(payloadFor('tsla'), { symbol: 'TSLA', now: 0 });
  expect(msft.name).toBe('MSFT — replay data');
  expect(msft.symbol).toBe('MSFT');
  expect(msft.price).not.toBe(306.83);
  expect(tsla.price).not.toBe(msft.price);
  // Stable: the same symbol gets the same numbers every run.
  expect(entryFromChart(payloadFor('MSFT'), { symbol: 'MSFT', now: 0 }).price).toBe(msft.price);
});
