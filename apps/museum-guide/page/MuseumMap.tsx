// The museum map: the floor plan with a pin for every work (ticked once the
// visitor has seen it, ringed where they are now), the works by room below
// it, and a work's full catalogue entry when its pin or row is tapped.
import { useState } from 'react';
import type { Exhibit } from '../engine/catalogue.ts';
import { PLAN, pins, ROOMS } from '../engine/floorplan.ts';
import { exhibitImage } from './images.ts';
import { Tick, WorkInfo } from './WorkInfo.tsx';
import { localize, pinLabel, roomName } from '../engine/catalogue.i18n.ts';
import { useLang } from './i18n.ts';


function FloorPlan({ seen, current, selected, onPick }: { seen: Set<string>; current: string | null; selected: string | null; onPick: (e: Exhibit) => void }) {
  const { lang, t } = useLang();
  const all = pins();
  const route = all.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <svg className="mr-plan" viewBox={`0 0 ${PLAN.width} ${PLAN.height}`} role="group" aria-label={t('floorPlan')}>
      {ROOMS.map((r) => (
        <g key={r.n}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="6" className="mr-plan-room" />
          <text x={r.x + 10} y={r.y + 18} className="mr-plan-room-n">{t('gallery', { n: r.n })}</text>
          <text x={r.x + 10} y={r.y + 30} className="mr-plan-room-name">
            {roomName(lang, r.n).map((line, i) => <tspan key={line} x={r.x + 10} dy={i ? 12 : 0}>{line}</tspan>)}
          </text>
        </g>
      ))}
      <polyline points={`${PLAN.entrance.x},${PLAN.entrance.y} ${route}`} className="mr-plan-route" />
      <g className="mr-plan-entrance">
        <path d={`M${PLAN.entrance.x - 22} ${PLAN.entrance.y + 12} h44`} />
        <text x={PLAN.entrance.x} y={PLAN.entrance.y + 24}>{t('entrance')}</text>
      </g>
      {all.map((p) => {
        const isSeen = seen.has(p.exhibit.id);
        const here = current === p.exhibit.id;
        return (
          <g key={p.exhibit.id} className={`mr-pin ${isSeen ? 'is-seen' : ''} ${here ? 'is-here' : ''} ${selected === p.exhibit.id ? 'is-picked' : ''}`}
            transform={`translate(${p.x} ${p.y})`} role="button" tabIndex={0}
            aria-label={`${p.number}. ${localize(p.exhibit, lang).title}${isSeen ? ` · ${t('seen')}` : ''}${here ? t('hereSuffix') : ''}`}
            onClick={() => onPick(p.exhibit)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(p.exhibit); } }}>
            {here && <circle r="19" className="mr-pin-here" />}
            <circle r="13" className="mr-pin-dot" />
            {isSeen
              ? <path d="M-5.5 0.5 -1.5 4.5 6 -4" className="mr-pin-tick" />
              : <text y="4.5" className="mr-pin-n">{p.number}</text>}
            <text y="28" className="mr-pin-label">{pinLabel(lang, p.exhibit.id) ?? p.short}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function MuseumMap({ seen, current, initial = null, onClose, onAsk, onToggleSeen }: {
  seen: Exhibit[];
  current: Exhibit | null;
  /** A work to open at, instead of the plan. */
  initial?: Exhibit | null;
  onClose: () => void;
  /** While the call is live: put a question about this work to Edmund. */
  onAsk?: (e: Exhibit) => void;
  onToggleSeen?: (e: Exhibit, seen: boolean) => void;
}) {
  const { lang, t } = useLang();
  const [open, setOpen] = useState<Exhibit | null>(initial);
  const seenIds = new Set(seen.map((e) => e.id));
  const all = pins();
  const pick = (e: Exhibit) => { setOpen(e); document.querySelector('.mr-map-body')?.scrollTo({ top: 0 }); };
  return (
    <div className="mr-map" role="dialog" aria-modal="true" aria-label={t('museumMap')}>
      <header className="mr-map-top">
        <div>
          <h2>{t('museumMap')}</h2>
          <p>{t('seenCount', { n: seenIds.size, total: all.length })}</p>
        </div>
        <button type="button" className="mr-chip is-dark" onClick={onClose}>{t('close')}</button>
      </header>
      <div className="mr-map-progress" aria-hidden="true"><span style={{ width: `${(seenIds.size / all.length) * 100}%` }} /></div>
      <div className="mr-map-body">
        {open ? (
          <WorkInfo exhibit={open} seen={seenIds.has(open.id)} here={current?.id === open.id} back={t('allWorks')} onBack={() => setOpen(null)} onOpen={pick} onAsk={onAsk} onToggleSeen={onToggleSeen} />
        ) : (
          <>
            <FloorPlan seen={seenIds} current={current?.id ?? null} selected={null} onPick={pick} />
            {ROOMS.map((room) => (
              <section key={room.n} className="mr-map-room">
                <h3>{t('gallery', { n: room.n })} · {roomName(lang, room.n).join(/^(zh|ja)/.test(lang) ? '' : ' ')}</h3>
                <ul>
                  {all.filter((p) => p.room.n === room.n).map((p) => (
                    <li key={p.exhibit.id}>
                      <button type="button" className={`mr-map-row ${seenIds.has(p.exhibit.id) ? 'is-seen' : ''}`} onClick={() => pick(p.exhibit)}>
                        <span className="mr-map-check" aria-label={seenIds.has(p.exhibit.id) ? t('seen') : t('notSeenYet')}>{seenIds.has(p.exhibit.id) ? <Tick size={13} /> : p.number}</span>
                        <img src={exhibitImage(p.exhibit)} alt="" />
                        <span className="mr-map-row-text"><b>{localize(p.exhibit, lang).title}</b><small>{localize(p.exhibit, lang).artist}{current?.id === p.exhibit.id ? t('hereSuffix') : ''}</small></span>
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
