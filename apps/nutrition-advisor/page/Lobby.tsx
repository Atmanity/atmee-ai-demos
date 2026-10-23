// Morsel's front door: what it is, how it works, and the way in.
import { builtInCard } from '../engine/fallback.ts';
import { Label } from './Label.tsx';

export function Logo() {
  return (
    <a className="ms-logo" href="./" aria-label="Morsel home">
      <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
        <defs>
          <mask id="ms-bite">
            <rect width="40" height="40" fill="#fff" />
            <circle cx="35.5" cy="7.5" r="6.5" fill="#000" />
            <circle cx="29" cy="2.5" r="4.2" fill="#000" />
            <circle cx="39.5" cy="15" r="4.2" fill="#000" />
          </mask>
        </defs>
        <circle cx="19.5" cy="21" r="17" fill="var(--ms-tomato)" mask="url(#ms-bite)" />
        <rect x="9" y="13.5" width="16" height="3.6" fill="#fff" />
        <rect x="9" y="20.5" width="21" height="2" fill="#fff" />
        <rect x="9" y="25.5" width="13" height="2" fill="#fff" />
      </svg>
      <span>Morsel</span>
    </a>
  );
}

const STEPS: [string, string][] = [
  ['Name any food', 'Say it or type it: a banana, 200 g of chicken, the cereal in your cupboard. Or add a photo of the food or its label.'],
  ['See what\'s in it', 'A clear label: calories, protein, fat, fiber and more against a 2,000-calorie day, plus a 1 to 10 score with the takeaway in plain words.'],
  ['Compare, then cook', 'Line foods up side by side, then open a recipe and Rachel talks you through it, two steps at a time.'],
];

const AVOCADO = builtInCard('avocado');

export function Lobby({ host, onStart }: { host: string; onStart: (mic: boolean) => void }) {
  return (
    <div className="ms-lobby">
      <header className="ms-top is-lobby"><Logo /></header>
      <main className="ms-hero">
        <div className="ms-hero-copy">
          <p className="ms-eyebrow">A nutritionist you can talk to</p>
          <h1>Ask about any food. See what's really in it.</h1>
          <p className="ms-lede">
            {host}, a friendly nutritionist, looks up anything you eat and puts the facts on a clear label: what stands out, how it
            compares with something else, and what you could cook with it.
          </p>
          <div className="ms-cta">
            <button type="button" className="ms-primary is-big" onClick={() => onStart(true)}>Talk to {host}</button>
            <button type="button" className="ms-secondary is-big" onClick={() => onStart(false)}>Type instead</button>
          </div>
          <p className="ms-small">Your microphone is used only while you talk with {host}. {host} explains food, not medical advice: for your health, ask your doctor.</p>
        </div>
        {AVOCADO && (
          <figure className="ms-hero-visual" aria-hidden="true">
            <div className="ms-hero-label"><Label data={AVOCADO} compact /></div>
            <figcaption className="ms-hero-bubble">
              <span className="ms-hero-who"><i>{host.charAt(0)}</i>{host}</span>
              Mostly the good, unsaturated kind of fat, and 10 grams of fiber. That's a lot for one fruit.
            </figcaption>
          </figure>
        )}
      </main>
      <section className="ms-how" aria-label="How it works">
        {STEPS.map(([title, text], i) => (
          <article key={title}>
            <span className="ms-how-n">{String(i + 1).padStart(2, '0')}</span>
            <h2>{title}</h2>
            <p>{text.replace('Rachel', host)}</p>
          </article>
        ))}
      </section>
      <footer className="ms-foot">Figures are typical values for the serving shown, estimated unless read from your label. Morsel is for curiosity and cooking, not for medical decisions.</footer>
    </div>
  );
}
