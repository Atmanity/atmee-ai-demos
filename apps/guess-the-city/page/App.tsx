// Guess the City: the avatar hosts; the server owns the game and judges every
// guess. The page shows the board, keeps the avatar's state in step with it,
// and passes on what happened as events.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarStage, Composer, Transcript, useAvatar } from '../../../src/kit/index.ts';
import { boardState, NOTES } from '../engine/director.ts';
import type { Command } from '../engine/judge.ts';
import type { Outcome, View } from '../engine/types.ts';
import { Board } from './Board.tsx';
import './board.css';

const API = '/api/apps/guess-the-city';

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function App() {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const game = useRef<string | null>(null);

  const avatar = useAvatar('guess-the-city', {
    // The avatar hears the player too, and answers at once; the game's verdict
    // follows as an event (the standing notes tell it to wait for that).
    onUserSaid: (text, how) => { if (how === 'spoken') void act({ text }, 'spoken'); },
  });

  const show = useCallback((outcome: Outcome, from: 'spoken' | 'other' = 'other') => {
    setView(outcome.view);
    // A clue asked for out loud was already given from the staged one in the
    // avatar's state; telling it again would repeat it.
    const alreadySaid = from === 'spoken' && outcome.kind === 'hint';
    if (outcome.event && !alreadySaid) avatar.event(outcome.event, 30);
  }, [avatar.event]);

  async function act(input: { command?: Command; text?: string }, from: 'spoken' | 'other' = 'other'): Promise<Outcome | null> {
    if (!game.current) return null;
    setBusy(true);
    try {
      const outcome = await post<Outcome>(`/games/${game.current}/act`, input);
      show(outcome, from);
      return outcome;
    } catch (err) {
      console.warn(err);
      return null;
    } finally {
      setBusy(false);
    }
  }

  // The game is dealt while the avatar is on its way (both take a while).
  useEffect(() => {
    if (avatar.phase !== 'starting' || game.current) return;
    for (const note of NOTES) avatar.note(note);
    void post<{ id: string; outcome: Outcome }>('/games').then(({ id, outcome }) => {
      game.current = id;
      show(outcome);
    });
  }, [avatar.phase]);

  // The avatar's picture of the board follows the board.
  useEffect(() => { if (view) avatar.state(boardState(view)); }, [view]);

  // A typed line is judged first; only what isn't a game action goes to the avatar.
  const onTyped = (text: string) => {
    void act({ text }).then((outcome) => {
      if (outcome?.handled) avatar.record(text);
      else avatar.say(text);
    });
  };

  return (
    <div className="kit-layout">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar} name="Your host" startLabel="Start the game"
          lobby={<><div className="kit-title">Guess the City</div><div className="kit-detail">A mystery city appears on the right. Guess it out loud or type it; ask for a clue whenever you like. Three cities a game.</div></>}
        />
        <Composer avatar={avatar} placeholder="Type a guess, or ask for a clue…" onSubmit={(t) => { onTyped(t); }} />
        <Transcript avatar={avatar} names={{ avatar: 'Host' }} />
      </div>
      <Board view={view} busy={busy} live={avatar.phase === 'live'} onCommand={(command) => void act({ command })} />
    </div>
  );
}
