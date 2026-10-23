// Outcry's board: the stock on watch, big, and the six slots below it.
// Boards in, intents out, nothing decided here: the desk answers each intent
// with the board or a refusal, and a refusal is printed as the sentence it is
// (the same one Reese is told). It draws only what the board holds, so it
// never shows a price for a quote that has not arrived.
import { useEffect, useState } from 'react';
import type { Board, Kind, Quote } from '../engine/types.ts';
import { AddSymbol } from './AddSymbol.tsx';
import { ARROW, formatAsOf, formatMove, formatPrice, formatPrintTime, formatSeriesSpan, moveDirection, rangePosition, sortQuotes, type SortOrder } from './format.ts';
import { Sparkline } from './Sparkline.tsx';

export interface IntentResult { applied: boolean; reason?: string }
export type OnIntent = (kind: Kind, symbol?: string) => Promise<IntentResult>;

/** Shown only on an empty board: a first move, not a recommendation list. */
export const STARTERS = ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'GOOGL'];

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
const RefreshIcon = () => <svg {...icon}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>;
const RemoveIcon = () => <svg {...icon}><path d="M6 6l12 12M18 6L6 18" /></svg>;

export function DeskBoard({ board, onIntent, notice = null, now = Date.now(), host = 'Reese' }: {
  board: Board | null;
  onIntent: OnIntent;
  /** A refusal or failure from elsewhere (a tool call), printed like the board's own. */
  notice?: string | null;
  /** For the ages ("4m ago"); re-rendered by the page as time passes. */
  now?: number;
  host?: string;
}) {
  // View state: never sent, never compared against the board.
  const [order, setOrder] = useState<SortOrder>('board');
  const [refusal, setRefusal] = useState<string | null>(null);
  // Clear takes the whole board and there is no undo: one misplaced click next
  // to "Sort by move" should not cost six rows, so it asks first.
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!refusal) return;
    const timer = setTimeout(() => setRefusal(null), 6000);
    return () => clearTimeout(timer);
  }, [refusal]);
  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  async function intent(kind: Kind, symbol?: string) {
    const result = await onIntent(kind, symbol);
    setRefusal(result.applied ? null : result.reason ?? null);
  }

  if (!board) {
    return (
      <section className="oc-board is-loading" aria-busy="true" aria-label="Your board">
        <div className="oc-watch is-waiting"><p className="oc-watch-wait">Opening your board…</p></div>
      </section>
    );
  }

  const quotes = sortQuotes(board.watchlist, order);
  const arriving = board.fetching.filter((symbol) => !board.watchlist.some((quote) => quote.symbol === symbol));
  const watched = board.watchlist.find((q) => q.symbol === board.focus) ?? board.watchlist[0] ?? null;
  const message = refusal ?? notice ?? board.last_error;
  const used = board.watchlist.length + arriving.length;

  return (
    <section className="oc-board" aria-label="Your board">
      <Watch
        quote={watched} arriving={arriving} now={now} host={host}
        refreshing={watched ? board.fetching.includes(watched.symbol) : false}
        onStart={(symbol) => void intent('add', symbol)}
        onRefresh={(symbol) => void intent('refresh', symbol)}
        onRemove={(symbol) => void intent('remove', symbol)}
      />

      <div className="oc-board-bar">
        <h2 className="oc-board-title">Your board <span>{board.watchlist.length} of {board.max_symbols}</span></h2>
        <AddSymbol full={used >= board.max_symbols} onAdd={(symbol) => void intent('add', symbol)} />
        <div className="oc-board-tools">
          <button type="button" className="oc-text-button" onClick={() => setOrder(order === 'board' ? 'move' : 'board')} disabled={quotes.length < 2}>
            {order === 'board' ? 'Sort by move' : 'Sort by board'}
          </button>
          <button
            type="button"
            className={`oc-text-button is-danger${confirmClear ? ' is-armed' : ''}`}
            disabled={!used}
            onClick={() => {
              if (!confirmClear) return void setConfirmClear(true);
              setConfirmClear(false);
              void intent('clear');
            }}
          >
            {confirmClear ? 'Clear the board?' : 'Clear'}
          </button>
        </div>
      </div>

      {message && <p className="oc-notice" role="status">{message}</p>}

      <ol className="oc-slots">
        {quotes.map((quote) => (
          <Slot
            key={quote.symbol} quote={quote} now={now}
            watched={watched?.symbol === quote.symbol}
            fetching={board.fetching.includes(quote.symbol)}
            onWatch={() => void intent('focus', quote.symbol)}
            onRefresh={() => void intent('refresh', quote.symbol)}
            onRemove={() => void intent('remove', quote.symbol)}
          />
        ))}
        {arriving.map((symbol) => (
          // A claimed slot, NOT a provisional row: no price is shown for a quote we do not have.
          <li className="oc-slot is-arriving" key={symbol} aria-busy="true">
            <span className="oc-slot-symbol">{symbol}</span>
            <span className="oc-slot-wait">pulling a quote…</span>
          </li>
        ))}
        {Array.from({ length: Math.max(0, board.max_symbols - used) }, (_, i) => (
          <li className="oc-slot is-open" key={`open-${i}`}>
            <span className="oc-slot-n">{String(used + i + 1).padStart(2, '0')}</span>
            <span className="oc-slot-hint">{i === 0 ? `Open: name a stock to ${host}` : 'Open'}</span>
          </li>
        ))}
      </ol>

      <p className="oc-source">Quotes from Nasdaq (Yahoo as a fallback), stamped with the time they printed. {host} reads the tape and never gives advice.</p>
    </section>
  );
}

