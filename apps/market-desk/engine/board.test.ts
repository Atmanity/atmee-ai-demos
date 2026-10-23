// The pure half: symbols, the two parses, and every refusal by its sentence.
// Ported from the original's tests/test_board.py. No network anywhere in here:
// the parse is fed saved payloads, which is the only way the endpoints' quirks
// (nulls in close[], no previousClose, a 200 for an unknown ticker) stay
// covered on a day the feed is rate-limiting the test runner.
import { describe, expect, test } from 'vitest';
import * as board from './board.ts';
import { entry, load } from './test-helpers.ts';
import type { BoardState } from './types.ts';

function boardWith(symbols: string[], { focus, now = 1000 }: { focus?: string; now?: number } = {}): BoardState {
  let state = board.initialState();
  for (const symbol of symbols) {
    state = board.beginAdd(state, symbol, { now });
    state = board.finishAdd(state, symbol, entry({ symbol }));
  }
  if (focus) state = board.focus(state, focus);
  return state;
}

const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal');
};

// ─── symbols ─────────────────────────────────────────────────────────────

describe('a spoken ticker becomes the row it meant', () => {
  test.each([
    ['aapl', 'AAPL'],
    ['  $AAPL ', 'AAPL'],
    ['aapl.', 'AAPL'],
    // Speech recognition spells tickers out letter by letter more often than not.
    ['a. a. p. l', 'AAPL'],
    ['A A P L', 'AAPL'],
    ['brk-b', 'BRK-B'],
    ['^GSPC', '^GSPC'],
    // Not a ticker: refused here rather than sent to the feed for a 404.
    ['my favourite one', ''],
    ['', ''],
    [null, ''],
  ])('%j -> %j', (raw, expected) => {
    expect(board.normalizeSymbol(raw)).toBe(expected);
  });
});

// ─── the Yahoo parse ─────────────────────────────────────────────────────

test('a saved payload parses into a row the panel can draw', () => {
  const parsed = board.entryFromChart(load('aapl-1mo.json'), { symbol: 'AAPL', now: 1785861999 });
  expect(parsed.symbol).toBe('AAPL');
  expect(parsed.name).toBe('Apple Inc.');
  expect(parsed.currency).toBe('USD');
  // fullExchangeName, not the terse `exchangeName` ("NMS") nobody recognises.
  expect(parsed.exchange).toBe('NasdaqGS');
  expect(parsed.price).toBe(306.83);
  expect([parsed.wk52_high, parsed.wk52_low]).toEqual([344.57, 202.16]);
  expect(parsed.as_of).toBe(1785861561);
  expect(parsed.stale).toBe(false);
  expect(parsed.error).toBeNull();
});

test("the day's change comes from close[-2], not chartPreviousClose", () => {
  // meta has NO previousClose, and chartPreviousClose is the close before the
  // whole window: using it reports a month of drift as a day's move.
  const parsed = board.entryFromChart(load('aapl-1mo.json'), { symbol: 'AAPL', now: 0 });
  expect(parsed.prev_close).toBe(308.63); // close[-2]
  expect(parsed.change).toBe(-1.8);
  expect(parsed.change_pct).toBe(-0.58);
  // What it would have been off chartPreviousClose (299.10): +2.58%.
  expect(Math.abs(parsed.change_pct! - 2.58)).toBeGreaterThan(0.01);
});

test('a holiday null drops its timestamp with it', () => {
  // close[] carries nulls; dropping the value alone slides every later point
  // one day along the axis and the sparkline lies about its own dates.
  const payload = load('aapl-1mo.json');
  const result = payload.chart.result[0];
  expect(result.indicators.quote[0].close).toContain(null);
  const parsed = board.entryFromChart(payload, { symbol: 'AAPL', now: 0 });
  expect(parsed.series).not.toContain(null);
  expect(parsed.series).toHaveLength(result.timestamp.length - 1);
  // The first bar survived, so the series still starts where the window does.
  expect(parsed.series_start_ts).toBe(result.timestamp[0]);
});

test('a 404 body is an unknown symbol with the ticker in the sentence', () => {
  const err = refusal(() => board.entryFromChart(load('zzzz-404.json'), { symbol: 'ZZZZ', now: 0 }));
  expect(err).toBeInstanceOf(board.UnknownSymbol);
  expect(err.message).toBe("I couldn't find a listing for ZZZZ — check the ticker.");
});

