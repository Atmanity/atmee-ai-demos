// The board itself: pure rules, no network, no clock of its own. Ported from
// the original's board.py; every function is a function of its arguments, so
// the whole app is testable against a saved payload and a fixed `now`.
//
// Three groups:
// - symbol hygiene: `normalizeSymbol`, because "apple's ticker, aapl" and
//   "$AAPL " must be the same row on the board;
// - the parse: `entryFromNasdaq` (the primary feed) and `entryFromChart`
//   (Yahoo, the fallback), one payload to one row, where every quirk of those
//   endpoints is absorbed and the series is capped;
// - the transitions: begin/finish/fail add and refresh, remove, focus, clear,
//   each refusing with a `BoardError` whose message is the sentence the user
//   hears (and the panel prints).
//
// The state is a plain object and the transitions return a NEW object, so a
// refusal cannot have half-mutated anything. Keys beginning with `_` are
// private bookkeeping and never reach the page: `publicView()` is what it sees.
import type { Board, BoardState, Quote } from './types.ts';

/** How many rows the board holds: a 2x3 grid. */
export const MAX_SYMBOLS = 6;

/** Daily closes kept per symbol: 90 draws a readable three-month sparkline. */
export const MAX_SERIES_POINTS = 90;

/** A refresh inside this window is refused. The daily bar does not move fast
 * enough to be worth a round trip, and a caller asked twice will pull twice. */
export const REFRESH_FLOOR_S = 15;

// A leading `^` is an index (^GSPC, ^IXIC); `-` a share class (BRK-B); `=` and
// a trailing `.XX` the currency and non-US listings (EURUSD=X, 7203.T).
const SYMBOL_RE = /^\^?[A-Z0-9][A-Z0-9.\-=]{0,11}$/;

const COUNT_WORDS: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six' };

/** A refusal. Its message is spoken to the user and shown on the panel, so it
 * is a sentence about the board, never about the code. */
export class BoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class BoardFull extends BoardError {}
export class DuplicateSymbol extends BoardError {}
export class NotOnBoard extends BoardError {}
export class TooSoon extends BoardError {}
export class AlreadyClear extends BoardError {}
/** The feed has no listing under that ticker. */
export class UnknownSymbol extends BoardError {}
/** The feed did not answer, or answered with something unusable. */
export class FeedUnavailable extends BoardError {}
/** HTTP 429. Yahoo does this per IP and it clears on its own. */
export class RateLimited extends BoardError {}

export const fullMessage = (limit: number = MAX_SYMBOLS) => `The board only holds ${COUNT_WORDS[limit] ?? limit} — drop one first.`;
export const unknownMessage = (symbol: string) => `I couldn't find a listing for ${symbol} — check the ticker.`;

export const DUPLICATE_MESSAGE = "That one's already on the board.";
export const NOT_ON_BOARD_MESSAGE = "That isn't on the board.";
export const FOCUS_NOT_ON_BOARD_MESSAGE = "Add it first and I'll pull it up.";
export const TOO_SOON_MESSAGE = 'I just pulled that — nothing new yet.';
export const ALREADY_CLEAR_MESSAGE = "The board's already clear.";
export const FEED_DOWN_MESSAGE = "The market feed isn't answering right now — I'll try again in a moment.";
export const RATE_LIMITED_MESSAGE = 'The feed is rate-limiting me. Give it about a minute.';

// ─── numbers ─────────────────────────────────────────────────────────────

/** Python's round(): half to even. The series cap's stride depends on it. */
export function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 ? (r % 2 === 0 ? r : r - 1) : r;
}

/** A number rounded to two places, or null for anything that is not a finite number. */
export function round2(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim() !== '') n = Number(value.trim());
  else if (typeof value === 'boolean') n = Number(value);
  else return null;
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(2)) || 0; // `|| 0` folds -0 into 0
}

/** Nasdaq sends money as display text: "$310.956", "+1.576", "1,204.50",
 * "N/A", "". Everything that is not a number becomes null rather than a zero,
 * because a zero price renders as a real quote. */
export function money(raw: unknown): number | null {
  if (typeof raw === 'number') return round2(raw);
  const text = String(raw ?? '').trim().replace(/\$/g, '').replace(/,/g, '').replace(/%/g, '');
  if (!text || ['N/A', 'NA', '--'].includes(text.toUpperCase())) return null;
  const n = Number(text);
  return Number.isNaN(n) ? null : round2(n);
}

// ─── symbols ─────────────────────────────────────────────────────────────

