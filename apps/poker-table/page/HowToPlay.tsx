// The rules, on screen, on demand: the hand rankings first (something you
// glance at mid-hand and close), then how a hand goes. Dex opens it too when
// asked what beats what. Opening it changes nothing at the table.
import { useEffect, useRef } from 'react';
import { HOST } from '../engine/director.ts';
import { HAND_RANKINGS, RULE_SECTIONS } from '../engine/rules.ts';

export function HowToPlay({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes it: a sheet you can only leave by finding the right button
  // is the wrong thing to put in front of someone who is already lost.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); before?.focus?.(); };
  }, [onClose]);

  return (
    <div className="bs-sheet-backdrop" onClick={onClose}>
      <div className="bs-sheet" role="dialog" aria-modal="true" aria-label="How to play" onClick={(event) => event.stopPropagation()}>
        <header className="bs-sheet-head">
          <h2>How to play</h2>
          <button ref={closeRef} type="button" className="bs-icon-btn" onClick={onClose} aria-label="Close how to play">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <h3 className="bs-sheet-sub">What beats what</h3>
        <ol className="bs-rankings" aria-label="Hand rankings, strongest first">
          {HAND_RANKINGS.map((row, index) => (
            <li key={row.name}>
              <span className="bs-rank-n">{index + 1}</span>
              <span className="bs-rank-name">{row.name}</span>
              <span className="bs-rank-shape">{row.shape}</span>
            </li>
          ))}
        </ol>

        {RULE_SECTIONS.map((section) => (
          <section key={section.heading} className="bs-sheet-section">
            <h3>{section.heading}</h3>
            <p>{section.body}</p>
          </section>
        ))}

        <p className="bs-sheet-foot">Ask {HOST} anything else out loud: “what’s a flush?”, “what are the blinds?”</p>
      </div>
    </div>
  );
}
