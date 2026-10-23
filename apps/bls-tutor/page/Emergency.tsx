// The red card. It covers the whole page the moment the learner's words read
// like a real emergency (the page's own watch, or Alex's stop_for_emergency),
// with the exact line, the numbers to dial as links a phone can call, and one
// way off it. It is the only red thing in Bystander, on purpose.
import { useEffect, useRef } from 'react';
import { BUTTON } from '../engine/director.ts';
import { EMERGENCY_LINE, EMERGENCY_TITLE, SAFETY_LINE } from '../engine/lines.ts';
import { Dial } from './Lobby.tsx';

export function Emergency({ onResume, notice }: { onResume: () => void; notice?: string | null }) {
  const first = useRef<HTMLDivElement>(null);
  // Focus lands on the card, so a keyboard or screen-reader user starts there.
  useEffect(() => { first.current?.focus(); }, []);
  return (
    <div className="by-emergency" role="alert" aria-labelledby="by-emergency-title">
      <div className="by-emergency-inner" ref={first} tabIndex={-1}>
        <svg className="by-emergency-mark" viewBox="0 0 40 40" width="56" height="56" aria-hidden="true">
          <rect x="2" y="2" width="36" height="36" rx="7" fill="#fff" />
          <path d="M16 9h8v7h7v8h-7v7h-8v-7H9v-8h7z" fill="var(--by-red)" />
        </svg>
        <h1 id="by-emergency-title">{EMERGENCY_TITLE}</h1>
        <p className="by-emergency-line">{EMERGENCY_LINE}</p>
        <div className="by-dials"><Dial number="911" className="is-big" /><Dial number="112" className="is-big" /></div>
        <p className="by-emergency-small">Elsewhere, call your local emergency number. Stay on the line: the dispatcher will talk you through what to do.</p>
        <button type="button" className="by-emergency-off" onClick={onResume}>{BUTTON.resume}</button>
        {notice ? <p className="by-emergency-small" role="status">{notice}</p> : null}
        <footer>{SAFETY_LINE}</footer>
      </div>
    </div>
  );
}
