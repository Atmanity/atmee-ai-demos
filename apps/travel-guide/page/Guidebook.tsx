// The guidebook beside the map: where to, the destination's page (what to
// eat, the news, the sights around a place), and the route so far. It draws
// only what the board's snapshot holds; every control sends the same actions
// the host's tools take, with a label the host is told.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ideasFor } from '../engine/countries.ts';
import type { Action, Snapshot, SpotView, TripView } from '../engine/types.ts';
import { describeBounds, projectRings } from './outline.ts';

/** A control's action, and how the host hears about it ('' for nothing to say). */
export type Act = (action: Action, label: string) => void;
export type Tab = 'eat' | 'news' | 'wander';

export function Guidebook({ snapshot: s, busy, host, onAction }: { snapshot: Snapshot; busy: boolean; host: string; onAction: Act }) {
  const [tab, choose] = useTab(s, onAction);
  const somewhere = Boolean(s.map) || s.stage === 'around';
  return (
    <div className="yd-guide">
      <WhereTo busy={busy} onAction={onAction} />
      {somewhere ? (
        <>
          <PlaceHeader s={s} />
          <div className="yd-tabs" role="tablist" aria-label="The guidebook">
            <TabButton id="eat" tab={tab} onChoose={choose}>Eat</TabButton>
            {s.newsAvailable && <TabButton id="news" tab={tab} onChoose={choose}>News</TabButton>}
            <TabButton id="wander" tab={tab} onChoose={choose}>Wander</TabButton>
          </div>
          <div className="yd-panel" role="tabpanel" id={`yd-panel-${tab}`} aria-labelledby={`yd-tab-${tab}`}>
            {tab === 'eat' ? <Eat s={s} busy={busy} host={host} onAction={onAction} />
              : tab === 'news' ? <News s={s} busy={busy} host={host} onAction={onAction} />
                : <Wander s={s} busy={busy} host={host} onAction={onAction} />}
          </div>
        </>
      ) : (
        <Welcome s={s} busy={busy} host={host} onAction={onAction} />
      )}
      <Route trip={s.trip} stage={s.stage} busy={busy} onAction={onAction} />
    </div>
  );
}

/**
 * The open tab follows the board: the sights when the host explores a place,
 * the dishes or the headlines the moment they are shown. A tab the user picks
 * moves the board too (silently: the host only needs the new state).
 */
function useTab(s: Snapshot, onAction: Act): [Tab, (tab: Tab) => void] {
  const [tab, setTab] = useState<Tab>(s.stage === 'around' ? 'wander' : s.news?.shown && !s.food?.shown ? 'news' : 'eat');
  const asked = useRef<Tab | null>(null);
  const now = { stage: s.stage, food: Boolean(s.food?.shown), news: Boolean(s.news?.shown), country: s.map?.country ?? '' };
  const was = useRef(now);
  useEffect(() => {
    const before = was.current;
    was.current = now;
    let next: Tab | null = null;
    const moved = now.country !== before.country;
    if (now.stage !== 'around' && before.stage === 'around') next = asked.current ?? 'eat';
    if (now.news && (!before.news || moved)) next = 'news';
    if (now.food && (!before.food || moved)) next = 'eat';
    if (now.stage === 'around' && before.stage !== 'around') next = 'wander';
    asked.current = null;
    if (next) setTab(next);
  }, [now.stage, now.food, now.news, now.country]);

  const choose = (next: Tab) => {
    setTab(next);
    if (next === 'wander' && s.stage !== 'around') onAction({ kind: 'show', stage: 'around' }, '');
    if (next !== 'wander' && s.stage === 'around') {
      asked.current = next;
      onAction({ kind: 'show', stage: 'planning' }, '');
    }
  };
  return [tab, choose];
}

function TabButton({ id, tab, onChoose, children }: { id: Tab; tab: Tab; onChoose: (t: Tab) => void; children: ReactNode }) {
  return (
    <button type="button" role="tab" id={`yd-tab-${id}`} aria-selected={tab === id} aria-controls={`yd-panel-${id}`} className="yd-tab" onClick={() => tab !== id && onChoose(id)}>
      {children}
    </button>
  );
}

