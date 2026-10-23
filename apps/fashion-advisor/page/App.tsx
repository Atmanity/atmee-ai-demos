// Notch: a fitting with Emery. Emery calls the fitting's tools (rate the
// outfit, more pieces, try one on, back to the own photo) and speaks from
// their results; the page answers those calls through the server, shows the
// mirror, the verdict and the rail, keeps Emery's picture of the board
// current, and tells her about every button press. The board works with or
// without her: a photo, an occasion and a verdict need no call.
import { useEffect, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, HostVideo, useAvatar, useToolNet, type ToolCall } from '../../../src/kit/index.ts';
import { boardState, HOST, said } from '../engine/director.ts';
import type { Ran, Step } from '../engine/fitting.ts';
import { mustDo } from '../engine/judge.ts';
import type { Milestone, View } from '../engine/types.ts';
import { Mirror, OccasionPicker, Rail, Verdict } from './Fitting.tsx';
import { Lobby, Logo } from './Lobby.tsx';
import { Notes, type Rating } from './Notes.tsx';
import { preparePhoto } from './photo.ts';
import portrait from '../host/portrait.jpg';
import exampleOutfit from './sample-outfit.jpg';
import './notch.css';

const API = '/api/apps/fashion-advisor';
/** How long a tool call waits for slow work before Emery hears "still working" (the tools time out at 25 s). */
const TOOL_WAIT_MS = 20_000;

type Button =
  | { button: 'photo'; mime: string; data: string; example: boolean }
  | { button: 'occasion'; occasion: string }
  | { button: 'tryOn'; piece: string; why: string }
  | { button: 'rerate' | 'more' | 'restore' };

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/** The sentence being spoken, for the phone's host strip. */
const lastWords = (text: string) => {
  const sentences = text.trim().split(/(?<=[.!?…])\s+/);
  const line = sentences.pop() ?? '';
  return line.length > 110 ? `…${line.slice(-110)}` : line;
};

const PencilIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>;

