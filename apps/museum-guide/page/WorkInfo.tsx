// A work's whole entry: its picture, date, medium, where the original hangs,
// its story, what to look for and the next work on the route. The map opens it
// from a pin; the tour opens it as Edmund starts on a work, over the camera.
import type { ReactNode } from 'react';
import { exhibitById, type Exhibit } from '../engine/catalogue.ts';
import { exhibitImage } from './images.ts';

export const Tick = ({ size = 12 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export function WorkInfo({ exhibit, seen, here, back, onBack, onOpen, onAsk, onToggleSeen, children }: {
  exhibit: Exhibit;
  seen: boolean;
  here: boolean;
  /** The way out, in words: "‹ All works", "Back to camera". */
  back: string;
  onBack: () => void;
  onOpen: (e: Exhibit) => void;
  /** While Edmund is on the call: put a question about this work to him. */
  onAsk?: (e: Exhibit) => void;
  onToggleSeen?: (e: Exhibit, seen: boolean) => void;
  /** More actions beside Ask and Seen (a guest to meet). */
  children?: ReactNode;
}) {
  const next = exhibitById(exhibit.next);
  return (
    <article className="mr-detail" aria-label={exhibit.title}>
      <button type="button" className="mr-link mr-detail-back" onClick={onBack}>{back}</button>
      <img className="mr-detail-img" src={exhibitImage(exhibit)} alt={`${exhibit.title}, ${exhibit.artist}`} />
      <p className="mr-card-where">{here ? 'You are here · ' : ''}{exhibit.gallery}</p>
      <h2>{exhibit.title}</h2>
      <p className="mr-detail-by">{exhibit.artist} · {exhibit.date}</p>
      <p className="mr-detail-medium">{exhibit.medium}. The original hangs in {exhibit.original}.</p>
      <div className="mr-detail-actions">
        {children}
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