/** The stock on watch: front and centre, refreshed every minute, the one Reese speaks up about. */
function Watch({ quote, arriving, now, host, refreshing, onStart, onRefresh, onRemove }: {
  quote: Quote | null;
  arriving: string[];
  now: number;
  host: string;
  refreshing: boolean;
  onStart: (symbol: string) => void;
  onRefresh: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}) {
  if (!quote && arriving.length) {
    return (
      <article className="oc-watch is-waiting" aria-busy="true">
        <span className="oc-watch-tag">Coming up</span>
        <p className="oc-watch-symbol">{arriving[0]}</p>
        <p className="oc-watch-wait">{host} is pulling the quote…</p>
      </article>
    );
  }
  if (!quote) {
    return (
      <article className="oc-watch is-empty">
        <span className="oc-watch-tag">On watch</span>
        <h2 className="oc-watch-title">Nothing on the board yet</h2>
        <p className="oc-watch-hint">Tell {host} a company (“put Apple up”), type a ticker below, or start with one of these.</p>
        <div className="oc-starters">
          {STARTERS.map((symbol) => <button key={symbol} type="button" className="oc-starter" onClick={() => onStart(symbol)}>{symbol}</button>)}
        </div>
      </article>
    );
  }
  const direction = moveDirection(quote);
  const span = formatSeriesSpan(quote, now);
  const position = rangePosition(quote);
  return (
    <article className={`oc-watch is-${direction}${quote.stale ? ' is-stale' : ''}`} aria-label={`On watch: ${quote.symbol}`}>
      <div className="oc-watch-head">
        <span className="oc-watch-tag">On watch</span>
        <h2 className="oc-watch-symbol">{quote.symbol}</h2>
        <p className="oc-watch-name">{quote.name}{quote.exchange ? <span> · {quote.exchange}</span> : null}</p>
      </div>
      <div className="oc-watch-quote">
        <p className="oc-watch-price">{formatPrice(quote.price)}<small>{quote.currency}</small></p>
        <p className={`oc-move is-${direction}`}>
          <span aria-hidden="true">{ARROW[direction]}</span> <span className="oc-move-num">{formatMove(quote)}</span> <span className="oc-move-when">today</span>
        </p>
      </div>
      <div className="oc-watch-chart">
        <Sparkline series={quote.series} direction={direction} width={480} height={110} label={`${quote.symbol} on watch`} />
        {span && <p className="oc-watch-span">{span}</p>}
      </div>
      {position !== null && (
        /* The period is ON SCREEN, not only in aria-label. Two testers read this
           bar as the sparkline's three-month window; the wider spread it actually
           covers then looked impossible, and one concluded the app makes its numbers up. */
        <div className="oc-range">
          <span className="oc-range-label">52-week range</span>
          <span className="oc-range-end">{formatPrice(quote.wk52_low)}</span>
          <div
            className="oc-range-bar" role="meter" aria-label={`${quote.symbol} in its 52-week range`}
            aria-valuemin={quote.wk52_low ?? undefined} aria-valuemax={quote.wk52_high ?? undefined} aria-valuenow={quote.price ?? undefined}
            aria-valuetext={`${Math.round(position * 100)}% of the way from the low to the high`}
          >
            <span className="oc-range-marker" style={{ left: `${(position * 100).toFixed(1)}%` }} />
          </div>
          <span className="oc-range-end">{formatPrice(quote.wk52_high)}</span>
        </div>
      )}
      <footer className="oc-watch-foot">
        <span className="oc-printed" title="When this price printed, not when we asked for it">
          {quote.stale ? `Stale · the last number the desk got, ${formatAsOf(quote.as_of, now)}` : `Printed ${formatPrintTime(quote.as_of)} · ${formatAsOf(quote.as_of, now)}`}
        </span>
        {quote.stale && quote.error && <span className="oc-watch-error">{quote.error}</span>}
        <span className="oc-watch-actions">
          <button type="button" className="oc-ghost" onClick={() => onRefresh(quote.symbol)} disabled={refreshing}>
            <RefreshIcon /> {refreshing ? 'Pulling…' : 'Refresh'}
          </button>
          <button type="button" className="oc-ghost" onClick={() => onRemove(quote.symbol)}><RemoveIcon /> Remove</button>
        </span>
      </footer>
    </article>
  );
}

