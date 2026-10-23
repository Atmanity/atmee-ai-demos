// Arcwise: a projectile-motion practice range coached by Theo. Theo moves the
// launcher, fires and changes the challenge by calling the range's tools, and
// speaks from what they return: `fire` waits for the ball to come down, so his
// first words after "fire" are where it landed. The student's hands work too:
// the arrow, the steppers, Fire and the challenge list act at once, and Theo
// (who cannot see the screen) is told what happened.
//
// The range runs in this page (engine/range.ts owns the clock that lands each
// shot); `Controls` is the one way into it, for tools and buttons alike.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, HostVideo, useAvatar, useToolNet, type Avatar, type ToolCall } from '../../../src/kit/index.ts';
import type { Interpret, Press } from '../engine/controls.ts';
import { rangeState, said } from '../engine/director.ts';
import { contextOf, mustDo } from '../engine/judge.ts';
import { clearedCount, shotCount } from '../engine/logbook.ts';
import type { Command } from '../engine/types.ts';
import { Board, Brief, Console, Lesson, Pips, Result, Syllabus } from './Board.tsx';
import portrait from '../host/portrait.jpg';
import { HOST, Lobby, Logo } from './Lobby.tsx';
import { Logbook } from './Logbook.tsx';
import { useRange } from './useRange.ts';
import './arcwise.css';

const ID = 'trajectory-coach';
const API = `/api/apps/${ID}`;
// ?challenge=moonshot opens on the Moon (the original's appParams.startChallenge).
const START = new URLSearchParams(location.search).get('challenge');

/** The app's model, for aim words the rules could not read. Null when there is none, it is unsure, or it is slow. */
const interpret: Interpret = async (text, ctx) => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 6000);
  try {
    const res = await fetch(`${API}/interpret`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
      body: JSON.stringify({ text, aim: ctx.aim, challengeId: ctx.challengeId }),
    });
    if (!res.ok) return null;
    const { command } = (await res.json()) as { command: Command | null };
    return command && (command.kind === 'aim' || command.kind === 'challenge') ? command : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** The end of what he is saying, short enough to sit beside a small video. */
const lastWords = (text: string) => (text.length > 140 ? `…${text.slice(-140).replace(/^\S*\s/, '')}` : text);

/** Why the launcher is locked, in the range's words; null while the call is on. */
function lockCopy(phase: Avatar['phase']): string | null {
  switch (phase) {
    case 'live': return null;
    case 'ended': return `Call ${HOST} again to step back up to the launcher.`;
    case 'failed': return `The launcher unlocks when ${HOST} is on the call.`;
    default: return `${HOST} is on his way to the range…`;
  }
}

export function App() {
  const avatarRef = useRef<Avatar | null>(null);
  const { range, controls, state, seq, message, log } = useRange(START, {
    // Only while the call is on: a shot landing after the end must not greet the next call.
    tell: (text, ttl) => { const a = avatarRef.current; if (a?.phase === 'live') a.event(text, ttl); },
    interpret,
  });
  const [view, setView] = useState<'range' | 'logbook'>('range');

  // Theo's tool calls: the range acts, the screen follows, the result is what he says.
  const onToolCall = useCallback(({ name, arguments: args }: ToolCall) => {
    setView('range');
    return controls.tool(name, args ?? {});
  }, [controls]);

  // If Theo narrates "fire" without calling it, the range does it and tells him.
  const net = useToolNet({
    match: (text) => { const call = mustDo(text, contextOf(range.snapshot())); return call ? { id: `net-${Date.now()}`, ...call } : null; },
    run: (call) => { setView('range'); return controls.tool(call.name, call.arguments, 'net'); },
    avatar: () => avatarRef.current!,
  });
  const avatar = useAvatar(ID, { onToolCall: net.watch(onToolCall), onUserSaid: (text) => net.heard(text) });
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  // The opening, held by the kit until Theo arrives: the challenge actually up.
  useEffect(() => {
    if (avatar.phase !== 'starting') return;
    setView('range');
    avatar.event(said.opening(range.snapshot()), 60);
  }, [avatar.phase]);

  // Theo's picture of the range follows the range.
  useEffect(() => { avatar.state(rangeState(state)); }, [state]);

  // A new screen starts at its top (the front door or the range may have been scrolled).
  useEffect(() => { document.documentElement.scrollTop = 0; }, [avatar.phase === 'idle', view]);

  // The call over, with something to show for it: the logbook.
  useEffect(() => { if (avatar.phase === 'ended' && shotCount(log) > 0) setView('logbook'); }, [avatar.phase]);

  if (avatar.phase === 'idle') return <Lobby onStart={(mic) => void avatar.start({ mic })} />;

  const press = (p: Press) => { controls.press(p); };
  const cleared = clearedCount(log);
  const allCleared = state.catalog.every((e) => e.cleared);
  const again = () => { setView('range'); void avatar.start({ mic: avatar.micOn }); };

  return (
    <div className="aw-app">
      <header className="aw-top">
        <Logo />
        <Pips state={state} />
        {view === 'logbook'
          ? <button type="button" className="aw-tab" onClick={() => setView('range')} aria-label="Back to the range"><span aria-hidden="true">←</span> Range</button>
          : <button type="button" className="aw-tab" onClick={() => setView('logbook')}>Logbook <b>{cleared}/{state.catalog.length}</b></button>}
        <CallControls avatar={avatar} className="aw-controls" />
      </header>

      <main className="aw-main">
        <div className="aw-stage">
          {view === 'logbook' ? (
            <Logbook log={log} back={live ? 'Back to the range' : `Call ${HOST} again`} onBack={live ? () => setView('range') : again} />
          ) : (
            <>
              <Brief state={state} />
              <Board state={state} seq={seq} locked={lockCopy(avatar.phase)} onPress={press} />
              <Console state={state} seq={seq} live={live} onPress={press} />
              <Result state={state} message={message} />
              <Lesson state={state} live={live} allCleared={allCleared} onPress={press} onLogbook={() => setView('logbook')} />
              <Syllabus state={state} live={live} onPress={press} />
            </>
          )}
        </div>

        <div className="aw-side">
          <aside className={`aw-coach ${live ? 'is-live' : ''}`} aria-label={`${HOST}, your coach`}>
            <HostVideo avatar={avatar} name={HOST} poster={portrait} className="aw-coach-video">
              <CallStatus avatar={avatar} name={HOST} again={`Call ${HOST} again`} onAgain={again} />
            </HostVideo>
            <div className="aw-coach-meta">
              <p className="aw-nameplate">
                <b>{HOST}</b><span>your coach</span>
                {live && <span className="aw-onair">On the range</span>}
              </p>
              {/* Where the video is small, his words beside it (the chat has them for screen readers). */}
              {live && avatar.caption && <p className="aw-coach-caption" aria-hidden="true">{lastWords(avatar.caption)}</p>}
            </div>
          </aside>

          <ChatPanel
            avatar={avatar} name={HOST} className="aw-chat" placeholder='Try "forty degrees", "fire" or "why did that miss?"'
            empty={<>Talk to {HOST} out loud, or type here: an angle, &ldquo;a bit more speed&rdquo;, &ldquo;fire&rdquo;.</>}
          />
        </div>
      </main>
    </div>
  );
}
