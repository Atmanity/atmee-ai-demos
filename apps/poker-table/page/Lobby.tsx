// Blindside's front door: what it is, how a match goes, and the way in.
import { BIG_BLIND, SMALL_BLIND, STARTING_STACK } from '../engine/types.ts';
import dex from '../host/portrait.jpg';
import { CardView } from './CardView.tsx';

/** The mark: a chip, its blind side in shadow. */
export function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" className="bs-mark">
      <circle cx="20" cy="20" r="18.5" fill="var(--bs-brass)" />
      <circle cx="20" cy="20" r="15" fill="none" stroke="var(--bs-ink)" strokeWidth="4.5" strokeDasharray="5.2 6.58" transform="rotate(-8 20 20)" />
      <circle cx="20" cy="20" r="10.5" fill="var(--bs-ivory)" />
      <path d="M20 9.5a10.5 10.5 0 0 1 0 21z" fill="var(--bs-ink)" />
      <circle cx="20" cy="20" r="3" fill="var(--bs-cherry)" />
    </svg>
  );
}

export function Logo() {
  return (
    <a className="bs-logo" href="./" aria-label="Blindside home">
      <Mark />
      <span>Blindside</span>
    </a>
  );
}

const STEPS: [string, string][] = [
  ['Take your seat', `${STARTING_STACK.toLocaleString('en-US')} chips each, blinds ${SMALL_BLIND} and ${BIG_BLIND}. Dex picks up, and the first hand is already dealt.`],
  ['Say it, type it or tap it', '“Call.” “Raise to 60.” “I’m all in.” The dealer rules on every move before Dex gets a word in.'],
  ['Last stack standing', 'Hand after hand until one of you is out of chips. Ask Dex anything about the rules along the way.'],
];

export function Lobby({ onPlay }: { onPlay: (mic: boolean) => void }) {
  return (
    <div className="bs-lobby">
      <header className="bs-top is-lobby"><Logo /></header>
      <main className="bs-hero">
        <div className="bs-hero-copy">
          <p className="bs-seat-chip"><img src={dex} alt="" /><span>Across the felt tonight: <b>Dex</b></span></p>
          <p className="bs-eyebrow">Heads-up no-limit hold’em</p>
          <h1>One table. Two stacks. Dex across the felt.</h1>
          <p className="bs-lede">
            Blindside is heads-up poker against Dex, a sharp, talkative opponent on a live video call. Say your moves out loud,
            type them or tap them. The dealer keeps Dex’s cards face down, even from him, so every word he says about his hand is a bluff.
          </p>
          <div className="bs-cta">
            <button type="button" className="bs-btn is-brass is-big" onClick={() => onPlay(true)}>Play with your voice</button>
            <button type="button" className="bs-btn is-ghost is-big" onClick={() => onPlay(false)}>Play by typing</button>
          </div>
          <p className="bs-small">Voice play uses your microphone while you’re at the table. A sitting lasts up to 15 minutes.</p>
        </div>
        <TablePreview />
      </main>
      <section className="bs-steps" aria-label="How a match goes">
        {STEPS.map(([title, text], i) => (
          <article key={title}>
            <span className="bs-step-n">0{i + 1}</span>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

/** A still of the product: Dex's seat, the flop, your cards, and a line of his. */
function TablePreview() {
  return (
    <div className="bs-preview" aria-hidden="true">
      <div className="bs-preview-felt">
        <div className="bs-preview-dex">
          <div className="bs-preview-tile">
            <img src={dex} alt="" className="bs-preview-face" />
            <span className="bs-preview-plate"><b>Dex</b> 1,060</span>
          </div>
          <div className="bs-preview-hole">
            <CardView faceDown size="sm" />
            <CardView faceDown size="sm" />
          </div>
          <p className="bs-preview-bubble">Sixty? Cute. I’ll make it one-twenty.</p>
        </div>
        <div className="bs-preview-board">
          <CardView card="Qh" size="sm" />
          <CardView card="7c" size="sm" />
          <CardView card="2d" size="sm" />
          <CardView size="sm" />
          <CardView size="sm" />
        </div>
        <p className="bs-preview-pot">Pot <b>180</b></p>
        <div className="bs-preview-you">
          <CardView card="As" size="md" />
          <CardView card="Kh" size="md" />
        </div>
      </div>
    </div>
  );
}
