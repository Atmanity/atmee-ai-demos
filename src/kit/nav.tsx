// What every app's frame shares, whatever its brand: a way back to the list of
// apps, and the viewer's choice to show the host's words over the video.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Avatar } from './useAvatar.ts';
import './nav.css';

/** Where the list of every app lives. */
export const APPS_HOME = '/';

/**
 * "← All apps", for the app's header. With a live call, leaving asks first, in
 * the page, and ends the call before it goes. Without one it is a plain link.
 */
export function BackToApps({ avatar, name, className = '' }: {
  /** The call, when the page has one; leaving while it is live ends it first. */
  avatar?: Pick<Avatar, 'phase' | 'end'>;
  /** Who the call is with, for the question ("End the call with Marco?"). */
  name?: string;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const live = avatar?.phase === 'live';
  useEffect(() => { if (!live) setAsking(false); }, [live]);
  useEffect(() => {
    if (!asking) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setAsking(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAsking(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [asking]);
  const leave = async () => {
    setLeaving(true);
    // A call that cannot be ended from here still ends when the page goes (its pagehide beacon).
    try { await avatar?.end(); } catch { /* leave anyway */ }
    location.assign(APPS_HOME);
  };
  return (
    <span className={`call-back-wrap ${className}`} ref={box}>
      <a
        className="call-back" href={APPS_HOME} aria-label="All apps"
        onClick={(e) => { if (live) { e.preventDefault(); setAsking((a) => !a); } }}
        aria-expanded={live ? asking : undefined}
      >
        <BackIcon /><span className="call-back-label">All apps</span>
      </a>
      {asking && (
        <span className="call-back-ask" role="dialog" aria-label="Leave this app?">
          <span>{name ? `End the call with ${name} and go to all apps?` : 'End the call and go to all apps?'}</span>
          <span className="call-back-actions">
            <button type="button" className="call-back-stay" onClick={() => setAsking(false)} disabled={leaving}>Stay</button>
            <button type="button" className="call-back-go" onClick={() => void leave()} disabled={leaving} autoFocus>{leaving ? 'Ending…' : 'End call'}</button>
          </span>
        </span>
      )}
    </span>
  );
}

/** The browser's memory of a viewer's captions choice, one per app (the five classic pages use the same keys). */
export const captionsKey = (app: string) => `atmee-captions:${app}`;

function readChoice(app: string): boolean | null {
  try {
    const v = localStorage.getItem(captionsKey(app));
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

export interface CaptionToggle { on: boolean; toggle(): void }

/**
 * Whether to show the host's words over the video: the viewer's last choice in
 * this browser, else the app's default (off where a chat already carries
 * them, on where the video is the only place they appear).
 */
export function useCaptionToggle(app: string, defaultOn: boolean): CaptionToggle {
  const [on, setOn] = useState(() => readChoice(app) ?? defaultOn);
  const toggle = useCallback(() => {
    setOn((was) => {
      const next = !was;
      try { localStorage.setItem(captionsKey(app), next ? '1' : '0'); } catch { /* private mode: the choice lasts this visit */ }
      return next;
    });
  }, [app]);
  return { on, toggle };
}

/** The CC button on the host's video. */
export function CaptionsButton({ on, onToggle, className = '' }: { on: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button" className={`call-cc ${on ? 'is-on' : ''} ${className}`} onClick={onToggle}
      aria-pressed={on} title={on ? 'Hide captions' : 'Show captions'} aria-label="Captions"
    >CC</button>
  );
}

const BackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
);
