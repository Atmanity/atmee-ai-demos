// The rules, on screen, on demand: the original panel's sheet. The hand
// rankings are a reference table (something you glance at mid-hand and
// close), which is a screen's job and not a conversation's. Opening it sends
// nothing and changes nothing at the table.
import { useEffect, useRef } from "react";

import { HAND_RANKINGS, RULE_SECTIONS } from "../engine/rules.ts";

export function HowToPlay({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes it. A modal you can only leave by finding the right button
  // is the wrong thing to put in front of someone who is already lost.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="poker-help-backdrop" onClick={onClose}>
      <div
        className="poker-help"
        role="dialog"
        aria-modal="true"
        aria-label="How to play"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="poker-help__head">
          <h2>How to play</h2>
          <button
            ref={closeRef}
            type="button"
            className="poker-help__close"
            onClick={onClose}
            aria-label="Close how to play"
          >
            ✕
          </button>
        </header>

        <ol className="poker-help__rankings" aria-label="Hand rankings, strongest first">
          {HAND_RANKINGS.map((row, index) => (
            <li key={row.name}>
              <span className="poker-help__rank">{index + 1}</span>
              <span className="poker-help__rank-name">{row.name}</span>
              <span className="poker-help__rank-shape">{row.shape}</span>
            </li>
          ))}
        </ol>

        {RULE_SECTIONS.map((section) => (
          <section key={section.heading} className="poker-help__section">
            <h3>{section.heading}</h3>
            <p>{section.body}</p>
          </section>
        ))}

        <p className="poker-help__foot">
          Ask anything else out loud — "what's a flush?", "what are the blinds?" —
          you'll get an answer.
        </p>
      </div>
    </div>
  );
}
