// Guess the City: the avatar hosts; the server owns the game. The host calls
// the game's tools (a guess, a clue, the next city) and speaks from the
// results; the page answers those calls, shows the board, keeps the host's
// picture of it current, and tells the host about button presses.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarStage, Composer, Transcript, useAvatar, type ToolCall } from '../../../src/kit/index.ts';
import { boardState } from '../engine/director.ts';
import type { Command } from '../engine/judge.ts';
import type { View } from '../engine/types.ts';
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

  // The host's tool calls: the server acts, the board follows, the result is what the host says.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    if (!game.current) throw new Error('the game is still being dealt; try again in a moment');
    setBusy(true);
    try {
      const { view: next, result } = await post<{ view: View; result: string }>(`/games/${game.current}/tool`, { name, arguments: args });
      setView(next);
      return result;
    } finally {
      setBusy(false);
    }
  }, []);

  const avatar = useAvatar('guess-the-city', { onToolCall });

  // A button acts at once; the host cannot see it, so it is told.
  async function press(command: Command) {
    if (!game.current) return;
    setBusy(true);
    try {
      const { view: next, event } = await post<{ view: View; event: string }>(`/games/${game.current}/act`, { command });
      setView(next);
      avatar.event(event, 30);
    } catch (err) {
      console.warn(err);
    } finally {
      setBusy(false);
    }
  }

  // The game is dealt while the avatar is on its way (both take a while).
  useEffect(() => {
    if (avatar.phase !== 'starting' || game.current) return;
    void post<{ id: string; view: View; opening: string }>('/games').then(({ id, view: first, opening }) => {
      game.current = id;
      setView(first);
      avatar.event(opening, 60);
    });
  }, [avatar.phase]);

  // The host's picture of the board follows the board.
  useEffect(() => { if (view) avatar.state(boardState(view)); }, [view]);

  return (
    <div className="kit-layout">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar} name="Your host" startLabel="Start the game"
          lobby={<><div className="kit-title">Guess the City</div><div className="kit-detail">A mystery city appears on the right. Guess it out loud or type it; ask for a clue whenever you like. Three cities a game.</div></>}
        />
        <Composer avatar={avatar} placeholder="Type a guess, or ask for a clue…" />
        <Transcript avatar={avatar} names={{ avatar: 'Host' }} />
      </div>
      <Board view={view} busy={busy} live={avatar.phase === 'live'} onCommand={(command) => void press(command)} />
    </div>
  );
}
