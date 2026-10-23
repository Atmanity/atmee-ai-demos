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
import portrait from '../host/portrait.jpg';
import { Board, Recap, Tray, type BoardStatus } from './Board.tsx';
import { HOST, Logo } from './brand.tsx';
import { Lobby } from './Lobby.tsx';
import { notesFileName, notesText, record, type NoteEntry } from './notes.ts';
import './chalkline.css';

const API = '/api/apps/quadratic-whiteboard';
/** How long the safety net waits on a typed line (a spoken one: the kit's 7 s). */
export const TYPED_NET_MS = 15_000;

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
  // Which call the page is on: bumped when a call starts, ends or fails, and
  // when the page goes. Anything started for a call (a board setup, a tool
  // call, a key) records it, and an answer that comes back after that call is
  // over is dropped: it never draws, tells Ada or holds the keys in the next one.
  const call = useRef(0);
  const setups = useRef(0);
  const current = (mine: number) => mine === call.current;

  /** Requests in flight for this call; the keys wait for them. */
  const track = useCallback((delta: number) => {
    inFlight.current += delta;
    setBusy(inFlight.current > 0);
  }, []);

  /** A new call, or the end of one: what was in flight belongs to the last. */
  const nextCall = useCallback(() => {
    call.current += 1;
    inFlight.current = 0;
    setBusy(false);
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
    const mine = call.current;
    track(1);
    try {
      const outcome = await post<ToolOutcome>(`/boards/${board.current}/tool`, { name, arguments: args });
      if (current(mine)) {
        show(outcome.view);
        setMessage(outcome.message ?? '');
      }
      return outcome.result;
    } catch (err) {
      console.warn('[board] %s failed', name, err);
      return said.failed();
    } finally {
      if (current(mine)) track(-1);
    }
  }, [show, track]);

  // If Ada narrates "hiding the graph" without calling it, the board does it and tells her.
  // Typed lines get longer: live, Ada answered them up to a turn late, and the
  // net's own message then queued ahead of her reply and made the call twice.
  const netOptions = {
    match: (text: string) => {
      const call = mustDo(text);
      return call ? { id: `net-${Date.now()}`, ...call } : null;
    },
    run: (call: ToolCall) => onToolCall(call),
    avatar: () => avatarRef.current,
  };
  const spokenNet = useToolNet(netOptions);
  const typedNet = useToolNet({ ...netOptions, waitMs: TYPED_NET_MS });
  const avatar = useAvatar('quadratic-whiteboard', {
    onToolCall: typedNet.watch(spokenNet.watch(onToolCall)),
    onUserSaid: (text, how) => (how === 'typed' ? typedNet : spokenNet).heard(text),
  });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  // A key or the equation box acts at once; Ada cannot see the screen, so she is told.
  async function act(body: { intent: Intent } | { equation: string }): Promise<Outcome | null> {
    if (!board.current) return null;
    const mine = call.current;
    track(1);
    try {
      const outcome = await post<Outcome>(`/boards/${board.current}/act`, body);
      if (!current(mine)) return null;
      show(outcome.view);
      setMessage(outcome.message ?? '');
      if (outcome.event) avatarRef.current.event(outcome.event, outcome.ttl ?? 25);
      return outcome;
    } catch (err) {
      console.warn('[board] a control failed', err);
      if (current(mine)) setMessage('The board didn’t answer. Try that again.');
      return null;
    } finally {
      if (current(mine)) track(-1);
    }
  }

  // The board is set up while Ada is on her way; calling back resumes the board the teacher left.
  // Only the newest setup of the current call installs its board: one from a
  // call that failed and was placed again, or a retry overtaken by another, is dropped.
  const setUp = useCallback(() => {
    const mine = call.current;
    const attempt = ++setups.current;
    const stale = () => !current(mine) || attempt !== setups.current;
    setStatus('loading');
    post<{ id: string; view: View; opening: string }>('/boards', { resume: board.current })
      .then(({ id, view: first, opening }) => {
        if (stale()) return;
        if (id !== board.current) seen.current = -1;
        board.current = id;
        setStatus('ready');
        show(first);
        setMessage('');
        avatarRef.current.event(opening, 60);
      })
      .catch((err) => {
        console.warn('[board] could not set up the board', err);
        if (!stale()) setStatus('failed');
      });
  }, [show]);

  useEffect(() => {
    if (avatar.phase === 'starting') {
      nextCall();
      setUp();
    } else if (avatar.phase === 'ended' || avatar.phase === 'failed') {
      nextCall();
    }
  }, [avatar.phase]);
  // Nothing answers into a page that has gone.
  useEffect(() => () => { call.current += 1; }, []);

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
          <HostVideo avatar={avatar} name={HOST} poster={portrait} className="cl-host-video">
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
