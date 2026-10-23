// The chart and everything around it: where and when (the place picker, the
// clock and the night strip), the dome, the chart's own word when it refuses,
// the marked star, your night's list and the constellations.
//
// Everything rendered is the chart's view. This decides nothing: it cannot
// say whether a star is up, and it does not try. A tap or a button is one
// intent, and a refusal comes back as a sentence to show.
import { useState } from 'react';
import { isDaytime } from '../engine/director.ts';
import type { Notice } from '../engine/actions.ts';
import type { NightEntry } from '../engine/night.ts';
import { clockLabel, PLACES } from '../engine/sky.ts';
import type { FigureStatus, Intent, SkyView } from '../engine/types.ts';
import { NightList } from './NightCard.tsx';
import { compassWord, heightWord } from './projection.ts';
import { SkyDome, type DomePalette } from './SkyDome.tsx';

export type Act = (intent: Intent) => void;

/** "9:00 pm, Thu 23 Oct" as its two halves. */
const split = (label: string) => {
  const [clock, date] = label.split(', ');
  return { clock, date: date ?? '' };
};

/** Where and when: the place picker, the clock, how much is up. */
export function SkyHeader({ view, working, host, onIntent }: { view: SkyView; working: boolean; host: string; onIntent: Act }) {
  const s = view.snapshot;
  const { clock, date } = split(s.when.label);
  return (
    <div className="ls-sky-head">
      <PlacePicker view={view} onIntent={onIntent} />
      <p className="ls-clock">
        <b>{clock}</b>
        <span>{date}{view.solarTime ? ' · solar time' : ''}</span>
      </p>
      <p className="ls-up" aria-live="polite">
        {working ? <span className="ls-working">{host} is checking the catalogue…</span> : <><b>{s.visible.length}</b> of {s.catalog_size} stars up</>}
      </p>
    </div>
  );
}

/** Where the observer stands: one of the 41 places, or coordinates. */
function PlacePicker({ view, onIntent }: { view: SkyView; onIntent: Act }) {
  const [typing, setTyping] = useState(false);
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const current = PLACES.find((place) => place.label === view.snapshot.where.label);
  return (
    <div className="ls-place">
      <label className="ls-kicker" htmlFor="ls-place">The sky from</label>
      <select
        id="ls-place"
        className="ls-place-select"
        value={typing ? 'coords' : current?.id ?? 'here'}
        onChange={(event) => {
          const value = event.target.value;
          if (value === 'coords') return setTyping(true);
          setTyping(false);
          const place = PLACES.find((p) => p.id === value);
          if (place) onIntent({ kind: 'set_place', label: place.label });
        }}
      >
        {!current && <option value="here">{view.snapshot.where.label}</option>}
        {PLACES.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}
        <option value="coords">Somewhere else (coordinates)…</option>
      </select>
      {typing && (
        <form
          className="ls-coords"
          onSubmit={(event) => {
            event.preventDefault();
            // The chart judges the numbers: out of range is a refusal, shown and said.
            onIntent({ kind: 'set_place', lat, lon });
            setTyping(false);
          }}
        >
          <input className="ls-input" aria-label="Latitude" placeholder="Latitude, e.g. -33.9" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          <input className="ls-input" aria-label="Longitude" placeholder="Longitude, e.g. 18.4" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
          <button type="submit" className="ls-chip is-solid" disabled={!lat.trim() || !lon.trim()}>Go</button>
          <button type="button" className="ls-chip" onClick={() => setTyping(false)}>Cancel</button>
        </form>
      )}
    </div>
  );
}

/** The dome with what it needs said over it: daytime, an empty sky. */
export function Dome({ view, palette, onIntent }: { view: SkyView; palette: DomePalette; onIntent: Act }) {
  const s = view.snapshot;
  const day = isDaytime(view);
  return (
    <div className={`ls-dome ${day ? 'is-day' : ''}`}>
      <SkyDome state={s} onSelect={(id) => onIntent({ kind: 'select', star: id })} busy={false} palette={palette} daytime={day} />
      {day && (
        <p className="ls-dome-note" role="status">
          It's daytime in {s.where.label}. The chart leaves out the Sun.
          <button type="button" className="ls-chip is-solid" onClick={() => onIntent({ kind: 'set_time', preset: 'tonight' })}>See tonight</button>
        </p>
      )}
      {!s.visible.length && <p className="ls-dome-note" role="status">No catalogue star is above the horizon here right now.</p>}
      <p className="ls-dome-key" aria-hidden="true">You're looking up: east is on the left.</p>
    </div>
  );
}

const NIGHT_TICKS = [
  { at: 12, label: 'noon' }, { at: 18, label: '6 pm' }, { at: 24, label: 'midnight' }, { at: 30, label: '6 am' }, { at: 36, label: 'noon' },
];

