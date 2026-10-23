// The done moment: the student's logbook. Each challenge with the shot that
// cleared it, the range's own sentence and the lesson; a file to keep.
import { clearedCount, logbookText, shotCount, type Entry } from '../engine/logbook.ts';

export function saveLogbook(log: Entry[]) {
  const text = logbookText(log, new Date());
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `arcwise-logbook-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Logbook({ log, back, onBack }: { log: Entry[]; back: string; onBack: () => void }) {
  const cleared = clearedCount(log);
  const shots = shotCount(log);
  return (
    <section className="aw-logbook" aria-label="Your logbook">
      <header className="aw-logbook-head">
        <div>
          <p className="aw-eyebrow">Your logbook</p>
          <h1 className="aw-logbook-total"><b>{cleared}</b> of {log.length} cleared</h1>
          <p className="aw-logbook-sub">{shots === 0 ? 'No shots yet: the range is waiting.' : `${shots} shot${shots === 1 ? '' : 's'} on the range today.`}</p>
        </div>
        <div className="aw-logbook-actions">
          <button type="button" className="aw-secondary" onClick={() => saveLogbook(log)} disabled={shots === 0}>Save as a text file</button>
          <button type="button" className="aw-primary" onClick={onBack}>{back}</button>
        </div>
      </header>
      <ol className="aw-entries">
        {log.map((e, i) => (
          <li key={e.id} className={e.cleared ? 'is-cleared' : e.shots ? 'is-tried' : 'is-new'}>
            <span className="aw-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
            <div className="aw-entry">
              <h2>{e.name}</h2>
              {e.cleared ? (
                <>
                  <p className="aw-entry-status">Cleared on shot {e.cleared.shot}, at <b>{e.cleared.angle_deg}°</b> and <b>{e.cleared.speed_ms} m/s</b></p>
                  <p className="aw-entry-note">{e.cleared.note}</p>
                  {e.lesson && <p className="aw-entry-lesson">{e.lesson}</p>}
                </>
              ) : (
                <p className="aw-entry-status">{e.shots ? `Not cleared yet: ${e.shots} shot${e.shots === 1 ? '' : 's'}` : 'Not tried yet'}<span className="aw-entry-blurb"> · {e.blurb}</span></p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
