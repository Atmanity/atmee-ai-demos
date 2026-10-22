// The travel board, from the original mini-app panel: the map, the latest
// headlines and the dishes for a planned country, or one nearby spot at a
// time; the trip strip under both. New here: a finder (a destination box with
// ideas and "surprise me", a place box with "use my location") and a map you
// can tap, so every action the guide could take by voice has a control.
import { useState, type FormEvent } from 'react';
import { ideasFor } from '../engine/countries.ts';
import type { Action, Dish, FoodView, MapConfig, NewsView, Snapshot, SpotView, TripView } from '../engine/types.ts';
import { describeBounds, projectRings } from './outline.ts';
import { TravelMap, type MapMode } from './TravelMap.tsx';

/** What the copy calls the person on screen: the app is not told the avatar's name. */
const WHO = 'your guide';

export function Board({ snapshot, config, busy, onAction }: {
  snapshot: Snapshot | null;
  config: MapConfig | null;
  busy: boolean;
  onAction: (action: Action) => void;
}) {
  if (!snapshot || !config) {
    return (
      <div className="board">
        <header className="board__head"><h1 className="board__title">Travel</h1></header>
        <div className="lobby"><span className="spinner" /><span>Unfolding the map…</span></div>
      </div>
    );
  }

  const tab = snapshot.stage === 'around' ? 'around' : 'planning';
  const mode: MapMode = tab === 'around' && snapshot.spot ? 'around' : snapshot.map ? 'country' : 'world';

  return (
    <div className="board">
      <header className="board__head">
        <h1 className="board__title">Travel</h1>
        {snapshot.travelerName && <span className="board__who">Hello {snapshot.travelerName}</span>}
      </header>

      <Finder snapshot={snapshot} tab={tab} busy={busy} onAction={onAction} />

      <section className="block">
        <MapHeading snapshot={snapshot} mode={mode} />
        <TravelMap
          config={config} mode={mode} map={snapshot.map} spots={snapshot.spot}
          onPick={(what, lat, lon) => onAction(what === 'destination' ? { kind: 'destinationAt', lat, lon } : { kind: 'coords', lat, lon })}
          onSpot={(index) => onAction({ kind: 'goto', index })}
        />
        <p className="map__hint">Tap the map to plan a trip there, or to see what is around that spot.</p>
      </section>

      {tab === 'around' ? (
        <Around view={snapshot.spot} busy={busy} onAction={onAction} />
      ) : snapshot.map ? (
        <Planning snapshot={snapshot} busy={busy} onAction={onAction} />
      ) : (
        <Welcome name={snapshot.travelerName} onName={(name) => onAction({ kind: 'name', name })} />
      )}

      {/* The trip lives OUTSIDE the stage branches on purpose: it is the one
          thing that survives switching country, and hiding it while looking
          around a street would hide the only proof the earlier half of the
          call happened at all. */}
      <Trip trip={snapshot.trip} busy={busy} onRevisit={(country) => onAction({ kind: 'revisit', country })} />
    </div>
  );
}

function Finder({ snapshot, tab, busy, onAction }: { snapshot: Snapshot; tab: 'planning' | 'around'; busy: boolean; onAction: (a: Action) => void }) {
  const [destination, setDestination] = useState('');
  const [place, setPlace] = useState('');
  const [locating, setLocating] = useState('');
  const visited = snapshot.trip.visited.map((v) => v.country);
  const ideas = ideasFor(snapshot.continent, visited).slice(0, 6);

  const go = (e: FormEvent) => {
    e.preventDefault();
    if (!destination.trim()) return;
    onAction({ kind: 'search', query: destination.trim() });
    setDestination('');
  };
  const look = (e: FormEvent) => {
    e.preventDefault();
    if (!place.trim()) return;
    onAction({ kind: 'around', place: place.trim() });
    setPlace('');
  };
  // The original's "use my location" was a sealed seam: its sandboxed iframe had no geolocation. This page does.
  const locate = () => {
    if (!navigator.geolocation) return setLocating('This browser cannot share a location; type where you are instead.');
    setLocating('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(''); onAction({ kind: 'coords', lat: pos.coords.latitude, lon: pos.coords.longitude }); },
      () => setLocating('No location was shared; type where you are instead.'),
      { timeout: 15000, maximumAge: 300000 },
    );
  };

  return (
    <section className="finder">
      <div className="finder__tabs" role="tablist" aria-label="What to do">
        <button type="button" role="tab" aria-selected={tab === 'planning'} className="finder__tab" onClick={() => tab !== 'planning' && onAction({ kind: 'show', stage: 'planning' })}>Plan a trip</button>
        <button type="button" role="tab" aria-selected={tab === 'around'} className="finder__tab" onClick={() => tab !== 'around' && onAction({ kind: 'show', stage: 'around' })}>Around me</button>
      </div>
      {tab === 'planning' ? (
        <>
          <form className="finder__row" onSubmit={go}>
            <input className="finder__input" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Where are you dreaming of? A country, or a city in one" aria-label="Destination" />
            <button className="btn btn--primary" type="submit" disabled={busy || !destination.trim()}>Go</button>
            <button className="btn" type="button" disabled={busy} onClick={() => onAction({ kind: 'pick' })}>Surprise me</button>
          </form>
          <div className="ideas">
            <span className="ideas__label">{snapshot.continent ? `Ideas in ${snapshot.continent}` : 'Ideas'}</span>
            {ideas.map((country) => (
              <button key={country} type="button" className="chip" disabled={busy} onClick={() => onAction({ kind: 'destination', country })}>{country}</button>
            ))}
          </div>
        </>
      ) : (
        <>
          <form className="finder__row" onSubmit={look}>
            <input className="finder__input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Where are you? A town, neighbourhood or station" aria-label="Where you are" />
            <button className="btn btn--primary" type="submit" disabled={busy || !place.trim()}>Look around</button>
            <button className="btn" type="button" disabled={busy} onClick={locate}>Use my location</button>
          </form>
          {locating && <p className="muted">{locating}</p>}
        </>
      )}
    </section>
  );
}

