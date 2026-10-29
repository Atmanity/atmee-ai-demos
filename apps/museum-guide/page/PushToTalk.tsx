// The microphone, held to talk: a gallery is never quiet, and the visitor's
// phone hears everyone around them. The call joins with the microphone muted;
// it opens while the button (or the space bar) is held, and stays open a
// moment after it is let go so the last word is not cut off.
import { useEffect, useRef, useState } from 'react';
import { MicIcon, type Avatar } from '../../../src/kit/index.ts';

const TAIL_MS = 400;

export function PushToTalk({ avatar }: { avatar: Avatar }) {
  const [held, setHeld] = useState(false);
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;

  const press = () => {
    clearTimeout(release.current);
    setHeld(true);
    if (!avatarRef.current.micOn) avatarRef.current.setMic(true);
  };
  const letGo = () => {
    setHeld(false);
    clearTimeout(release.current);
    release.current = setTimeout(() => avatarRef.current.setMic(false), TAIL_MS);
  };

  // The space bar, held, when no text box has the keys.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !e.repeat && !typing(e)) { e.preventDefault(); press(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e)) { e.preventDefault(); letGo(); } };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); };
  }, []);
  // Leaving the screen with the button held must not leave the microphone open.
  useEffect(() => () => { clearTimeout(release.current); avatarRef.current.setMic(false); }, []);

  const open = held || avatar.micOn;
  return (
    <button
      type="button" className={`mr-dock-btn mr-ptt ${open ? 'is-open' : ''}`}
      aria-pressed={open} aria-label="Hold to talk" title="Hold to talk (or hold the space bar)"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); press(); }}
      onPointerUp={letGo} onPointerCancel={letGo}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="mr-dock-ico"><MicIcon /></span>
      <span className="mr-dock-label">{open ? 'Listening…' : 'Hold to talk'}</span>
    </button>
  );
}
