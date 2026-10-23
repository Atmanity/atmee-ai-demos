// The closing sheet: what was on the board when the call ended, to keep.
import type { Board } from '../engine/types.ts';
import { ARROW, boardCsv, formatAsOf, formatMove, formatPrice, moveDirection, rangePosition } from './format.ts';

function download(board: Board, now: number) {
  const url = URL.createObjectURL(new Blob([boardCsv(board)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `outcry-board-${new Date(now).toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Closing({ board, now, host, onAgain }: { board: Board | null; now: number; host: string; onAgain: () => void }) {
  const rows = board?.watchlist ?? [];
  // English like the rest of the product, whatever the browser's language (a zh-TW browser printed "下午4:43").
  const at = new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return (
    <section className="oc-closing" aria-label="Closing sheet">
      <p className="oc-eyebrow">Closing sheet · {at}</p>
      <h2>{rows.length ? 'Your board when you hung up' : 'You hung up with an empty board'}</h2>
      {rows.length > 0 ? (
        <table className="oc-sheet">
          <thead>
            <tr><th scope="col">Stock</th><th scope="col" className="is-num">Last</th><th scope="col" className="is-num">Today</th><th scope="col" className="is-num">52-week</th><th scope="col" className="is-num">Printed</th></tr>
          </thead>
          <tbody>
            {rows.map((q) => {
              const direction = moveDirection(q);
              const position = rangePosition(q);
              return (
                <tr key={q.symbol} className={q.stale ? 'is-stale' : ''}>
                  <th scope="row"><b>{q.symbol}</b><small>{q.name}</small></th>
                  <td className="is-num">{formatPrice(q.price)}</td>
                  <td className={`is-num oc-move is-${direction}`} title={formatMove(q)}>
                    <span aria-hidden="true">{ARROW[direction]}</span> {q.change_pct === null ? '—' : `${q.change_pct > 0 ? '+' : ''}${q.change_pct.toFixed(2)}%`}
                  </td>
                  <td className="is-num">{position === null ? '—' : `${Math.round(position * 100)}% up`}</td>
                  <td className="is-num">{q.stale ? 'stale · ' : ''}{formatAsOf(q.as_of, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="oc-closing-empty">Nothing to keep this time. Call {host} again and name a stock to start a board.</p>
      )}
      <div className="oc-closing-actions">
        {rows.length > 0 && <button type="button" className="oc-primary" onClick={() => download(board!, now)}>Download the board (CSV)</button>}
        <button type="button" className={rows.length ? 'oc-secondary' : 'oc-primary'} onClick={onAgain}>Call {host} again</button>
      </div>
      {rows.length > 0 && <p className="oc-small">Your board stays live below: the stock on watch keeps refreshing.</p>}
    </section>
  );
}
