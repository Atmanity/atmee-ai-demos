// Hanshi: stroke-order lessons with Ren. Ren calls the sheet's tools (show a
// stroke, next stroke, a character, start over) and speaks from the results;
// the server owns the lesson and grades every stroke the learner draws. The
// page answers Ren's calls, draws the sheet, keeps Ren's picture of it
// current, and tells Ren about strokes and button presses as they land.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, HostVideo, useAvatar, useToolNet, type Avatar, type ToolCall } from '../../../src/kit/index.ts';
import { boardState, firstTries, say, TTL } from '../engine/director.ts';
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
const RELAID = 'Your sheet had to be set up again, so your progress on it is gone. Pick a character to carry on.';

/** The server no longer has this lesson: it keeps lessons in memory, so a restart, a deploy or hours idle lose them. */
class LessonGone extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, init);
  if (res.status === 404 && path.startsWith('/lessons/')) throw new LessonGone(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
const post = <T,>(path: string, body?: unknown) => call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const get = <T,>(path: string) => call<T>(path);

/** Every answer that moves the sheet carries the lesson's `seq`: only one newer than the sheet on screen may move it. */
interface Acted { view: Snapshot; event?: string; refused?: string; seq?: number }
interface Written { id: string; glyph: string; correct: number; total: number }
/** How a lay-out ended: on screen (with Ren's opening), overtaken by a newer one (which speaks for itself), or failed. */
type LaidOut = { status: 'laid'; opening: string } | { status: 'overtaken' } | { status: 'failed' };

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
  // The newest answer applied to the sheet. Requests can answer out of order
  // (a slow stroke, then Ren's quick tool call): a late answer must not roll
  // the sheet back or speak for a moment that has passed.
  const seqRef = useRef(0);
  const isNewest = (seq: number | undefined) => {
    if (seq === undefined) return true;
    if (seq <= seqRef.current) return false;
    seqRef.current = seq;
    return true;
  };
  // Only the newest lay-out may install a sheet: one asked for by a call that
  // failed and was placed again can answer last, after the learner has started
  // on the sheet the new call laid out.
  const setupGen = useRef(0);

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
      const done = { id: next.character.id, glyph: next.character.glyph, correct: firstTries(next), total: next.results.length };
      setWritten((list) => [...list, done]);
    }
  }, []);

  /**
   * A fresh lesson from the server, and how it ended. A lay-out that lands
   * after its call failed still lays out the sheet (the sheet outlives calls);
   * one overtaken by a newer lay-out, or by the page going, is dropped and
   * says so, so its caller stays quiet rather than report a loss.
   */
  const layOut = useCallback(async (): Promise<LaidOut> => {
    const mine = ++setupGen.current;
    lesson.current = null;
    setBroken(false);
    try {
      const { id, view: first, opening, seq } = await post<{ id: string; view: Snapshot; opening: string; seq?: number }>('/lessons');
      if (mine !== setupGen.current) return { status: 'overtaken' };
      lesson.current = id;
      seqRef.current = seq ?? 0;
      land(first);
      setMiss(null);
      setPicking(false);
      return { status: 'laid', opening };
    } catch (err) {
      if (mine !== setupGen.current) return { status: 'overtaken' };
      console.warn(err);
      setBroken(true);
      return { status: 'failed' };
    }
  }, [land]);

  /**
   * The server lost the lesson: a fresh sheet, and the learner is told why
   * their progress is gone. Resolves with what Ren should be told: a fresh
   * sheet, or none at all; null when a newer recovery overtook this one (that
   * one speaks). A coaching line still waiting is about the lost sheet, so it goes.
   */
  const recover = useCallback(async (): Promise<string | null> => {
    coach.clear();
    const done = await layOut();
    if (done.status === 'overtaken') return null;
    if (done.status === 'failed') return say.lost();
    setNotice(RELAID);
    return say.relaid();
  }, [coach, layOut]);

  // Ren's tool calls: the server acts, the sheet follows, the result is what Ren says.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    if (!lesson.current) throw new Error('the sheet is still being laid out; try again in a moment');
    setBusy(true);
    try {
      const { view: next, result, seq } = await post<{ view: Snapshot; result: string; seq?: number }>(`/lessons/${lesson.current}/tool`, { name, arguments: args });
      // Ren is told what the call did either way; the sheet moves only if nothing newer has.
      if (isNewest(seq)) {
        coach.clear();   // this result is newer than any coaching line still waiting
        land(next);
        setMiss(null);
        setNotice('');
        setPicking(false);
      }
      return result;
    } catch (err) {
      if (!(err instanceof LessonGone)) throw err;
      // A tool must answer; an overtaken recovery answers only that the sheet is being set up.
      return (await recover()) ?? say.relaying();
    } finally {
      setBusy(false);
    }
  }, [coach, land, recover]);

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
  // A call that ends or fails takes its waiting coaching line with it; the next call opens from the sheet as it is.
  useEffect(() => { if (avatar.phase === 'ended' || avatar.phase === 'failed') coach.clear(); }, [coach, avatar.phase]);
  // The page going: nothing it started may land or speak afterwards (the coach's quiet timer, a lay-out in flight).
  useEffect(() => () => {
    setupGen.current += 1;
    coach.clear();
  }, [coach]);

  // The lesson is laid out while Ren is on the way; calling Ren again carries on the same sheet,
  // once the server confirms it still has it.
  useEffect(() => {
    if (avatar.phase !== 'starting') return;
    const id = lesson.current;
    if (!id || !viewRef.current) {
      void layOut().then((done) => { if (done.status === 'laid') coach.push({ text: done.opening, ttlS: TTL.opening }); });
      return;
    }
    const resume = () => coach.push({ text: say.resume(viewRef.current!), ttlS: TTL.opening });
    void get<{ view: Snapshot; seq?: number }>(`/lessons/${id}`).then(({ view: now, seq }) => {
      if (lesson.current !== id) return;
      if (isNewest(seq)) land(now);
      resume();
    }, async (err) => {
      if (lesson.current !== id) return;
      if (!(err instanceof LessonGone)) return resume();   // a hiccup: carry on with the sheet on screen
      const told = await recover();
      if (told) coach.push({ text: told === say.lost() ? say.lostOpening() : say.relaidOpening(), ttlS: TTL.opening });
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
      if (!isNewest(out.seq)) return;
      land(out.view);
      setMiss(null);
      setNotice(out.refused ?? '');
      if (!out.refused) setPicking(false);
      const cue = cueFor({ view: out.view, handled: true, event: out.event, refused: out.refused }, 'panel');
      if (cue) coach.push(cue);
    } catch (err) {
      if (err instanceof LessonGone) {
        const told = await recover();
        if (told) coach.push({ text: told, ttlS: TTL.cue });
        return;
      }
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
      // The stroke it was drawn on: the server grades it only against that one.
      const on = viewRef.current;
      const at = on?.character ? { character: on.character.id, stroke: on.stroke_index, take: on.take } : undefined;
      const out = await post<Acted>(`/lessons/${lesson.current}/stroke`, { points, at });
      if (!isNewest(out.seq)) return;
      const graded = !out.refused;
      land(out.view, graded ? points : undefined);
      setMiss(graded && out.view.phase === 'writing' ? points : null);
      setNotice(out.refused ?? '');
      const cue = cueFor({ view: out.view, handled: true, event: out.event, refused: out.refused }, 'panel');
      if (cue) coach.push(cue);
    } catch (err) {
      if (err instanceof LessonGone) {
        const told = await recover();
        if (told) coach.push({ text: told, ttlS: TTL.cue });
        return;
      }
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
    desk = <Picker view={view} busy={busy || !lesson.current} notice={notice} onPick={choose} onClose={picking && view?.character ? () => setPicking(false) : undefined} />;
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
