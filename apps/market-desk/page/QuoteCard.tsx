import { formatAsOf, formatMove, formatPrice, formatSeriesSpan, moveDirection, rangePosition } from './format.ts';
import { Sparkline } from './Sparkline.tsx';
import type { Quote } from '../engine/types.ts';

/**
 * One row of the board (ported from the original panel).
 *
 * Everything drawn here comes out of the board, including whether the row is
 * stale, which is the server's judgement about its own last pull. A stale card
 * greys and prints the age of the number it is still showing, because hiding
 * it, or showing it as if it were current, is the failure this app is most
 * likely to be blamed for.
 */
export function QuoteCard({ quote, focused, fetching, disabled, now, onFocus, onRemove, onRefresh }: {
  quote: Quote;
  focused: boolean;
  fetching: boolean;
  disabled: boolean;
  now?: number;
  onFocus: () => void;
  onRemove: () => void;
  onRefresh: () => void;
}) {
  const direction = moveDirection(quote);
  const position = rangePosition(quote);
  const span = formatSeriesSpan(quote, now);

  return (
    <article className={['card', focused ? 'card-focused' : '', quote.stale ? 'card-stale' : ''].filter(Boolean).join(' ')} aria-current={focused ? 'true' : undefined}>
      <button type="button" className="card-hit" onClick={onFocus} disabled={disabled} aria-label={`Focus ${quote.symbol}`} />

      <header className="card-head">
        <span className="card-symbol">{quote.symbol}</span>
        <span className="card-exchange">{quote.exchange}</span>
        {focused && <span className="card-badge" title="The desk refreshes this one every minute and speaks on a 1% move">on watch</span>}
      </header>
      <p className="card-name" title={quote.name}>{quote.name}</p>

      <p className={`card-price price-${direction}`}>
        {formatPrice(quote.price)}
        <span className="card-ccy">{quote.currency}</span>
      </p>
      <p className={`card-move move-${direction}`}><span>{formatMove(quote)}</span><span className="card-window">today</span></p>

      <Sparkline series={quote.series} direction={direction} label={quote.symbol} />
      {span && <p className="card-span">{span}</p>}

      {/* Why this row is grey, on the row itself: a banner at the top of the board does not say which symbol it is about. */}
      {quote.stale && quote.error && <p className="card-error" role="status">{quote.error}</p>}

      {position !== null && (
        /* The period is ON SCREEN, not only in aria-label. Two testers read this
           bar as the sparkline's three-month window; the wider spread it actually
           covers then looked impossible, and one concluded the app makes its numbers up. */
        <div className="range">
          <span className="range-label">52-week range</span>
          <span className="range-end">{formatPrice(quote.wk52_low)}</span>
          <div
            className="range-bar"
            role="meter"
            aria-label={`${quote.symbol} in its 52-week range`}
            aria-valuemin={quote.wk52_low ?? undefined}
            aria-valuemax={quote.wk52_high ?? undefined}
            aria-valuenow={quote.price ?? undefined}
          >
            <span className="range-marker" style={{ left: `${(position * 100).toFixed(1)}%` }} />
          </div>
          <span className="range-end">{formatPrice(quote.wk52_high)}</span>
        </div>
      )}

      <footer className="card-foot">
        <span className="card-asof" title="When this price printed, not when we asked for it">
          {quote.stale ? 'stale · ' : ''}
          {formatAsOf(quote.as_of, now)}
        </span>
        <span className="card-actions">
          <button type="button" className="icon" onClick={onRefresh} disabled={disabled || fetching} aria-label={`Refresh ${quote.symbol}`} title="Refresh">
            {fetching ? '…' : '⟳'}
          </button>
          <button type="button" className="icon" onClick={onRemove} disabled={disabled} aria-label={`Remove ${quote.symbol}`} title="Remove">✕</button>
        </span>
      </footer>
    </article>
  );
}
