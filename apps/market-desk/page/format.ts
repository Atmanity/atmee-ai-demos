// The panel's formatters, ported from the original panel's market/types.ts.
// The snapshot types themselves are the engine's (engine/types.ts).
import { rangePosition } from '../engine/director.ts';
import type { Quote } from '../engine/types.ts';

export { rangePosition };

/** Panel sort orders. View state: the board's own order is the add order. */
export type SortOrder = 'board' | 'move';

export function sortQuotes(quotes: Quote[], order: SortOrder): Quote[] {
  if (order === 'board') return quotes;
  return [...quotes].sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0));
}

export function formatPrice(value: number | null): string {
  return value === null || value === undefined ? '—' : value.toFixed(2);
}

export function formatMove(quote: Quote): string {
  if (quote.change_pct === null || quote.change === null) return '—';
  const sign = quote.change_pct >= 0 ? '+' : '';
  return `${sign}${quote.change.toFixed(2)} (${sign}${quote.change_pct.toFixed(2)}%)`;
}

export function moveDirection(quote: Quote): 'up' | 'down' | 'flat' {
  if (quote.change_pct === null || quote.change_pct === 0) return 'flat';
  return quote.change_pct > 0 ? 'up' : 'down';
}

/**
 * What period the sparkline actually covers, in words.
 *
 * `series_start_ts` and `series_step` were on the wire and drawn nowhere, so
 * every card showed an unlabelled squiggle that could equally have been one
 * session or one year. The step matters too: a thinned line calling itself
 * daily is the lie that field exists to prevent.
 */
export function formatSeriesSpan(quote: Quote, now: number = Date.now()): string | null {
  if (quote.series.length < 2 || quote.series_start_ts === null) return null;
  const days = Math.round((now / 1000 - quote.series_start_ts) / 86400);
  let span: string;
  if (days < 2) span = 'today';
  else if (days < 45) span = `last ${days} days`;
  else if (days < 400) span = `last ${Math.round(days / 30)} months`;
  else span = `last ${Math.round(days / 365)} years`;
  // "1d" is the unthinned case and needs no caveat; anything else does.
  const stride = Number.parseInt(quote.series_step, 10);
  if (quote.series_step !== '1d' && Number.isFinite(stride) && stride > 1) return `${span} · every ${stride} days`;
  return span;
}

export function formatAsOf(seconds: number, now: number = Date.now()): string {
  const age = Math.max(0, Math.floor(now / 1000 - seconds));
  if (age < 60) return 'just now';
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86400) return `${Math.floor(age / 3600)}h ago`;
  return `${Math.floor(age / 86400)}d ago`;
}
