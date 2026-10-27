// Requisition's front door: what the Supply window is, how a visit goes, and the way in.
import { BackToApps } from '../../../src/kit/index.ts';
import hester from '../host/portrait.jpg';
import scene from '../host/scene.jpg';

export function Logo() {
  return (
    <a className="rq-logo" href="./" aria-label="Requisition home">
      <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <circle cx="20" cy="20" r="12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2.2" />
        <text x="20" y="24.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="currentColor" fontFamily="Big Shoulders Stencil Display, sans-serif">18</text>
      </svg>
      <span>Requisition</span>
    </a>
  );
}

const STEPS: [string, string][] = [
  ['Ask for it', 'Name what you need. Hester checks the shelves, and the row lights up in the stores ledger.'],
  ['Department and reason', 'Nothing leaves Supply without both. Some stock goes only to certain departments.'],
  ['Leave with a slip', 'Stamped and paid in chits, or refused with the reason written on it. You have 30 chits.'],
];

export function Lobby({ onStart }: { onStart: (mic: boolean) => void }) {
  return (
    <div className="rq-lobby">
      <header className="rq-top is-lobby"><BackToApps /><Logo /></header>
      <main className="rq-hero">
        <div className="rq-hero-copy">
          <p className="rq-host-chip"><img src={hester} alt="" /><span>Behind the counter: <b>Hester Pell</b>, Supply manager</span></p>
          <h1>Supply. Name, department, and what you're after.</h1>
          <p className="rq-lede">Silo 18's supply window. Hester has run it for twenty-two years and knows the ledger down to the last bolt. Ask for what you need and give her a reason. She'll stamp your slip, or tell you why not.</p>
          <div className="rq-cta">
            <button type="button" className="rq-primary is-big" onClick={() => onStart(true)}>Step up and talk</button>
            <button type="button" className="rq-secondary is-big" onClick={() => onStart(false)}>Step up and type</button>
          </div>
          <p className="rq-small">Talking uses your microphone while you're at the window. A visit takes a few minutes.</p>
        </div>
        <div className="rq-hero-scene" aria-hidden="true">
          <div className="rq-room">
            <img className="rq-plate-img" src={scene} alt="" draggable={false} />
            <div className="rq-glass">
              <div className="rq-host-video"><img className="call-poster" src={hester} alt="" /></div>
              <div className="rq-tube"><i className="rq-roll" /><i className="rq-grain" /></div>
            </div>
          </div>
        </div>
      </main>
      <section className="rq-steps" aria-label="How a visit goes">
        {STEPS.map(([title, text], i) => (
          <article key={title}><span className="rq-step-n">{i + 1}</span><h2>{title}</h2><p>{text}</p></article>
        ))}
      </section>
    </div>
  );
}
