// Hanshi: stroke-order lessons with Ren. Ren calls the sheet's tools (show a
// stroke, next stroke, a character, start over) and speaks from the results;
// the server owns the lesson and grades every stroke the learner draws. The
// page answers Ren's calls, draws the sheet, keeps Ren's picture of it
// current, and tells Ren about strokes and button presses as they land.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, HostVideo, useAvatar, useToolNet, type Avatar, type ToolCall } from '../../../src/kit/index.ts';
import { boardState, say, TTL } from '../engine/director.ts';
import { mustDo } from '../engine/judge.ts';
import type { Command, Snapshot } from '../engine/types.ts';
import { createCoach, cueFor, type Coach } from './coach.ts';
import { Finished, HOST, Lesson, Picker } from './Desk.tsx';
import type { GridPoint } from './ink.ts';
import { Lobby, Logo } from './Lobby.tsx';
import { nextMarks, type Marks } from './marks.ts';
import { saveSheet } from './save.ts';
import ren from '../host/portrait.jpg';
import './hanshi.css';

const API = '/api/apps/stroke-tutor';
const OFFLINE = "That didn't reach your sheet. Check your connection and try again.";

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

interface Acted { view: Snapshot; event?: string; refused?: string }
interface Written { id: string; glyph: string; correct: number; total: number }

