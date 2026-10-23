// The avatar's half of every app's screen: the stage (video, connection
// phases, captions), the composer (typing, microphone, end) and a transcript.
// Theme through CSS variables (kit.css): --accent, --stage-bg, --radius.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Avatar } from './useAvatar.ts';
import './kit.css';

const PHASE_TEXT: Record<string, [string, string]> = {
  starting: ['Calling…', 'This takes a few seconds.'],
  warming: ['Getting ready', ''],
  connecting: ['Connecting…', ''],
  arriving: ['Almost there', 'Joining now…'],
};

export function AvatarStage({ avatar, name, lobby, startLabel = 'Start', allowTyping = true }: {
  avatar: Avatar;
  name: string;
  /** Shown before the session starts, above the start buttons. */
  lobby?: ReactNode;
  startLabel?: string;
  /** Offer "type instead" next to the microphone start. */
  allowTyping?: boolean;
}) {
  const { phase } = avatar;
  const connecting = phase in PHASE_TEXT;
  return (
    <div className={`kit-stage ${avatar.speaking ? 'is-speaking' : ''}`}>
      <video ref={avatar.videoRef} className="kit-video" playsInline muted />
      <audio ref={avatar.audioRef} autoPlay />
      {phase === 'live' && (
        <>
          <div className="kit-badge"><span className="kit-dot" />{name}</div>
          {avatar.secondsLeft !== null && <div className="kit-timer">{clock(avatar.secondsLeft)}</div>}
          <Captions text={avatar.caption} />
          {avatar.heard && <div className="kit-heard">“{avatar.heard}”</div>}
          {avatar.audioBlocked && <button className="kit-btn kit-hear" onClick={avatar.resumeAudio}>Tap to hear {name}</button>}
        </>
      )}
      {phase === 'idle' && (
        <div className="kit-overlay">
          {lobby}
          <div className="kit-actions">
            <button className="kit-btn kit-primary" onClick={() => avatar.start({ mic: true })}>{startLabel}</button>
            {allowTyping && <button className="kit-btn" onClick={() => avatar.start({ mic: false })}>Use the keyboard</button>}
          </div>
        </div>
      )}
      {connecting && (
        <div className="kit-overlay">
          <div className="kit-spinner" />
          <div className="kit-title">{PHASE_TEXT[phase][0]}</div>
          <div className="kit-detail">{phase === 'warming' ? avatar.detail : PHASE_TEXT[phase][1]}</div>
        </div>
      )}
      {(phase === 'ended' || phase === 'failed') && (
        <div className="kit-overlay">
          <div className="kit-title">{phase === 'ended' ? 'Call ended' : 'We could not connect'}</div>
          {avatar.detail && <div className="kit-detail">{avatar.detail}</div>}
          <div className="kit-actions">
            <button className="kit-btn kit-primary" onClick={() => avatar.start({ mic: avatar.micOn })}>Call again</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Captions({ text }: { text: string }) {
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
  return shown ? <div className="kit-captions"><span>{shown}</span></div> : null;
}

export function Composer({ avatar, placeholder = 'Type a message…', onSubmit }: {
  avatar: Avatar;
  placeholder?: string;
  /** Defaults to a typed turn to the avatar. Return false to keep the text. */
  onSubmit?: (text: string) => boolean | void;
}) {
  const [text, setText] = useState('');
  const live = avatar.phase === 'live';
  const submit = () => {
    const t = text.trim();
    if (!t || !live) return;
    if ((onSubmit ? onSubmit(t) : avatar.say(t)) !== false) setText('');
  };
  return (
    <div className="kit-composer">
      <input
        className="kit-input" value={text} placeholder={live ? placeholder : 'Start the call to chat'} disabled={!live}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <button className="kit-btn" disabled={!live || !text.trim()} onClick={submit}>Send</button>
      {live && (
        <button className={`kit-btn kit-icon ${avatar.micOn ? '' : 'is-off'}`} title={avatar.micOn ? 'Mute microphone' : 'Unmute microphone'} onClick={() => avatar.setMic(!avatar.micOn)}>
          {avatar.micOn ? '🎙' : '🔇'}
        </button>
      )}
      {live && <button className="kit-btn kit-danger" onClick={() => avatar.end()}>End</button>}
    </div>
  );
}

export function Transcript({ avatar, names }: { avatar: Avatar; names: { avatar: string; user?: string } }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [avatar.lines.length]);
  return (
    <div className="kit-transcript" ref={box}>
      {avatar.lines.map((line) => (
        <div key={line.id} className={`kit-line is-${line.who}`}>
          <span className="kit-who">{line.who === 'avatar' ? names.avatar : names.user ?? 'You'}</span>
          <span>{line.text}</span>
        </div>
      ))}
    </div>
  );
}

export function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.max(0, seconds % 60)).padStart(2, '0')}`;
}
