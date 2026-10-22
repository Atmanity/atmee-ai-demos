import { useEffect, useState } from 'react';
import { STANDING_LINE } from '../engine/director.ts';
import type { Board, Kind } from '../engine/types.ts';
import { AddSymbol } from './AddSymbol.tsx';
import { sortQuotes, type SortOrder } from './format.ts';
import { QuoteCard } from './QuoteCard.tsx';

export interface IntentResult { applied: boolean; reason?: string }

/**
 * The board (ported from the original panel's MarketDesk.tsx): boards in,
 * intents out, nothing decided here. The original read the agent's state
 * store; this one is handed the server's board and an `onIntent` that resolves
 * to applied or refused, the same contract.
 *
 * A refusal is a message, not a throw: the reason is printed verbatim, because
 * the same sentence is what the analyst says out loud. The advice refusal is
 * drawn too: an app whose whole safety property is a refusal cannot render
 * that refusal as nothing.
 */
export function MarketDesk({ board, onIntent, notice = null, advice = null, now }: {
  board: Board | null;
  onIntent: (intent: { kind: Kind; symbol?: string }) => Promise<IntentResult>;
  /** A refusal of something the user said or typed (the panel's own are kept here). */
  notice?: string | null;
  /** The decline path just fired: what was asked, and the board fact offered instead. */
  advice?: { asked: string; fact: string } | null;
  /** For the cards' "4m ago"; re-rendered by the page as time passes. */
  now?: number;
}) {
  // View state, all three: never sent, never compared against the board.
  const [order, setOrder] = useState<SortOrder>('board');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Clear takes the whole board and there is no undo: one misplaced click next
  // to "Sort by move" should not cost six rows, so it asks first.
  const [confirmClear, setConfirmClear] = useState(false);

  // A refusal of something WE just asked for is ours to show and to clear.
  useEffect(() => {
    if (!refusal) return;
    const timer = setTimeout(() => setRefusal(null), 6000);
    return () => clearTimeout(timer);
  }, [refusal]);

  // An armed Clear that stays armed is a trap the next time the mouse passes.
  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  async function intent(payload: { kind: Kind; symbol?: string }) {
    setPending(true);
    try {
      const result = await onIntent(payload);
      setRefusal(result.applied ? null : result.reason ?? null);
    } finally {
      setPending(false);
    }
  }

  if (!board) {
    return (
      <div className="desk desk-loading" aria-live="polite">
        <span className="desk-status">Opening the board…</span>
      </div>
    );
  }

  const quotes = sortQuotes(board.watchlist, order);
  const pendingAdds = board.fetching.filter((symbol) => !board.watchlist.some((quote) => quote.symbol === symbol));
  const message = refusal ?? notice ?? board.last_error;

  return (
    <div className="desk">
      <header className="desk-head">
        <h1 className="desk-title">Market Desk</h1>
        <span className="desk-count">{board.watchlist.length}/{board.max_symbols}</span>
        <button type="button" className="desk-sort" onClick={() => setOrder(order === 'board' ? 'move' : 'board')}>
          {order === 'board' ? 'Sort by move' : 'Sort by board'}
        </button>
        <button
          type="button"
          className={`desk-clear${confirmClear ? ' is-armed' : ''}`}
          onClick={() => {
            if (!confirmClear) return void setConfirmClear(true);
            setConfirmClear(false);
            void intent({ kind: 'clear' });
          }}
          disabled={pending}
        >
          {confirmClear ? 'Clear the board?' : 'Clear'}
        </button>
      </header>

      <AddSymbol
        empty={quotes.length === 0 && pendingAdds.length === 0}
        full={board.watchlist.length >= board.max_symbols}
        busy={pending}
        onAdd={(symbol) => void intent({ kind: 'add', symbol })}
      />

      {advice && (
        <div className="desk-refusal" role="status">
          <span className="desk-refusal__asked">“{advice.asked}”</span>
          <span className="desk-refusal__line">{STANDING_LINE}</span>
          <span className="desk-refusal__fact">From the board: {advice.fact}</span>
        </div>
      )}

      {message && <p className="desk-message" role="status">{message}</p>}

      {quotes.length === 0 && pendingAdds.length === 0 ? (
        <p className="desk-empty">Nothing on the board yet. Type a ticker above, tap one of the starters, or ask out loud: "put Apple up".</p>
      ) : (
        <div className="grid">
          {quotes.map((quote) => (
            <QuoteCard
              key={quote.symbol}
              quote={quote}
              now={now}
              focused={board.focus === quote.symbol}
              fetching={board.fetching.includes(quote.symbol)}
              disabled={pending}
              onFocus={() => void intent({ kind: 'focus', symbol: quote.symbol })}
              onRemove={() => void intent({ kind: 'remove', symbol: quote.symbol })}
              onRefresh={() => void intent({ kind: 'refresh', symbol: quote.symbol })}
            />
          ))}
          {pendingAdds.map((symbol) => (
            // A claimed slot, NOT a provisional row: no price is shown for a quote we do not have.
            <article className="card card-pending" key={symbol}>
              <header className="card-head"><span className="card-symbol">{symbol}</span></header>
              <p className="card-waiting">pulling a quote…</p>
            </article>
          ))}
        </div>
      )}

      <footer className="desk-foot">
        Quotes from Nasdaq (Yahoo as a fallback), stamped with the time they printed. The desk reads the tape; it never gives advice.
      </footer>
    </div>
  );
}
