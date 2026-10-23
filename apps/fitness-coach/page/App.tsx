// Spotter: a personal training call with Sammy. Sammy acts through the
// coach's tools (set a goal, a level, a limit; start a move; start over; stop
// for safety) and speaks from what each returns; the page answers those calls
// by asking the server, shows the plan, keeps Sammy's picture of the screen
// current, and tells her about taps.
//
// Two things the page does on its own, from the user's words:
// - the safety stop. A condition no exercise swap makes safe (pregnancy, a
//   cardiac history, recent surgery…) freezes the plan the moment the page
//   hears it, whatever Sammy does; if she has not called stop_for_safety a few
//   seconds later, the page does, and gives her the words.
// - the safety net. "Start over", a limit ("only 20 minutes", "bad knee"), a
//   level said alone while the level step is live ("Beginner, please."), or a
//   move asked for once a plan is up, that Sammy answers without calling the
//   tool is done by the page. Live, she answered "Beginner, please." with
//   "I've set you up for a beginner plan" and called nothing, twice.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, HostVideo, useAvatar, useToolNet, type Avatar, type ToolCall } from '../../../src/kit/index.ts';
import { parseConstraints } from '../engine/constraints.ts';
import { boardState, say } from '../engine/director.ts';
import { limitWords, mustDo, mustSetLevel, mustStartMove, mustStop, type NetCall, type NetContext } from '../engine/judge.ts';
import type { Command, Outcome, View } from '../engine/types.ts';
import { Workout, type Pending } from './Workout.tsx';
import portrait from '../host/portrait.jpg';
import { Lobby, Logo } from './Lobby.tsx';
import { parseSnapshot } from './parsers.ts';
import { planFileName, planText } from './plan-text.ts';
import './spotter.css';

const ID = 'fitness-coach';
const API = `/api/apps/${ID}`;
const HOST = 'Sammy';
/** How long Sammy has to call stop_for_safety herself before the page does it and gives her the words. */
const STOP_WAIT_MS = 4000;
/** Seeds the six goals on offer: fixed for this page, so they never reshuffle under the user. */
const SEED = Math.random().toString(36).slice(2, 10);

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

const asCall = (call: NetCall | null): ToolCall | null => (call ? { id: `net-${Date.now()}`, name: call.name, arguments: call.arguments } : null);

