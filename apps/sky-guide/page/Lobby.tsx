// Lodestar's front door: what it is, how it works, and the way in, beside
// the real sky over the chosen place tonight (the same chart the call opens on).
import { BackToApps } from '../../../src/kit/index.ts';
import portrait from '../host/portrait.jpg';
import type { SkyView } from '../engine/types.ts';
import { PLACES } from '../engine/sky.ts';
import { SkyDome, type DomePalette } from './SkyDome.tsx';

export function Logo() {
  return (
    <a className="ls-logo" href="./" aria-label="Lodestar home">
      <svg viewBox="0 0 40 40" width="32" height="32" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".55" />
        <circle cx="20" cy="20" r="11.5" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 3" opacity=".55" />
        <path d="M20 5.5 22.4 17.6 34.5 20 22.4 22.4 20 34.5 17.6 22.4 5.5 20 17.6 17.6Z" fill="var(--ls-brass)" />
        <circle cx="20" cy="2.6" r="1.6" fill="currentColor" />
      </svg>
      <span>Lodestar</span>
    </a>
  );
}

const STEPS: [string, string][] = [
  ['Pick your sky', 'Any of 41 cities or your own coordinates, any night from 1900 to 2100.'],
  ['Ask Mira', '"Where\'s Vega?" "Show me Orion." "What\'s up at midnight?" She moves the chart for you.'],
  ['Look up', 'Plain directions, never degrees, and a list of your night to take outside.'],
];

export function Lobby({ view, host, palette, onPlace, onStart }: {
  view: SkyView;
  host: string;
  palette: DomePalette;
  onPlace: (label: string) => void;
  onStart: (mic: boolean) => void;
}) {
  const s = view.snapshot;
  const current = PLACES.find((p) => p.label === s.where.label);
  const [clock, date] = s.when.label.split(', ');
  return (
    <div className="ls-lobby">
      <header className="ls-top is-lobby"><BackToApps /><Logo /></header>
      <main className="ls-hero">
        <div className="ls-hero-copy">
          <p className="ls-eyebrow">A stargazing guide for anywhere on Earth</p>
          <h1>Know what you're looking at.</h1>
          <p className="ls-lede">
            Lodestar charts the sky over any city, at any hour, and {host}, your guide, tells you what's up,
            where to look and what each star is. Only from the star catalogue: she never guesses.
          </p>
          <p className="ls-guide">
            {/* Decorative: her name is right beside it. */}
            <img src={portrait} alt="" width={48} height={48} />
            <span>Your guide tonight is <b>{host}</b>, who has spent years pointing at things in the dark for people seeing them for the first time.</span>
          </p>
          <div className="ls-cta">
            <button type="button" className="ls-primary is-big" onClick={() => onStart(true)}>Talk to {host}</button>
            <button type="button" className="ls-secondary is-big" onClick={() => onStart(false)}>Chat by typing</button>
          </div>
          <p className="ls-small">Talking uses your microphone only while you're with {host}. You can switch to typing any time.</p>
        </div>

        <figure className="ls-preview">
          <div className="ls-preview-dome" aria-hidden="true">
            <SkyDome state={s} onSelect={() => undefined} busy palette={palette} />
          </div>
          <figcaption>
            <label className="ls-preview-place">
              <span>Tonight over</span>
              <select value={current?.id ?? ''} onChange={(e) => { const p = PLACES.find((x) => x.id === e.target.value); if (p) onPlace(p.label); }} aria-label="Your place">
                {!current && <option value="">{s.where.label}</option>}
                {PLACES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <span className="ls-preview-meta"><b>{clock}</b> {date} · {s.visible.length} stars up{s.visible[0] ? `, brightest ${s.visible[0].name}` : ''}</span>
          </figcaption>
        </figure>
      </main>
      <section className="ls-steps" aria-label="How it works">
        {STEPS.map(([title, text], i) => (
          <article key={title}><span className="ls-step-n">0{i + 1}</span><h2>{title}</h2><p>{text}</p></article>
        ))}
      </section>
    </div>
  );
}