function WhereTo({ busy, onAction }: { busy: boolean; onAction: Act }) {
  const [query, setQuery] = useState('');
  const go = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    onAction({ kind: 'search', query: q }, `Go, searching for "${q}"`);
    setQuery('');
  };
  return (
    <form className="yd-where" onSubmit={go} role="search">
      <label className="yd-where-label" htmlFor="yd-where">Where to?</label>
      <div className="yd-where-row">
        <input id="yd-where" className="yd-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A country, or a city in one" autoComplete="off" />
        <button className="yd-primary" type="submit" disabled={busy || !query.trim()}>Go</button>
        <button className="yd-sun" type="button" disabled={busy} onClick={() => onAction({ kind: 'pick' }, 'Surprise me')}>Surprise me</button>
      </div>
    </form>
  );
}

function Welcome({ s, busy, host, onAction }: { s: Snapshot; busy: boolean; host: string; onAction: Act }) {
  const ideas = ideasFor(s.continent, s.trip.visited.map((v) => v.country)).slice(0, 6);
  return (
    <section className="yd-welcome">
      <h1 className="yd-welcome-title">{s.travelerName ? `Where to, ${s.travelerName}?` : 'The whole world is open'}</h1>
      <p className="yd-text">Name a country to {host}, type one above, or tap the map. It lands with its outline, and its food is a question away.</p>
      <div className="yd-ideas" aria-label={s.continent ? `Ideas in ${s.continent}` : 'Ideas'}>
        <span className="yd-kicker">{s.continent ? `Ideas in ${s.continent}` : 'Ideas'}</span>
        {ideas.map((country) => (
          <button key={country} type="button" className="yd-chip" disabled={busy} onClick={() => onAction({ kind: 'destination', country }, `${country}, one of the ideas`)}>{country}</button>
        ))}
      </div>
      <div className="yd-wander-now">
        <h2 className="yd-subhead">Already somewhere?</h2>
        <PlaceFinder busy={busy} onAction={onAction} intro={`Name a street, station or neighbourhood, and ${host} shows you what is worth seeing around it.`} />
      </div>
    </section>
  );
}

function PlaceHeader({ s }: { s: Snapshot }) {
  const m = s.map;
  const wandering = s.stage === 'around' && s.spot;
  return (
    <header className="yd-place">
      <p className="yd-kicker">{m ? 'Your destination' : 'Wandering'}</p>
      <h1>{m?.country ?? s.spot?.place ?? ''}</h1>
      {m && <p className="yd-coords">{m.city && <span>{m.city} · </span>}{describeBounds(m.center, m.bbox)}</p>}
      {!m && wandering && <p className="yd-coords">No country on your route yet</p>}
    </header>
  );
}

