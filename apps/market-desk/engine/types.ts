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

/** The public board: what the page draws and what the avatar's state is built from. */
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

/** Where an action came from: it decides what the avatar is told about it. */
export type Origin = 'button' | 'spoken' | 'typed' | 'timer';

/** A board action, as a control or the judge produces it. */
export interface Action {
  kind: Kind;
  /** Tickers, already normalised. Empty for clear, and for refresh/focus/remove of "it". */
  symbols: string[];
  /** What the user called each symbol ("Nvidia"), when it was not the ticker itself. */
  said?: Record<string, string>;
}

/** The judge's reading of one utterance. */
export type Judgement =
  | { kind: 'none' }
  | { kind: 'advice' }
  | { kind: Kind; symbols: string[]; said: Record<string, string>; unresolved: string[] };

export interface Outcome {
  seq: number;
  board: Board;
  /** It was a desk action or an advice question: a typed line is recorded, not forwarded. */
  handled: boolean;
  kind?: Kind | 'advice';
  /** The board's refusal, verbatim (the panel prints it; the avatar is told it). */
  refused?: string;
  /** The decline path fired: what was asked and the board fact offered instead. */
  advice?: { asked: string; fact: string };
  /** What the avatar should be told, in its own words, if anything. */
  event?: string;
}

/** What the server streams to the page. */
export type DeskMessage =
  | { type: 'board'; seq: number; board: Board }
  | { type: 'say'; text: string; ttl: number };