test('an empty result is unknown rather than a crash', () => {
  expect(refusal(() => board.entryFromChart({ chart: { result: [], error: null } }, { symbol: 'X', now: 0 }))).toBeInstanceOf(board.UnknownSymbol);
});

test('prices are rounded to two places so the payload stays small', () => {
  const payload = load('aapl-1mo.json');
  payload.chart.result[0].meta.regularMarketPrice = 306.8299999999;
  expect(board.entryFromChart(payload, { symbol: 'AAPL', now: 0 }).price).toBe(306.83);
});

// ─── the series cap ──────────────────────────────────────────────────────

test('a long range is downsampled to ninety points ending on today', () => {
  const closes = Array.from({ length: 250 }, (_, i) => i);
  const stamps = Array.from({ length: 250 }, (_, i) => 1700000000 + 86400 * i);
  const [series, kept, step] = board.capSeries(closes, stamps);
  expect(series).toHaveLength(board.MAX_SERIES_POINTS);
  expect(series[0]).toBe(closes[0]);
  expect(series.at(-1)).toBe(closes.at(-1));
  expect(kept.at(-1)).toBe(stamps.at(-1));
  // The step no longer claims daily bars for a thinned series.
  expect(step).toBe('3d');
});

test('a short series is left exactly as it came', () => {
  expect(board.capSeries([1, 2, 3], [10, 20, 30])).toEqual([[1, 2, 3], [10, 20, 30], '1d']);
});

// ─── refusals, each by the sentence the user hears ───────────────────────

test('a seventh symbol is refused by the board size', () => {
  const state = boardWith(['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOG']);
  const err = refusal(() => board.beginAdd(state, 'META', { now: 2000 }));
  expect(err).toBeInstanceOf(board.BoardFull);
  expect(err.message).toBe('The board only holds six — drop one first.');
});

test('adding a symbol twice is refused', () => {
  const err = refusal(() => board.beginAdd(boardWith(['AAPL']), 'AAPL', { now: 2000 }));
  expect(err).toBeInstanceOf(board.DuplicateSymbol);
  expect(err.message).toBe("That one's already on the board.");
});

test('adding the same symbol while it is still in flight is refused', () => {
  // Without this, "add Apple" twice in one breath puts two AAPL rows up.
  const state = board.beginAdd(board.initialState(), 'AAPL', { now: 1 });
  expect(refusal(() => board.beginAdd(state, 'AAPL', { now: 2 }))).toBeInstanceOf(board.DuplicateSymbol);
});

test('a pending fetch still counts against the six', () => {
  let state = boardWith(['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN']);
  state = board.beginAdd(state, 'GOOG', { now: 2000 });
  expect(refusal(() => board.beginAdd(state, 'META', { now: 2001 }))).toBeInstanceOf(board.BoardFull);
});

test('removing something that is not there is refused', () => {
  const err = refusal(() => board.remove(boardWith(['AAPL']), 'MSFT'));
  expect(err).toBeInstanceOf(board.NotOnBoard);
  expect(err.message).toBe("That isn't on the board.");
});

test('focusing something that is not there asks them to add it', () => {
  const err = refusal(() => board.focus(boardWith(['AAPL']), 'MSFT'));
  expect(err).toBeInstanceOf(board.NotOnBoard);
  expect(err.message).toBe("Add it first and I'll pull it up.");
});

test('a second refresh inside fifteen seconds is refused', () => {
  const state = boardWith(['AAPL'], { now: 1000 });
  const err = refusal(() => board.beginRefresh(state, 'AAPL', { now: 1010 }));
  expect(err).toBeInstanceOf(board.TooSoon);
  expect(err.message).toBe('I just pulled that — nothing new yet.');
  // And allowed once the floor has passed.
  expect(board.beginRefresh(state, 'AAPL', { now: 1016 }).fetching).toContain('AAPL');
});

test('refreshing something that is not there is refused', () => {
  expect(refusal(() => board.beginRefresh(boardWith(['AAPL']), 'MSFT', { now: 9000 }))).toBeInstanceOf(board.NotOnBoard);
});

test('clearing an empty board is refused', () => {
  const err = refusal(() => board.clear(board.initialState()));
  expect(err).toBeInstanceOf(board.AlreadyClear);
  expect(err.message).toBe("The board's already clear.");
});

// ─── the transitions themselves ──────────────────────────────────────────

test('the first symbol added becomes the focus', () => {
  expect(boardWith(['AAPL', 'MSFT']).focus).toBe('AAPL');
});

