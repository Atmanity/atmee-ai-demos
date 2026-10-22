// Chess Opponent: a real game against the avatar. The board (rules, the
// opponent's move choice, every refusal) runs here in the page, because chess
// has no secrets; the avatar is the opponent across the table, told what the
// board did and asked to say why it played what it played.
//
// Three ways in, one way through: a button or a drag acts at once; a typed
// line and the player's speech are judged first (engine/judge.ts: rules, then
// the server's model for the doubtful ones). Every action then goes through
// the same Table, one at a time, and the avatar gets the new state and one
// event about what happened.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarStage, Composer, Transcript, useAvatar } from '../../../src/kit/index.ts';
import { boardState, NOTES, say } from '../engine/director.ts';
import { ChessMatch } from '../engine/game.ts';
import { judge, toAction, type Verdict } from '../engine/judge.ts';
import { Table, type Outcome } from '../engine/table.ts';
import type { Action, ChessSnapshot } from '../engine/types.ts';
import { ChessGame, type Intent, type Sent } from './ChessGame.tsx';
import './styles.css';

const ID = 'chess-opponent';
const API = `/api/apps/${ID}`;
/** A beat between the player's move landing and the opponent's reply, so both are seen. */
const REPLY_MS = 700;
/** The board names the opponent by role: the avatar on screen has its own name. */
const OPPONENT = 'Opponent';

type How = 'button' | 'typed' | 'spoken';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const NONE: Verdict = { kind: 'none' };
const VERDICTS = new Set(['move', 'side', 'difficulty', 'resign', 'new', 'none']);

function intentAction(intent: Intent): Action {
  switch (intent.kind) {
    case 'move': return { kind: 'move', text: intent.move };
    case 'new_game': return { kind: 'new' };
    case 'set_side': return { kind: 'side', side: intent.side };
    case 'set_difficulty': return { kind: 'difficulty', level: intent.level };
    case 'resign': return { kind: 'resign' };
  }
}

