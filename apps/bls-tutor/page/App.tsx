// Bystander: CPR and first-aid drills hosted by Alex. Alex calls the drill's
// tools (an answer to grade, a step to show, the next step) and speaks from
// the results; the page answers those calls through the server, draws the
// drill sheet, keeps Alex's picture of the screen current, and tells him
// about button presses.
//
// One thing the page still does on its own, ahead of everyone: it reads every
// line the learner says or types for a real emergency, and the moment one
// reads like that, the red card covers the screen. Alex's stop_for_emergency
// is a second way to the same card, never the only one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, HostVideo, useAvatar, useToolNet, type Avatar, type ToolCall } from '../../../src/kit/index.ts';
import { drillState, said } from '../engine/director.ts';
import { emergencySnapshot, SAFETY_LINE } from '../engine/lines.ts';
import { clearedBy, mustDo } from '../engine/net.ts';
import { isRealEmergency } from '../engine/safety.ts';
import type { ActReply, Command, ToolReply, View } from '../engine/types.ts';
import portrait from '../host/portrait.jpg';
import { DRILLS } from './drills.ts';
import { Emergency } from './Emergency.tsx';
import { Lobby, Logo } from './Lobby.tsx';
import { Sheet } from './Sheet.tsx';
import './bystander.css';

const API = '/api/apps/bls-tutor';
const HOST = 'Alex';
/** A spoken emergency: how long Alex has to call stop_for_emergency himself before the page tells him. */
const ALARM_WAIT_MS = 3000;
/** Alex can act before the transcript reaches the page; a call this early still counts. */
const EARLY_MS = 6000;

