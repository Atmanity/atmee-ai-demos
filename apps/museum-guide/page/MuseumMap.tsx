// The museum map: the floor plan with a pin for every work (ticked once the
// visitor has seen it, ringed where they are now), the works by room below
// it, and a work's full catalogue entry when its pin or row is tapped.
import { useState } from 'react';
import { exhibitById, type Exhibit } from '../engine/catalogue.ts';
import { PLAN, pins, ROOMS } from '../engine/floorplan.ts';
import { exhibitImage } from './images.ts';

const Tick = ({ size = 12 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

function FloorPlan({ seen, current, selected, onPick }: { seen: Set<string>; current: string | null; selected: string | null; onPick: (e: Exhibit) => void }) {
  const all = pins();
  const route = all.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <svg className="mr-plan" viewBox={`0 0 ${PLAN.width} ${PLAN.height}`} role="group" aria-label="Floor plan of the Meridian">
      {ROOMS.map((r) => (
        <g key={r.n}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="6" className="mr-plan-room" />
          <text x={r.x + 10} y={r.y + 18} className="mr-plan-room-n">Gallery {r.n}</text>
          <text x={r.x + 10} y={r.y + 30} className="mr-plan-room-name">
            {(r.lines ?? [r.name]).map((line, i) => <tspan key={line} x={r.x + 10} dy={i ? 12 : 0}>{line}</tspan>)}
          </text>
        </g>
      ))}
      <polyline points={`${PLAN.entrance.x},${PLAN.entrance.y} ${route}`} className="mr-plan-route" />
      <g className="mr-plan-entrance">
        <path d={`M${PLAN.entrance.x - 22} ${PLAN.entrance.y + 12} h44`} />
        <text x={PLAN.entrance.x} y={PLAN.entrance.y + 24}>Entrance</text>
      </g>
      {all.map((p) => {
        const isSeen = seen.has(p.exhibit.id);
        const here = current === p.exhibit.id;
        return (
          <g key={p.exhibit.id} className={`mr-pin ${isSeen ? 'is-seen' : ''} ${here ? 'is-here' : ''} ${selected === p.exhibit.id ? 'is-picked' : ''}`}
            transform={`translate(${p.x} ${p.y})`} role="button" tabIndex={0}
            aria-label={`${p.number}. ${p.exhibit.title}${isSeen ? ', seen' : ''}${here ? ', you are here' : ''}`}
            onClick={() => onPick(p.exhibit)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(p.exhibit); } }}>
            {here && <circle r="19" className="mr-pin-here" />}
            <circle r="13" className="mr-pin-dot" />
            {isSeen
              ? <path d="M-5.5 0.5 -1.5 4.5 6 -4" className="mr-pin-tick" />
              : <text y="4.5" className="mr-pin-n">{p.number}</text>}
            <text y="28" className="mr-pin-label">{p.short}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Detail({ exhibit, seen, here, onBack, onOpen, onAsk, onToggleSeen }: {
  exhibit: Exhibit;
  seen: boolean;
  here: boolean;
  onBack: () => void;
  onOpen: (e: Exhibit) => void;
  onAsk?: (e: Exhibit) => void;
  onToggleSeen?: (e: Exhibit, seen: boolean) => void;
}) {
  const next = exhibitById(exhibit.next);
  return (
    <article className="mr-detail" aria-label={exhibit.title}>
      <button type="button" className="mr-link" onClick={onBack}>‹ All works</button>
      <img className="mr-detail-img" src={exhibitImage(exhibit)} alt={`${exhibit.title}, ${exhibit.artist}`} />
      <p className="mr-card-where">{here ? 'You are here · ' : ''}{exhibit.gallery}</p>
      <h2>{exhibit.title}</h2>
      <p className="mr-detail-by">{exhibit.artist} · {exhibit.date}</p>
      <p className="mr-detail-medium">{exhibit.medium}. The original hangs in {exhibit.original}.</p>
      <div className="mr-detail-actions">
        {onAsk && <button type="button" className="mr-primary" onClick={() => onAsk(exhibit)}>Ask Edmund about it</button>}
        {onToggleSeen && (
          <button type="button" className={`mr-seen-toggle ${seen ? 'is-on' : ''}`} aria-pressed={seen} onClick={() => onToggleSeen(exhibit, !seen)}>
            {seen ? <><Tick /> Seen</> : 'Mark as seen'}
          </button>
        )}
      </div>
      <h3>The story</h3>
      {exhibit.story.map((line) => <p key={line}>{line}</p>)}
      <h3>Look for</h3>
      <ul>{exhibit.lookFor.map((line) => <li key={line}>{line[0].toUpperCase() + line.slice(1)}</li>)}</ul>
      {next && (
        <button type="button" className="mr-next" onClick={() => onOpen(next)}>
          <img src={exhibitImage(next)} alt="" />
          <span><small>Next on the route · {next.gallery.split(',')[0]}</small><b>{next.title}</b></span>
          <span aria-hidden="true">›</span>
        </button>
      )}
    </article>
  );
}

export function MuseumMap({ seen, current, onClose, onAsk, onToggleSeen }: {
  seen: Exhibit[];
  current: Exhibit | null;
  onClose: () => void;
  /** While the call is live: put a question about this work to Edmund. */
  onAsk?: (e: Exhibit) => void;
  onToggleSeen?: (e: Exhibit, seen: boolean) => void;
}) {
  const [open, setOpen] = useState<Exhibit | null>(null);
  const seenIds = new Set(seen.map((e) => e.id));
  const all = pins();
  const pick = (e: Exhibit) => { setOpen(e); document.querySelector('.mr-map-body')?.scrollTo({ top: 0 }); };
  return (
    <div className="mr-map" role="dialog" aria-modal="true" aria-label="Museum map">
      <header className="mr-map-top">
        <div>
          <h2>Museum map</h2>
          <p><b>{seenIds.size}</b> of {all.length} works seen</p>
        </div>
        <button type="button" className="mr-chip is-dark" onClick={onClose}>Close</button>
      </header>
      <div className="mr-map-progress" aria-hidden="true"><span style={{ width: `${(seenIds.size / all.length) * 100}%` }} /></div>
      <div className="mr-map-body">
        {open ? (
          <Detail exhibit={open} seen={seenIds.has(open.id)} here={current?.id === open.id} onBack={() => setOpen(null)} onOpen={pick} onAsk={onAsk} onToggleSeen={onToggleSeen} />
        ) : (
          <>
            <FloorPlan seen={seenIds} current={current?.id ?? null} selected={null} onPick={pick} />
            {ROOMS.map((room) => (
              <section key={room.n} className="mr-map-room">
                <h3>Gallery {room.n} · {room.name}</h3>
                <ul>
                  {all.filter((p) => p.room.n === room.n).map((p) => (
                    <li key={p.exhibit.id}>
                      <button type="button" className={`mr-map-row ${seenIds.has(p.exhibit.id) ? 'is-seen' : ''}`} onClick={() => pick(p.exhibit)}>
                        <span className="mr-map-check" aria-label={seenIds.has(p.exhibit.id) ? 'Seen' : 'Not seen yet'}>{seenIds.has(p.exhibit.id) ? <Tick size={13} /> : p.number}</span>
                        <img src={exhibitImage(p.exhibit)} alt="" />
                        <span className="mr-map-row-text"><b>{p.exhibit.title}</b><small>{p.exhibit.artist}{current?.id === p.exhibit.id ? ' · you are here' : ''}</small></span>
                        <span aria-hidden="true" className="mr-map-more">›</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