function MapHeading({ snapshot, mode }: { snapshot: Snapshot; mode: MapMode }) {
  if (mode === 'around' && snapshot.spot) {
    const v = snapshot.spot;
    return <div className="eyebrow">Around {v.place}{v.total > 1 && <span className="eyebrow__sub">{v.index + 1} of {v.total}</span>}</div>;
  }
  if (mode === 'country' && snapshot.map) {
    const m = snapshot.map;
    return (
      <div className="eyebrow">
        <span>{m.country}{m.city && <span className="eyebrow__city"> · {m.city}</span>}</span>
        <span className="eyebrow__sub">{describeBounds(m.center, m.bbox)}</span>
      </div>
    );
  }
  return <div className="eyebrow">The world{snapshot.continent && <span className="eyebrow__sub">drawn to {snapshot.continent}</span>}</div>;
}

function Welcome({ name, onName }: { name: string; onName: (name: string) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <section className="empty">
      <h2>{name ? `Hello ${name}` : 'Where shall we go?'}</h2>
      <p>
        Say where you are dreaming of and the country appears here, with the latest headlines and what to eat.
        Or say where you are now, and something worth seeing nearby turns up.
      </p>
      {!name && (
        <form className="name" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) onName(draft.trim()); setDraft(''); }}>
          <input className="finder__input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What should we call you?" aria-label="Your name" maxLength={60} />
          <button className="btn" type="submit" disabled={!draft.trim()}>Save</button>
        </form>
      )}
    </section>
  );
}

function Planning({ snapshot, busy, onAction }: { snapshot: Snapshot; busy: boolean; onAction: (a: Action) => void }) {
  return (
    <div className="planning">
      <Headlines news={snapshot.news} available={snapshot.newsAvailable} busy={busy} onShow={() => onAction({ kind: 'news' })} />
      <Food food={snapshot.food} busy={busy} onShow={() => onAction({ kind: 'food' })} />
    </div>
  );
}

