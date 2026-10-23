// Arcwise's front door: what it is, how a shot works, the six challenges, and
// the way in by voice or by typing.
import { CHALLENGES } from '../engine/challenges.ts';

export const HOST = 'Theo';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <a className="aw-logo" href="./" aria-label="Arcwise home">
      <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
        <rect x="1.5" y="1.5" width="37" height="37" rx="9" fill="var(--aw-slate)" />
        <path d="M6.5 31.5h27" stroke="var(--aw-chalk)" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M8 31 Q20 1.5 33 31" fill="none" stroke="var(--aw-chalk)" strokeWidth="2.2" strokeDasharray="2.4 3.2" strokeLinecap="round" />
        <circle cx="20.3" cy="16.3" r="3.6" fill="var(--aw-tracer)" />
      </svg>
      {!compact && <span>Arcwise</span>}
    </a>
  );
}

const STEPS: [string, string][] = [
  ['Aim', 'Drag the arrow up from the launcher, or tell Theo: "forty degrees", "a bit more speed".'],
  ['Fire', 'Press Fire or just say it. Every shot is worked out exactly, and drawn to scale.'],
  ['Hear why', 'Theo reads you the real numbers (height at the wall, metres short, seconds in the air) and one thing to change.'],
];

export function Lobby({ onStart }: { onStart: (mic: boolean) => void }) {
  return (
    <div className="aw-lobby">
      <header className="aw-top is-lobby"><Logo /></header>
      <main className="aw-hero">
        <div className="aw-hero-copy">
          <p className="aw-eyebrow">A projectile-motion range, coached by {HOST}</p>
          <h1>Forty-five degrees isn&rsquo;t always the answer.</h1>
          <p className="aw-lede">
            Arcwise is a practice range drawn to scale. {HOST}, your physics coach, puts up a target; you aim, fire, and he
            tells you in real numbers why the shot landed where it did, and what to change.
          </p>
          <div className="aw-cta">
            <button type="button" className="aw-primary is-big" onClick={() => onStart(true)}>Start with your voice</button>
            <button type="button" className="aw-secondary is-big" onClick={() => onStart(false)}>Start by typing</button>
          </div>
          <p className="aw-small">Voice uses your microphone while you&rsquo;re on the range. Each challenge takes a few minutes.</p>
        </div>
        <Chalkboard />
      </main>

      <section className="aw-steps" aria-label="How a shot works">
        {STEPS.map(([title, text], i) => (
          <article key={title}>
            <span className="aw-step-n">0{i + 1}</span>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="aw-syllabus-intro" aria-label="The six challenges">
        <h2>Six challenges, six bits of folklore</h2>
        <ol>
          {CHALLENGES.map((c, i) => (
            <li key={c.id}><span className="aw-num">{String(i + 1).padStart(2, '0')}</span><b>{c.name}</b><span>{c.blurb}</span></li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/**
 * The product in one picture, to scale (6.8 px a metre) and with the range's
 * own numbers: the wall at forty metres, a flat shot that fell short (30° at
 * 20 m/s), 45° at 20 m/s passing the wall 0.76 m up, and 45° at 24 m/s over it.
 */
function Chalkboard() {
  const chalk = 'rgba(243,240,228,.45)';
  return (
    <figure className="aw-board-art">
      <svg viewBox="0 0 480 300" role="img" aria-label="A shot at forty-five degrees and twenty-four metres a second clearing a three-metre wall forty metres out, beside two earlier misses.">
        <rect width="480" height="300" rx="14" fill="var(--aw-slate)" />
        <g stroke="rgba(243,240,228,.07)" strokeWidth="1">
          {[108, 176, 244, 312, 380, 448].map((x) => <line key={x} x1={x} y1="24" x2={x} y2="250" />)}
          {[80, 148, 216].map((y) => <line key={y} x1="30" y1={y} x2="458" y2={y} />)}
        </g>
        <line x1="26" y1="250" x2="458" y2="250" stroke="rgba(243,240,228,.8)" strokeWidth="2.5" strokeLinecap="round" />
        <g fill="rgba(243,240,228,.5)" fontFamily="IBM Plex Mono, monospace" fontSize="11" textAnchor="middle">
          <text x="108" y="268">10 m</text><text x="176" y="268">20 m</text><text x="244" y="268">30 m</text><text x="312" y="268">40 m</text><text x="380" y="268">50 m</text>
        </g>
        <rect x="309" y="229.6" width="6" height="20.4" fill="var(--aw-yolk)" />
        <text x="312" y="221" fill="var(--aw-yolk)" fontFamily="IBM Plex Mono, monospace" fontSize="11" fontWeight="600" textAnchor="middle">3 m</text>
        <path d="M40 250 Q160 180.6 280.1 250" fill="none" stroke={chalk} strokeWidth="1.8" strokeDasharray="4 5" />
        <path d="M40 250 Q178.6 111.4 317.2 250" fill="none" stroke={chalk} strokeWidth="1.8" strokeDasharray="4 5" />
        <path d="M40 250 Q239.6 50.4 439.3 250" fill="none" stroke="var(--aw-tracer)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="439.3" cy="250" r="5.5" fill="var(--aw-tracer)" />
        <line x1="40" y1="250" x2="82" y2="208" stroke="var(--aw-aim)" strokeWidth="3.2" strokeLinecap="round" />
        <circle cx="82" cy="208" r="5" fill="var(--aw-aim)" />
        <path d="M29 250 L40 241 L51 250 Z" fill="rgba(243,240,228,.85)" />
        <g fontFamily="IBM Plex Mono, monospace" fontSize="12" fill="var(--aw-chalk)">
          <text x="64" y="196">45° · 24 m/s</text>
          <text x="262" y="132">over with 9.75 m to spare</text>
        </g>
      </svg>
      <figcaption>Three shots at the wall: short, too low, and over with metres to spare.</figcaption>
    </figure>
  );
}
