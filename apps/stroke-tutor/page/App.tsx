// Stroke Tutor: the avatar teaches; the server owns the lesson and grades
// every stroke. The page shows the board, keeps the avatar's state in step
// with it, and passes on what happened as events, one coaching line at a time.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarStage, Composer, Transcript, useAvatar } from '../../../src/kit/index.ts';
import { boardState, NOTES, say, TTL } from '../engine/director.ts';
import type { Intent, Outcome, Snapshot } from '../engine/types.ts';
import { createCoach, cueFor, type Coach } from './coach.ts';
import { StrokeTutorPanel } from './StrokeTutorPanel.tsx';
import './styles.css';

const API = '/api/apps/stroke-tutor';
const RUNNING = new Set(['starting', 'warming', 'connecting', 'arriving', 'live']);

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

type From = 'panel' | 'typed' | 'spoken';

export function App() {
  const [view, setView] = useState<Snapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const lesson = useRef<string | null>(null);

  const avatar = useAvatar('stroke-tutor', {
    // The avatar hears the learner too, and answers at once ("let me show
    // you"); the board acts on the same words a moment later and the result
    // follows as an event (the standing notes tell it to wait for that).
    onUserSaid: (text, how) => { if (how === 'spoken') void act({ text }, 'spoken'); },
  });

  // One coaching line at a time, the newest only, once the avatar has the floor.
  const sendEvent = useRef(avatar.event);
  sendEvent.current = avatar.event;
  const coachRef = useRef<Coach | null>(null);
  coachRef.current ??= createCoach((text, ttlS) => sendEvent.current(text, ttlS));
  const coach = coachRef.current;
  useEffect(() => coach.live(avatar.phase === 'live'), [avatar.phase]);
  useEffect(() => coach.speaking(avatar.speaking), [avatar.speaking]);

  const show = useCallback((outcome: Outcome, from: From) => {
    setView(outcome.view);
    if (outcome.handled) setMessage(outcome.refused ?? '');
    const cue = cueFor(outcome, from);
    if (cue) coach.push(cue);
  }, [coach]);

  async function act(input: { intent?: Intent; text?: string }, from: From): Promise<Outcome | null> {
    if (!lesson.current) return null;
    if (from === 'panel') setPending(true);
    try {
      const outcome = await post<Outcome>(`/lessons/${lesson.current}/act`, input);
      show(outcome, from);
      return outcome;
    } catch (err) {
      console.warn(err);
      return null;
    } finally {
      if (from === 'panel') setPending(false);
    }
  }

  // The lesson is set up while the avatar is on its way (that takes a while);
  // a session started again carries on the same lesson.
  useEffect(() => {
    if (avatar.phase !== 'starting') return;
    for (const note of NOTES) avatar.note(note);
    if (lesson.current) {
      if (view) coach.push({ text: say.resume(view), ttlS: TTL.opening });
      return;
    }
    void post<{ id: string; outcome: Outcome }>('/lessons').then(({ id, outcome }) => {
      lesson.current = id;
      setView(outcome.view);
      if (outcome.event) coach.push({ text: outcome.event, ttlS: TTL.opening });
    }).catch((err) => { console.warn(err); setMessage('The lesson could not be set up. Is the app server running?'); });
  }, [avatar.phase]);

  // The avatar's picture of the board follows the board.
  useEffect(() => { if (view) avatar.state(boardState(view)); }, [view]);

  // A typed line is judged first; only what isn't a board action goes to the avatar.
  const onTyped = (text: string) => {
    void act({ text }, 'typed').then((outcome) => {
      if (outcome?.handled) avatar.record(text);
      else avatar.say(text);
    });
  };

  const running = RUNNING.has(avatar.phase);

  return (
    <div className="kit-layout">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar} name="Your teacher" startLabel="Start the lesson"
          lobby={<><div className="kit-title">Stroke Tutor</div><div className="kit-detail">Write a character one stroke at a time on the board. Your teacher grades the order and the direction, never the handwriting. Seven characters, from 一 to 永, plus A and E.</div></>}
        />
        <Composer avatar={avatar} placeholder="Ask, or type “show me”, “next”, “the tree one”…" onSubmit={(t) => { onTyped(t); }} />
        <Transcript avatar={avatar} names={{ avatar: 'Teacher' }} />
      </div>
      <StrokeTutorPanel
        state={view}
        pending={pending}
        message={message}
        disabled={!running}
        waiting={running ? 'Inking the brush…' : 'Start the lesson to pick a character.'}
        onIntent={(intent) => void act({ intent }, 'panel')}
      />
    </div>
  );
}
