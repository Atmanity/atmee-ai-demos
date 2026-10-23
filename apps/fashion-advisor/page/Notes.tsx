// The end of a fitting: the notes. The verdict that stands, every rating of
// the fitting, and the pieces to look for, with a copy to keep. They open
// when the call ends (and any time from the header once there is a verdict).
import { useEffect, useRef } from 'react';
import { HOST } from '../engine/director.ts';
import { itemsMatch } from '../engine/items.ts';
import type { View } from '../engine/types.ts';
import { ArrowIcon, Tape } from './Fitting.tsx';

/** One verdict of the fitting, as it landed. */
export interface Rating { occasion: string; score: number; summary: string; with?: string }

/** The pieces worth looking for: the ones tried first, then the rest of the rail. */
function shoppingList(view: View) {
  const a = view.analysis;
  if (!a) return [];
  const tried = a.suggestions.filter((s) => a.tried_items.some((t) => itemsMatch(t, s.item)));
  const rest = a.suggestions.filter((s) => !tried.includes(s));
  return [...tried, ...rest].slice(0, 8);
}

/** The notes as plain text, for the download. */
export function notesText(view: View, ratings: Rating[]): string {
  const a = view.analysis;
  const lines = ['NOTCH · FITTING NOTES', ''];
  if (view.target) lines.push(`Dressing for: ${view.target}`);
  if (a) {
    lines.push(`Verdict: ${a.style_score}/10, "${a.style_summary}"${view.image?.kind === 'tryon' ? ` (with the ${view.image.item})` : ''}`);
    lines.push('', `What works: ${a.what_works}`, `The one fix: ${a.style_tip}`);
  }
  if (ratings.length) {
    lines.push('', 'Ratings this fitting:');
    for (const r of ratings) lines.push(`  ${r.score}/10 for ${r.occasion}${r.with ? `, with the ${r.with}` : ''}`);
  }
  const pieces = shoppingList(view);
  if (pieces.length) {
    lines.push('', 'Pieces to look for:');
    for (const p of pieces) lines.push(`  ${p.item}: ${p.text}${p.amazon_search_url ? `\n    ${p.amazon_search_url}` : ''}`);
  }
  lines.push('', `Styled with ${HOST} on Notch.`);
  return lines.join('\n');
}

function download(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'notch-fitting-notes.txt';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Notes({ view, ratings, ended, onClose, onNewFitting }: {
  view: View;
  ratings: Rating[];
  /** The call is over: the notes are the fitting's ending, not a peek. */
  ended: boolean;
  onClose: () => void;
  onNewFitting: () => void;
}) {
  const sheet = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Focus moves into the notes once, when they open; Escape closes them.
  useEffect(() => {
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const a = view.analysis;
  const pieces = shoppingList(view);
  return (
    <div className="nt-sheet-backdrop" onClick={onClose}>
      <section className="nt-sheet" role="dialog" aria-modal="true" aria-labelledby="nt-notes-title" tabIndex={-1} ref={sheet} onClick={(e) => e.stopPropagation()}>
        <p className="nt-eyebrow">{ended ? 'Your fitting is done' : 'Fitting notes'}</p>
        <h2 id="nt-notes-title">{view.target ? `Your look for ${view.target.toLowerCase()}` : 'Your look'}</h2>
        <div className="nt-notes-top">
          {view.image && <img className="nt-notes-photo" src={view.image.url} alt={view.image.kind === 'tryon' ? `Your outfit with the ${view.image.item}` : 'Your outfit'} />}
          {a ? (
            <div className="nt-notes-verdict">
              <p className="nt-score is-small"><b>{a.style_score}</b><span>/10</span></p>
              <Tape score={a.style_score} />
              <p className="nt-summary is-small">{a.style_summary}</p>
              <p><span className="nt-label">What works</span> {a.what_works}</p>
              <p><span className="nt-label is-fix">The one fix</span> {a.style_tip}</p>
            </div>
          ) : (
            <p className="nt-verdict-lede">No verdict yet: add a photo and say what you’re dressing for.</p>
          )}
        </div>
        {ratings.length > 1 && (
          <>
            <h3 className="nt-notes-h">Ratings this fitting</h3>
            <ol className="nt-ratings">
              {ratings.map((r, i) => <li key={i}><b>{r.score}</b><span>/10 for {r.occasion}{r.with ? `, with the ${r.with}` : ''}</span></li>)}
            </ol>
          </>
        )}
        {pieces.length > 0 && (
          <>
            <h3 className="nt-notes-h">Pieces to look for</h3>
            <ul className="nt-shoplist">
              {pieces.map((p) => (
                <li key={p.item}>
                  <span><b>{p.item}</b> {p.text}</span>
                  {p.amazon_search_url && <a className="nt-shop" href={p.amazon_search_url} target="_blank" rel="noreferrer" aria-label={`Shop ${p.item}`}>Shop <ArrowIcon /></a>}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="nt-sheet-actions">
          {a && <button type="button" className="nt-primary" onClick={() => download(notesText(view, ratings))}>Download notes</button>}
          <button type="button" className="nt-secondary" onClick={onNewFitting}>Start a new fitting</button>
          <button type="button" className="nt-quiet" onClick={onClose}>{ended ? 'Back to the fitting room' : 'Close'}</button>
        </div>
      </section>
    </div>
  );
}
