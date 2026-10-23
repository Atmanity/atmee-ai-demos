// Outcry's front door: what it is, who you will talk to, how it works, and the way in.
import reese from '../host/portrait.jpg';

/** The mark: a pit trader's badge in oxblood, clipped on, with a brass tick across it. */
export function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" className="oc-mark">
      <rect x="15" y="2.5" width="10" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <rect x="3" y="8" width="34" height="29" rx="4" fill="currentColor" />
      <path d="M9 28.5l6-6.5 5 4 7.5-10 4.5 3.5" fill="none" stroke="var(--oc-brass-lit)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <a className="oc-logo" href="./" aria-label="Outcry home">
      <Mark />
      <span>Outcry</span>
    </a>
  );
}

const STEPS: [string, string][] = [
  ['Call out a stock', 'Say “put Nvidia up”, or type a ticker. Your board has six slots.'],
  ['Reese reads the tape', 'The last sale, today’s move, the 52-week range and how old each print is. The stock on watch refreshes every minute.'],
  ['Facts, never tips', 'Ask what a company makes or which moved more. Ask what to buy and Reese says it straight: “I read the tape, I don’t give advice.”'],
];

/** The product in miniature: a board filling in, and the line Reese never crosses. No real numbers: a picture is not a quote. */
function Preview() {
  return (
    <figure className="oc-preview" aria-hidden="true">
      <div className="oc-preview-board">
        <div className="oc-preview-watch">
          <span className="oc-preview-tag">On watch</span>
          <b>NVDA</b>
          <svg viewBox="0 0 200 60" preserveAspectRatio="none"><path d="M0 46 L20 40 L38 44 L58 30 L80 34 L100 22 L122 28 L146 14 L168 20 L200 8" /></svg>
          <span className="oc-preview-bar" />
        </div>
        <div className="oc-preview-slot"><b>AAPL</b><svg viewBox="0 0 100 30" preserveAspectRatio="none"><path className="is-down" d="M0 8 L18 12 L34 10 L52 18 L70 16 L100 24" /></svg><span className="oc-preview-bar is-short" /></div>
        <div className="oc-preview-slot is-arriving"><b>TSLA</b><span>pulling a quote…</span></div>
        <div className="oc-preview-slot is-open"><span>Open slot</span></div>
      </div>
      <div className="oc-preview-talk">
        <p className="oc-bubble is-user">Put Tesla up too.</p>
        <p className="oc-bubble is-user">Should I buy Nvidia?</p>
        <p className="oc-bubble is-host"><span>Reese</span>I read the tape, I don’t give advice.</p>
      </div>
    </figure>
  );
}

export function Lobby({ onStart }: { onStart: (mic: boolean) => void }) {
  return (
    <div className="oc-lobby">
      <header className="oc-top is-lobby"><Logo /></header>
      <main className="oc-hero">
        <div className="oc-hero-copy">
          {/* Who picks up: Reese's face, pinned like a floor badge. The name sits beside it, so the photo is decorative. */}
          <p className="oc-host-badge"><img src={reese} alt="" /><span><b>Reese</b> your analyst on the desk</span></p>
          <p className="oc-eyebrow">A live stock watchlist, read aloud</p>
          <h1>Call out a ticker. Reese reads the tape.</h1>
          <p className="oc-lede">Build a board of up to six stocks just by naming them. Reese, your analyst, puts each one up with its real last sale, today’s move and its 52-week range, and tells you when the one on watch moves. Reese never tells you what to buy.</p>
          <div className="oc-cta">
            <button type="button" className="oc-primary is-big" onClick={() => onStart(true)}>Talk to Reese</button>
            <button type="button" className="oc-secondary is-big" onClick={() => onStart(false)}>Type instead</button>
          </div>
          <p className="oc-small">Talking uses your microphone while the desk is open. Quotes come from Nasdaq, stamped with the time they printed. Nothing here is investment advice.</p>
        </div>
        <Preview />
      </main>
      <section className="oc-steps" aria-label="How it works">
        {STEPS.map(([title, text], i) => (
          <article key={title}><span className="oc-step-n">0{i + 1}</span><h2>{title}</h2><p>{text}</p></article>
        ))}
      </section>
    </div>
  );
}