export function App() {
  const [snapshot, setSnapshot] = useState<ChessSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const table = useRef<Table | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const avatar = useAvatar(ID, {
    // The avatar hears the player too and starts its own reply at once; the
    // board's outcome follows as an event (the notes tell it to wait for that).
    onUserSaid: (text, how) => { if (how === 'spoken') void heard(text, 'spoken'); },
  });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  /** The same board twice is no change (so the panel's own refusal message survives). */
  const show = useCallback((next: ChessSnapshot) => {
    setSnapshot((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);

  /** The state first, then the event, so the avatar's words are grounded. */
  const tell = useCallback((outcome: Outcome, how: How) => {
    show(outcome.snapshot);
    avatarRef.current.state(boardState(outcome.snapshot));
    // A spoken request whose answer was staged in the state was already answered by the avatar.
    if (outcome.event && !(how === 'spoken' && outcome.staged)) avatarRef.current.event(outcome.event.text, outcome.event.ttl);
  }, [show]);

  /** One board change at a time, whatever its route. */
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task);
    queue.current = run.catch((err) => console.warn('[chess-opponent]', err));
    return run;
  }, []);

  /** The opponent's move, after a beat, and the one event about it and what led to it. */
  const reply = useCallback(async (lead: NonNullable<Outcome['next']>) => {
    setBusy(true);
    await sleep(REPLY_MS);
    setBusy(false);
    const t = table.current;
    if (t) tell(t.reply(lead), 'button');
  }, [tell]);

  /** Act on the board. `quiet`: an unreadable move is not told (the rules guessed it was a move; the model decides next). */
  const perform = useCallback((action: Action, how: How, quiet = false): Promise<Outcome | null> => enqueue(async () => {
    const t = table.current;
    if (!t) return null;
    const outcome = t.act(action);
    if (outcome.kind === 'unreadable' && quiet) {
      show(outcome.snapshot);
      return outcome;
    }
    if (outcome.next) {
      show(outcome.snapshot);
      avatarRef.current.state(boardState(outcome.snapshot));
      await reply(outcome.next);
    } else {
      tell(outcome, how);
    }
    return outcome;
  }), [enqueue, reply, show, tell]);

  /** The server's model, for a line the rules could not settle. None when it is unavailable. */
  async function askModel(text: string): Promise<Verdict> {
    const s = table.current?.snapshot();
    if (!s) return NONE;
    try {
      const res = await fetch(`${API}/judge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          userColor: s.user_color,
          turn: s.turn,
          legal: s.turn === 'user' ? s.legal_moves.map((m) => m.san) : [],
          moves: s.history.length,
          over: s.phase === 'game-over',
        }),
      });
      if (!res.ok) return NONE;
      const verdict = await res.json();
      return verdict && VERDICTS.has(verdict.kind) ? (verdict as Verdict) : NONE;
    } catch {
      return NONE;
    }
  }

  /** A line the player said or typed. Returns whether it was a board action. */
  async function heard(text: string, how: 'spoken' | 'typed'): Promise<boolean> {
    const t = table.current;
    if (!t) return false;
    let verdict = judge(text, { moves: t.snapshot().history.length });
    if (verdict.kind === 'model') verdict = await askModel(text);
    const action = toAction(verdict);
    if (!action) return false;
    const guessed = verdict.kind === 'move' && verdict.via === 'rules';
    const outcome = await perform(action, how, guessed);
    if (outcome?.kind === 'unreadable' && guessed) {
      // It looked like a move and the board could not read it: a sentence like
      // "that knight belongs on g5" is talk, "okay so knight to g5 then" is a
      // move. The model decides; without one, it is talk.
      const again = toAction(await askModel(text));
      if (!again) return false;
      await perform(again, how);
    }
    return true;
  }

  // The board is set up while the avatar is on its way (the player sees it
  // during the wait); a second session on the same page carries on the game.
  useEffect(() => {
    if (avatar.phase !== 'starting') return;
    for (const note of NOTES) avatar.note(note);
    const existing = table.current;
    if (existing) {
      const s = existing.snapshot();
      tell({ kind: 'idle', applied: false, snapshot: s, event: { text: say.resume(s), ttl: 60 } }, 'button');
      return;
    }
    const t = new Table(new ChessMatch());
    table.current = t;
    console.info('[chess-opponent] match seed=%d (new ChessMatch("white", seed) replays its tie-breaks)', t.match.seed);
    const opening = t.start();
    if (opening.next) {
      show(opening.snapshot);
      void enqueue(() => reply(opening.next!));
    } else {
      tell(opening, 'button');
    }
  }, [avatar.phase]);

  // The avatar's picture of the board follows the board.
  useEffect(() => { if (snapshot) avatar.state(boardState(snapshot)); }, [snapshot]);

  const send = useCallback((intent: Intent): Promise<Sent> =>
    perform(intentAction(intent), 'button').then((outcome) =>
      outcome ? { applied: outcome.applied, reason: outcome.reason ?? '' } : { applied: false, reason: 'The board is not set up yet.' }),
  [perform]);

  // A typed line is judged first; only what isn't a board action goes to the avatar.
  const onTyped = (text: string) => {
    void heard(text, 'typed').then((handled) => {
      if (handled) avatar.record(text);
      else avatar.say(text);
    });
  };

  const status = !snapshot ? 'Press “Start the game”: your opponent sets up the board.'
    : !live ? (avatar.phase === 'ended' ? 'The session has ended. Start again to play on.' : 'Your opponent is on the way…')
      : busy ? 'Your opponent is thinking…'
        : snapshot.phase === 'game-over' ? 'Game over.'
          : snapshot.turn === 'user' ? 'Your move.' : 'Your opponent’s move.';

  return (
    <div className="kit-layout">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar} name="Your opponent" startLabel="Start the game"
          lobby={<><div className="kit-title">Chess Opponent</div><div className="kit-detail">A real game against an opponent who moves on its own, says why, and needles you a little. Drag a piece, or say or type your move.</div></>}
        />
        <Composer avatar={avatar} placeholder='Type a move ("e4", "knight to f3") or a message…' onSubmit={(t) => { onTyped(t); }} />
        <Transcript avatar={avatar} names={{ avatar: OPPONENT }} />
      </div>
      <main className="chess-app">
        <header className="chess-app__header">
          <h1 className="chess-app__title">Chess</h1>
          <span className="chess-app__tagline" role="status">{status}</span>
        </header>
        <ChessGame
          state={snapshot} send={send} pending={busy} opponentName={OPPONENT} disabled={!live}
          lobby="Press “Start the game”: your opponent sets up the board."
        />
      </main>
    </div>
  );
}
