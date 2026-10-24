// What the server and the page share. The board is not a secret (every number
// on it is also on the user's screen), so the page sees the whole public
// snapshot; only the refresh floor's bookkeeping stays on the server.

/** One row of the board, as `board.ts` parses it from a feed. */
export interface Quote {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  price: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  wk52_high: number | null;
  wk52_low: number | null;
  /** Daily closes, oldest first, at most 90 points. */
  series: number[];
  series_start_ts: number | null;
  series_step: string;
  /** Unix seconds of the quote itself (when it PRINTED), not of our request. */
  as_of: number;
  /** The last pull failed: the number is the last one we got, not the one now. */
  stale: boolean;
  error: string | null;
}

/** The public board: what the page draws and what the host's state is built from. */
export interface Board {
  watchlist: Quote[];
  focus: string | null;
  /** Symbols with a pull in flight: a spinner, never a provisional row. */
  fetching: string[];
  last_error: string | null;
  max_symbols: number;
}

/** The board plus the server's private bookkeeping (when each symbol was last pulled). */
export interface BoardState extends Board {
  _pulled: Record<string, number>;
}

/** What the desk can do to the board. */
export type Kind = 'add' | 'remove' | 'focus' | 'refresh' | 'clear';

/**
 * Who asked for a pull, which decides who tells the host how it went:
 * - `tool` or `button`: the caller waits for it and reports it itself;
 * - `late`: the caller stopped waiting, so the desk tells the host when it lands.
 * A pull nobody asked for (the once-a-minute timer) is the announcer's.
 */
export type Asker = 'tool' | 'button' | 'late';

/** How one pull ended. */
export interface PullOutcome { symbol: string; kind: 'add' | 'refresh'; ok: boolean; reason?: string }

/** What an add did, per stock. */
export interface AddReport {
  /** On the board now, with what the user called each one. */
  landed: { quote: Quote; said?: string }[];
  /** Already on the board before this add. */
  already: Quote[];
  /** Did not go up, and why (in the board's words). */
  failed: { symbol: string; reason: string; said?: string }[];
  /** Still in flight when the wait ran out: the desk tells the host when each lands. */
  pending: string[];
  /** Names nobody could turn into a ticker. */
  unresolved: string[];
  /** Named past what one call takes (a whole positions list): never tried. */
  untried?: string[];
}

export type RefreshReport =
  | { kind: 'fresh'; quote: Quote; samePrint: boolean }
  | { kind: 'failed'; quote: Quote; reason: string }
  | { kind: 'tooSoon'; quote: Quote }
  | { kind: 'pending'; symbol: string }
  | { kind: 'missing'; symbol: string }
  | { kind: 'empty' };

export type FocusReport =
  | { kind: 'focused'; quote: Quote }
  | { kind: 'added'; report: AddReport }
  | { kind: 'missing'; said: string };

export interface RemoveReport { removed: string[]; refused: string[]; board: Board }

export type ClearReport = { cleared: true } | { cleared: false; reason: string };

/** What the server streams to the page. */
export type DeskMessage =
  | { type: 'board'; seq: number; board: Board }
  /** `call`: the page's call the line was promised in, if any (the page drops it once that call is over). */
  | { type: 'say'; text: string; ttl: number; call?: number };

/** A tool call's or a button's reply: the board, and the words for the host. */
export interface ActReply {
  seq: number;
  board: Board;
  /** For a tool call: what the host says next. For a button: the event telling the host. */
  text: string;
  /** A refusal or failure in the board's own words, for the panel to print. */
  refused?: string;
}
