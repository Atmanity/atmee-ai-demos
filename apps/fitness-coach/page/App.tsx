// Fitness Coach: the avatar coaches; the app's server owns the session (the
// step machine, the plan, the limits, the safety hold, the demo render). The
// page draws the server's view, keeps the avatar's state in step with it, and
// passes on what happened as events.
//
// Three inputs, one route (`act`), one rule each:
// - a tap: the server acts; every event goes to the avatar (it cannot see taps);
// - a typed line: the server judges it first. If the app handled it, the line
//   is recorded and the events speak for it; otherwise it goes to the avatar
//   as a typed turn, after the state, so the answer is grounded;
// - speech: the avatar has already started answering, from the state's staged
//   lines, so only the events it could not have known are sent.
// Background work (a plan landing, a rebuild, a demo finishing) arrives on the
// server's event stream as the same kind of outcome.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarStage, Composer, Transcript, useAvatar, type Avatar } from '../../../src/kit/index.ts';
import { boardState, NOTES, say } from '../engine/director.ts';
import type { Command, Outcome, View } from '../engine/types.ts';
import type { BoardStage } from './board.ts';
import { refusalReason } from './board.ts';
import { FitnessPanel } from './FitnessPanel.tsx';
import { INITIAL_FLOW, parseSnapshot } from './parsers.ts';
import './fitness.css';

const ID = 'fitness-coach';
const API = `/api/apps/${ID}`;

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

type From = 'tap' | 'typed' | 'spoken' | 'background';

/** Seeds the six goals on offer: fixed for this page, so they never reshuffle under the user. */
const SEED = Math.random().toString(36).slice(2, 10);

export function App() {
  const [view, setView] = useState<View | null>(null);
  const shown = useRef<View | null>(null);
  const session = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const avatarRef = useRef<Avatar | null>(null);

  const show = useCallback((outcome: Outcome, from: From) => {
    const avatar = avatarRef.current!;
    // The newest view wins: a reply and a streamed outcome can cross.
    if (!shown.current || outcome.view.seq >= shown.current.seq) {
      shown.current = outcome.view;
      setView(outcome.view);
      // Sent here rather than from an effect, so it reaches the avatar before
      // any typed turn this outcome leads to.
      avatar.state(boardState(outcome.view));
    }
    for (const event of outcome.events) {
      // After speech the avatar has already said what its state staged.
      if (from === 'spoken' && event.staged) continue;
      avatar.event(event.text, event.ttl);
    }
  }, []);

  const act = useCallback(async (body: { command?: Command; value?: string; text?: string; how?: 'typed' | 'spoken' }, from: From): Promise<Outcome | null> => {
    if (!session.current) return null;
    try {
      const outcome = await post<Outcome>(`/sessions/${session.current}/act`, body);
      show(outcome, from);
      return outcome;
    } catch (err) {
      console.warn('[fitness-coach]', err);
      return null;
    }
  }, [show]);

  const avatar = useAvatar(ID, {
    // The avatar hears the user too and answers at once; the app acts on the
    // same words and tells it the outcome.
    onUserSaid: (text, how) => { if (how === 'spoken') void act({ text, how: 'spoken' }, 'spoken'); },
  });
  avatarRef.current = avatar;

  // The session is set up while the avatar is on its way (both take a while).
  useEffect(() => {
    if (avatar.phase !== 'starting') return;
    for (const note of NOTES) avatar.note(note);
    if (session.current) {
      // A second call on the same page: the board (and any hold) carries on.
      if (shown.current) {
        avatar.state(boardState(shown.current));
        avatar.event(say.resume(shown.current), 60);
      }
      return;
    }
    void post<{ id: string; outcome: Outcome }>('/sessions', { seed: SEED }).then(({ id, outcome }) => {
      session.current = id;
      setSessionId(id);
      show(outcome, 'tap');
    }).catch((err) => console.warn('[fitness-coach] could not open a session', err));
  }, [avatar.phase]);

  // Plans, rebuilds and demos finish in the background, on the server.
  useEffect(() => {
    if (!sessionId) return;
    const stream = new EventSource(`${API}/sessions/${sessionId}/stream`);
    stream.onmessage = (message) => {
      try {
        show(JSON.parse(message.data) as Outcome, 'background');
      } catch (err) {
        console.warn('[fitness-coach] a streamed outcome was unreadable', err);
      }
    };
    return () => stream.close();
  }, [sessionId, show]);

  // A typed line is judged first; only what the app did not handle goes to the avatar.
  const onTyped = (text: string) => {
    void act({ text, how: 'typed' }, 'typed').then((outcome) => {
      if (outcome?.handled) avatar.record(text);
      else avatar.say(text);
    });
  };

  const tap = (command: Command, value = '') =>
    act({ command, value }, 'tap').then((outcome) => (outcome ? refusalReason(outcome) : 'That did not reach the app. Try again.'));

  const board = view ? parseSnapshot(view) : null;
  const live = avatar.phase === 'live';

  return (
    <div className="kit-layout fitness-app">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar} name="Your coach" startLabel="Start the session"
          lobby={<><div className="kit-title">Fitness Coach</div><div className="kit-detail">Tell your coach what you want to train and your level, or tap them on the right. You get a plan built around your limits, and a walk-through of the first move.</div></>}
        />
        <Composer avatar={avatar} placeholder="Say what you want to train, or a limit like “only 20 minutes”…" onSubmit={(t) => { onTyped(t); }} />
        <Transcript avatar={avatar} names={{ avatar: 'Coach' }} />
      </div>
      <div className="fitness-board" aria-label="Fitness Coach">
        <FitnessPanel
          flow={board?.flow ?? INITIAL_FLOW}
          plan={board?.plan ?? null}
          video={board?.video ?? null}
          stage={(view?.stage ?? 'goal') as BoardStage}
          demos={view?.demos ?? false}
          live={live && Boolean(view)}
          planning={view?.planning ?? false}
          rebuilding={view?.rebuilding ?? false}
          seed={view?.seed ?? SEED}
          onSelectGoal={(goal) => tap('goal', goal)}
          onSelectLevel={(level) => tap('level', level)}
          onChooseMove={(step) => tap('move', step)}
          onRestart={() => tap('restart')}
        />
      </div>
    </div>
  );
}
