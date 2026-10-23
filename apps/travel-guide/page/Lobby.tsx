// Yonder's front door: what it is, how it works, and the two ways in.
import { useId } from 'react';

/** The mark: a sun going down behind the hills, seen through a round window. */
export function Mark({ size = 34 }: { size?: number }) {
  // React's ids carry characters a url(#…) reference would have to escape.
  const clip = `yd-window-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" className="yd-mark">
      <clipPath id={clip}><circle cx="20" cy="20" r="17.5" /></clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect width="40" height="40" fill="var(--yd-mist)" />
        <circle cx="25" cy="18" r="8" fill="var(--yd-sun)" />
        <path d="M0 27c6-6 12-7 18-3s12 4 22-3v19H0z" fill="var(--yd-pine-soft)" />
        <path d="M0 31c8-4 15-4 21-1s12 3 19-1v11H0z" fill="var(--yd-pine)" />
        <path d="M6 15c4-6 9-8 14-7" fill="none" stroke="var(--yd-flamingo)" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="1.5 3" />
      </g>
      <circle cx="20" cy="20" r="17.5" fill="none" stroke="var(--yd-pine)" strokeWidth="2.5" />
    </svg>
  );
}

export function Logo() {
  return (
    <a className="yd-logo" href="./" aria-label="Yonder home">
      <Mark />
      <span>Yonder</span>
    </a>
  );
}

/** The front door's picture of the product: a route on a map, a dish, a sight, and Lumi's voice. */
function Poster({ host }: { host: string }) {
  return (
    <figure className="yd-poster" aria-hidden="true">
      <svg viewBox="0 0 360 450" preserveAspectRatio="xMidYMid slice">
        <rect width="360" height="450" fill="var(--yd-pine)" />
        <circle cx="252" cy="118" r="64" fill="var(--yd-sun)" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path key={i} d={`M-10 ${210 + i * 34}c50-${18 + i * 2} 95-${10 + i} 140 4s100 ${16 + i * 2} 240-${8 + i * 3}`} fill="none" stroke="var(--yd-paper)" strokeOpacity={0.1 + i * 0.015} strokeWidth="1.4" />
        ))}
        <path d="M0 330c40-30 90-36 130-18s80 30 120 8 80-30 110-20v150H0z" fill="var(--yd-pine-soft)" opacity=".7" />
        <path d="M58 362C98 268 160 236 206 262s80 52 104-28" fill="none" stroke="var(--yd-flamingo)" strokeWidth="3" strokeLinecap="round" strokeDasharray="0.5 9" />
        {([[58, 362, 'Lisbon', 'end'], [206, 262, 'Kyoto', 'middle'], [310, 234, 'Oaxaca', 'middle']] as const).map(([x, y, label, anchor]) => (
          <g key={label}>
            <circle cx={x} cy={y} r="7.5" fill="var(--yd-paper)" stroke="var(--yd-flamingo)" strokeWidth="3.5" />
            <text x={anchor === 'end' ? x + 16 : x} y={anchor === 'end' ? y + 4 : y - 16} textAnchor={anchor === 'end' ? 'start' : 'middle'} className="yd-poster-label">{label.toUpperCase()}</text>
          </g>
        ))}
      </svg>
      <figcaption className="yd-poster-voice"><b>{host}</b>In Belém, get the pastéis de nata still warm. Go early.</figcaption>
      <div className="yd-poster-ticket">
        <span className="yd-ticket-kicker">Sight 1 of 8 · 6 min walk</span>
        <span className="yd-ticket-name">Jerónimos Monastery</span>
      </div>
    </figure>
  );
}

const STEPS: [string, string][] = [
  ['Name a place', 'A country, a city in one, or "you choose". It lands on the map with its outline.'],
  ['Ask like you would ask a friend', 'What to eat there, and what is worth seeing around a station, a square or a street, one sight at a time.'],
  ['Take the trip with you', 'Every place stays on your route. Download your trip notes when you are done.'],
];

export function Lobby({ host, onStart }: { host: string; onStart: (mic: boolean) => void }) {
  return (
    <div className="yd-lobby">
      <header className="yd-lobby-top"><Logo /></header>
      <main className="yd-hero">
        <div className="yd-hero-copy">
          <p className="yd-eyebrow">Trip dreaming, with a friend who has been</p>
          <h1>Where to next?</h1>
          <p className="yd-lede">
            Name a country and it lands on a live map. {host}, a friend who has been almost everywhere, tells you what to eat there and
            walks you through the sights around any street or station you name. Every dish and every sight comes from real maps and Wikipedia.
          </p>
          <div className="yd-cta">
            <button type="button" className="yd-primary is-big" onClick={() => onStart(true)}>Talk to {host}</button>
            <button type="button" className="yd-secondary is-big" onClick={() => onStart(false)}>Chat by typing</button>
          </div>
          <p className="yd-small">Talking uses your microphone while the call is on. A call lasts up to 15 minutes, and your trip stays on screen when it ends.</p>
        </div>
        <Poster host={host} />
      </main>
      <section className="yd-steps" aria-label="How it works">
        {STEPS.map(([title, text], i) => (
          <article key={title}><span className="yd-step-n">0{i + 1}</span><h2>{title}</h2><p>{text}</p></article>
        ))}
      </section>
      <footer className="yd-credits">Maps © OpenStreetMap contributors · Photos and facts from Wikipedia</footer>
    </div>
  );
}