const stripChars = (text: string, chars: string) => {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start])) start++;
  while (end > start && chars.includes(text[end - 1])) end--;
  return text.slice(start, end);
};

/**
 * A spoken or typed ticker to the one string the board keys on.
 *
 * Speech recognition hands us "a. a. p. l", "$aapl", "aapl." and "AAPL";
 * all of those are the same row. Anything that survives the strip but is not
 * a plausible ticker returns "" and the caller refuses it as unknown rather
 * than sending it to the feed: a query for "MY FAVOURITE ONE" is a 404 that
 * cost a round trip.
 */
export function normalizeSymbol(raw: unknown): string {
  let text = (raw ? String(raw) : '').trim().toUpperCase().replace(/\$/g, '');
  // "a. a. p. l": single letters separated by dots or spaces are spelled out.
  const letters = text.split(/[.\s]+/).filter(Boolean);
  if (letters.length > 1 && letters.every((part) => part.length === 1)) text = letters.join('');
  else text = stripChars(text, ' .,!?;:\'"');
  text = text.replace(/\s+/g, '');
  return SYMBOL_RE.test(text) ? text : '';
}

// ─── the parse ───────────────────────────────────────────────────────────

/**
 * Keep at most `limit` points, evenly spaced, ALWAYS ending on the last.
 *
 * Downsampling rather than truncating is the difference between a sparkline
 * that shows the shape of a quarter and one that shows the shape of the oldest
 * 90 days and calls it today. The step string goes with it so the panel is not
 * left claiming daily bars for a thinned series.
 */
export function capSeries(closes: number[], timestamps: number[], limit = MAX_SERIES_POINTS): [number[], number[], string] {
  const count = closes.length;
  if (count <= limit) return [[...closes], [...timestamps], '1d'];
  const idx = [...new Set(Array.from({ length: limit }, (_, i) => pyRound((i * (count - 1)) / (limit - 1))))].sort((a, b) => a - b);
  const stride = Math.max(1, pyRound((count - 1) / (limit - 1)));
  return [idx.map((i) => closes[i]), idx.map((i) => timestamps[i]), `${stride}d`];
}

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * One Yahoo `v8/finance/chart` payload to one row. Everything surprising about
 * that endpoint lives here:
 *
 * - **There is no `previousClose` in `meta`.** `chartPreviousClose` is the
 *   close *before the whole requested window* (a month ago for `range=1mo`),
 *   so using it for "today's change" reports a month of drift as a day's
 *   move. The previous daily close is `indicators.quote[0].close[-2]`.
 * - **`close[]` contains nulls** on holidays and halted sessions, and they line
 *   up with real entries in `timestamp[]`. Dropping the value without its
 *   timestamp would slide every later point along the axis, so they go in pairs.
 * - `exchangeName` is the terse code (`NMS`); `fullExchangeName` is what a
 *   person recognises (`NasdaqGS`).
 */
export function entryFromChart(payload: unknown, { symbol, now }: { symbol: string; now: number }): Quote {
  const chart = isObject(payload) ? payload.chart : null;
  const error = isObject(chart) ? chart.error : null;
  if (isObject(error) && Object.keys(error).length) {
    const code = String(error.code || '').toLowerCase();
    if (code.includes('notfound') || code.includes('not found')) throw new UnknownSymbol(unknownMessage(symbol));
    throw new FeedUnavailable(FEED_DOWN_MESSAGE);
  }
  const results = isObject(chart) ? chart.result : null;
  if (!Array.isArray(results) || !results.length) throw new UnknownSymbol(unknownMessage(symbol));
  const result = isObject(results[0]) ? results[0] : {};
  const meta = isObject(result.meta) ? result.meta : {};

  const stamps = (Array.isArray(result.timestamp) ? result.timestamp : []).filter(isNumber);
  const quotes = isObject(result.indicators) ? result.indicators.quote : null;
  const rawCloses: unknown[] = (Array.isArray(quotes) && quotes.length && isObject(quotes[0]) && Array.isArray(quotes[0].close) ? quotes[0].close : []);

  const pairs: [number, number][] = [];
  for (let i = 0; i < Math.min(stamps.length, rawCloses.length); i++) {
    const close = round2(rawCloses[i]);
    if (close !== null) pairs.push([Math.trunc(stamps[i]), close]);
  }
  const times = pairs.map(([t]) => t);
  const closes = pairs.map(([, c]) => c);

  let price = round2(meta.regularMarketPrice);
  if (price === null) price = closes.length ? closes[closes.length - 1] : null;
  // No price and no usable history: the symbol resolved to nothing we can draw.
  // Unknown rather than a feed fault: retrying produces exactly the same result.
  if (price === null) throw new UnknownSymbol(unknownMessage(symbol));

  // The previous DAILY close, not the pre-window close.
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : round2(meta.chartPreviousClose);
  let change: number | null = null;
  let changePct: number | null = null;
  if (prevClose) {
    change = round2(price - prevClose);
    changePct = round2((change! / prevClose) * 100);
  }

  const [series, seriesStamps, step] = capSeries(closes, times);
  return {
    symbol: String(meta.symbol || symbol).toUpperCase(),
    name: String(meta.longName || meta.shortName || symbol),
    currency: String(meta.currency || ''),
    exchange: String(meta.fullExchangeName || meta.exchangeName || ''),
    price,
    prev_close: prevClose,
    change,
    change_pct: changePct,
    wk52_high: round2(meta.fiftyTwoWeekHigh),
    wk52_low: round2(meta.fiftyTwoWeekLow),
    series,
    series_start_ts: seriesStamps.length ? seriesStamps[0] : null,
    series_step: step,
    as_of: Math.trunc(Number(meta.regularMarketTime) || now),
    stale: false,
    error: null,
  };
}

