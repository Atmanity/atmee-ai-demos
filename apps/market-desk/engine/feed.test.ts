// The fetcher's half: HTTP status to domain error, and the header that is
// load-bearing. Ported from the original's tests/test_feed.py. No network: an
// injected fetch answers per URL, which covers every branch that would
// otherwise only run in production (and only intermittently).
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as board from './board.ts';
import { fetchEntry, fromYahoo, searchSymbols, type Http } from './feed.ts';
import { load } from './test-helpers.ts';

type Answer = { status: number; body?: unknown } | Error;

/** Answers per URL fragment, because a quote has two possible sources and the
 * interesting cases are about WHICH one was asked. */
function fakeHttp(fallback?: Answer, routes: Record<string, Answer> = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const http: Http = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const answer = Object.entries(routes).find(([fragment]) => url.includes(fragment))?.[1] ?? fallback;
    if (!answer) throw new Error(`unscripted ${url}`);
    if (answer instanceof Error) throw answer;
    return { status: answer.status, text: async () => JSON.stringify(answer.body ?? null) };
  };
  return { http, calls };
}

const nasdaqDown = (status = 503) => ({ 'api.nasdaq.com': { status } });
/** The Yahoo half on its own: the fallback, exercised directly. */
const pull = (http: Http, symbol = 'AAPL') => fromYahoo(symbol, { http, range: '1mo', interval: '1d', now: 1785861999 });
/** The real entry point: Nasdaq first, Yahoo second. */
const pullEither = (http: Http, symbol = 'AAPL') => fetchEntry(symbol, { http, now: 1785861999 });

afterEach(() => { vi.unstubAllEnvs(); });
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'info').mockImplementation(() => {});

test('a good response becomes a row', async () => {
  const { http } = fakeHttp({ status: 200, body: load('aapl-1mo.json') });
  const row = await pull(http);
  expect(row.symbol).toBe('AAPL');
  expect(row.price).toBe(306.83);
});

test('the request carries a browser user agent', async () => {
  // Without one this endpoint answers 429, not 403, so it reads as rate
  // limiting and invites a retry loop that can never succeed.
  const { http, calls } = fakeHttp({ status: 200, body: load('aapl-1mo.json') });
  await pull(http);
  const url = new URL(calls[0].url);
  expect(url.pathname.endsWith('/v8/finance/chart/AAPL')).toBe(true);
  expect(Object.fromEntries(url.searchParams)).toEqual({ range: '1mo', interval: '1d' });
  expect(calls[0].headers['User-Agent']).toContain('Mozilla/5.0');
});

test('a 404 is an unknown ticker and names it', async () => {
  const err = await pull(fakeHttp({ status: 404 }).http, 'ZZZZ').catch((e) => e);
  expect(err).toBeInstanceOf(board.UnknownSymbol);
  expect(err.message).toBe("I couldn't find a listing for ZZZZ — check the ticker.");
});

test('a 429 says the feed is rate-limiting, not that the ticker is bad', async () => {
  const err = await pull(fakeHttp({ status: 429 }).http).catch((e) => e);
  expect(err).toBeInstanceOf(board.RateLimited);
  expect(err.message).toBe('The feed is rate-limiting me. Give it about a minute.');
});

test('a timeout is the feed not answering', async () => {
  // Through the real entry point: both sources time out, and what the user
  // hears is a sentence about the feed, never a transport error.
  const timeout = new Error('The operation was aborted due to timeout');
  timeout.name = 'TimeoutError';
  const err = await pullEither(fakeHttp(timeout).http).catch((e) => e);
  expect(err).toBeInstanceOf(board.FeedUnavailable);
  expect(err.message).toBe("The market feed isn't answering right now — I'll try again in a moment.");
});

describe('any other status is the feed not answering', () => {
  test.each([500, 502, 403])('%d', async (status) => {
    expect(await pull(fakeHttp({ status }).http).catch((e) => e)).toBeInstanceOf(board.FeedUnavailable);
  });
});

test('a dropped connection never escapes as a transport error', async () => {
  // A reducer that has to know about sockets is a reducer nobody can test.
  expect(await pullEither(fakeHttp(new Error('ECONNRESET: peer went away')).http).catch((e) => e)).toBeInstanceOf(board.FeedUnavailable);
});

