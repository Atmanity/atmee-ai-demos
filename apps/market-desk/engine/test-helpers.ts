// Shared by the engine's tests: the recorded feed payloads and a row to build boards from.
import { readFileSync } from 'node:fs';
import type { Quote } from './types.ts';

/** A recorded payload from fixtures/, freshly parsed (tests may change it). */
export const load = (name: string): any => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

/** A board row, as the parse would produce it. */
export function entry(over: Partial<Quote> = {}): Quote {
  return {
    symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', exchange: 'NasdaqGS', price: 306.83, prev_close: 308.63,
    change: -1.8, change_pct: -0.58, wk52_high: 344.57, wk52_low: 202.16, series: [305.0, 306.83], series_start_ts: 1783344600,
    series_step: '1d', as_of: 1785861561, stale: false, error: null, ...over,
  };
}

/** A row with a full 90-point history, as the original's table tests built them. */
export function quote({ symbol = 'AAPL', price = 306.83, pct = -0.58, asOf = 1785861561, points = 90 }: { symbol?: string; price?: number; pct?: number; asOf?: number; points?: number } = {}): Quote {
  return {
    symbol, name: `${symbol} Inc.`, currency: 'USD', exchange: 'NasdaqGS', price, prev_close: Number((price - 1.8).toFixed(2)),
    change: -1.8, change_pct: pct, wk52_high: 344.57, wk52_low: 202.16,
    series: Array.from({ length: points }, (_, i) => Number((price + i * 0.11).toFixed(2))),
    series_start_ts: 1783344600, series_step: '1d', as_of: asOf, stale: false, error: null,
  };
}