const EASTERN = 'America/New_York';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** How far `timeZone` is ahead of UTC at `epochMs`, in milliseconds. */
function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(epochMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return wall - Math.floor(epochMs / 1000) * 1000;
}

/** A New York wall-clock time to epoch seconds (daylight saving included). */
export function easternToEpoch(year: number, month0: number, day: number, hour = 0, minute = 0, second = 0): number {
  const wall = Date.UTC(year, month0, day, hour, minute, second);
  const first = wall - zoneOffsetMs(wall, EASTERN);
  return Math.floor((wall - zoneOffsetMs(first, EASTERN)) / 1000);
}

/**
 * The print time Nasdaq reports, as epoch seconds.
 *
 * Nasdaq sends "Aug 4, 2026 7:21 PM ET". Using our own fetch time instead made
 * every card read "just now" over a Friday close all weekend, and left the
 * announcer's same-print guard comparing two clocks that always differ. Falls
 * back to `now` when the field is missing or in a shape we do not know: an
 * unparseable stamp is not a reason to drop the quote. (New here: a leading
 * "Closed at", the shape Nasdaq uses for a session's close, is read too.)
 */
export function nasdaqStamp(raw: unknown, now: number): number {
  if (typeof raw !== 'string') return Math.trunc(now);
  let text = raw.trim().replace(/^(closed at|as of)\s+/i, '');
  for (const suffix of [' ET', ' EDT', ' EST']) {
    if (text.endsWith(suffix)) {
      text = text.slice(0, -suffix.length).trim();
      break;
    }
  }
  const m = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))? ([AaPp][Mm]))?$/.exec(text);
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  if (!m || month < 0) return Math.trunc(now);
  let hour = m[4] ? Number(m[4]) : 0;
  if (m[4]) {
    if (hour < 1 || hour > 12) return Math.trunc(now);
    hour = (hour % 12) + (m[7].toUpperCase() === 'PM' ? 12 : 0);
  }
  return easternToEpoch(Number(m[3]), month, Number(m[2]), hour, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0);
}

/**
 * Nasdaq's `quote/<sym>/info` + `quote/<sym>/chart` to one row. What differs
 * from Yahoo, and why each matters:
 *
 * - **Every number is a formatted string** ("$310.956", "+1.576",
 *   "201.68 - 344.57"), parsed through `money`, which returns null rather than
 *   0 for "N/A": an unquoted symbol showing $0.00 is worse than one showing nothing.
 * - **An unknown ticker is HTTP 200** with `data: null` and
 *   "Symbol not exists.", so the status code cannot say the symbol was bad.
 * - **`lastSalePrice` is real-time, including after hours**, while the chart's
 *   last point is the previous session's close: using the chart's last point
 *   as the price would silently report yesterday every evening.
 * - The 52-week range arrives as one "low - high" string.
 * - Chart points are `{x: epoch_ms, y: close}`.
 */