async function call<T>(path: string, body?: unknown): Promise<T> {
  const init = body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(API + path, init);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/** The phases of a call in progress (placing it, or on it). */
const CALLING = new Set(['starting', 'warming', 'connecting', 'arriving', 'live']);

/** The live step: a hint belongs to it and goes when it does. */
const stepKey = (v: View | null) => (v ? `${v.phase}:${v.scenario?.id}:${v.step_index}` : '');
/** Anything that moved since the learner's words makes the safety net stand down. */
const netKey = (v: View | null) => (v ? `${v.phase}:${v.scenario?.id}:${v.step_index}:${v.attempts}` : '');

export function App() {
  const [choice, setChoice] = useState(DRILLS[0].id);
  const [view, setView] = useState<View | null>(null);
  const [failed, setFailed] = useState(false);
  // The card the page put up itself, ahead of the server (and in spite of it, if it is unreachable).
  const [alarm, setAlarm] = useState(false);
  const [hint, setHint] = useState<{ key: string; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const drill = useRef<string | null>(null);
  const choiceRef = useRef(choice);
  choiceRef.current = choice;
  const viewRef = useRef<View | null>(null);
  const alarmRef = useRef(false);
  const sinceCard = useRef<string[]>([]);   // what the learner said since the card went up
  const lineGiven = useRef(0);              // when Alex was last handed the emergency line
  const netKeys = useRef(new Map<string, { key: string; at: number }>());
  const avatarRef = useRef<Avatar | null>(null);
  // The server's emergency view the learner dismissed with the card's button while the server was out of reach.
  const dismissed = useRef<View | null>(null);
  // Which call the page is in. Anything started for a call carries its number
  // and is dropped if it answers after that call ended or a newer one began.
  const callGen = useRef(0);
  const alarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearAlarmTimer = () => {
    if (alarmTimer.current) clearTimeout(alarmTimer.current);
    alarmTimer.current = null;
  };

  const shown = useMemo<View | null>(() => (alarm && view?.phase !== 'emergency' ? emergencySnapshot(view) : view), [alarm, view]);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const cardUp = () => alarmRef.current || (viewRef.current?.phase === 'emergency' && viewRef.current !== dismissed.current);

  function land(next: View, hintText?: string) {
    if (!cardUp() && next.phase === 'emergency') sinceCard.current = [];
    viewRef.current = next;
    setView(next);
    if (hintText) setHint({ key: stepKey(next), text: hintText });
  }

  function lower() {
    alarmRef.current = false;
    setAlarm(false);
    sinceCard.current = [];
  }

  function tell(how: 'typed' | 'spoken', words: string) {
    lineGiven.current = Date.now();
    avatarRef.current?.event(said.alarm(how, words), 60);
  }

  /** Put the red card up, once per card, and stop the drill. Alex hears about it from his own call, or from the page. */
  function raise(how: 'host' | 'typed' | 'spoken', words = '') {
    if (cardUp()) return false;
    alarmRef.current = true;
    setAlarm(true);
    setNotice(null);
    sinceCard.current = [];
    if (how !== 'host' && drill.current) {
      const gen = callGen.current;
      void call<ActReply>(`/drills/${drill.current}/act`, { command: 'emergency' })
        .then((reply) => { if (gen === callGen.current && alarmRef.current) land(reply.view); })
        .catch((err) => console.warn('[bystander] the drill did not hear the stop', err));
    }
    if (how === 'typed') tell('typed', words);   // Alex never heard a typed line
    if (how === 'spoken') {
      // Alex heard it too, and should call stop_for_emergency; if he does not, the page tells him.
      // The reminder belongs to this call: a hang-up or a new call clears it.
      const at = Date.now();
      clearAlarmTimer();
      alarmTimer.current = setTimeout(() => {
        alarmTimer.current = null;
        if (lineGiven.current < at - EARLY_MS && cardUp()) tell('spoken', words);
      }, ALARM_WAIT_MS);
    }
    return true;
  }

  // Alex's tool calls: the server acts, the sheet follows, the result is what he says.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall): Promise<string> => {
    if (name === 'stop_for_emergency') {
      lineGiven.current = Date.now();
      raise('host');   // the screen first, whatever the server does
    }
    if (!drill.current) {
      if (name === 'stop_for_emergency') return said.emergency();
      throw new Error('the drill is still being set up; try again in a moment');
    }
    // Only the learner's own words take the card down, never Alex's reading of them.
    if (name === 'resume_practice' && cardUp() && !clearedBy(sinceCard.current)) return said.keepCard();
    const gen = callGen.current;
    setBusy(true);
    try {
      const reply = await call<ToolReply>(`/drills/${drill.current}/tool`, { name, arguments: args ?? {} });
      // The call it belonged to is over: the next call reads the drill afresh.
      if (gen !== callGen.current) return reply.result;
      land(reply.view, reply.hint);
      if (reply.emergency) lineGiven.current = Date.now();
      if (name === 'resume_practice' && reply.view.phase !== 'emergency') lower();
      setNotice(null);
      return reply.result;
    } catch (err) {
      if (name === 'stop_for_emergency') return said.emergency();
      throw err;
    } finally {
      if (gen === callGen.current) setBusy(false);
    }
  }, []);

  // When the learner clearly asks for something safe to do twice and Alex does not call it, the page does.
  const net = useToolNet({
    match: (text) => {
      const v = shownRef.current;
      if (!v) return null;
      const wanted = mustDo(text, v.phase, v.scenario?.id ?? null);
      if (!wanted) return null;
      for (const [id, k] of netKeys.current) if (Date.now() - k.at > 60_000) netKeys.current.delete(id);
      const id = `net-${Date.now()}-${wanted.name}`;
      netKeys.current.set(id, { key: netKey(v), at: Date.now() });
      return { id, ...wanted };
    },
    run: async (c) => {
      const was = netKeys.current.get(c.id)?.key;
      netKeys.current.delete(c.id);
      if (was !== netKey(shownRef.current)) throw new Error('the drill moved on since');
      return onToolCall(c);
    },
    avatar: () => avatarRef.current!,
  });

  const avatar = useAvatar('bls-tutor', {
    onToolCall: net.watch(onToolCall),
    onUserSaid: (text, how) => {
      if (cardUp()) sinceCard.current.push(text);
      else if (how === 'spoken' && isRealEmergency(text)) raise('spoken', text);
      net.heard(text);
    },
  });
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  /** A typed line goes to Alex, unless it reads as a real emergency: then the card goes up and Alex is told. */
  function typed(text: string) {
    if (!cardUp() && isRealEmergency(text)) {
      avatar.record(text);
      raise('typed', text);
      return;
    }
    avatar.say(text);
  }

  // A button acts at once; Alex cannot see the screen, so he is told.
  async function press(command: Command, scenario?: string) {
    if (command === 'resume') {
      // The card never outlives its own button, even with the server out of reach.
      lower();
      dismissed.current = viewRef.current;
    }
    if (!drill.current) return;
    const gen = callGen.current;
    setBusy(true);
    setNotice(null);
    try {
      const reply = await call<ActReply>(`/drills/${drill.current}/act`, { command, scenario });
      if (gen !== callGen.current) return;
      land(reply.view, reply.hint);
      if (!reply.applied && reply.reason) setNotice(reply.reason.replace(/\*/g, ''));
      if (reply.event) avatar.event(reply.event, 30);
    } catch (err) {
      console.warn('[bystander] the drill did not answer', err);
      if (gen === callGen.current) setNotice("That didn't reach the drill. Check your connection and try again.");
    } finally {
      if (gen === callGen.current) setBusy(false);
    }
  }

  // A new call, or the end of one: whatever the last call started stops here.
  useEffect(() => {
    if (avatar.phase !== 'starting' && avatar.phase !== 'ended' && avatar.phase !== 'failed') return;
    callGen.current += 1;
    clearAlarmTimer();
    netKeys.current.clear();
    setBusy(false);
  }, [avatar.phase]);
  useEffect(() => () => { callGen.current += 1; clearAlarmTimer(); }, []);

  // Each call opens the drill (a new one on the scene chosen at the door, or
  // the one already running), and Alex is given the opening once he is here.
  // It starts from the screen: with the red card up, the drill is stopped too
  // and the opening is the 911 sentence, even if the drill never heard the stop.
  useEffect(() => {
    if (avatar.phase !== 'starting') return;
    const gen = callGen.current;
    setFailed(false);
    setNotice(null);
    void (async () => {
      let opened: { id: string; view: View; opening: string } | null = null;
      if (drill.current) {
        const id = drill.current;
        opened = await call<{ view: View; opening: string }>(`/drills/${id}`).then((r) => ({ id, ...r }), () => null);
        if (gen !== callGen.current) return;
      }
      opened ??= await call<{ id: string; view: View; opening: string }>('/drills', { scenario: choiceRef.current });
      if (gen !== callGen.current) return;
      if (alarmRef.current && opened.view.phase !== 'emergency') {
        const stopped = await call<ActReply>(`/drills/${opened.id}/act`, { command: 'emergency' });
        if (gen !== callGen.current) return;
        opened = { ...opened, view: stopped.view, opening: said.opening(stopped.view) };
      }
      drill.current = opened.id;
      land(opened.view);
      avatar.event(opened.opening, 60);
    })().catch((err) => {
      if (gen !== callGen.current) return;
      console.warn('[bystander] could not set up the drill', err);
      setFailed(true);
    });
  }, [avatar.phase]);

  // Alex's picture of the screen follows the screen.
  const visibleHint = hint && hint.key === stepKey(shown) ? hint.text : null;
  useEffect(() => { if (shown) avatar.state(drillState(shown, { hint: visibleHint })); }, [shown, visibleHint]);

  if (avatar.phase === 'idle') return <Lobby choice={choice} onChoose={setChoice} onStart={(mic) => void avatar.start({ mic })} />;

  const scoring = shown?.scenario && (shown.phase === 'answering' || shown.phase === 'coaching' || shown.phase === 'debrief') ? shown : null;
  return (
    <div className="by-app">
      <header className="by-top">
        <Logo />
        {scoring && <Progress view={scoring} />}
        {scoring && <p className="by-score" aria-live="polite"><b>{scoring.score.correct}</b>/{scoring.steps?.length ?? 0} <span>on your own</span></p>}
      </header>

      <main className="by-main">
        <section className="by-host" aria-label={`${HOST}, your instructor`}>
          <HostVideo avatar={avatar} name={HOST} poster={portrait} className="by-host-video" />
          <div className="by-nameplate">
            <p className="by-who"><b>{HOST}</b> <span>Paramedic instructor</span></p>
            {live && <p className="by-oncall">On call</p>}
            {live && avatar.caption && <p className="by-saying">{lastSentence(avatar.caption)}</p>}
            <CallControls avatar={avatar} className="by-controls" />
          </div>
          <CallStatus avatar={avatar} name={HOST} again="Call Alex again" />
        </section>

        <Sheet view={shown} live={live} busy={busy} hint={visibleHint} notice={notice} failed={failed} calling={CALLING.has(avatar.phase)} onCommand={(c, s) => void press(c, s)} />

        <ChatPanel
          avatar={avatar} name={HOST} className="by-chat" placeholder="Type what you'd do, or ask Alex…"
          onSubmit={(text) => { typed(text); }}
          empty={<>Say what you would do out loud, or type it here.</>}
        />
      </main>

      <footer className="by-foot">{SAFETY_LINE}</footer>
      {shown?.phase === 'emergency' && (alarm || view !== dismissed.current) && <Emergency onResume={() => void press('resume')} />}
    </div>
  );
}

/** The end of what Alex is saying, for the phone's call bar (the start scrolls off a two-line clamp). */
function lastSentence(text: string) {
  const sentences = text.trim().split(/(?<=[.!?…])\s+/);
  let line = sentences.pop() ?? '';
  if (line.length < 40 && sentences.length) line = `${sentences.pop()} ${line}`;
  return line;
}

/** The header's step ticks: got it, shown, now, still to come. */
function Progress({ view }: { view: View }) {
  const steps = view.steps ?? [];
  const k = Math.min((view.step_index ?? 0) + 1, steps.length);
  return (
    <ol className="by-progress" aria-label={view.phase === 'debrief' ? 'Drill complete' : `Step ${k} of ${steps.length}`}>
      {steps.map((s) => (
        <li key={s.key} className={s.status === 'done' ? (s.outcome === 'shown' ? 'is-shown' : 'is-got') : s.status === 'current' ? 'is-now' : ''} />
      ))}
    </ol>
  );
}
