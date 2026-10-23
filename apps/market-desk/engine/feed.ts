// The only thing in this app that touches the network: quotes, and the
// symbol search the judge falls back on. Ported from the original's feed.py.
//
// It runs on the app server, never in the page: Nasdaq and Yahoo do not answer
// a browser (CORS), Yahoo needs a browser User-Agent a page cannot set, and
// both rate-limit by IP. Kept to a thin async half so the interesting half,
// the parse, stays pure in `board.ts` and testable against a saved payload.
//
// Two facts about Yahoo's `v8/finance/chart`, both learned the hard way:
// - **A browser `User-Agent` is required.** Without one the endpoint answers
//   **429**, not 403, so it reads as rate limiting and invites a retry loop
//   that will never work.
// - A genuinely unknown ticker is **HTTP 404**: a permanent answer for that
//   string, so retrying it is pure latency.
import {
  entryFromChart, entryFromNasdaq, FEED_DOWN_MESSAGE, FeedUnavailable, RATE_LIMITED_MESSAGE, RateLimited, UnknownSymbol, unknownMessage,
} from './board.ts';
import type { Quote } from './types.ts';

/** A fetch-shaped function: the real `fetch` on the server, a script in tests. */
export type Http = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}';
export const NASDAQ_INFO_URL = 'https://api.nasdaq.com/api/quote/{symbol}/info?assetclass=stocks';
export const NASDAQ_CHART_URL = 'https://api.nasdaq.com/api/quote/{symbol}/chart?assetclass=stocks&fromdate={fromdate}&todate={todate}';
export const NASDAQ_SEARCH_URL = 'https://api.nasdaq.com/api/autocomplete/slookup/10?search={query}';

/** A real browser string. See the header: this is load-bearing. */
export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Short on purpose: a quote nobody is waiting for is worthless, and the timer fires again in a minute anyway. */
export const TIMEOUT_MS = 6000;
export const DEFAULT_RANGE = '1mo';
export const DEFAULT_INTERVAL = '1d';
/** How much history the sparkline draws from. Nasdaq wants explicit dates. */
export const NASDAQ_WINDOW_DAYS = 92;

const HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
const realHttp: Http = (url, init) => fetch(url, init);
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
const day = (epochS: number) => new Date(epochS * 1000).toISOString().slice(0, 10);

/** One GET, with every HTTP answer already turned into a domain error. */
async function fetchJson(http: Http, url: string, symbol: string): Promise<unknown> {
  const response = await http(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 404) throw new UnknownSymbol(unknownMessage(symbol));
  if (response.status === 429) throw new RateLimited(RATE_LIMITED_MESSAGE);
  if (response.status !== 200) {
    console.warn('[market-desk] [Feed] %s returned HTTP %d', url.split('?')[0], response.status);
    throw new FeedUnavailable(FEED_DOWN_MESSAGE);
  }
  return JSON.parse(await response.text()); // whatever the content type says
}

/** Nasdaq's own quote API, the primary source. Two calls, issued together: the
 * real-time last sale and the 52-week range live on `info`, the daily history on `chart`. */
export async function fromNasdaq(symbol: string, { http = realHttp, now }: { http?: Http; now: number }): Promise<Quote> {
  // Share classes: the board (and Yahoo) write BRK-B, Nasdaq writes BRK.B and
  // calls BRK-B "Symbol not exists." (found porting this; the original could not
  // put Berkshire up at all, since an unknown symbol is never asked of Yahoo).
  const escaped = encodeURIComponent(symbol.replace(/-([A-Z]{1,2})$/, '.$1'));
  const [info, chart] = await Promise.all([
    fetchJson(http, fill(NASDAQ_INFO_URL, { symbol: escaped }), symbol),
    // To tomorrow: inclusive of today wherever the exchange thinks it is.
    fetchJson(http, fill(NASDAQ_CHART_URL, { symbol: escaped, fromdate: day(now - NASDAQ_WINDOW_DAYS * 86400), todate: day(now + 86400) }), symbol),
  ]);
  return entryFromNasdaq(info, chart, { symbol, now });
}

/**
 * Yahoo's chart endpoint, the fallback. `MARKET_DESK_CHART_URL` redirects it at
 * something else (a replay of recorded payloads) for offline work. It is read
 * per call, not at import: the server imports this long before a local run sets it.
 */
export async function fromYahoo(symbol: string, { http = realHttp, now, range = DEFAULT_RANGE, interval = DEFAULT_INTERVAL }: { http?: Http; now: number; range?: string; interval?: string }): Promise<Quote> {
  const template = process.env.MARKET_DESK_CHART_URL || YAHOO_CHART_URL;
  const base = fill(template, { symbol: encodeURIComponent(symbol) });
  const url = `${base}${base.includes('?') ? '&' : '?'}range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
  return entryFromChart(await fetchJson(http, url, symbol), { symbol, now });
}

/** Every failure leaves as one of the three domain errors whose messages the user hears verbatim. */
async function wrapTransport(pull: Promise<Quote>, symbol: string): Promise<Quote> {
  try {
    return await pull;
  } catch (err) {
    if (err instanceof UnknownSymbol || err instanceof RateLimited || err instanceof FeedUnavailable) throw err;
    if ((err as Error)?.name === 'TimeoutError') console.warn('[market-desk] [Feed] %s timed out after %ds', symbol, TIMEOUT_MS / 1000);
    else console.warn('[market-desk] [Feed] %s failed: %s', symbol, (err as Error)?.message);
    throw new FeedUnavailable(FEED_DOWN_MESSAGE);
  }
}

/**
 * One quote, parsed into a row, or a `BoardError` to show.
 *
 * **Two sources, because they fail in different places.** Nasdaq answers a
 * laptop that Yahoo rate-limits by IP; Yahoo is the long-standing fallback when
 * Nasdaq is unhappy. Nasdaq goes first, and Yahoo is tried only when Nasdaq
 * gives an infrastructure answer, never when it says the symbol does not exist:
 * both sources agree about that, and asking twice is latency on a turn the
 * user is waiting through.
 */
export async function fetchEntry(symbol: string, { http = realHttp, now, range, interval }: { http?: Http; now: number; range?: string; interval?: string }): Promise<Quote> {
  try {
    return await wrapTransport(fromNasdaq(symbol, { http, now }), symbol);
  } catch (err) {
    if (!(err instanceof RateLimited || err instanceof FeedUnavailable)) throw err;
    console.info('[market-desk] [Feed] nasdaq %s unavailable (%s), falling back', symbol, err.message);
  }
  return wrapTransport(fromYahoo(symbol, { http, now, range, interval }), symbol);
}

export interface Listing { symbol: string; name: string; asset: string; exchange: string }

/** Nasdaq's symbol lookup ("palantir" -> PLTR), best effort: [] on any failure. */
export async function searchSymbols(query: string, { http = realHttp }: { http?: Http } = {}): Promise<Listing[]> {
  try {
    const response = await http(fill(NASDAQ_SEARCH_URL, { query: encodeURIComponent(query) }), { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status !== 200) return [];
    const body: any = JSON.parse(await response.text());
    const rows: any[] = Array.isArray(body?.data) ? body.data : [];
    return rows
      .filter((r) => r && typeof r.symbol === 'string')
      .map((r) => ({ symbol: String(r.symbol), name: String(r.name ?? ''), asset: String(r.asset ?? ''), exchange: String(r.exchange ?? '') }));
  } catch {
    return [];
  }
}
