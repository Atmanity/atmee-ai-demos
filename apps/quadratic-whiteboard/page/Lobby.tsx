// Chalkline's front door: what it is, how a lesson goes, and the way in.
import { HOST, Logo } from './brand.tsx';

const STEPS: [string, string][] = [
  ['Say the equation', '“Put up x squared minus five x plus six.” It goes on the board with its graph, vertex and axis.'],
  ['Pick a method', 'Factoring, completing the square or the formula. Chalkline only offers the ones that work for that equation.'],
  ['Reveal at your pace', `Say “next” and one more line appears, and ${HOST} reads it out. Nothing shows before you ask.`],
];

const PROMISES: [string, string][] = [
  ['Exact, always', '2 + √3 stays 2 + √3. No rounding on the board, and none out loud.'],
  ['Nothing ahead of you', 'Lines you haven’t revealed aren’t on any screen in the room.'],
  ['A key for every word', 'Misheard? Every spoken request has a key on the board’s tray.'],
];

export function Lobby({ onStart }: { onStart: (mic: boolean) => void }) {
  return (
    <div className="cl-lobby">
      <header className="cl-top is-lobby"><Logo /></header>
      <main>
        <section className="cl-hero">
          <div className="cl-hero-copy">
            <p className="cl-eyebrow">The maths board you run by voice</p>
            <h1>Say the equation. Reveal the working <em>one line at a time.</em></h1>
            <p className="cl-lede">
              Chalkline puts any quadratic on the board with its graph, then walks your class through factoring,
              completing the square or the formula at the pace you set. {HOST}, the board’s voice, reads every line out exactly as it’s written.
            </p>
            <div className="cl-cta">
              <button type="button" className="cl-primary is-big" onClick={() => onStart(true)}>Start with your voice</button>
              <button type="button" className="cl-secondary is-big" onClick={() => onStart(false)}>Start by typing</button>
            </div>
            <p className="cl-small">{HOST} listens only while the board is on. Best on the classroom screen, with your laptop’s microphone.</p>
          </div>
          <Preview />
        </section>

        <section className="cl-steps" aria-label="How a lesson goes">
          {STEPS.map(([title, text], i) => (
            <article key={title}>
              <span className="cl-step-n" aria-hidden="true">{i + 1}</span>
              <h2>{title}</h2>
              <p>{text}</p>
            </article>
          ))}
        </section>

        <section className="cl-promises" aria-label="Built for the front of the class">
          {PROMISES.map(([title, text]) => (
            <p key={title}><b>{title}.</b> {text}</p>
          ))}
        </section>
      </main>
      <footer className="cl-foot">Chalkline · quadratics, from factoring to the formula</footer>
    </div>
  );
}

/** The product in one picture: the board halfway through factoring, with the next line still to come. */
function Preview() {
  return (
    <div className="cl-preview" aria-hidden="true">
      <div className="cl-preview-board">
        <p className="cl-preview-eq">y = x² − 5x + 6</p>
        <div className="cl-preview-body">
          <svg viewBox="0 0 160 120" className="cl-preview-graph">
            <line x1="4" y1="95.7" x2="156" y2="95.7" className="is-axis" />
            <line x1="80" y1="6" x2="80" y2="114" className="is-sym" />
            <path d="M10 10 Q80 188.6 150 10" className="is-curve" />
            <circle cx="66" cy="95.7" r="4" className="is-root" />
            <circle cx="94" cy="95.7" r="4" className="is-root" />
            <circle cx="80" cy="99.3" r="4" className="is-vertex" />
          </svg>
          <ol className="cl-preview-lines">
            <li><span>1</span>x² − 5x + 6 = 0</li>
            <li><span>2</span>need p·q = 6 and p + q = −5</li>
            <li className="is-blank"><span>3</span><i /></li>
            <li className="is-blank"><span>4</span><i /></li>
          </ol>
        </div>
      </div>
      <div className="cl-preview-tray">
        <span className="cl-key">‹ Back</span>
        <span className="cl-key is-next">Next line ›</span>
      </div>
      <p className="cl-preview-voice"><b>{HOST}</b> “We want two numbers that multiply to 6 and add to minus 5.”</p>
    </div>
  );
}