/** One stock on the board: tap it to put it on watch. */
function Slot({ quote, watched, fetching, now, onWatch, onRefresh, onRemove }: {
  quote: Quote;
  watched: boolean;
  fetching: boolean;
  now: number;
  onWatch: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const direction = moveDirection(quote);
  return (
    <li className={['oc-slot', 'is-filled', `is-${direction}`, watched ? 'is-watched' : '', quote.stale ? 'is-stale' : ''].filter(Boolean).join(' ')}>
      <button type="button" className="oc-slot-hit" onClick={onWatch} aria-label={`Watch ${quote.symbol}`} aria-pressed={watched} />
      <div className="oc-slot-top">
        <span className="oc-slot-symbol">{quote.symbol}</span>
        {watched && <span className="oc-slot-tag">On watch</span>}
      </div>
      <p className="oc-slot-name" title={quote.name}>{quote.name}</p>
      <p className="oc-slot-price">{formatPrice(quote.price)}</p>
      <p className={`oc-move is-${direction}`}><span aria-hidden="true">{ARROW[direction]}</span> <span className="oc-move-num">{formatMove(quote)}</span></p>
      <Sparkline series={quote.series} direction={direction} label={quote.symbol} />
      {/* Why this row is grey, on the row itself: a banner does not say which stock it is about. */}
      {quote.stale && quote.error && <p className="oc-slot-error">{quote.error}</p>}
      <footer className="oc-slot-foot">
        <span className="oc-slot-age" title="When this price printed, not when we asked for it">{quote.stale ? 'stale · ' : ''}{formatAsOf(quote.as_of, now)}</span>
        <button type="button" className="oc-icon" onClick={onRefresh} disabled={fetching} aria-label={`Refresh ${quote.symbol}`} title="Refresh">
          <span className={fetching ? 'oc-spin' : ''}><RefreshIcon /></span>
        </button>
        <button type="button" className="oc-icon" onClick={onRemove} aria-label={`Remove ${quote.symbol}`} title="Remove"><RemoveIcon /></button>
      </footer>
    </li>
  );
}
