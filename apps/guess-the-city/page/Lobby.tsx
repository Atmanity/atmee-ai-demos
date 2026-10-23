// Postmark's front door: what the game is, how to play, and the way in.
import marco from '../host/portrait.jpg';

export function Logo() {
  return (
    <a className="pm-logo" href="./" aria-label="Postmark home">
      <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="3 2.4" />
        <circle cx="20" cy="20" r="11" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M5 26c5-3 9-3 15 0s10 3 15 0" fill="none" stroke="var(--pm-red)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span>Postmark</span>
    </a>
  );
}

const STEPS: [string, string][] = [
  ['Look at the postcard', 'A photo of a real city, and nothing else. Marco can\'t see it either.'],
  ['Guess, or open a clue', 'Say a city out loud or type it. Each clue you open costs a point.'],
  ['Score your trip', 'Three cities, up to 4 points each for a cold guess.'],
];

export function Lobby({ onPlay }: { onPlay: (mic: boolean) => void }) {
  return (
    <div className="pm-lobby">
      <header className="pm-top is-lobby"><Logo /></header>
      <main className="pm-hero">
        <div className="pm-hero-copy">
          <p className="pm-host-chip"><img src={marco} alt="" /><span>Hosted by <b>Marco</b></span></p>
          <h1>One photo. Three clues. Where in the world?</h1>
          <p className="pm-lede">Marco, a well-travelled host, deals you three mystery cities. Guess from the photo alone for full points, or open a clue when you're stuck.</p>
          <div className="pm-cta">
            <button type="button" className="pm-primary is-big" onClick={() => onPlay(true)}>Play with your voice</button>
            <button type="button" className="pm-secondary is-big" onClick={() => onPlay(false)}>Play by typing</button>
          </div>
          <p className="pm-small">Voice play uses your microphone while the game is on. A round takes about two minutes.</p>
        </div>
        <div className="pm-stack" aria-hidden="true">
          <div className="pm-mini is-a"><span>?</span></div>
          <div className="pm-mini is-b"><span>?</span></div>
          <div className="pm-mini is-c"><span>?</span><i className="pm-mini-mark">Round 1</i></div>
        </div>
      </main>
      <section className="pm-steps" aria-label="How to play">
        {STEPS.map(([title, text], i) => (
          <article key={title}><span className="pm-step-n">{i + 1}</span><h2>{title}</h2><p>{text}</p></article>
        ))}
      </section>
    </div>
  );
}