test('removing the focused symbol moves the focus to what is left', () => {
  const state = board.remove(boardWith(['AAPL', 'MSFT']), 'AAPL');
  expect(state.focus).toBe('MSFT');
  expect(board.remove(state, 'MSFT').focus).toBeNull();
});

test('a failed pull greys the row instead of dropping it', () => {
  // The last price we had is still the last price there was; what changed is
  // our confidence in it.
  let state = boardWith(['AAPL']);
  state = board.beginRefresh(state, 'AAPL', { now: 9000 });
  state = board.failRefresh(state, 'AAPL', board.FEED_DOWN_MESSAGE);
  const row = board.find(state, 'AAPL')!;
  expect(row.stale).toBe(true);
  expect(row.error).toBe(board.FEED_DOWN_MESSAGE);
  expect(row.price).toBe(306.83);
  expect(state.fetching).toEqual([]);
  expect(state.last_error).toBe(board.FEED_DOWN_MESSAGE);
});

test('a failed add releases the slot it claimed', () => {
  let state = board.beginAdd(board.initialState(), 'ZZZZ', { now: 1 });
  state = board.failAdd(state, 'ZZZZ', board.unknownMessage('ZZZZ'));
  expect(state.fetching).toEqual([]);
  expect(state.watchlist).toEqual([]);
  expect(state.last_error).toBe("I couldn't find a listing for ZZZZ — check the ticker.");
  // The slot is genuinely free: a retry is not refused as too soon.
  expect(board.beginAdd(state, 'ZZZZ', { now: 2 }).fetching).toEqual(['ZZZZ']);
});

test('a row removed mid-pull does not come back when the quote lands', () => {
  let state = boardWith(['AAPL']);
  state = board.beginRefresh(state, 'AAPL', { now: 9000 });
  state = board.remove(state, 'AAPL');
  state = board.finishRefresh(state, 'AAPL', entry());
  expect(state.watchlist).toEqual([]);
});

test('NEW: a board cleared while an add is in flight stays clear when the quote lands', () => {
  let state = board.beginAdd(board.initialState(), 'NVDA', { now: 1 });
  state = board.clear(state);
  state = board.finishAdd(state, 'NVDA', entry({ symbol: 'NVDA' }));
  expect(state.watchlist).toEqual([]);
});

test('the private pull clock never reaches the page', () => {
  const state = boardWith(['AAPL']);
  expect(Object.keys(state._pulled)).not.toHaveLength(0);
  expect(board.publicView(state)).not.toHaveProperty('_pulled');
  expect(new Set(Object.keys(board.publicView(state)))).toEqual(new Set(['watchlist', 'focus', 'fetching', 'last_error', 'max_symbols']));
});

// ─── Nasdaq, the primary source ──────────────────────────────────────────

test('a nasdaq payload becomes a row', () => {
  const row = board.entryFromNasdaq(load('nasdaq-aapl-info.json'), load('nasdaq-aapl-chart.json'), { symbol: 'AAPL', now: 1785885000 });
  expect(row.symbol).toBe('AAPL');
  // "Apple Inc. Common Stock" is the security's legal name, not the company's.
  expect(row.name).toBe('Apple Inc.');
  expect(row.exchange).toBe('NASDAQ-GS');
  expect([row.wk52_low, row.wk52_high]).toEqual([201.68, 344.57]);
  expect(row.series.length).toBeGreaterThan(0);
  expect(row.series_step).toBe('1d');
});

test("the day's move matches the move nasdaq itself shows", () => {
  // `chart.previousClose` is NOT what `netChange` is measured from. Trusting it
  // put NVDA on the board at +7.85% while Nasdaq showed +2.15%: a number the
  // user cannot reconcile with any other screen.
  const info = load('nasdaq-aapl-info.json');
  const primary = info.data.primaryData;
  const row = board.entryFromNasdaq(info, load('nasdaq-aapl-chart.json'), { symbol: 'AAPL', now: 1785885000 });
  expect(row.change).toBe(board.money(primary.netChange));
  expect(row.change_pct).toBe(board.money(primary.percentageChange));
  expect(row.prev_close).toBe(board.round2(row.price! - row.change!));
  // and specifically NOT the chart's own field
  expect(row.prev_close).not.toBe(board.money(load('nasdaq-aapl-chart.json').data.previousClose));
});

