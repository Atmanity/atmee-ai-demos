// Bystander's front door: what it is, how a drill goes, which drill to start
// with, and the way in. The real-emergency numbers are on it too: someone who
// lands here in the middle of one needs a dispatcher, not a drill.
import { SAFETY_LINE } from '../engine/lines.ts';
import { DRILLS, PREVIEW } from './drills.ts';
import { CheckIcon, Emblem, EyeIcon, LockIcon, Mark, PhoneIcon, Pictogram } from './icons.tsx';

export function Logo() {
  return (
    <a className="by-logo" href="./" aria-label="Bystander home">
      <Mark />
      <span>Bystander</span>
    </a>
  );
}

/** A tel: link to the emergency number, wherever it is offered. */
export function Dial({ number, className = '' }: { number: '911' | '112'; className?: string }) {
  return <a className={`by-dial ${className}`} href={`tel:${number}`}><PhoneIcon /> Call {number}</a>;
}

const STEPS: [string, string][] = [
  ['Pick a scene', 'A collapse in a café, a child by a pool, choking at dinner, or someone breathing but unresponsive.'],
  ['Say what you would do', 'Out loud or typed. Alex asks one step at a time, and the drill checks your answer against the lay-rescuer guidelines.'],
  ['Learn the numbers', 'Miss a step twice and Alex teaches it, with the exact rate, depth and count. You finish with a review of every step.'],
];

export function Lobby({ choice, onChoose, onStart }: { choice: string; onChoose: (id: string) => void; onStart: (mic: boolean) => void }) {
  return (
    <div className="by-lobby">
      <header className="by-top is-lobby">
        <Logo />
        <p className="by-top-sos"><span>Someone needs help right now?</span> <Dial number="911" /></p>
      </header>

      <main className="by-hero">
        <div className="by-hero-copy">
          <p className="by-eyebrow">CPR and first-aid practice with a paramedic</p>
          <h1>Be the bystander who knows what to do.</h1>
          <p className="by-lede">Alex, a calm paramedic instructor, walks you through an emergency one step at a time. Say what you would do; the drill checks it against the real algorithm and teaches each step with the exact numbers.</p>

          <fieldset className="by-pick">
            <legend>Start with</legend>
            {DRILLS.map((d) => (
              <label key={d.id} className={`by-pick-item ${choice === d.id ? 'is-on' : ''}`}>
                <input type="radio" name="drill" value={d.id} checked={choice === d.id} onChange={() => onChoose(d.id)} />
                <span className="by-pick-emblem"><Emblem id={d.id} /></span>
                <span className="by-pick-text"><b>{d.title}</b><small>{d.who} · {d.steps} steps</small></span>
              </label>
            ))}
          </fieldset>

          <div className="by-cta">
            <button type="button" className="by-primary is-big" onClick={() => onStart(true)}>Start with your voice</button>
            <button type="button" className="by-secondary is-big" onClick={() => onStart(false)}>Start by typing</button>
          </div>
          <p className="by-small">Voice uses your microphone during the drill. A drill takes about five minutes.</p>
        </div>

        <Preview />
      </main>

      <section className="by-steps" aria-label="How it works">
        {STEPS.map(([title, text], i) => (
          <article key={title}><span className="by-step-sq">{i + 1}</span><h2>{title}</h2><p>{text}</p></article>
        ))}
      </section>

      <section className="by-practice" aria-label="Practice only">
        <div>
          <h2>Practice, not certification</h2>
          <p>Bystander helps you rehearse what to do. It is not a CPR course, it does not certify you, and it is not medical advice. A hands-on class with a manikin is still the best way to learn.</p>
        </div>
        <div className="by-practice-sos">
          <p>If someone needs help right now, call your emergency number and follow the dispatcher.</p>
          <div className="by-dials"><Dial number="911" /><Dial number="112" /></div>
        </div>
      </section>

      <footer className="by-foot">{SAFETY_LINE}</footer>
    </div>
  );
}

/** What a drill looks like: a step just taught, the beat to practise to, and Alex. */
function Preview() {
  const rungs: ('got' | 'shown' | 'now' | 'locked')[] = ['got', 'got', 'shown', 'now', 'locked', 'locked', 'locked'];
  return (
    <figure className="by-preview" aria-hidden="true">
      <div className="by-strip" />
      <div className="by-preview-body">
        <p className="by-preview-scene"><Emblem id="adult_cardiac_arrest" size={18} /> {PREVIEW.title}</p>
        <p className="by-step-n">Step {PREVIEW.step} of {PREVIEW.of}</p>
        <p className="by-badge is-got"><CheckIcon /> You got it</p>
        <p className="by-preview-label">{PREVIEW.label}</p>
        <div className="by-teach"><span className="by-teach-icon"><Pictogram kind="torso_hands" /></span><p>{PREVIEW.teach}</p></div>
        <p className="by-beat-demo"><span className="by-beat-dot" /> Practise to the beat · {PREVIEW.bpm} a minute</p>
        <ol className="by-ticks">
          {rungs.map((r, i) => (
            <li key={i} className={`is-${r}`}>{r === 'got' ? <CheckIcon size={12} /> : r === 'shown' ? <EyeIcon size={12} /> : r === 'locked' ? <LockIcon size={11} /> : i + 1}</li>
          ))}
        </ol>
      </div>
      <figcaption className="by-preview-host">
        <span className="by-avatar-dot">A</span>
        <span><b>Alex</b> “Good. Now push to the beat, and let the chest come all the way back up.”</span>
      </figcaption>
    </figure>
  );
}
