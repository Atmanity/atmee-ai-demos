// The board's formatters, ported from the original panel's market/types.ts,
// and the closing sheet's CSV. The snapshot types themselves are the
// engine's (engine/types.ts).
import { rangePosition } from '../engine/director.ts';
import type { Board, Quote } from '../engine/types.ts';

export { rangePosition };

/** Sort orders. View state: the board's own order is the add order. */
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

/** A tick's arrow: a text glyph, so it reads in any font and in a screen reader as "up" or "down" via its label. */
export const ARROW = { up: '▲', down: '▼', flat: '■' } as const;

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

/** When a quote printed, as New York time ("4:00 PM ET, Oct 23"): the exchange's clock, not the viewer's. */
export function formatPrintTime(seconds: number): string {
  const at = new Date(seconds * 1000);
  const time = at.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const day = at.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  return `${time} ET, ${day}`;
}

const cell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The board as a CSV: one row per stock, every number as the board has it, the print time in UTC. */
export function boardCsv(board: Board): string {
  const head = ['Ticker', 'Company', 'Exchange', 'Last', 'Currency', 'Change', 'Change %', '52-week low', '52-week high', 'Printed (UTC)', 'Stale'];
  const rows = board.watchlist.map((q) => [
    q.symbol, q.name, q.exchange, q.price, q.currency, q.change, q.change_pct, q.wk52_low, q.wk52_high,
    new Date(q.as_of * 1000).toISOString(), q.stale ? 'yes' : 'no',
  ]);
  return [head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