function Eat({ s, busy, host, onAction }: { s: Snapshot; busy: boolean; host: string; onAction: Act }) {
  const country = s.map?.country;
  if (!country) return <Quiet>Choose a country above, and its food is a question away.</Quiet>;
  const food = s.food;
  if (food?.shown) {
    if (!food.dishes.length) return <Quiet>No dish ideas came back for {country}. Ask {host} what people eat there.</Quiet>;
    return (
      <ol className="yd-dishes" aria-label={`Dishes from ${country}`}>
        {food.dishes.map((dish, i) => (
          <li key={`${i}-${dish.name}`} className="yd-dish">
            <div className="yd-dish-photo">
              {dish.imageUrl ? <img src={dish.imageUrl} alt={dish.name} loading="lazy" /> : <NoPhoto />}
            </div>
            <div className="yd-dish-text">
              <span className="yd-num">0{i + 1}</span>
              <h3>{dish.name}</h3>
              {dish.description && <p>{dish.description}</p>}
            </div>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="yd-ask">
      <p className="yd-text">Three dishes from {country} worth crossing a city for, with a photo of each.</p>
      <button type="button" className="yd-primary" disabled={busy} onClick={() => onAction({ kind: 'food' }, 'What should I eat there?')}>
        {food?.loading ? 'Finding dishes…' : 'What should I eat there?'}
      </button>
      <p className="yd-hint">Or just ask {host}.</p>
    </div>
  );
}

function News({ s, busy, host, onAction }: { s: Snapshot; busy: boolean; host: string; onAction: Act }) {
  const country = s.map?.country;
  if (!country) return <Quiet>Choose a country above to see what is in its news.</Quiet>;
  const news = s.news;
  if (news?.shown) {
    if (!news.headlines.length) return <Quiet>No headlines came back for {country} right now.</Quiet>;
    return (
      <>
        <ul className="yd-headlines" aria-label={`Headlines from ${country}`}>
          {news.headlines.map((h, i) => (
            <li key={`${i}-${h.title}`}>
              {h.url ? <a href={h.url} target="_blank" rel="noreferrer">{h.title}</a> : <span>{h.title}</span>}
              <span className="yd-source">{h.source}</span>
            </li>
          ))}
        </ul>
        {/* Not "today's": the newest the source has, with no date filter, so their age is unknown. */}
        <p className="yd-hint">The newest stories the source has for {country}; some may be a few days old.</p>
      </>
    );
  }
  return (
    <div className="yd-ask">
      <p className="yd-text">The newest local stories from {country}, to get a feel for the place.</p>
      <button type="button" className="yd-primary" disabled={busy} onClick={() => onAction({ kind: 'news' }, 'Show the latest headlines')}>
        {news?.loading ? 'Pulling the headlines…' : 'Show the latest headlines'}
      </button>
      <p className="yd-hint">Or just ask {host}.</p>
    </div>
  );
}

function Wander({ s, busy, host, onAction }: { s: Snapshot; busy: boolean; host: string; onAction: Act }) {
  const v = s.spot;
  const where = s.map?.country ? ` in ${s.map.country}` : '';
  if (!v) return <PlaceFinder busy={busy} onAction={onAction} intro={`Name a street, station or neighbourhood${where}, and ${host} shows you what is worth seeing around it, one sight at a time.`} />;
  if (!v.spot) {
    return (
      <>
        <Quiet>
          {v.lookupFailed ? `The places service is not answering right now, so nothing came back for ${v.place}.` : `Nothing stands out around ${v.place}. A station or a main square nearby usually has more.`}
        </Quiet>
        {v.lookupFailed && <button type="button" className="yd-secondary" disabled={busy} onClick={() => onAction({ kind: 'around', place: v.place }, `Try again, around ${v.place}`)}>Try {v.place} again</button>}
        <PlaceFinder busy={busy} onAction={onAction} intro="Or look around somewhere else." compact />
      </>
    );
  }
  return (
    <>
      <Sight view={v} busy={busy} onAction={onAction} />
      <PlaceFinder busy={busy} onAction={onAction} intro="Look around somewhere else" compact />
    </>
  );
}

function Sight({ view, busy, onAction }: { view: SpotView; busy: boolean; onAction: Act }) {
  const spot = view.spot!;
  const more = view.index + 1 < view.total;
  return (
    <article className="yd-sight" aria-label={spot.name}>
      <p className="yd-kicker">Around {view.place}</p>
      <a className="yd-sight-photo" href={spot.mapsUrl || undefined} target="_blank" rel="noreferrer" aria-label={`${spot.name}, open in Google Maps`}>
        {spot.imageUrl ? <img key={spot.imageUrl} src={spot.imageUrl} alt="" /> : <NoPhoto label={`No photo of this ${spot.category} yet`} hint="Open it in Maps to look around" />}
      </a>
      <p className="yd-sight-meta"><span>{spot.category}</span>{spot.distance && <span>{spot.distance}</span>}</p>
      <h2 className="yd-sight-name">{spot.name}</h2>
      {spot.summary && <p className="yd-text">{spot.summary}</p>}
      {spot.mapsUrl && <a className="yd-link" href={spot.mapsUrl} target="_blank" rel="noreferrer">Open in Google Maps</a>}
      <nav className="yd-sight-nav" aria-label="Sights">
        <button type="button" className="yd-secondary" disabled={busy || view.index === 0} onClick={() => onAction({ kind: 'previous' }, 'Previous sight')}>Previous</button>
        <span className="yd-count" aria-live="polite">{view.index + 1} of {view.total}</span>
        <button type="button" className="yd-primary" disabled={busy || !more} onClick={() => onAction({ kind: 'next' }, 'Next sight')}>{more ? 'Next sight' : 'That was the last'}</button>
      </nav>
    </article>
  );
}

function PlaceFinder({ busy, onAction, intro, compact = false }: { busy: boolean; onAction: Act; intro: string; compact?: boolean }) {
  const [place, setPlace] = useState('');
  const [locating, setLocating] = useState('');
  const look = (e: FormEvent) => {
    e.preventDefault();
    const p = place.trim();
    if (!p) return;
    onAction({ kind: 'around', place: p }, `Look around, for "${p}"`);
    setPlace('');
  };
  const locate = () => {
    if (!navigator.geolocation) return setLocating('This browser cannot share a location. Type where you are instead.');
    setLocating('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(''); onAction({ kind: 'coords', lat: pos.coords.latitude, lon: pos.coords.longitude }, 'Use my location'); },
      () => setLocating('No location was shared. Type where you are instead.'),
      { timeout: 15000, maximumAge: 300000 },
    );
  };
  return (
    <form className={`yd-finder ${compact ? 'is-compact' : ''}`} onSubmit={look}>
      <label className={compact ? 'yd-kicker' : 'yd-text'} htmlFor={compact ? 'yd-place-again' : 'yd-place'}>{intro}</label>
      <div className="yd-where-row">
        <input id={compact ? 'yd-place-again' : 'yd-place'} className="yd-input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="A street, station or neighbourhood" autoComplete="off" />
        <button className="yd-primary" type="submit" disabled={busy || !place.trim()}>Look around</button>
      </div>
      <button type="button" className="yd-textbutton" disabled={busy} onClick={locate}>Use my location</button>
      {locating && <p className="yd-hint" role="status">{locating}</p>}
    </form>
  );
}

function Route({ trip, stage, busy, onAction }: { trip: TripView; stage: Snapshot['stage']; busy: boolean; onAction: Act }) {
  // One country is not a route, it is where you are: the header already says so.
  if (trip.visited.length < 2) return null;
  return (
    <section className="yd-route" aria-label="Your route">
      <h2 className="yd-kicker">Your route</h2>
      <ol>
        {trip.visited.map((stop) => {
          const here = stop.country === trip.current;
          const shape = stop.silhouette ? projectRings(stop.silhouette, 40, 3) : null;
          return (
            <li key={stop.country}>
              <button
                type="button" className="yd-stop" aria-current={here ? 'true' : undefined}
                disabled={busy || (here && stage !== 'around')} title={here ? 'On the map now' : `Back to ${stop.country}`}
                onClick={() => onAction({ kind: 'revisit', country: stop.country }, `${stop.country}, on their route`)}
              >
                {shape ? (
                  <svg className="yd-stop-shape" viewBox={`0 0 ${shape.width} ${shape.height}`} aria-hidden="true">{shape.paths.map((d, i) => <path key={i} d={d} />)}</svg>
                ) : <span className="yd-stop-dot" aria-hidden="true" />}
                <span className="yd-stop-name">{stop.country}{stop.city && <small>{stop.city}</small>}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="yd-hint">Nothing is lost when you move on: tap a place to bring it back.</p>
    </section>
  );
}

/**
 * Where a photo would be and none was found: a small travel poster of the
 * place's kind, sea, sun and swell, rather than a grey box with a letter.
 */
export function NoPhoto({ label, hint }: { label?: string; hint?: string }) {
  return (
    <span className="yd-nophoto" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="160" height="100" fill="var(--yd-sea)" />
        <circle cx="112" cy="40" r="22" fill="var(--yd-sun)" />
        <path d="M0 70c13-8 27-8 40 0s27 8 40 0 27-8 40 0 27 8 40 0v30H0z" fill="var(--yd-sea-soft)" />
        <path d="M0 82c13-6 27-6 40 0s27 6 40 0 27-6 40 0 27 6 40 0v18H0z" fill="var(--yd-paper)" fillOpacity=".14" />
        <path d="M18 34c10-12 24-16 38-12" fill="none" stroke="var(--yd-coral)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="1 6" />
      </svg>
      {label && <span className="yd-nophoto-text"><b>{label}</b>{hint && <small>{hint}</small>}</span>}
    </span>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="yd-quiet">{children}</p>;
}
