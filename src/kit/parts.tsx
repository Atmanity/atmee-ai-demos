// Parts an app arranges in its own layout, so the host is part of the product
// rather than a widget beside it: the host's video tile, what to say while
// the call connects or after it ends, the call controls and a chat panel.
// Everything speaks the product's language: a host with a name and a call,
// never a session, an avatar or a room. Style them with your own classes and
// the --call-* variables (parts.css).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Avatar } from './useAvatar.ts';
import './parts.css';

/** What to show for the call's phase, in the product's words; null while idle or live. */
export function callCopy(avatar: Avatar, name: string): { title: string; detail: string; busy: boolean } | null {
  switch (avatar.phase) {
    case 'starting': return { title: `Calling ${name}…`, detail: 'This takes a few seconds.', busy: true };
    case 'warming': return { title: `${name} is getting ready`, detail: avatar.detail, busy: true };
    case 'connecting': return { title: `Connecting to ${name}…`, detail: '', busy: true };
    case 'arriving': return { title: `${name} is joining…`, detail: 'Almost there.', busy: true };
    case 'ended': return { title: 'Call ended', detail: '', busy: false };
    case 'failed': return { title: `Couldn't reach ${name}`, detail: avatar.detail, busy: false };
    default: return null;
  }
}

/** The host's video, with live captions, a speaking ring and "tap to hear" when the browser blocks sound. */
export function HostVideo({ avatar, name, captions = true, className = '', children }: {
  avatar: Avatar;
  name: string;
  /** Show the host's words over the video. */
  captions?: boolean;
  className?: string;
  /** Laid over the video (a lobby, a status). */
  children?: ReactNode;
}) {
  const live = avatar.phase === 'live';
  return (
    <div className={`call-video ${avatar.speaking ? 'is-speaking' : ''} ${live ? 'is-live' : ''} ${className}`}>
      <video ref={avatar.videoRef} playsInline muted aria-label={`${name}'s video`} />
      <audio ref={avatar.audioRef} autoPlay />
      {live && captions && <Caption text={avatar.caption} />}
      {live && avatar.audioBlocked && (
        <button type="button" className="call-hear" onClick={avatar.resumeAudio}>Tap to hear {name}</button>
      )}
      {children}
    </div>
  );
}

/** The call's state over the video while it connects, and after it ends or fails, with a way back in. */
export function CallStatus({ avatar, name, again = 'Call again', onAgain }: {
  avatar: Avatar;
  name: string;
  /** The button after the call ends or fails. */
  again?: string;
  onAgain?: () => void;
}) {
  const copy = callCopy(avatar, name);
  if (!copy) return null;
  return (
    <div className="call-status" role="status" aria-live="polite">
      {copy.busy && <span className="call-spinner" aria-hidden="true" />}
      <strong>{copy.title}</strong>
      {copy.detail && <span>{copy.detail}</span>}
      {!copy.busy && (
        <button type="button" className="call-again" onClick={onAgain ?? (() => void avatar.start({ mic: avatar.micOn }))}>{again}</button>
      )}
    </div>
  );
}

/** Microphone and hang-up, for while the call is live. */
export function CallControls({ avatar, className = '' }: { avatar: Avatar; className?: string }) {
  if (avatar.phase !== 'live') return null;
  return (
    <div className={`call-controls ${className}`}>
      <button type="button" className={`call-round ${avatar.micOn ? '' : 'is-off'}`} onClick={() => avatar.setMic(!avatar.micOn)}
        aria-pressed={!avatar.micOn} title={avatar.micOn ? 'Mute your microphone' : 'Unmute your microphone'}>
        {avatar.micOn ? <MicIcon /> : <MicOffIcon />}
      </button>
      <button type="button" className="call-round is-end" onClick={() => void avatar.end()} title="End the call">
        <HangUpIcon />
      </button>
    </div>
  );
}

/** The conversation as chat bubbles, with a box to type into. */
export function ChatPanel({ avatar, name, placeholder, onSubmit, className = '', empty }: {
  avatar: Avatar;
  name: string;
  placeholder?: string;
  /** Defaults to a typed turn to the host. Return false to keep the text. */
  onSubmit?: (text: string) => boolean | void;
  className?: string;
  /** Shown before anything has been said. */
  empty?: ReactNode;
}) {
  const [text, setText] = useState('');
  const list = useRef<HTMLOListElement>(null);
  const live = avatar.phase === 'live';
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [avatar.lines.length, avatar.heard]);
  const send = () => {
    const t = text.trim();
    if (!t || !live) return;
    if ((onSubmit ? onSubmit(t) : avatar.say(t)) !== false) setText('');
  };
  return (
    <div className={`call-chat ${className}`}>
      <ol className="call-lines" ref={list} aria-live="polite">
        {avatar.lines.length === 0 && !avatar.heard && empty && <li className="call-empty">{empty}</li>}
        {avatar.lines.map((line) => (
          <li key={line.id} className={`call-line is-${line.who}`}>
            {line.who === 'avatar' && <span className="call-who">{name}</span>}
            <span className="call-bubble">{line.text}</span>
          </li>
        ))}
        {avatar.heard && <li className="call-line is-user is-hearing"><span className="call-bubble">{avatar.heard}</span></li>}
      </ol>
      <form className="call-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          className="call-input" value={text} onChange={(e) => setText(e.target.value)} disabled={!live}
          placeholder={live ? placeholder ?? `Message ${name}…` : `Start the call to chat with ${name}`} aria-label={`Message ${name}`}
        />
        <button type="submit" className="call-send" disabled={!live || !text.trim()} title="Send"><SendIcon /></button>
      </form>
    </div>
  );
}

function Caption({ text }: { text: string }) {
  // Only the sentence being spoken, cleared after a pause.
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!text) return;
    const sentences = text.trim().split(/(?<=[.!?…])\s+/);
    let line = sentences.pop() ?? '';
    if (line.length < 30 && sentences.length) line = `${sentences.pop()} ${line}`;
    setShown(line.length > 140 ? `…${line.slice(-140)}` : line);
    const id = setTimeout(() => setShown(''), 5000);
    return () => clearTimeout(id);
  }, [text]);
  return shown ? <div className="call-caption"><span>{shown}</span></div> : null;
}

const icon = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
export const MicIcon = () => <svg {...icon}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
export const MicOffIcon = () => <svg {...icon}><path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5 11a7 7 0 0 0 11.6 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18" /></svg>;
export const HangUpIcon = () => <svg {...icon}><path d="M3 15.5c5.3-4.7 12.7-4.7 18 0l-2.2 2.6-3.6-1.4.3-2.5a10 10 0 0 0-7 0l.3 2.5-3.6 1.4z" /></svg>;
export const SendIcon = () => <svg {...icon}><path d="M4 12l16-8-6 16-2.5-6.5z" /></svg>;