function Headlines({ news, available, busy, onShow }: { news: NewsView | null; available: boolean; busy: boolean; onShow: () => void }) {
  return (
    <section className="block">
      {/* Not "Today's": the provider is asked for the newest five with no date filter, so their age is unknown. */}
      <div className="eyebrow">Latest headlines</div>
      {!available ? (
        <p className="muted">No news source is set up for this board (it needs a WorldNews key), so there are no headlines.</p>
      ) : news?.shown ? (
        news.headlines.length ? (
          <ul className="news">
            {news.headlines.map((h, i) => (
              <li key={`${i}-${h.title}`} className="news__item">
                {h.url ? (
                  <a href={h.url} target="_blank" rel="noreferrer"><span className="news__title">{h.title}</span><span className="news__source">{h.source}</span></a>
                ) : (
                  <><span className="news__title">{h.title}</span><span className="news__source">{h.source}</span></>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No fresh headlines came back for {news.country}.</p>
        )
      ) : (
        <button type="button" className="reveal" disabled={busy} onClick={onShow}>{news?.loading ? 'Pulling the headlines…' : 'Show the latest headlines'}</button>
      )}
    </section>
  );
}

function Food({ food, busy, onShow }: { food: FoodView | null; busy: boolean; onShow: () => void }) {
  return (
    <section className="block">
      <div className="eyebrow">What they eat</div>
      {food?.shown ? (
        food.dishes.length ? (
          <div className="dishes">{food.dishes.map((dish, i) => <DishCard key={`${i}-${dish.name}`} dish={dish} />)}</div>
        ) : (
          <p className="muted">No dish ideas came back for {food.country}.</p>
        )
      ) : (
        <button type="button" className="reveal" disabled={busy} onClick={onShow}>{food?.loading ? 'Finding dishes…' : 'What should I eat there?'}</button>
      )}
    </section>
  );
}

function DishCard({ dish }: { dish: Dish }) {
  return (
    <article className="dish">
      <div className="dish__thumb">
        {dish.imageUrl ? (
          <img src={dish.imageUrl} alt={dish.name} loading="lazy" />
        ) : (
          // No photo is normal: only when Wikipedia has one. The initial keeps the grid from collapsing.
          <span className="dish__initial" aria-hidden="true">{dish.name.slice(0, 1)}</span>
        )}
      </div>
      <div className="dish__meta">
        <h4>{dish.name}</h4>
        {dish.description && <p>{dish.description}</p>}
      </div>
    </article>
  );
}

function Around({ view, busy, onAction }: { view: SpotView | null; busy: boolean; onAction: (a: Action) => void }) {
  if (!view) {
    return (
      <section className="empty">
        <h2>Where are you?</h2>
        <p>Say the town, neighbourhood or station you are near (or type it above, share your location, or tap the map), and the area around it gets a look.</p>
      </section>
    );
  }
  if (!view.spot) {
    return (
      <section className="empty">
        <h2>Around {view.place}</h2>
        <p>
          {view.lookupFailed
            ? `The places service is not answering right now. Ask ${WHO} to try again in a moment.`
            : `Nothing stands out right next to you. Ask ${WHO} to plan a trip instead.`}
        </p>
      </section>
    );
  }

  const spot = view.spot;
  const hasMore = view.total > 0 && view.index < view.total - 1;
  return (
    <section className="block">
      <a className="spot" href={spot.mapsUrl || undefined} target="_blank" rel="noreferrer" title="Open in Google Maps">
        <div className="spot__image">
          {spot.imageUrl ? <img key={spot.imageUrl} src={spot.imageUrl} alt={spot.name} /> : <span className="spot__initial" aria-hidden="true">{spot.name.slice(0, 1)}</span>}
        </div>
        <div className="spot__meta">
          <span className="spot__category">{spot.category}</span>
          <h3>{spot.name}</h3>
          {spot.distance && <p className="spot__distance">{spot.distance}</p>}
          {spot.summary && <p className="spot__summary">{spot.summary}</p>}
          <span className="spot__hint">Tap to open in Google Maps</span>
        </div>
      </a>
      {/* Two buttons, not one: the queue used to run forwards only, so a spot you liked and passed was gone. */}
      <div className="spot__nav">
        <button type="button" className="next next--back" onClick={() => onAction({ kind: 'previous' })} disabled={busy || view.index === 0}>Previous</button>
        <button type="button" className="next" onClick={() => onAction({ kind: 'next' })} disabled={busy || !hasMore}>{hasMore ? 'Next spot' : 'No more spots nearby'}</button>
      </div>
    </section>
  );
}

function Trip({ trip, busy, onRevisit }: { trip: TripView; busy: boolean; onRevisit: (country: string) => void }) {
  // One country is not a trip, it is where you are: the strip would just repeat the heading above the map.
  if (trip.visited.length < 2) return null;
  return (
    <section className="block trip">
      <div className="eyebrow">Your trip so far</div>
      <ul className="trip__list">
        {trip.visited.map((stop) => {
          const here = stop.country === trip.current;
          const shape = stop.silhouette ? projectRings(stop.silhouette, 40, 3) : null;
          return (
            <li key={stop.country}>
              <button type="button" className={here ? 'trip__stop trip__stop--here' : 'trip__stop'} disabled={busy || here} onClick={() => onRevisit(stop.country)} title={here ? 'You are here' : `Back to ${stop.country}`}>
                {shape && (
                  <svg className="trip__shape" viewBox={`0 0 ${shape.width} ${shape.height}`} aria-hidden="true">
                    {shape.paths.map((d, i) => <path key={i} d={d} />)}
                  </svg>
                )}
                <span className="trip__text">
                  <span className="trip__country">{stop.country}</span>
                  {stop.city && <span className="trip__city">{stop.city}</span>}
                  <span className="trip__kept">
                    {stop.dishes.length > 0 ? stop.dishes.join(' · ') : stop.headlineCount > 0 ? `${stop.headlineCount} headlines` : 'on the map'}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted trip__hint">Nothing is lost when you move on: tap a place to put it back, or just ask {WHO}.</p>
    </section>
  );
}
