// BLS Tutor: the avatar instructs; the server owns the drill (the step
// answers never reach the page) and grades every answer. The page shows the
// panel, keeps the avatar's state in step with it, passes on what happened as
// events, and watches every line for a real emergency.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AvatarStage, Composer, Transcript, useAvatar } from '../../../src/kit/index.ts';
import { drillState, NOTES, say } from '../engine/director.ts';
import { emergencySnapshot, SAFETY_LINE } from '../engine/lines.ts';
import { isRealEmergency } from '../engine/safety.ts';
import type { Intent, Outcome, Source, View } from '../engine/types.ts';
import { TutorPanel, type SendResult } from './TutorPanel.tsx';
import './bls.css';

const API = '/api/apps/bls-tutor';

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function App() {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  // The card the page put up itself, the instant it read an emergency, ahead
  // of the server's answer (and in spite of it, if the server is unreachable).
  const [alarm, setAlarm] = useState(false);
  const alarmSaid = useRef(false);       // the emergency event for the card now up was sent
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;
  const drill = useRef<string | null>(null);
  const creating = useRef(false);
  const wantsOpening = useRef(false);

  const avatar = useAvatar('bls-tutor', {
    // The avatar hears the learner too and answers at once; the drill's verdict
    // follows as an event (the standing notes tell it not to grade).
    onUserSaid: (text, how) => { if (how === 'spoken') heard(text); },
  });

  /** What the screen shows: the server's view, or the page's own card while the server catches up. */
  const shown = useMemo<View | null>(
    () => (alarm && view?.phase !== 'emergency' ? { ...emergencySnapshot(view), staged: null } : view),
    [alarm, view],
  );
  const onCard = () => alarmSaid.current || viewRef.current?.phase === 'emergency';

  /** Put the card up and tell the avatar, once per card. */
  function raise() {
    if (onCard()) return false;
    alarmSaid.current = true;
    setAlarm(true);
    avatar.event(say.emergency(), 60);
    return true;
  }
  function lower() {
    alarmSaid.current = false;
    setAlarm(false);
  }

  function show(outcome: Outcome) {
    setView(outcome.view);
    if (outcome.kind === 'resume' && outcome.applied) lower();
    if (!outcome.event) return;
    if (outcome.kind === 'emergency') {
      // The page already said it when it raised the card itself.
      if (alarmSaid.current) return;
      alarmSaid.current = true;
    }
    avatar.event(outcome.event, outcome.ttl ?? 30);
  }

  async function act(input: { intent?: Intent; text?: string }, from: Source): Promise<Outcome | null> {
    if (!drill.current) return null;
    setBusy(true);
    try {
      const outcome = await post<Outcome>(`/drills/${drill.current}/act`, { ...input, from });
      show(outcome);
      return outcome;
    } catch (err) {
      console.warn('[bls-tutor] the drill did not answer', err);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Speech, as the avatar's recogniser heard it: the watch first, then the drill. */
  function heard(text: string) {
    if (isRealEmergency(text)) raise();
    void act({ text }, 'spoken');
  }

  /** A typed line is judged first; only what isn't a drill action goes to the avatar. */
  function typed(text: string) {
    const raised = isRealEmergency(text) && raise();
    void act({ text }, 'typed').then((outcome) => {
      if (raised || outcome?.handled) avatar.record(text);
      else avatar.say(text);
    });
  }

  /** The panel's controls, with the original panel's intents. */
  async function send(intent: Intent): Promise<SendResult> {
    if (intent.kind === 'answer') {
      avatar.record(intent.text);
      if (isRealEmergency(intent.text)) raise();
    }
    const outcome = await act({ intent }, 'button');
    // The card never outlives its own button, even with the server unreachable.
    if (intent.kind === 'ack_safety') lower();
    if (!outcome) return { applied: false, reason: 'The drill could not be reached. Try again in a moment.' };
    return { applied: outcome.applied, reason: outcome.reason };
  }

  // The drill is set up at once (the menu shows before the avatar arrives),
  // and the standing rules are queued for the avatar's arrival.
  useEffect(() => {
    for (const note of NOTES) avatar.note(note);
    if (creating.current) return;
    creating.current = true;
    post<{ id: string; view: View }>('/drills')
      .then(({ id, view }) => { drill.current = id; setView(view); })
      .catch((err) => console.warn('[bls-tutor] could not set up the drill', err));
  }, []);

  // Each session opens with the safety line and the menu (or where the drill is).
  useEffect(() => { if (avatar.phase === 'starting') wantsOpening.current = true; }, [avatar.phase]);
  useEffect(() => {
    if (!wantsOpening.current || !shown) return;
    wantsOpening.current = false;
    avatar.event(say.opening(shown), 45);
  }, [avatar.phase, shown]);

  // The avatar's picture of the drill follows the screen.
  useEffect(() => { if (shown) avatar.state(drillState(shown)); }, [shown]);

  const live = avatar.phase === 'live';
  return (
    <div className="kit-layout bls-app">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar}
          name="Your instructor"
          startLabel="Start the drill"
          lobby={
            <>
              <div className="kit-title">BLS Tutor</div>
              <div className="kit-detail">A calm paramedic instructor walks you through a CPR or first-aid scenario, one step at a time. Say or type what you would do. {SAFETY_LINE}</div>
            </>
          }
        />
        <Composer avatar={avatar} placeholder="Type what you'd do, or ask your instructor…" onSubmit={(text) => { typed(text); }} />
        <Transcript avatar={avatar} names={{ avatar: 'Instructor' }} />
      </div>
      <TutorPanel state={shown} send={send} pending={busy || !live} />
    </div>
  );
}
