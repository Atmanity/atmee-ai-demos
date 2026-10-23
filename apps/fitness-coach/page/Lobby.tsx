// Spotter's front door: what it is, how a workout goes, the promise that sets
// it apart (every limit is enforced, and it knows when to stop), and the way in.

/** The mark: a floor spot on rubber matting, the marker you stand on in a gym. */
export function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" className="sp-mark">
      <circle cx="20" cy="20" r="18.5" fill="var(--sp-rubber)" />
      <circle cx="20" cy="20" r="11.5" fill="none" stroke="var(--sp-tangerine)" strokeWidth="3.5" />
      <path d="M20 4.5v6M20 29.5v6M4.5 20h6M29.5 20h6" stroke="var(--sp-lane)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="20" cy="20" r="4.2" fill="#fff" />
    </svg>
  );
}

export function Logo() {
  return (
    <a className="sp-logo" href="./" aria-label="Spotter home">
      <Mark />
      <span>Spotter</span>
    </a>
  );
}

const STEPS: [string, string][] = [
  ['Say what you want to train', 'Glutes, mobility, a quick full-body blast. Tap it or just say it.'],
  ['Tell Sammy your limits', 'Twenty minutes, no kit, a sore knee. Every limit goes into the plan, not just the conversation.'],
  ['Start moving', 'Pick your first move and Sammy talks you through the form, cue by cue.'],
];

export function Lobby({ host, onStart }: { host: string; onStart: (mic: boolean) => void }) {
  return (
    <div className="sp-lobby">
      <header className="sp-top is-lobby"><Logo /></header>
      <main className="sp-hero">
        <div className="sp-hero-copy">
          <p className="sp-eyebrow">Personal training with {host}</p>
          <h1>A workout built around you.</h1>
          <p className="sp-lede">
            Tell {host} what you want to train, how experienced you are and what to work around. She builds the plan,
            keeps every move inside your limits, and coaches you through your first one.
          </p>
          <div className="sp-cta">
            <button type="button" className="sp-primary is-big" onClick={() => onStart(true)}>Talk to {host}</button>
            <button type="button" className="sp-secondary is-big" onClick={() => onStart(false)}>Type instead</button>
          </div>
          <p className="sp-small">Talking uses your microphone while the call is on; you can mute any time. Calls run up to 15 minutes.</p>
        </div>
        <PlanPreview host={host} />
      </main>
      <section className="sp-steps" aria-label="How it works">
        {STEPS.map(([title, text], i) => (
          <article key={title}>
            <span className="sp-step-n">0{i + 1}</span>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <section className="sp-promise" aria-label="When Spotter stops">
        <span className="sp-promise-mark" aria-hidden="true">!</span>
        <div>
          <h2>Built to know when to stop</h2>
          <p>
            If you mention pregnancy, a heart condition, recent surgery or anything a doctor should clear first, Spotter
            pauses your workout straight away and asks you to check in with them before you train.
          </p>
        </div>
      </section>
    </div>
  );
}

/** What the product does, drawn: a plan reworked around a sore knee, and the coach saying so. */
function PlanPreview({ host }: { host: string }) {
  return (
    <div className="sp-preview" aria-hidden="true">
      <div className="sp-preview-sheet">
        <p className="sp-eyebrow">Your plan · Glutes + legs</p>
        <p className="sp-preview-title">Glute Bridge Builder</p>
        <p className="sp-preview-meta"><b>20</b> min <i /> <b>4</b> moves <i /> Beginner</p>
        <p className="sp-preview-chips"><span>Working around: knee</span><span>20 min cap</span></p>
        <ol className="sp-preview-list">
          <li><span>01</span>Glute bridge<em>12 reps</em></li>
          <li className="is-now"><span>02</span>Dead bug<em>8 each side</em></li>
          <li className="is-gone"><span>—</span>Walking lunges<em>off for your knee</em></li>
          <li><span>03</span>Side-lying leg lift<em>10 each side</em></li>
        </ol>
      </div>
      <div className="sp-preview-coach">
        <span className="sp-preview-dot">{host[0]}</span>
        <p><b>{host}</b>Noted on your knee. I've taken the lunges out and kept it to twenty minutes.</p>
      </div>
    </div>
  );
}
