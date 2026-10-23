// The trip, gathered: every country on the route with what it showed, and
// every sight looked at. Open any time from the top bar, and on its own when
// the call ends. Its notes download as plain text.
import type { Snapshot } from '../engine/types.ts';
import { sightsByPlace, type TripNotes } from './notes.ts';
import { projectRings } from './outline.ts';

export function TripSummary({ snapshot, notes, host, ended, onBack, onDownload, onNewTrip }: {
  snapshot: Snapshot | null;
  notes: TripNotes;
  host: string;
  ended: boolean;
  onBack: () => void;
  onDownload: () => void;
  onNewTrip: () => void;
}) {
  const stops = snapshot?.trip.visited ?? [];
  const places = sightsByPlace(notes);
  const empty = !stops.length && !places.length;
  const name = snapshot?.travelerName;
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <section className="yd-summary" aria-labelledby="yd-summary-title">
      <p className="yd-kicker">{ended ? 'Your call has ended' : 'So far'}</p>
      <h1 id="yd-summary-title">{name ? `${name}'s trip` : 'Your trip'}</h1>
      <p className="yd-coords">Dreamt up with {host} · {date}</p>

      {empty ? (
        <p className="yd-quiet">Nothing on your trip yet. Name a country, or a place to look around, and it starts here.</p>
      ) : (
        <>
          {stops.length > 0 && (
            <ol className="yd-timeline" aria-label="The route">
              {stops.map((stop) => {
                const kept = notes.countries[stop.country];
                const dishes = kept?.dishes.map((d) => d.name) ?? stop.dishes;
                const shape = stop.silhouette ? projectRings(stop.silhouette, 48, 3) : null;
                return (
                  <li key={stop.country}>
                    {shape ? (
                      <svg className="yd-stop-shape" viewBox={`0 0 ${shape.width} ${shape.height}`} aria-hidden="true">{shape.paths.map((d, i) => <path key={i} d={d} />)}</svg>
                    ) : <span className="yd-stop-dot" aria-hidden="true" />}
                    <div>
                      <h2>{stop.country}{stop.city && <small>{stop.city}</small>}</h2>
                      {dishes.length > 0 && <p><b>Eat</b> {dishes.join(' · ')}</p>}
                      {(kept?.headlines.length ?? 0) > 0 && <p><b>News</b> {kept!.headlines.length} headline{kept!.headlines.length === 1 ? '' : 's'} read</p>}
                      {!dishes.length && !kept?.headlines.length && <p className="yd-hint">On the map, nothing else yet.</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {places.map(([place, sights]) => (
            <section key={place} className="yd-summary-sights" aria-label={`Around ${place}`}>
              <h2 className="yd-kicker">Around {place}</h2>
              <ul>
                {sights.map((sight) => (
                  <li key={sight.name}>
                    {sight.mapsUrl ? <a href={sight.mapsUrl} target="_blank" rel="noreferrer">{sight.name}</a> : <span>{sight.name}</span>}
                    <small>{sight.category}{sight.distance ? `, ${sight.distance}` : ''}</small>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <div className="yd-summary-actions">
        <button type="button" className="yd-primary" onClick={onDownload} disabled={empty}>Download trip notes</button>
        <button type="button" className="yd-secondary" onClick={onBack}>Keep exploring</button>
        <button type="button" className="yd-textbutton" onClick={onNewTrip}>Start a new trip</button>
      </div>
    </section>
  );
}
