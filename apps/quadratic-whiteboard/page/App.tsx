// Chalkline: a maths board a teacher drives by voice in front of a class.
// Ada, the board's voice, calls the board's tools (put an equation up, choose
// a method, the next line…) and reads out what each one returns. The server
// owns the working, so a line the class has not seen is nowhere in this page.
// The page answers Ada's calls, draws the board, keeps Ada's picture of it
// current, tells Ada about the teacher's own keys, and keeps the lesson notes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, HostVideo, clock, useAvatar, useToolNet, type ToolCall } from '../../../src/kit/index.ts';
import { boardState, said } from '../engine/director.ts';
import { mustDo } from '../engine/judge.ts';
import type { Intent } from '../engine/table.ts';
import type { Outcome, ToolOutcome, View } from '../engine/types.ts';
import { Board, Recap, Tray, type BoardStatus } from './Board.tsx';
import { HOST, Logo } from './brand.tsx';
import { Lobby } from './Lobby.tsx';
import { notesFileName, notesText, record, type NoteEntry } from './notes.ts';
import './chalkline.css';

const API = '/api/apps/quadratic-whiteboard';

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function App() {
  const [view, setView] = useState<View | null>(null);
  const [status, setStatus] = useState<BoardStatus>('loading');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const board = useRef<string | null>(null);
  const seen = useRef(-1);
  const inFlight = useRef(0);

  const track = useCallback((delta: number) => {
    inFlight.current += delta;
    setBusy(inFlight.current > 0);
  }, []);

  // Replies can cross (a slow equation reading, then a key): never go back to an older board.
  const show = useCallback((next: View) => {
    if (next.seq < seen.current) return;
    seen.current = next.seq;
    setView(next);
  }, []);

  // Ada's tool calls: the server acts, the board follows, the result is what Ada says.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall): Promise<string> => {
    if (!board.current) return said.failed();
    track(1);
    try {
      const outcome = await post<ToolOutcome>(`/boards/${board.current}/tool`, { name, arguments: args });
      show(outcome.view);
      setMessage(outcome.message ?? '');
      return outcome.result;
    } catch (err) {
      console.warn('[board] %s failed', name, err);
      return said.failed();
    } finally {
      track(-1);
    }
  }, [show, track]);

  // If Ada narrates "hiding the graph" without calling it, the board does it and tells her.
  const net = useToolNet({
    match: (text) => {
      const call = mustDo(text);
      return call ? { id: `net-${Date.now()}`, ...call } : null;
    },
    run: (call) => onToolCall(call),
    avatar: () => avatarRef.current,
  });
  const avatar = useAvatar('quadratic-whiteboard', { onToolCall: net.watch(onToolCall), onUserSaid: (text) => net.heard(text) });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  // A key or the equation box acts at once; Ada cannot see the screen, so she is told.
  async function act(body: { intent: Intent } | { equation: string }): Promise<Outcome | null> {
    if (!board.current) return null;
    track(1);
    try {
      const outcome = await post<Outcome>(`/boards/${board.current}/act`, body);
      show(outcome.view);
      setMessage(outcome.message ?? '');
      if (outcome.event) avatar.event(outcome.event, outcome.ttl ?? 25);
      return outcome;
    } catch (err) {
      console.warn('[board] a control failed', err);
      setMessage('The board didn’t answer. Try that again.');
      return null;
    } finally {
      track(-1);
    }
  }

  // The board is set up while Ada is on her way; calling back resumes the board the teacher left.
  const setUp = useCallback(() => {
    setStatus('loading');
    post<{ id: string; view: View; opening: string }>('/boards', { resume: board.current })
      .then(({ id, view: first, opening }) => {
        if (id !== board.current) seen.current = -1;
        board.current = id;
        setStatus('ready');
        show(first);
        setMessage('');
        avatarRef.current.event(opening, 60);
      })
      .catch((err) => {
        console.warn('[board] could not set up the board', err);
        setStatus('failed');
      });
  }, [show]);

  useEffect(() => {
    if (avatar.phase === 'starting') setUp();
  }, [avatar.phase]);

  // Ada's picture of the board, and the lesson notes, follow the board.
  useEffect(() => {
    if (!view) return;
    avatar.state(boardState(view));
    setNotes((current) => record(current, view));
  }, [view]);

  const download = () => {
    const when = new Date();
    const url = URL.createObjectURL(new Blob([notesText(notes, when)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = notesFileName(when);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  if (avatar.phase === 'idle') return <Lobby onStart={(mic) => void avatar.start({ mic })} />;

  const over = avatar.phase === 'ended' || avatar.phase === 'failed';
  const left = live && avatar.secondsLeft !== null && avatar.secondsLeft <= 180 ? avatar.secondsLeft : null;
  const onIntent = (intent: Intent) => void act({ intent });
  const onEquation = async (equation: string) => {
    const outcome = await act({ equation });
    return Boolean(outcome && !outcome.message);
  };

  return (
    <div className="cl-app">
      <header className="cl-top">
        <Logo />
        <div className="cl-top-end">
          {left !== null && <p className="cl-left" role="timer">{clock(left)} left on this call</p>}
          {notes.length > 0 && !over && <button type="button" className="cl-quiet" onClick={download}>Save lesson notes</button>}
          <CallControls avatar={avatar} className="cl-controls" />
        </div>
      </header>

      <main className="cl-main">
        <div className="cl-stage">
          <Board
            view={view} status={!view && over ? 'idle' : status} live={live} busy={busy} message={message}
            onRetry={setUp} onIntent={onIntent} onEquation={onEquation}
          />
          {over && notes.length > 0
            ? <Recap notes={notes} onDownload={download} />
            : <Tray view={view} live={live} busy={busy} onIntent={onIntent} onEquation={onEquation} />}
        </div>

        <aside className="cl-host" aria-label={`${HOST}, the board’s voice`}>
          <HostVideo avatar={avatar} name={HOST} className="cl-host-video">
            <CallStatus avatar={avatar} name={HOST} again={`Call ${HOST} again`} />
          </HostVideo>
          <p className="cl-nameplate">
            <b>{HOST}</b>
            <span>the board’s voice</span>
            {live && <span className={`cl-voice${avatar.speaking ? ' is-speaking' : ''}`}>{avatar.speaking ? 'Speaking' : avatar.micOn ? 'Listening' : 'Reading your messages'}</span>}
          </p>
        </aside>

        <ChatPanel
          avatar={avatar} name={HOST} className="cl-chat" placeholder={`Type to ${HOST}: “next”, an equation, a question…`}
          empty={<>Say “put up x squared minus five x plus six”, or type it here.</>}
        />
      </main>
    </div>
  );
}
