// The counter: the visitor's chits, the slip Hester last wrote (stamped or
// refused) with the visit's earlier slips under it, and the stores ledger with
// the row she last looked up lit. All of it is the stores' view: Hester's words
// never change it.
import { useEffect, useRef } from 'react';
import type { Item, Slip, View } from '../engine/types.ts';

export function Purse({ view }: { view: View }) {
  const low = view.purse < view.startPurse / 4;
  return (
    <p className={`rq-purse ${low ? 'is-low' : ''}`} aria-live="polite">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <rect x="3" y="6" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M7 10h6M7 14h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="17" cy="12" r="1.6" fill="currentColor" />
      </svg>
      <b>{view.purse}</b><span>of {view.startPurse} chits</span>
    </p>
  );
}

const field = (label: string, value: string) => (
  <div className="rq-field"><dt>{label}</dt><dd>{value || '—'}</dd></div>
);

function SlipCard({ slip }: { slip: Slip }) {
  const stamped = slip.status === 'stamped';
  return (
    <article className={`rq-slip is-${slip.status}`} aria-label={`Slip ${slip.no}, ${stamped ? 'stamped' : 'refused'}`}>
      <header className="rq-slip-head">
        <span>Silo 18 · Supply · Requisition</span>
        <b>No. {slip.no}</b>
      </header>
      <dl className="rq-slip-body">
        {field('Item', slip.item)}
        {field('Qty', String(slip.quantity))}
        {field('Department', slip.department)}
        {field('For', slip.purpose)}
        {field('Chits', stamped ? String(slip.chits) : '0')}
        {!stamped && field('Reason', slip.reason ?? '')}
      </dl>
      <p className="rq-stamp" aria-hidden="true">{stamped ? 'Stamped' : 'Refused'}</p>
      <footer className="rq-slip-sign">Issued by H. Pell, Supply</footer>
    </article>
  );
}

export function Slips({ view }: { view: View }) {
  const last = view.slips.at(-1);
  const earlier = view.slips.slice(0, -1).reverse();
  return (
    <section className="rq-slips" aria-label="Your slips" aria-live="polite">
      {last ? <SlipCard key={last.no} slip={last} /> : (
        <article className="rq-slip is-blank">
          <header className="rq-slip-head"><span>Silo 18 · Supply · Requisition</span><b>No. ———</b></header>
          <p className="rq-blank-copy">No slip yet. Tell Hester what you need, which department it's for, and why.</p>
        </article>
      )}
      {earlier.length > 0 && (
        <ol className="rq-earlier" aria-label="Earlier slips">
          {earlier.map((s) => (
            <li key={s.no} className={`is-${s.status}`}>
              <span className="rq-earlier-no">{s.no}</span>
              <span className="rq-earlier-item">{s.item}{s.status === 'stamped' ? ` × ${s.quantity}` : ''}</span>
              <span className="rq-earlier-mark">{s.status === 'stamped' ? `${s.chits} ch` : 'Refused'}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Row({ item, lit }: { item: Item; lit: boolean }) {
  const ref = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (!lit) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [lit]);
  const out = item.count === 0;
  return (
    <tr ref={ref} className={`${lit ? 'is-lit' : ''} ${out ? 'is-out' : ''}`} aria-current={lit ? 'true' : undefined}>
      <td className="rq-shelf">{item.shelf}</td>
      <th scope="row">{item.name}{item.only && <small>{item.only.join(' · ')} only</small>}</th>
      <td className="rq-count">{out ? <span className="rq-out">Out</span> : item.count}</td>
      <td className="rq-price">{item.chits}</td>
    </tr>
  );
}

export function Ledger({ view }: { view: View }) {
  return (
    <section className="rq-ledger" aria-label="Stores ledger">
      <h2>Stores ledger</h2>
      <div className="rq-ledger-scroll">
        <table>
          <thead><tr><th scope="col">Shelf</th><th scope="col">Item</th><th scope="col">On hand</th><th scope="col">Chits</th></tr></thead>
          <tbody>{view.ledger.map((item) => <Row key={item.id} item={item} lit={view.lit === item.id} />)}</tbody>
        </table>
      </div>
    </section>
  );
}