/** When: an hour either way, the night strip (noon to noon), presets, the night itself. */
export function NightStrip({ view, onIntent }: { view: SkyView; onIntent: Act }) {
  const { night } = view;
  return (
    <div className="ls-time">
      <div className="ls-strip-row">
        <button type="button" className="ls-step" aria-label="An hour earlier" title="An hour earlier" onClick={() => onIntent({ kind: 'set_time', shiftHours: -1 })}>−1 h</button>
        <div className="ls-strip">
          <input
            type="range" aria-label="Hour of the night" min={12} max={36} step={0.25} value={night.hours}
            aria-valuetext={view.spokenWhen}
            onChange={(event) => onIntent({ kind: 'set_time', nightHours: Number(event.target.value) })}
          />
          <div className="ls-ticks" aria-hidden="true">
            {NIGHT_TICKS.map((tick) => <span key={tick.at} style={{ left: `${((tick.at - 12) / 24) * 100}%` }}>{tick.label}</span>)}
          </div>
        </div>
        <button type="button" className="ls-step" aria-label="An hour later" title="An hour later" onClick={() => onIntent({ kind: 'set_time', shiftHours: 1 })}>+1 h</button>
      </div>
      <div className="ls-presets">
        <button type="button" className="ls-chip" aria-label="Back to this evening" onClick={() => onIntent({ kind: 'set_time', preset: 'tonight' })}>Tonight</button>
        <button type="button" className="ls-chip" onClick={() => onIntent({ kind: 'set_time', preset: 'midnight' })}>Midnight</button>
        <button type="button" className="ls-chip" onClick={() => onIntent({ kind: 'set_time', preset: 'dawn' })}>Before dawn</button>
        <label className="ls-date">
          <span>Night of</span>
          <input
            type="date" className="ls-input" min="1900-01-01" max="2099-12-31" value={night.date}
            onChange={(event) => { if (event.target.value) onIntent({ kind: 'set_time', date: event.target.value }); }}
          />
        </label>
      </div>
    </div>
  );
}

/** The chart's own word after a refusal, with a way to see the thing when it is up. */
export function NoticeBar({ notice, tz, onLater, onDismiss }: { notice: Notice | null; tz: number; onLater: (notice: Notice) => void; onDismiss: () => void }) {
  if (!notice) return null;
  const later = notice.later === null ? null : split(clockLabel(notice.later, tz));
  return (
    <div className="ls-notice" role="status">
      <p>{notice.text}</p>
      <div className="ls-notice-actions">
        {later && notice.later !== null && (
          <button type="button" className="ls-chip is-solid" onClick={() => onLater(notice)}>
            Show the sky at {later.clock}
          </button>
        )}
        <button type="button" className="ls-chip" onClick={onDismiss} aria-label="Dismiss">OK</button>
      </div>
    </div>
  );
}

/** The marked star, or a way to mark one. */
export function StarCard({ view, host, onIntent }: { view: SkyView; host: string; onIntent: Act }) {
  const s = view.snapshot;
  const star = s.visible.find((v) => v.id === s.selected) ?? null;
  if (!star || !s.fact) {
    return (
      <section className="ls-card is-empty" aria-label="Marked star">
        <p className="ls-kicker">No star marked</p>
        <p className="ls-card-lede">Tap any star on the chart, or ask {host}: <em>"What's that bright one?"</em></p>
        {s.visible.length > 0 && (
          <div className="ls-quick">
            <span>Brightest up now</span>
            <div>
              {s.visible.slice(0, 3).map((v) => (
                <button key={v.id} type="button" className="ls-chip" aria-label={`Mark ${v.name}`} onClick={() => onIntent({ kind: 'select', star: v.id })}>{v.name}</button>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }
  return (
    <section className="ls-card is-star" aria-label="Marked star">
      <p className="ls-kicker">Marked</p>
      <h2 className="ls-star-name">{s.fact.title}</h2>
      <p className="ls-star-where"><Arrow az={star.az} /> {heightWord(star.alt)} in the {compassWord(star.az)}</p>
      <div className="ls-star-fact">
        {s.fact.lines.map((line) => <p key={line}>{line}</p>)}
      </div>
      <button type="button" className="ls-quiet" onClick={() => onIntent({ kind: 'clear_selection' })}>Unmark</button>
    </section>
  );
}

/** A small compass needle pointing where to face (north up). */
function Arrow({ az }: { az: number }) {
  return (
    <svg className="ls-arrow" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" style={{ transform: `rotate(${az}deg)` }}>
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1" opacity=".5" />
      <path d="M10 3.5 13 11h-6z" fill="currentColor" />
    </svg>
  );
}

/** The eighteen figures: drawn, up, or down (still pressable: the chart then says when it rises). */
export function Figures({ figures, lit, onIntent }: { figures: FigureStatus[]; lit: string | null; onIntent: Act }) {
  const up = figures.filter((f) => f.up).length;
  return (
    <section className="ls-figures" aria-label="Constellations">
      <h3 className="ls-kicker">Constellations <span>{up} of {figures.length} up</span></h3>
      <div className="ls-figure-list">
        {figures.map((figure) => {
          const isLit = figure.con === lit;
          const where = figure.anchor ? `${heightWord(figure.anchor.alt)} in the ${compassWord(figure.anchor.az)}` : '';
          return (
            <button
              key={figure.con}
              type="button"
              className={`ls-figure${figure.up ? '' : ' is-down'}${isLit ? ' is-lit' : ''}`}
              aria-pressed={isLit}
              title={figure.up ? where : `Not up${figure.rise ? `: ${figure.rise}` : ''}`}
              onClick={() => onIntent(isLit ? { kind: 'clear_figure' } : { kind: 'show_constellation', name: figure.con })}
            >
              {figure.name}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The side of the chart: the marked star or your night, then the constellations. */
export function Side({ view, night, tab, host, onTab, onIntent }: {
  view: SkyView;
  night: NightEntry[];
  tab: 'star' | 'night';
  host: string;
  onTab: (tab: 'star' | 'night') => void;
  onIntent: Act;
}) {
  return (
    <aside className="ls-side">
      <div className="ls-tabs" role="group" aria-label="Show">
        <button type="button" aria-pressed={tab === 'star'} onClick={() => onTab('star')}>This star</button>
        <button type="button" aria-pressed={tab === 'night'} onClick={() => onTab('night')}>Your night{night.length ? ` · ${night.length}` : ''}</button>
      </div>
      {tab === 'star' ? <StarCard view={view} host={host} onIntent={onIntent} /> : <NightList night={night} host={host} />}
      <Figures figures={view.figures} lit={view.snapshot.figure?.con ?? null} onIntent={onIntent} />
    </aside>
  );
}
