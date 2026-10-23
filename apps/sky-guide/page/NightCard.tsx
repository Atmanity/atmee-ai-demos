// Your night: what you looked at, where to look for it, from that place at
// that hour. A list during the call; when the call ends, a card to keep.
import { byPlaceAndTime, nightFileName, nightText, type NightEntry } from '../engine/night.ts';

/** Save the list as a plain-text file. */
export function download(night: NightEntry[]): void {
  const url = URL.createObjectURL(new Blob([nightText(night)], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nightFileName(night);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The lines, grouped by place and hour. */
export function NightList({ night, host }: { night: NightEntry[]; host: string }) {
  if (!night.length) {
    return (
      <section className="ls-card is-empty" aria-label="Your night">
        <p className="ls-kicker">Your night</p>
        <p className="ls-card-lede">Every star you mark and every constellation {host} draws lands here, with where to look for it.</p>
      </section>
    );
  }
  return (
    <section className="ls-card is-night" aria-label="Your night">
      {byPlaceAndTime(night).map((group) => (
        <div key={`${group.place}|${group.when}`} className="ls-night-group">
          <p className="ls-kicker">{group.place} · {group.when}</p>
          <ul>
            {group.entries.map((e) => (
              <li key={e.id} className={`is-${e.kind}`}>
                <b>{e.name}</b>
                <span className="ls-night-where">{e.where}</span>
                <span className="ls-night-note">{e.note}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <button type="button" className="ls-secondary" onClick={() => download(night)}>Download the list</button>
    </section>
  );
}

/** The end of the call: the night, to keep. */
export function NightCard({ night, host, onAgain, onClose }: { night: NightEntry[]; host: string; onAgain: () => void; onClose: () => void }) {
  const places = new Set(night.map((e) => e.place));
  return (
    <section className="ls-done" aria-label="Your night under the stars">
      <div className="ls-done-head">
        <p className="ls-eyebrow">Clear skies</p>
        <h2>{night.length ? 'Your night under the stars' : 'Nothing on your list this time'}</h2>
        <p className="ls-done-sub">
          {night.length
            ? `${night.length} thing${night.length === 1 ? '' : 's'} you looked at${places.size > 1 ? `, from ${places.size} places` : ''}, with where to look. Take it outside.`
            : `Mark a star or ask ${host} for a constellation next time, and it will be here to take outside.`}
        </p>
      </div>
      {night.length > 0 && (
        <ol className="ls-done-list">
          {night.map((e) => (
            <li key={e.id}>
              <span className="ls-done-name">{e.name}{e.kind === 'figure' && <small>constellation</small>}</span>
              <span className="ls-done-where">{e.where}</span>
              <span className="ls-done-when">{e.place} · {e.when}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="ls-done-actions">
        {night.length > 0 && <button type="button" className="ls-primary" onClick={() => download(night)}>Download the list</button>}
        <button type="button" className="ls-secondary" onClick={onAgain}>Call {host} again</button>
        <button type="button" className="ls-quiet" onClick={onClose}>Back to the chart</button>
      </div>
    </section>
  );
}