test('nasdaq is asked first and yahoo only when it cannot answer', async () => {
  // Two sources because they fail in different places: Yahoo rate-limits by IP
  // (a laptop gets 429 whatever the headers say) and Nasdaq answers there.
  const { http, calls } = fakeHttp({ status: 200, body: load('aapl-1mo.json') }, nasdaqDown());
  const row = await pullEither(http);
  const asked = calls.map((c) => c.url);
  expect(asked.some((u) => u.includes('api.nasdaq.com'))).toBe(true);
  expect(asked.some((u) => u.includes('finance.yahoo.com'))).toBe(true);
  expect(asked[0].startsWith('https://api.nasdaq.com')).toBe(true);
  expect(row.symbol).toBe('AAPL');
});

test('an unknown ticker is not asked of the second source', async () => {
  // Both sources agree a bad ticker is a bad ticker. Asking again is pure
  // latency on a turn the user is waiting through.
  const { http, calls } = fakeHttp({ status: 200, body: load('aapl-1mo.json') }, { 'api.nasdaq.com': { status: 200, body: load('nasdaq-zzzq-404.json') } });
  expect(await pullEither(http, 'ZZZQ').catch((e) => e)).toBeInstanceOf(board.UnknownSymbol);
  expect(calls.filter((c) => c.url.includes('yahoo'))).toEqual([]);
});

test('nasdaq answers are used without touching the fallback', async () => {
  const { http, calls } = fakeHttp(undefined, {
    '/info': { status: 200, body: load('nasdaq-aapl-info.json') },
    '/chart?': { status: 200, body: load('nasdaq-aapl-chart.json') },
  });
  const row = await pullEither(http);
  expect(row.name).toBe('Apple Inc.');
  expect(calls.filter((c) => c.url.includes('yahoo'))).toEqual([]);
});

test('a symbol is url-escaped rather than pasted into the path', async () => {
  const { http, calls } = fakeHttp({ status: 200, body: load('aapl-1mo.json') });
  await fromYahoo('^GSPC', { http, now: 0 });
  expect(new URL(calls[0].url).pathname.endsWith('%5EGSPC')).toBe(true);
});

test('the fallback url can be redirected for offline work', async () => {
  // Yahoo answers 429 to a residential IP however correct the headers are, so
  // a laptop cannot reach the real feed. The override lets a local run replay
  // recorded payloads; unset, the app has its real sources.
  const first = fakeHttp({ status: 200, body: load('aapl-1mo.json') });
  await pull(first.http);
  expect(first.calls[0].url.startsWith('https://query1.finance.yahoo.com/')).toBe(true);

  vi.stubEnv('MARKET_DESK_CHART_URL', 'http://127.0.0.1:8795/chart/{symbol}');
  const other = fakeHttp({ status: 200, body: load('aapl-1mo.json') });
  await pull(other.http, 'BRK-B');
  // Read per call, not at import: the server imports this long before a local run sets anything.
  expect(other.calls[0].url.split('?')[0]).toBe('http://127.0.0.1:8795/chart/BRK-B');
});

test('NEW: the symbol search returns listings, and nothing at all when it fails', async () => {
  const body = { data: [{ symbol: 'PLTR', name: 'Palantir Technologies Inc. Class A Common Stock', asset: 'STOCKS', exchange: 'NASDAQ-GS' }] };
  const { http, calls } = fakeHttp({ status: 200, body });
  expect(await searchSymbols('palantir', { http })).toEqual([{ symbol: 'PLTR', name: 'Palantir Technologies Inc. Class A Common Stock', asset: 'STOCKS', exchange: 'NASDAQ-GS' }]);
  expect(calls[0].url).toContain('autocomplete/slookup');
  expect(await searchSymbols('x', { http: fakeHttp({ status: 429 }).http })).toEqual([]);
  expect(await searchSymbols('x', { http: fakeHttp(new Error('down')).http })).toEqual([]);
});

test('NEW: a share class is asked of nasdaq the way nasdaq writes it', async () => {
  // The board and Yahoo write BRK-B; Nasdaq writes BRK.B and calls BRK-B "Symbol not exists.".
  const { http, calls } = fakeHttp(undefined, {
    '/info': { status: 200, body: load('nasdaq-aapl-info.json') },
    '/chart?': { status: 200, body: load('nasdaq-aapl-chart.json') },
  });
  await fetchEntry('BRK-B', { http, now: 1785861999 });
  expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/api/quote/BRK.B/info', '/api/quote/BRK.B/chart']);
});