export function App() {
  const [view, setView] = useState<Snapshot | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<GridPoint[] | null>(null);
  const [miss, setMiss] = useState<GridPoint[] | null>(null);
  const [notice, setNotice] = useState('');
  const [picking, setPicking] = useState(false);
  const [broken, setBroken] = useState(false);
  const [written, setWritten] = useState<Written[]>([]);
  const lesson = useRef<string | null>(null);
  const viewRef = useRef<Snapshot | null>(null);
  const marksRef = useRef<Marks>({});
  const avatarRef = useRef<Avatar | null>(null);

  // One coaching line at a time, the newest only, once Ren has the floor: a
  // learner can draw three strokes in the time Ren takes to say one sentence.
  const coachRef = useRef<Coach | null>(null);
  coachRef.current ??= createCoach((text, ttlS) => avatarRef.current?.event(text, ttlS));
  const coach = coachRef.current;

  /** The sheet moved: the page's marks (and the list of characters written) follow it. */
  const land = useCallback((next: Snapshot, drawn?: GridPoint[]) => {
    const before = viewRef.current;
    marksRef.current = nextMarks(marksRef.current, next, drawn);
    viewRef.current = next;
    setMarks(marksRef.current);
    setView(next);
    if (next.phase === 'debrief' && next.character && before?.phase !== 'debrief') {
      const done = { id: next.character.id, glyph: next.character.glyph, correct: next.score.correct, total: next.score.total };
      setWritten((list) => [...list, done]);
    }
  }, []);

  // Ren's tool calls: the server acts, the sheet follows, the result is what Ren says.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    if (!lesson.current) throw new Error('the sheet is still being laid out; try again in a moment');
    setBusy(true);
    try {
      const { view: next, result } = await post<{ view: Snapshot; result: string }>(`/lessons/${lesson.current}/tool`, { name, arguments: args });
      coach.clear();   // this result is newer than any coaching line still waiting
      land(next);
      setMiss(null);
      setNotice('');
      setPicking(false);
      return result;
    } finally {
      setBusy(false);
    }
  }, [coach, land]);

  // If Ren narrates "let me show you" without calling it, the sheet does it and tells Ren.
  const net = useToolNet({
    match: (text) => {
      const v = viewRef.current;
      const call = v ? mustDo(text, v.phase, v.character?.id ?? null) : null;
      return call ? { id: `net-${Date.now()}`, ...call } : null;
    },
    run: async (call) => String(await onToolCall(call)),
    avatar: () => avatarRef.current!,
  });
  const avatar = useAvatar('stroke-tutor', { onToolCall: net.watch(onToolCall), onUserSaid: (text) => net.heard(text) });
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  useEffect(() => coach.live(live), [coach, live]);
  useEffect(() => coach.speaking(avatar.speaking), [coach, avatar.speaking]);

  // The lesson is laid out while Ren is on the way; calling Ren again carries on the same sheet.
  useEffect(() => {
    if (avatar.phase !== 'starting') return;
    const current = viewRef.current;
    if (lesson.current && current) {
      coach.push({ text: say.resume(current), ttlS: TTL.opening });
      return;
    }
    setBroken(false);
    void post<{ id: string; view: Snapshot; opening: string }>('/lessons').then(({ id, view: first, opening }) => {
      lesson.current = id;
      land(first);
      coach.push({ text: opening, ttlS: TTL.opening });
    }).catch((err) => {
      console.warn(err);
      setBroken(true);
    });
  }, [avatar.phase]);

  // Ren's picture of the sheet follows the sheet.
  useEffect(() => { if (view) avatar.state(boardState(view)); }, [view]);

  // A button acts at once; Ren cannot see the screen, so Ren is told.
  async function press(command: Command, character?: string) {
    if (!lesson.current) return;
    setBusy(true);
    try {
      const out = await post<Acted>(`/lessons/${lesson.current}/act`, { command, character });
      land(out.view);
      setMiss(null);
      setNotice(out.refused ?? '');
      if (!out.refused) setPicking(false);
      const cue = cueFor({ view: out.view, handled: true, event: out.event, refused: out.refused }, 'panel');
      if (cue) coach.push(cue);
    } catch (err) {
      console.warn(err);
      setNotice(OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  // A stroke the learner drew: graded on the server, then told to Ren.
  async function write(points: GridPoint[]) {
    if (!lesson.current) return;
    setPending(points);
    try {
      const out = await post<Acted>(`/lessons/${lesson.current}/stroke`, { points });
      const graded = !out.refused;
      land(out.view, graded ? points : undefined);
      setMiss(graded && out.view.phase === 'writing' ? points : null);
      setNotice(out.refused ?? '');
      const cue = cueFor({ view: out.view, handled: true, event: out.event, refused: out.refused }, 'panel');
      if (cue) coach.push(cue);
    } catch (err) {
      console.warn(err);
      setNotice(OFFLINE);
    } finally {
      setPending(null);
    }
  }

  if (avatar.phase === 'idle') return <Lobby onStart={(mic) => void avatar.start({ mic })} />;

  const choose = (id: string) => void press('choose', id);
  let desk;
  if (broken) {
    desk = (
      <section className="hs-picker is-problem" role="alert">
        <p className="hs-eyebrow">Something went wrong</p>
        <h1>Your sheet couldn't be laid out.</h1>
        <p className="hs-lede">Check your connection, then call {HOST} again to start a fresh lesson.</p>
      </section>
    );
  } else if (!view || view.phase === 'intro' || picking) {
    desk = <Picker view={view} busy={busy || !lesson.current} onPick={choose} onClose={picking && view?.character ? () => setPicking(false) : undefined} />;
  } else if (view.phase === 'debrief') {
    desk = <Finished view={view} marks={marks} busy={busy} notice={notice} onCommand={(c) => void press(c)} onPick={() => setPicking(true)} onSave={() => { if (!saveSheet(view, marks)) setNotice("Your browser couldn't save the sheet."); }} />;
  } else {
    desk = (
      <Lesson
        view={view} marks={marks} busy={busy} pending={pending} miss={miss} notice={notice}
        onStroke={(points) => void write(points)} onCommand={(c) => void press(c)} onPick={() => setPicking(true)}
      />
    );
  }
  const away = (avatar.phase === 'ended' || avatar.phase === 'failed') && view !== null;

  return (
    <div className="hs-app">
      <header className="hs-top">
        <Logo />
        {written.length > 0 && (
          <p className="hs-written" aria-label={`Written so far: ${written.map((w) => w.glyph).join(', ')}`}>
            <span>Written</span>
            {written.map((w, i) => <b key={i} lang={/[A-Z]/.test(w.glyph) ? undefined : 'ja'} title={`${w.correct} of ${w.total} right first try`}>{w.glyph}</b>)}
          </p>
        )}
        {live && avatar.secondsLeft !== null && avatar.secondsLeft <= 120 && (
          <p className="hs-time" role="status">{Math.max(1, Math.ceil(avatar.secondsLeft / 60))} min left</p>
        )}
        <CallControls avatar={avatar} className="hs-controls" />
      </header>

      <main className="hs-main">
        <div className="hs-deskwrap">{desk}</div>

        <aside className="hs-teacher" aria-label={`${HOST}, your teacher`}>
          <HostVideo avatar={avatar} name={HOST} poster={ren} className="hs-video">
            <CallStatus avatar={avatar} name={HOST} again={`Call ${HOST} again`} />
          </HostVideo>
          <div className="hs-nameplate">
            <p className="hs-name"><b>{HOST}</b> your teacher{live && <span className="hs-live">Live</span>}</p>
            {live && avatar.caption && <p className="hs-saying" aria-hidden="true">{avatar.caption}</p>}
            {away && <p className="hs-away">Your sheet is still here: keep writing, and {HOST} picks up where you are when you call again.</p>}
          </div>
        </aside>

        <ChatPanel
          avatar={avatar} name={HOST} className="hs-chat" placeholder="Ask Ren, or say “show me”, “next”, “the tree one”…"
          empty={<>Talk to {HOST} out loud, or type here. Try “Which way does it go?”</>}
        />
      </main>
    </div>
  );
}