export function App() {
  const [view, setView] = useState<View | null>(null);
  const shown = useRef<View | null>(null);
  const session = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [held, setHeld] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [refusal, setRefusal] = useState('');
  const avatarRef = useRef<Avatar | null>(null);
  /** What the user said lately, so an add_limits call keeps every limit they named. */
  const said = useRef<{ text: string; at: number }[]>([]);
  const lastLimits = useRef(0);
  /**
   * Which call the page is on. It moves when a call is placed and when one
   * ends or fails, so work started for a call (the opening, a tap, a limit
   * re-read) that answers after it is over, or once a newer call is placed,
   * says nothing and installs nothing. The coach's screen is not call-scoped:
   * every view carries the server's sequence number and the newest one shows.
   */
  const call = useRef(0);

  // The newest screen wins: a tool's reply and a streamed outcome can cross.
  const show = useCallback((next: View) => {
    if (shown.current && next.seq < shown.current.seq) return;
    shown.current = next;
    setView(next);
  }, []);

  // Sammy's tool calls: the server acts, the screen follows, the result is what she says.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    if (!session.current) throw new Error('Spotter is still opening; try again in a moment');
    // The server reads the limits in the user's own words too (the finished lines, and
    // the words still being recognised), in case Sammy's words dropped one.
    let sent = args;
    if (name === 'add_limits') {
      lastLimits.current = Date.now();
      const now = Date.now();
      const words = [...said.current, { text: avatarRef.current?.heard ?? '', at: now }];
      sent = { ...args, heard: limitWords(words, now) };
    }
    const { view: next, result } = await post<{ view: View; result: string }>(`/sessions/${session.current}/tool`, { name, arguments: sent });
    show(next);
    return result;
  }, [show]);

  const run = async (call: ToolCall) => String(await onToolCall(call));
  // What is on the screen when the words were said: a level or a move is read against it.
  const context = (): NetContext | null => {
    const now = shown.current;
    if (!now) return null;
    return { stage: held.length ? 'hold' : now.stage, level: now.flow.level, plan: now.plan };
  };
  const net = useToolNet({ match: (text) => asCall(mustDo(text)), run, avatar: () => avatarRef.current! });
  const levelNet = useToolNet({ match: (text) => { const ctx = context(); return ctx ? asCall(mustSetLevel(text, ctx)) : null; }, run, avatar: () => avatarRef.current! });
  const moveNet = useToolNet({ match: (text) => { const ctx = context(); return ctx ? asCall(mustStartMove(text, ctx)) : null; }, run, avatar: () => avatarRef.current! });
  const safety = useToolNet({ match: (text) => asCall(mustStop(text)), run, avatar: () => avatarRef.current!, waitMs: STOP_WAIT_MS });

  // Everything the user says or types passes here once it is final.
  const heard = (text: string) => {
    said.current = [...said.current.slice(-9), { text, at: Date.now() }];
    // Sammy called add_limits before these words were final: record what her call left
    // out (a repeat records nothing), and tell her only if it added something.
    if (Date.now() - lastLimits.current < 10_000 && mustDo(text)?.name === 'add_limits') {
      const mine = call.current;
      void onToolCall({ id: `own-${Date.now()}`, name: 'add_limits', arguments: { words: text } }).then((result) => {
        if (mine === call.current && /^Done: Noted on/.test(String(result))) avatarRef.current?.event(`The user's own words carried a limit your add_limits call left out; Spotter has recorded it now. ${result}`, 30);
      }).catch((err) => console.warn('[spotter] a limit from the user\'s words did not reach the server', err));
    }
    const conditions = parseConstraints(text).clearance;
    if (conditions.length) {
      // Frozen now, by the page: the screen stops before anyone has spoken.
      setHeld((current) => [...new Set([...current, ...conditions])]);
      if (session.current) {
        void post<{ view: View }>(`/sessions/${session.current}/hold`, { text }).then(({ view: next }) => show(next))
          .catch((err) => console.warn('[spotter] the pause did not reach the server', err));
      }
      safety.heard(text);
      return;
    }
    net.heard(text);
    levelNet.heard(text);
    moveNet.heard(text);
  };

  const avatar = useAvatar(ID, { onToolCall: safety.watch(net.watch(levelNet.watch(moveNet.watch(onToolCall)))), onUserSaid: (text) => heard(text) });
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  // Set up while Sammy is on her way; a second call on this page carries on where the first left off.
  useEffect(() => {
    const phase = avatar.phase;
    if (phase === 'starting' || phase === 'ended' || phase === 'failed') {
      // A new call, or the end of one: what the last call started is stale, and
      // nothing it left (a tap on its way, the words heard in it) carries over.
      call.current += 1;
      said.current = [];
      lastLimits.current = 0;
      setPending(null);
      setRefusal('');
    }
    if (phase !== 'starting') return;
    const mine = call.current;
    if (session.current) {
      if (shown.current) {
        avatar.state(boardState(shown.current));
        avatar.event(say.resume(shown.current), 60);
      }
      return;
    }
    void post<{ id: string; view: View; opening: string }>('/sessions', { seed: SEED }).then(({ id, view: first, opening }) => {
      // Placed again, or ended, before the floor was ready: this one belongs to no call.
      if (mine !== call.current) return;
      session.current = id;
      setSessionId(id);
      show(first);
      setRefusal('');
      avatar.event(opening, 60);
    }).catch((err) => {
      console.warn('[spotter] could not open a session', err);
      if (mine === call.current) setRefusal(`We couldn’t get your plan sheet ready. Hang up and call ${HOST} again.`);
    });
  }, [avatar.phase]);

  // Sammy's picture of the screen follows the screen.
  useEffect(() => { if (view) avatar.state(boardState(view)); }, [view]);

  // Plans, rebuilds and videos finish in the background, on the server.
  useEffect(() => {
    if (!sessionId) return;
    const stream = new EventSource(`${API}/sessions/${sessionId}/stream`);
    stream.onmessage = (message) => {
      try {
        const outcome = JSON.parse(message.data) as Outcome;
        show(outcome.view);
        if (avatarRef.current?.phase === 'live') for (const e of outcome.events) avatarRef.current.event(e.text, e.ttl);
      } catch (err) {
        console.warn('[spotter] a streamed update was unreadable', err);
      }
    };
    return () => stream.close();
  }, [sessionId, show]);

  // A tap acts at once; Sammy cannot see the screen, so she is told.
  async function tap(command: Command, value = '') {
    if (!session.current || pending) return;
    const mine = call.current;
    setPending({ command, value });
    setRefusal('');
    try {
      const out = await post<{ view: View; event?: string; refused?: string }>(`/sessions/${session.current}/act`, { command, value });
      // The coach did act: its screen is the screen, whenever it answers.
      show(out.view);
      // Telling Sammy, or showing a refusal, belongs to the call the tap was made in.
      if (mine !== call.current) return;
      if (out.refused) setRefusal(out.refused);
      if (out.event) avatarRef.current?.event(out.event, 30);
    } catch (err) {
      console.warn('[spotter]', err);
      if (mine === call.current) setRefusal('That didn’t go through. Try again.');
    } finally {
      if (mine === call.current) setPending(null);
    }
  }

  function save() {
    const snap = view ? parseSnapshot(view) : null;
    if (!snap?.plan) return;
    const blob = new Blob([planText(snap.plan, snap.flow.constraints, HOST)], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = planFileName(snap.plan);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  if (avatar.phase === 'idle') return <Lobby host={HOST} onStart={(mic) => void avatar.start({ mic })} />;

  const stopped = held.length > 0 || view?.stage === 'hold';
  return (
    <div className={`sp-app${stopped ? ' is-stopped' : ''}`}>
      <header className="sp-top">
        <Logo />
        <Steps stage={stopped ? 'hold' : view?.stage ?? 'goal'} />
        {live && avatar.secondsLeft !== null && <p className="sp-clock" aria-label="Call time left">{clock(avatar.secondsLeft)}</p>}
        <CallControls avatar={avatar} className="sp-controls" />
      </header>

      <main className="sp-main">
        <aside className={`sp-coach${live ? ' is-live' : ''}`} aria-label={`${HOST}, your coach`}>
          {/* Sammy's face fills the frame while the call connects, instead of a dark box. */}
          <HostVideo avatar={avatar} name={HOST} poster={portrait} className="sp-coach-video">
            <CallStatus avatar={avatar} name={HOST} again={`Call ${HOST} again`} />
          </HostVideo>
          <div className="sp-nameplate">
            <p><b>{HOST}</b> <span>your coach</span>{live && <span className="sp-live">On the floor</span>}</p>
            {live && avatar.caption && <p className="sp-coach-says" aria-hidden="true">{lastLine(avatar.caption)}</p>}
          </div>
        </aside>

        <section className="sp-board" aria-label="Your workout">
          <Workout
            view={view} seed={SEED} held={held} live={live && Boolean(view)} ended={avatar.phase === 'ended'} host={HOST}
            pending={pending} refusal={refusal} onTap={(command, value) => void tap(command, value)} onSave={save}
          />
        </section>

        <ChatPanel
          avatar={avatar} name={HOST} className="sp-chat" placeholder="A goal, a limit, a question…"
          empty={<>Talk to {HOST}, or type here: what you want to train, your level, anything to work around.</>}
        />
      </main>
    </div>
  );
}

const STEPS: [string, string[]][] = [['Goal', ['goal']], ['Level', ['level']], ['Plan', ['planning']], ['First move', ['move']]];

function Steps({ stage }: { stage: string }) {
  if (stage === 'hold') return <p className="sp-steps-paused" role="status">Paused for your safety</p>;
  const at = stage === 'coach' ? STEPS.length : STEPS.findIndex(([, stages]) => stages.includes(stage));
  return (
    <ol className="sp-track" aria-label="Your progress">
      {STEPS.map(([label], i) => (
        <li key={label} className={i < at ? 'is-done' : i === at ? 'is-now' : ''} aria-current={i === at ? 'step' : undefined}>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** The sentence being spoken, for the pinned coach bar on a phone (the video there is too small for captions). */
const lastLine = (text: string) => {
  const sentences = text.trim().split(/(?<=[.!?…])\s+/);
  const line = sentences.pop() ?? '';
  return line.length > 110 ? `…${line.slice(-110)}` : line;
};

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} left`;
