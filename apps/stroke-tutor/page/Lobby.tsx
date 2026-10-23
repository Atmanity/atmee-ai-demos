// Hanshi's front door: what it is, how a lesson goes, and the way in.
import { BackToApps } from '../../../src/kit/index.ts';
import ren from '../host/portrait.jpg';
import { HOST } from './Desk.tsx';

/** The mark: a vermilion seal with the practice grid and one brush stroke, 一. */
export function Logo() {
  return (
    <a className="hs-logo" href="./" aria-label="Hanshi home">
      <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
        <rect x="3" y="3" width="34" height="34" rx="4" fill="var(--hs-shu)" />
        <path d="M20 6v28M6 20h28" stroke="#fff" strokeOpacity=".38" strokeWidth="1.2" strokeDasharray="2 2.4" />
        <path d="M9.2 19.6c0-1.4 1-2 2.4-1.8l18.6 2c1.7.2 1.8 1.6.1 1.9l-18.7 2.5c-1.4.2-2.4-.4-2.4-1.7z" fill="#fff" />
      </svg>
      <span>Hanshi</span>
    </a>
  );
}

const STEPS: [string, string][] = [
  ['Pick a character', 'Seven to begin: from 一, a single stroke, to 永, the classic five-stroke exercise, plus the capitals A and E.'],
  ['Write it stroke by stroke', `${HOST} asks for each stroke by its number, never its shape, so you practise remembering it rather than tracing.`],
  ['Hear what to fix', `Wrong order, wrong direction, wrong starting point: the sheet catches it and ${HOST} explains. Miss twice and ${HOST} shows you.`],
];

/** The menu as the front door shows it (the page holds no character data; a test checks this against the lessons). */
export const MENU: [string, string, number][] = [['一', 'one', 1], ['十', 'ten', 2], ['川', 'river', 3], ['木', 'tree', 4], ['永', 'eternity', 5], ['A', 'letter A', 3], ['E', 'letter E', 4]];

/** The product at a glance: 山 (mountain, not one of the lessons) half written, with Ren's stroke in vermilion. */
function Showcase() {
  return (
    <div className="hs-showcase" aria-hidden="true">
      <div className="hs-showcase-sheet">
        <svg viewBox="0 0 1000 1000">
          <rect x="6" y="6" width="988" height="988" fill="none" stroke="var(--hs-shu)" strokeOpacity=".85" strokeWidth="6" />
          <path d="M500 0v1000M0 500h1000" stroke="var(--hs-shu)" strokeOpacity=".5" strokeWidth="3" strokeDasharray="12 14" />
          <path d="M0 0l1000 1000M1000 0L0 1000" stroke="var(--hs-shu)" strokeOpacity=".2" strokeWidth="3" strokeDasharray="2 16" />
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M500 170V790" stroke="var(--hs-sumi)" strokeWidth="54" />
            <path d="M215 380V790H790" stroke="var(--hs-sumi)" strokeWidth="50" />
            <path d="M790 330V790" stroke="var(--hs-shu)" strokeWidth="50" />
            <path d="M890 430V640M866 606l24 38 24-38" stroke="var(--hs-shu)" strokeWidth="9" />
          </g>
          <g fill="var(--hs-shu)" fontFamily="var(--hs-body)" fontWeight="700" fontSize="58" textAnchor="middle">
            <text x="500" y="112">1</text>
            <text x="215" y="320">2</text>
            <text x="790" y="272">3</text>
          </g>
        </svg>
      </div>
      <p className="hs-showcase-verdict"><b>Correct</b>Down, then across, in one stroke.</p>
      <p className="hs-showcase-ren"><img className="hs-showcase-face" src={ren} alt="" /><span><b>{HOST}</b>“Stroke three: watch the sheet.”</span></p>
    </div>
  );
}

export function Lobby({ onStart }: { onStart: (mic: boolean) => void }) {
  return (
    <div className="hs-lobby">
      <header className="hs-top is-lobby"><BackToApps /><Logo /></header>
      <main>
        <section className="hs-hero">
          <div className="hs-hero-copy">
            <p className="hs-host-credit">
              <img src={ren} alt="" />
              <span><span className="hs-eyebrow">Stroke-order lessons</span>Taught by <b>{HOST}</b>, a calligraphy teacher</span>
            </p>
            <h1>Write every character in the right order.</h1>
            <p className="hs-lede">{HOST}, a calm calligraphy teacher, watches you write one stroke at a time on a practice sheet, and tells you straight away when a stroke comes out of order or runs the wrong way. Your handwriting is never judged.</p>
            <div className="hs-cta">
              <button type="button" className="hs-primary is-big" onClick={() => onStart(true)}>Start with your voice</button>
              <button type="button" className="hs-secondary is-big" onClick={() => onStart(false)}>Start by typing</button>
            </div>
            <p className="hs-small">{HOST} listens through your microphone during the lesson. Draw with a finger, a stylus or a mouse. A lesson lasts up to 15 minutes.</p>
          </div>
          <Showcase />
        </section>

        <section className="hs-steps" aria-label="How a lesson goes">
          {STEPS.map(([title, text], i) => (
            <article key={title}><span className="hs-step-n">{i + 1}</span><h2>{title}</h2><p>{text}</p></article>
          ))}
        </section>

        <section className="hs-menu-strip" aria-label="On the menu">
          <h2>On the menu</h2>
          <ul>
            {MENU.map(([glyph, meaning, n]) => (
              <li key={glyph}><span className="hs-strip-glyph" lang={/[A-Z]/.test(glyph) ? undefined : 'ja'}>{glyph}</span><span>{meaning}</span><small>{n} stroke{n === 1 ? '' : 's'}</small></li>
            ))}
          </ul>
          <p>Hanshi grades the order and the direction of your strokes. Never their neatness.</p>
        </section>
      </main>
    </div>
  );
}