export function entryFromNasdaq(info: unknown, chart: unknown, { symbol, now }: { symbol: string; now: number }): Quote {
  const data = isObject(info) ? info.data : null;
  if (!isObject(data) || !Object.keys(data).length) throw new UnknownSymbol(unknownMessage(symbol));
  const primary = isObject(data.primaryData) ? data.primaryData : {};
  const stats = isObject(data.keyStats) ? data.keyStats : {};

  let price = money(primary.lastSalePrice);

  const chartData = isObject(chart) && isObject(chart.data) ? chart.data : {};
  const points: unknown[] = Array.isArray(chartData.chart) ? chartData.chart : [];
  const pairs: [number, number][] = [];
  for (const point of points) {
    if (!isObject(point)) continue;
    const close = round2(point.y);
    if (close === null || !isNumber(point.x)) continue;
    pairs.push([Math.floor(point.x / 1000), close]); // x is milliseconds
  }
  const times = pairs.map(([t]) => t);
  const closes = pairs.map(([, c]) => c);

  if (price === null) price = closes.length ? closes[closes.length - 1] : null;
  if (price === null) throw new UnknownSymbol(unknownMessage(symbol));

  // THE DAY'S MOVE COMES FROM `netChange`, NOT FROM `previousClose`.
  //
  // `chart.previousClose` disagrees with the change Nasdaq itself displays:
  // NVDA came back as +7.85% against it while Nasdaq showed +2.15%, because
  // that field is not the close `netChange` is measured from. `lastSalePrice`
  // and `netChange` arrive together and are what a person sees on the Nasdaq
  // page, so trust the pair and derive the previous close from it. The chart is
  // consulted only if `netChange` is missing, and `previousClose` last of all.
  let change = money(primary.netChange);
  let changePct = money(primary.percentageChange);
  let prevClose: number | null;
  if (change !== null) prevClose = round2(price - change);
  else if (closes.length >= 2) prevClose = closes[closes.length - 2];
  else prevClose = money(chartData.previousClose);
  if (change === null && prevClose) change = round2(price - prevClose);
  if (changePct === null && prevClose && change !== null) changePct = round2((change / prevClose) * 100);

  let wk52Low: number | null = null;
  let wk52High: number | null = null;
  const span = String((isObject(stats.fiftyTwoWeekHighLow) ? stats.fiftyTwoWeekHighLow.value : '') || '');
  if (span.includes('-')) {
    const at = span.indexOf('-');
    wk52Low = money(span.slice(0, at));
    wk52High = money(span.slice(at + 1));
  }

  const [series, seriesStamps, step] = capSeries(closes, times);
  let name = String(data.companyName || symbol);
  // "Apple Inc. Common Stock" is the security's legal name, not what anyone
  // calls it; the suffix is noise on a card that is 20 characters wide.
  for (const suffix of [' Common Stock', ' Class A Common Stock', ' Common Shares']) {
    if (name.endsWith(suffix)) name = name.slice(0, -suffix.length);
  }

  return {
    symbol: String(data.symbol || symbol).toUpperCase(),
    name,
    currency: String(primary.currency || 'USD'),
    exchange: String(data.exchange || ''),
    price,
    prev_close: prevClose,
    change,
    change_pct: changePct,
    wk52_high: wk52High,
    wk52_low: wk52Low,
    series,
    series_start_ts: seriesStamps.length ? seriesStamps[0] : null,
    series_step: step,
    as_of: nasdaqStamp(primary.lastTradeTimestamp, now),
    stale: false,
    error: null,
  };
}

// ─── the board ───────────────────────────────────────────────────────────

export function initialState(): BoardState {
  return {
    watchlist: [],
    focus: null,
    fetching: [],
    last_error: null,
    max_symbols: MAX_SYMBOLS,
    // Private: when each symbol was last pulled, which is what the refresh
    // floor is measured against. Bookkeeping, not something the avatar would
    // be caught lying about, so `publicView()` drops it.
    _pulled: {},
  };
}

/** The projection the page draws and the avatar's state is built from. */
export function publicView(state: BoardState): Board {
  return Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('_'))) as unknown as Board;
}

export const find = (state: Board, symbol: string): Quote | null => state.watchlist.find((e) => e.symbol === symbol) ?? null;

const withoutFetching = (state: Board, symbol: string) => state.fetching.filter((s) => s !== symbol);
const withoutPulled = (state: BoardState, symbol: string) => Object.fromEntries(Object.entries(state._pulled).filter(([k]) => k !== symbol));

/**
 * Claim a slot for a symbol we are about to fetch.
 *
 * The claim happens BEFORE the network call so the refusals a user cares
 * about (full board, already there) are instant and deterministic, and so a
 * second "add Apple" while the first is in flight is refused rather than
 * racing it onto the board twice.
 */