export function App() {
  const [view, setView] = useState<View | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [trouble, setTrouble] = useState('');
  const [roomFailed, setRoomFailed] = useState(false);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [notes, setNotes] = useState(false);
  const [picking, setPicking] = useState(false);
  const studio = useRef<string | null>(null);
  const opening = useRef(false);        // a fitting room is being opened
  const openingOwed = useRef(false);    // Emery arrived before the room was open
  const lastArrival = useRef<string | null>(null);   // the fitting Emery last arrived to
  const rev = useRef(-1);
  const viewRef = useRef<View | null>(null);
  const lastState = useRef('');
  const lastRating = useRef('');
  // Work belongs to the fitting (it outlives a call: the board keeps working), but what
  // Emery is told belongs to the call it was started in. A call starting or ending moves
  // the generation on, so a late outcome never speaks into another call; the next call's
  // opening describes the screen instead. The waits a tool holds are that call's too.
  const callGen = useRef(0);
  const waits = useRef(new Set<ReturnType<typeof setTimeout>>());
  const clearWaits = () => { waits.current.forEach((wait) => clearTimeout(wait)); waits.current.clear(); };

  function apply(v: View) {
    if (v.rev < rev.current) return;   // an answer overtaken by a newer one
    rev.current = v.rev;
    viewRef.current = v;
    setView(v);
  }

  /** Tell Emery, if she is in the call the work was started in (`gen`). If not, her next opening covers the board. */
  function tell(text: string, ttl = 30, gen = callGen.current) {
    const a = avatarRef.current;
    if (gen === callGen.current && a?.phase === 'live') a.event(text, ttl);
  }

  /** Follow a job's milestones: each brings a newer board. The result milestone's words are returned; the others are told (in call `gen` only). */
  function follow(id: string, job: NonNullable<Ran['job']>, result: Milestone | null, gen: number): Promise<string | null> {
    return new Promise((resolve) => {
      void (async () => {
        for (const m of job.milestones) {
          const step = await request<Step>(`/studios/${id}/jobs/${job.id}/${m}`).catch(() => null);
          if (id !== studio.current) break;
          if (!step) continue;
          apply(step.view);
          if (m === result) resolve(step.text);
          else if (step.text) tell(step.text, 30, gen);
        }
        resolve(null);
      })();
    });
  }

  // Emery's tool calls: the fitting acts, the board follows, the words are what she says next.
  async function onToolCall({ name, arguments: args }: ToolCall): Promise<string> {
    const id = studio.current;
    const gen = callGen.current;
    if (!id) throw new Error('the fitting room is still opening; try again in a moment');
    const ran = await request<Ran>(`/studios/${id}/tool`, { name, arguments: args });
    if (id !== studio.current) throw new Error('that fitting is over');
    apply(ran.view);
    if (ran.text !== null || !ran.job || !ran.result) {
      if (ran.job) void follow(id, ran.job, null, gen);   // a try-on: its picture and its new score are told as they land
      return ran.text ?? said.lost();
    }
    const outcome = follow(id, ran.job, ran.result, gen);
    let wait: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((resolve) => { wait = setTimeout(resolve, TOOL_WAIT_MS, 'late'); waits.current.add(wait); });
    const first = await Promise.race([outcome, late]);
    clearTimeout(wait);
    waits.current.delete(wait!);
    if (first !== 'late') return first ?? said.lost();
    void outcome.then((text) => { if (text && id === studio.current) tell(said.late(text), 45, gen); });
    return said.stillWorking();
  }

  // If Emery says "let's rate it for the wedding" without calling it, the fitting does it and tells her.
  const net = useToolNet({
    match: (text) => {
      const call = mustDo(text, { tryOns: viewRef.current?.tryOnAvailable ?? false });
      return call ? { id: `net-${Date.now()}`, ...call } : null;
    },
    // The kit stands down by itself when she called this tool, or any other just as the words came.
    run: (call) => onToolCall(call),
    avatar: () => avatarRef.current!,
  });

  const avatar = useAvatar('fashion-advisor', {
    onToolCall: net.watch(onToolCall),
    onUserSaid: (text) => net.heard(text),
    onLive: () => {
      const v = viewRef.current;
      if (!v) return void (openingOwed.current = true);
      const back = lastArrival.current === studio.current;
      lastArrival.current = studio.current;
      const opening = said.opening(v, back);
      if (opening) avatarRef.current?.event(opening, 60);
    },
    // The fitting's ending: the notes, once there is a verdict to keep. Nothing of this call carries over.
    onEnded: () => {
      endCall();
      if (viewRef.current?.analysis) setNotes(true);
    },
  });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  /** A call is over (or never connected): its waits, its pending opening and its outcomes stay with it. */
  function endCall() {
    callGen.current += 1;
    clearWaits();
    openingOwed.current = false;
  }

  // A new call starts a new generation; one that ends or fails closes its own (also on unmount).
  useEffect(() => {
    if (avatar.phase === 'starting') callGen.current += 1;
    if (avatar.phase === 'ended' || avatar.phase === 'failed') endCall();
  }, [avatar.phase]);
  useEffect(() => clearWaits, []);

  /** A fresh fitting room: an empty mirror, no occasion. */
  async function openFitting() {
    if (opening.current) return;
    opening.current = true;
    const gen = callGen.current;
    studio.current = null;
    rev.current = -1;
    viewRef.current = null;
    lastRating.current = '';
    setView(null);
    setRatings([]);
    setTrouble('');
    setRoomFailed(false);
    try {
      const { id, view: first } = await request<{ id: string; view: View }>('/studios', {});
      studio.current = id;
      apply(first);
      if (openingOwed.current) {
        // Emery arrived (in this call) before the room opened. A fresh room is empty and her
        // greeting already asked where they're headed, so there is no opening to send.
        openingOwed.current = false;
        lastArrival.current = id;
      } else if (gen === callGen.current && avatarRef.current.phase === 'live') {
        // A new fitting while she is in the call (the same one it was asked for in).
        lastArrival.current = id;
        tell(said.newFitting(), 30, gen);
      }
    } catch (err) {
      console.warn('[notch] could not open a fitting room', err);
      setRoomFailed(true);
    } finally {
      opening.current = false;
    }
  }

  // The first call opens the fitting room while Emery is on her way; calling her again keeps it.
  useEffect(() => {
    if (avatar.phase === 'starting' && !studio.current) void openFitting();
  }, [avatar.phase]);

  // A button acts at once; Emery cannot see the screen, so she is told what was pressed and what came of it.
  async function press(body: Button) {
    const id = studio.current;
    const gen = callGen.current;
    if (!id) return;
    setTrouble('');
    try {
      const ran = await request<Ran>(`/studios/${id}/act`, body);
      if (id !== studio.current) return;
      apply(ran.view);
      if (ran.text) tell(ran.text, 30, gen);
      if (ran.job) {
        const outcome = follow(id, ran.job, ran.result ?? null, gen);
        if (ran.result) void outcome.then((text) => { if (text && id === studio.current) tell(text, 60, gen); });
      }
    } catch (err) {
      console.warn('[notch] %s failed', body.button, err);
      setTrouble("That didn't go through. Check your connection and try again.");
    }
  }

  async function sendPhoto(file: Blob, example = false) {
    setTrouble('');
    try {
      const photo = await preparePhoto(file);
      setPreview(photo.preview);
      await press({ button: 'photo', mime: photo.mime, data: photo.data, example });
    } catch (err) {
      setTrouble((err as Error).message);
    } finally {
      setPreview(null);
    }
  }
  const sendExample = () => void fetch(exampleOutfit).then((r) => r.blob()).then((blob) => sendPhoto(blob, true))
    .catch(() => setTrouble("The example outfit didn't load. Try again, or upload your own photo."));

  function newFitting() {
    setNotes(false);
    setPicking(false);
    void openFitting();
    if (avatar.phase === 'ended' || avatar.phase === 'failed') void avatar.start({ mic: avatar.micOn });
  }

  // A photo's local preview is let go once it is replaced.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // Emery's picture of the board follows the board.
  useEffect(() => {
    if (!view) return;
    const text = boardState(view);
    if (text !== lastState.current) {
      lastState.current = text;
      avatar.state(text);
    }
  }, [view]);

  // Catalogue shots land in the background: look again while some are still rendering.
  useEffect(() => {
    const id = studio.current;
    if (!id || !view?.thumbnailsPending) return;
    const timer = setTimeout(() => { void request<{ view: View }>(`/studios/${id}`).then((r) => { if (id === studio.current) apply(r.view); }).catch(() => {}); }, 2500);
    return () => clearTimeout(timer);
  }, [view]);

  // Every verdict of the fitting, as it lands, for the notes and the score change.
  useEffect(() => {
    const a = view?.analysis;
    if (!view || !a || view.jobs.analysing || view.jobs.tryOn) return;
    const withItem = view.image?.kind === 'tryon' ? view.image.item : undefined;
    const key = [a.target_style, a.style_score, a.style_summary, withItem ?? ''].join('|');
    if (key === lastRating.current) return;
    lastRating.current = key;
    setRatings((rs) => [...rs, { occasion: a.target_style || view.target, score: a.style_score, summary: a.style_summary, ...(withItem ? { with: withItem } : {}) }]);
  }, [view]);

  if (avatar.phase === 'idle') return <Lobby onStart={(mic) => void avatar.start({ mic })} />;

  const ready = Boolean(view);
  const jobs = view?.jobs;
  const failed = Boolean(view && !view.analysis && view.image && view.target && jobs && !jobs.analysing && !jobs.photo && !jobs.tryOn && !jobs.queued.length);
  const latest = ratings[ratings.length - 1];
  const before = ratings[ratings.length - 2];
  const delta = latest?.with && before && before.occasion === latest.occasion ? { by: latest.score - before.score, item: latest.with } : null;
  const notice = trouble || (roomFailed ? "We couldn't open your fitting room. Start a new fitting to try again." : '') || (!failed && view?.notice ? view.notice.text : '');
  const left = avatar.secondsLeft;
  const pickOccasion = (occasion: string) => { setPicking(false); void press({ button: 'occasion', occasion }); };

  return (
    <div className="nt-app">
      <header className="nt-top">
        <Logo />
        {view?.target && (
          <button type="button" className="nt-pill" onClick={() => setPicking((p) => !p)} aria-expanded={picking} disabled={!ready}>
            <span className="nt-label">Dressing for</span> {view.target} <PencilIcon />
          </button>
        )}
        <div className="nt-top-end">
          {live && left !== null && left <= 120 && <span className="nt-timer" aria-live="polite">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left</span>}
          {view?.analysis && <button type="button" className="nt-quiet" onClick={() => setNotes(true)}>Fitting notes</button>}
          {roomFailed && <button type="button" className="nt-quiet" onClick={newFitting}>Start a new fitting</button>}
          <CallControls avatar={avatar} className="nt-controls" />
        </div>
      </header>

      <main className="nt-room">
        <div className="nt-mirror-cell">
          <Mirror view={view} preview={preview} ready={ready} notice={notice}
            onFile={(file) => void sendPhoto(file)} onExample={sendExample} onRestore={() => void press({ button: 'restore' })} />
        </div>

        <div className="nt-verdict-cell">
          {picking && view?.target && (
            <div className="nt-picker" role="group" aria-label="Rate it for something else">
              <p>Same outfit, another occasion. Now: <b>{view.target}</b></p>
              <OccasionPicker current={view.target} autoFocus onPick={pickOccasion} onClose={() => setPicking(false)} />
            </div>
          )}
          <Verdict view={view} failed={failed} delta={delta} ready={ready}
            onRerate={() => void press({ button: 'rerate' })} onOccasion={pickOccasion} onChangeOccasion={() => setPicking(true)} />
        </div>

        <aside className="nt-host" aria-label={`${HOST}, your stylist`}>
          <HostVideo avatar={avatar} name={HOST} poster={portrait} className="nt-host-video">
            <CallStatus avatar={avatar} name={HOST} again={`Call ${HOST} again`} />
          </HostVideo>
          <div className="nt-nameplate">
            <p><b>{HOST}</b> <span>your stylist</span></p>
            {live && <span className="nt-oncall">On call</span>}
            {live && avatar.speaking && avatar.caption && <p className="nt-saying">{lastWords(avatar.caption)}</p>}
          </div>
        </aside>

        <div className="nt-rail-cell">
          <Rail view={view} ready={ready} onTry={(piece, why) => void press({ button: 'tryOn', piece, why })} onMore={() => void press({ button: 'more' })} />
        </div>

        <ChatPanel
          avatar={avatar} name={HOST} className="nt-chat" placeholder={`Message ${HOST}, or try “rate it for a wedding”`}
          empty={<>Talk to {HOST} out loud, or type here.</>}
        />
      </main>

      {notes && view && <Notes view={view} ratings={ratings} ended={!live} onClose={() => setNotes(false)} onNewFitting={newFitting} />}
    </div>
  );
}
