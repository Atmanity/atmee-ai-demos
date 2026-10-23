// Postmark's board: the postcard (the mystery photo, stamped with the round),
// the three sealed clues, and the end-of-game summary. It shows only what the
// server's view holds, so it can never show the answer early.
import { hintCost, roundValue } from '../engine/game.ts';
import type { Command } from '../engine/judge.ts';
import type { View } from '../engine/types.ts';

export function Postcard({ view, failed = false, onRetry }: { view: View | null; failed?: boolean; onRetry?: () => void }) {
  if (!view && failed) {
    return (
      <figure className="pm-card is-failed">
        <div className="pm-photo">
          <span className="pm-dealing">The cities didn't arrive.</span>
          {onRetry && <button type="button" className="pm-primary" onClick={onRetry}>Deal again</button>}
        </div>
      </figure>
    );
  }
  if (!view) {
    return (
      <figure className="pm-card is-loading" aria-busy="true">
        <div className="pm-photo"><span className="pm-dealing">Marco is picking your cities…</span></div>
      </figure>
    );
  }
  const round = Math.min(view.round, view.rounds);
  return (
    <figure className={`pm-card ${view.revealed ? 'is-revealed' : ''}`}>
      <div className="pm-photo">
        {view.photo
          ? <img key={view.photo} src={view.photo} alt={view.city ? `${view.city.name}, ${view.city.country}` : 'The mystery city'} />
          : <span className="pm-nophoto" aria-label="No photo for this city">?</span>}
        <div className="pm-postmark" aria-hidden="true">
          <span>Round</span><b>{round}</b><span>of {view.rounds}</span>
        </div>
      </div>
      <figcaption className="pm-caption">
        {view.city ? (
          <>
            <p className="pm-place">{view.city.name}<span>{view.city.country}</span></p>
            <p className="pm-fact">{view.city.funFact}</p>
          </>
        ) : (
          <p className="pm-ask">Where in the world is this?</p>
        )}
      </figcaption>
    </figure>
  );
}

export function Clues({ view, busy, live, onCommand }: { view: View | null; busy: boolean; live: boolean; onCommand: (c: Command) => void }) {
  if (!view || view.over) return null;
  const used = view.hints.length;
  const disabled = busy || !live;
  return (
    <section className="pm-clues" aria-label="Clues">
      <ol>
        {Array.from({ length: view.hintsTotal }, (_, i) => {
          const text = view.hints[i];
          if (text) return <li key={i} className="pm-clue is-open"><span className="pm-clue-n">Clue {i + 1}</span><p>{text}</p></li>;
          const nextUp = i === used && !view.revealed;
          return (
            <li key={i} className="pm-clue is-sealed">
              {nextUp ? (
                <button type="button" onClick={() => onCommand('hint')} disabled={disabled}>
                  <span className="pm-clue-n">Clue {i + 1}</span>
                  <span>Open it{hintCost(used) > 0 ? ` · −${hintCost(used)} point` : ''}</span>
                </button>
              ) : (
                <span className="pm-sealed"><span className="pm-clue-n">Clue {i + 1}</span><span>Sealed</span></span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="pm-actions">
        {view.revealed ? (
          <button type="button" className="pm-primary" onClick={() => onCommand('next')} disabled={disabled}>
            {view.round >= view.rounds ? 'See your score' : 'Next city'} <span aria-hidden="true">→</span>
          </button>
        ) : (
          <>
            <span className="pm-worth">A right guess is worth <b>{roundValue(used)}</b> point{roundValue(used) === 1 ? '' : 's'}</span>
            <button type="button" className="pm-quiet" onClick={() => onCommand('skip')} disabled={disabled}>I give up</button>
          </>
        )}
      </div>
    </section>
  );
}

export function Summary({ view, live, busy, onAgain }: { view: View; live: boolean; busy: boolean; onAgain: () => void }) {
  const max = view.rounds * 4;
  return (
    <section className="pm-summary" aria-label="Your score">
      <p className="pm-eyebrow">Trip complete</p>
      <p className="pm-total"><b>{view.score}</b> / {max} points</p>
      <ol className="pm-results">
        {view.results.map((r, i) => (
          <li key={i} className={r.correct ? 'is-right' : 'is-missed'}>
            <span className="pm-result-mark" aria-hidden="true">{r.correct ? '✓' : '–'}</span>
            <span className="pm-result-place">{r.name}<small>{r.country}</small></span>
            <span className="pm-result-points">{r.correct ? `+${r.points}` : 'missed'}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="pm-primary" onClick={onAgain} disabled={busy}>{live ? 'Play three new cities' : 'Play again'}</button>
    </section>
  );
}