export function beginAdd(state: BoardState, symbol: string, { now }: { now: number }): BoardState {
  if (find(state, symbol) !== null) throw new DuplicateSymbol(DUPLICATE_MESSAGE);
  if (state.fetching.includes(symbol)) throw new DuplicateSymbol(DUPLICATE_MESSAGE);
  if (state.watchlist.length + state.fetching.length >= state.max_symbols) throw new BoardFull(fullMessage(state.max_symbols));
  return { ...state, fetching: [...state.fetching, symbol], last_error: null, _pulled: { ...state._pulled, [symbol]: now } };
}

/** The fetch landed. The row goes on the board, and the board follows it. */
export function finishAdd(state: BoardState, symbol: string, entry: Quote): BoardState {
  if (find(state, symbol) !== null) return { ...state, fetching: withoutFetching(state, symbol) }; // a duplicate that raced past the claim
  // New in this port: the claim was released while the quote was in flight (the
  // board was cleared), so the row must not come back on its own.
  if (!state.fetching.includes(symbol)) return state;
  return {
    ...state,
    watchlist: [...state.watchlist, entry],
    fetching: withoutFetching(state, symbol),
    focus: state.focus || entry.symbol,
    last_error: null,
  };
}

/** The fetch failed. The slot is released and the reason is on the board: a
 * failed add that silently vanished is how a user ends up asking twice. */
export function failAdd(state: BoardState, symbol: string, reason: string): BoardState {
  // The claim was released while the quote was in flight (the board was
  // cleared): like a landing then, a failure has nothing left to report.
  if (!state.fetching.includes(symbol)) return state;
  return { ...state, fetching: withoutFetching(state, symbol), last_error: reason, _pulled: withoutPulled(state, symbol) };
}

export function remove(state: BoardState, symbol: string): BoardState {
  if (find(state, symbol) === null) throw new NotOnBoard(NOT_ON_BOARD_MESSAGE);
  const remaining = state.watchlist.filter((e) => e.symbol !== symbol);
  let focus = state.focus;
  if (focus === symbol) focus = remaining.length ? remaining[0].symbol : null;
  return { ...state, watchlist: remaining, focus, fetching: withoutFetching(state, symbol), last_error: null, _pulled: withoutPulled(state, symbol) };
}

export function focus(state: BoardState, symbol: string): BoardState {
  if (find(state, symbol) === null) throw new NotOnBoard(FOCUS_NOT_ON_BOARD_MESSAGE);
  return { ...state, focus: symbol, last_error: null };
}

/** Claim a pull. The 15 s floor lives HERE, not in the caller, because every
 * path (the panel's button, a spoken "check it again", the 60 s timer) has to
 * obey the same one. */
export function beginRefresh(state: BoardState, symbol: string, { now }: { now: number }): BoardState {
  if (find(state, symbol) === null) throw new NotOnBoard(NOT_ON_BOARD_MESSAGE);
  if (state.fetching.includes(symbol)) throw new TooSoon(TOO_SOON_MESSAGE);
  const last = state._pulled[symbol];
  if (last !== undefined && now - last < REFRESH_FLOOR_S) throw new TooSoon(TOO_SOON_MESSAGE);
  return { ...state, fetching: [...state.fetching, symbol], last_error: null, _pulled: { ...state._pulled, [symbol]: now } };
}

export function finishRefresh(state: BoardState, symbol: string, entry: Quote): BoardState {
  if (find(state, symbol) === null) return { ...state, fetching: withoutFetching(state, symbol) }; // removed while the pull was in flight
  return {
    ...state,
    watchlist: state.watchlist.map((e) => (e.symbol === symbol ? entry : e)),
    fetching: withoutFetching(state, symbol),
    last_error: null,
  };
}

/**
 * A pull that failed greys the row rather than dropping it.
 *
 * The last price we had is still the last price there was; what changed is our
 * confidence in it, which is what `stale` and the printed `as_of` are for.
 * Nothing here speaks: a background timer announcing its plumbing is a nuisance.
 */
export function failRefresh(state: BoardState, symbol: string, reason: string): BoardState {
  // Removed (or the board cleared) while the pull was in flight: no row to grey, no refusal to show.
  if (find(state, symbol) === null) return { ...state, fetching: withoutFetching(state, symbol) };
  return {
    ...state,
    watchlist: state.watchlist.map((e) => (e.symbol === symbol ? { ...e, stale: true, error: reason } : e)),
    fetching: withoutFetching(state, symbol),
    last_error: reason,
  };
}

export function clear(state: BoardState): BoardState {
  if (!state.watchlist.length && !state.fetching.length) throw new AlreadyClear(ALREADY_CLEAR_MESSAGE);
  return initialState();
}
