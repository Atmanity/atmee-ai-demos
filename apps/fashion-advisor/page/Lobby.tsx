// Notch's front door: what it is, how a fitting goes, and the way in. The
// visual is the product itself: the mirror, the tape that scores the look,
// and the tag with the one fix.
import { MicIcon } from '../../../src/kit/index.ts';
import { HOST } from '../engine/director.ts';
import portrait from '../host/portrait.jpg';
import exampleOutfit from './sample-outfit.jpg';

/** A tape measure with one notch cut out: the score, and the name. */
export function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" className="nt-mark">
      <rect x="2" y="12" width="36" height="16" rx="2.5" fill="var(--nt-tape)" />
      <path d="M7 12v6M12 12v4M17 12v6M27 12v6M32 12v4" stroke="var(--nt-ink)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M19.5 12 22 19.5 24.5 12z" fill="var(--nt-pin)" />
      <path d="M2 29.5h36" stroke="var(--nt-rose)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <a className="nt-logo" href="./" aria-label="Notch home">
      <Mark />
      <span>Notch</span>
    </a>
  );
}

const STEPS: [string, string][] = [
  ['Say where you’re going', 'A job interview, a summer wedding, a first date. Emery judges the outfit for that, not in general.'],
  ['Share one photo', 'Upload or drag in a photo of what you’re wearing, or borrow our example outfit. Emery sees the photo, never you.'],
  ['Get the verdict', 'A score out of 10, what’s working, the one fix, and the pieces that take it up a notch.'],
];

export function Lobby({ onStart }: { onStart: (mic: boolean) => void }) {
  return (
    <div className="nt-lobby">
      <header className="nt-top is-lobby"><Logo /></header>
      <main className="nt-hero">
        <div className="nt-hero-copy">
          <p className="nt-stylist">
            {/* Her name is beside it, so the face is decoration to a screen reader. */}
            <img src={portrait} alt="" />
            <span><span className="nt-label">Your stylist</span><span><b>{HOST}</b>, ex-runway, styling on call</span></span>
          </p>
          <h1>Is this the outfit? <em>Ask {HOST}.</em></h1>
          <p className="nt-lede">
            Show {HOST} a photo of what you’re wearing and tell her where you’re going. She scores it for the occasion,
            tells you what’s working and the one thing to fix, then pulls the pieces that would finish it.
          </p>
          <div className="nt-cta">
            <button type="button" className="nt-primary is-big" onClick={() => onStart(true)}><MicIcon /> Talk to {HOST}</button>
            <button type="button" className="nt-secondary is-big" onClick={() => onStart(false)}>Chat by typing</button>
          </div>
          <p className="nt-small">Your microphone is used only during the fitting. Nothing opens your camera: you share a photo.</p>
        </div>
        <figure className="nt-hero-visual" aria-hidden="true">
          <div className="nt-mirror-frame is-hero">
            <img src={exampleOutfit} alt="" />
          </div>
          <div className="nt-hero-score">
            <span className="nt-hero-score-n">7<small>/10</small></span>
            <span className="nt-hero-score-for">for dinner out</span>
            <span className="nt-hero-tape"><i style={{ width: '70%' }} /></span>
          </div>
          <div className="nt-hangtag is-fix is-hero">
            <span className="nt-label">The one fix</span>
            <p>Finish the neckline: a fine chain lifts the plain tee.</p>
          </div>
        </figure>
      </main>
      <section className="nt-steps" aria-label="How a fitting works">
        {STEPS.map(([title, text], i) => (
          <article key={title}>
            <span className="nt-step-n">{String(i + 1).padStart(2, '0')}</span>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