test('an unknown nasdaq ticker is a 200 with no data', () => {
  // Nasdaq answers HTTP 200 for a ticker that does not exist, so the status
  // code cannot be trusted to say the symbol was bad.
  const err = refusal(() => board.entryFromNasdaq(load('nasdaq-zzzq-404.json'), {}, { symbol: 'ZZZQ', now: 1785885000 }));
  expect(err).toBeInstanceOf(board.UnknownSymbol);
  expect(err.message).toContain('ZZZQ');
});

describe('money strings parse or become nothing', () => {
  // null, never 0: an unquoted symbol showing $0.00 reads as a real price.
  test.each([
    ['$310.956', 310.96], ['+1.576', 1.58], ['-0.35%', -0.35], ['1,204.50', 1204.5], ['N/A', null], ['', null], [null, null],
  ])('%j -> %j', (raw, expected) => {
    expect(board.money(raw)).toBe(expected);
  });
});

test('the nasdaq path stamps the print time, not our fetch time', () => {
  // Nasdaq is the PRIMARY feed and reports its own print time; we were
  // overwriting it with the clock. At 8pm Friday every card then read "just
  // now" over Friday's close, and the announcer's same-print guard (which
  // compares as_of) could never fire on the path actually used.
  const fetchedAt = 2_000_000_000;
  const row = board.entryFromNasdaq(load('nasdaq-aapl-info.json'), load('nasdaq-aapl-chart.json'), { symbol: 'AAPL', now: fetchedAt });
  expect(row.as_of).not.toBe(fetchedAt);
  // The fixture says "Aug 4, 2026 7:21 PM ET": 19:21 in New York, daylight time (UTC-4).
  expect(row.as_of).toBe(Date.UTC(2026, 7, 4, 23, 21) / 1000);
});

test('an unparseable stamp falls back rather than dropping the quote', () => {
  const fetchedAt = 2_000_000_000;
  const info = { data: { primaryData: { lastSalePrice: '$10.00', lastTradeTimestamp: 'whenever' } } };
  expect(board.entryFromNasdaq(info, null, { symbol: 'ZZZ', now: fetchedAt }).as_of).toBe(fetchedAt);
});

test('NEW: a closed-session stamp is still the print time, in winter time too', () => {
  // Nasdaq words a session's close "Closed at Aug 4, 2026 4:00 PM ET"; read as
  // our own clock, a weekend board would call Friday's close "just now".
  expect(board.nasdaqStamp('Closed at Aug 4, 2026 4:00 PM ET', 0)).toBe(Date.UTC(2026, 7, 4, 20, 0) / 1000);
  expect(board.nasdaqStamp('Dec 4, 2026 9:30 AM ET', 0)).toBe(Date.UTC(2026, 11, 4, 14, 30) / 1000);
  expect(board.nasdaqStamp('Dec 4, 2026', 0)).toBe(Date.UTC(2026, 11, 4, 5, 0) / 1000);
});

// ─── a pull the board let go of (Bugbot) ─────────────────────────────────
// A landing for a stock cleared or removed while its quote was in flight was
// already ignored; a failure in the same spot still wrote its refusal onto
// the board, about a stock that was no longer there.

test('a failed add after the board was cleared leaves no refusal behind', () => {
  let state = board.beginAdd(board.initialState(), 'ZZZZ', { now: 1 });
  state = board.clear(state);
  const after = board.failAdd(state, 'ZZZZ', board.unknownMessage('ZZZZ'));
  expect(after).toBe(state);
  expect(after.last_error).toBeNull();
});

test('a failed refresh of a stock removed meanwhile leaves no refusal behind', () => {
  let state = board.beginAdd(board.initialState(), 'AAPL', { now: 1 });
  state = board.finishAdd(state, 'AAPL', entry());
  state = board.beginRefresh(state, 'AAPL', { now: 100 });
  state = board.remove(state, 'AAPL');
  const after = board.failRefresh(state, 'AAPL', board.FEED_DOWN_MESSAGE);
  expect(after.last_error).toBeNull();
  expect(after.fetching).toEqual([]);
});

test('a failed add or refresh that is still held is reported as before', () => {
  const adding = board.beginAdd(board.initialState(), 'ZZZZ', { now: 1 });
  expect(board.failAdd(adding, 'ZZZZ', 'gone').last_error).toBe('gone');
  let up = board.finishAdd(board.beginAdd(board.initialState(), 'AAPL', { now: 1 }), 'AAPL', entry());
  up = board.beginRefresh(up, 'AAPL', { now: 100 });
  const failed = board.failRefresh(up, 'AAPL', 'down');
  expect([failed.last_error, failed.watchlist[0].stale]).toEqual(['down', true]);
});
