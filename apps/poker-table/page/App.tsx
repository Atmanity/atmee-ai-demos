// Poker Table: the avatar sits opposite; the server owns the table, reads the
// player's moves and plays the opponent's. The page shows the masked view,
// keeps the avatar's state in step with it, passes on what happened as
// events, and asks the server to play the opponent whenever the action is on it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarStage, Composer, Transcript, useAvatar } from '../../../src/kit/index.ts';
import { NOTES, say, tableState } from '../engine/director.ts';
import type { Intent, Outcome, TableView } from '../engine/types.ts';
import { PokerGame } from './PokerGame.tsx';
import './poker.css';

const API = '/api/apps/poker-table';
const OPPONENT = 'Opponent';
/** A beat before the opponent acts, so the player sees their own move land first. */
const OPPONENT_BEAT_MS = 700;
/** The longest the opponent's move waits for the avatar to stop speaking. */
const HOLD_FOR_SPEECH_MS = 6000;

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function App() {
  const [view, setView] = useState<TableView | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const table = useRef<string | null>(null);
  const sentState = useRef('');
  const opponentAskedAt = useRef(-1);   // the view seq the opponent was last asked to play on
  const turnSince = useRef({ seq: -1, at: 0 });   // when the action landed on the opponent

  const avatar = useAvatar('poker-table', {
    // The avatar hears the player too, and has already started its own reply
    // by the time this arrives; the table's ruling follows as an event (the
    // standing notes tell it to wait for that).
    onUserSaid: (text, how) => { if (how === 'spoken') void act({ text, how: 'spoken' }); },
  });

  const show = useCallback((outcome: Outcome) => {
    setView(outcome.view);
    if (outcome.handled) setMessage(outcome.message ?? '');
    // State first, then the event: what the avatar says about it is grounded in the table.
    const state = tableState(outcome.view);
    if (state !== sentState.current) {
      sentState.current = state;
      avatar.state(state);
    }
    if (outcome.event) avatar.event(outcome.event, outcome.ttl ?? 20);
  }, [avatar.state, avatar.event]);

  async function act(body: { intent?: Intent; text?: string; how?: 'spoken' | 'typed' }): Promise<Outcome | null> {
    if (!table.current) return null;
    if (body.intent) setBusy(true);
    try {
      const outcome = await post<Outcome>(`/tables/${table.current}/act`, body);
      if (outcome.handled) show(outcome);
      return outcome;
    } catch (err) {
      console.warn(err);
      return null;
    } finally {
      if (body.intent) setBusy(false);
    }
  }

  // The table is dealt while the avatar is on its way; a second session at the same table carries on.
  useEffect(() => {
    if (avatar.phase !== 'starting') return;
    for (const note of NOTES) avatar.note(note);
    if (table.current) {
      avatar.event(say.resume(), 30);
      return;
    }
    void post<{ id: string; outcome: Outcome }>('/tables').then(({ id, outcome }) => {
      table.current = id;
      show(outcome);
    }).catch((err) => setMessage(`The table could not be set up (${(err as Error).message}).`));
  }, [avatar.phase]);

  // The opponent plays whenever the action is on it, once the avatar is there
  // to talk about it. While the avatar is still speaking (acknowledging the
  // player's move, say) its move waits, up to a cap: an event that arrives on
  // a busy floor can expire unsaid, and then the chips move with no word why.
  useEffect(() => {
    if (!view || !table.current || avatar.phase !== 'live') return;
    if (view.phase !== 'playing' || view.action_to !== 'agent' || opponentAskedAt.current === view.seq) return;
    const seq = view.seq;
    if (turnSince.current.seq !== seq) turnSince.current = { seq, at: Date.now() };
    const waited = Date.now() - turnSince.current.at;
    if (avatar.speaking && waited < HOLD_FOR_SPEECH_MS) {
      const recheck = setTimeout(() => setRetry((n) => n + 1), HOLD_FOR_SPEECH_MS - waited);
      return () => clearTimeout(recheck);
    }
    const timer = setTimeout(() => {
      opponentAskedAt.current = seq;
      post<Outcome>(`/tables/${table.current}/opponent`)
        .then((outcome) => { if (outcome.handled || outcome.view.seq !== seq) show(outcome); })
        .catch((err) => {
          console.warn(err);
          opponentAskedAt.current = -1;
          setTimeout(() => setRetry((n) => n + 1), 2000);
        });
    }, OPPONENT_BEAT_MS);
    return () => clearTimeout(timer);
  }, [view, avatar.phase, avatar.speaking, retry]);

  // A typed line is read by the table first; only what isn't a table action goes to the avatar as a turn.
  const onTyped = (text: string) => {
    void act({ text, how: 'typed' }).then((outcome) => {
      if (outcome?.handled) avatar.record(text);
      else avatar.say(text);
    });
  };

  return (
    <div className="kit-layout poker-layout">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar} name="Your opponent" startLabel="Sit down"
          lobby={<><div className="kit-title">Poker Table</div><div className="kit-detail">Heads-up no-limit hold'em: 1,000 chips each, blinds 10/20. Say or type your moves ("call", "raise to 60", "I fold"), or use the buttons.</div></>}
        />
        <Composer avatar={avatar} placeholder='Type a move ("raise to 60") or ask anything…' onSubmit={(t) => { onTyped(t); }} />
        <Transcript avatar={avatar} names={{ avatar: OPPONENT }} />
      </div>
      <div className="poker-shell">
        <PokerGame
          view={view} opponentName={OPPONENT} message={message} live={avatar.phase === 'live'} busy={busy}
          onIntent={(intent) => void act({ intent })}
        />
      </div>
    </div>
  );
}
