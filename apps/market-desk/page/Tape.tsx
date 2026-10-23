// The tape: the board's stocks running across the top, the way a ticker
// tape would. Decoration over the board (which carries the same numbers for
// a screen reader), so it is hidden from one; still when motion is reduced.
import type { Board } from '../engine/types.ts';
import { ARROW, formatPrice, moveDirection } from './format.ts';

export function Tape({ board }: { board: Board | null }) {
  const rows = board?.watchlist ?? [];
  const arriving = (board?.fetching ?? []).filter((s) => !rows.some((q) => q.symbol === s));
  if (!rows.length) {
    return (
      <div className="oc-tape is-quiet" aria-hidden="true">
        <span>{arriving.length ? `${arriving.join(' · ')} coming up…` : 'The tape is quiet. Call out a stock.'}</span>
      </div>
    );
  }
  const ticks = rows.map((q) => {
    const direction = moveDirection(q);
    return (
      <span key={q.symbol} className={`oc-tick is-${direction}${q.stale ? ' is-stale' : ''}`}>
        <b>{q.symbol}</b> {formatPrice(q.price)} <i>{ARROW[direction]} {q.change_pct === null ? '—' : `${Math.abs(q.change_pct).toFixed(2)}%`}</i>
      </span>
    );
  });
  // Twice over, so the loop has no seam; the run is as long as the board.
  return (
    <div className="oc-tape" aria-hidden="true">
      <div className="oc-tape-run" style={{ animationDuration: `${Math.max(16, rows.length * 7)}s` }}>
        <span className="oc-tape-set">{ticks}</span>
        <span className="oc-tape-set">{ticks}</span>
      </div>
    </div>
  );
}
