// Postmark: a city-guessing game hosted by Marco. Marco calls the game's
// tools (a guess, a clue, the next city) and speaks from the results; the
// page answers those calls, shows the postcard and the clues, keeps Marco's
// picture of the board current, and tells him about button presses.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, HostVideo, useAvatar, useToolNet, type ToolCall } from '../../../src/kit/index.ts';
import { boardState } from '../engine/director.ts';
import { mustDo, type Command } from '../engine/judge.ts';
import type { View } from '../engine/types.ts';
import { Clues, Postcard, Summary } from './Board.tsx';
import { Lobby, Logo } from './Lobby.tsx';
import marco from '../host/portrait.jpg';
import './postmark.css';

const API = '/api/apps/guess-the-city';
const HOST = 'Marco';

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function App() {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const game = useRef<string | null>(null);

  // Marco's tool calls: the server acts, the board follows, the result is what he says.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    if (!game.current) throw new Error('the cities are still being dealt; try again in a moment');
    setBusy(true);
    try {
      const { view: next, result } = await post<{ view: View; result: string }>(`/games/${game.current}/tool`, { name, arguments: args });
      setView(next);
      return result;
    } finally {
      setBusy(false);
    }
  }, []);

  // If Marco narrates "next city" without calling it, the game does it and tells him.
  const net = useToolNet({
    match: (text) => { const name = mustDo(text); return name ? { id: `net-${Date.now()}`, name, arguments: {} } : null; },
    run: async (call) => String(await onToolCall(call)),
    avatar: () => avatarRef.current!,
  });
  const avatar = useAvatar('guess-the-city', { onToolCall: net.watch(onToolCall), onUserSaid: (text) => net.heard(text) });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  // A button acts at once; Marco cannot see the screen, so he is told.
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

  // Every call is a new game, dealt while Marco is on his way (both take a while).
  // Only the newest deal may install its game: one from a call that failed and
  // was placed again can answer last. A newest deal that fails is tried once
  // more, then offered as "Deal again", so a live call is never left gameless.
  const deal = useRef(0);
  const [dealFailed, setDealFailed] = useState(false);
  const dealGame = useCallback(async (retry = true) => {
    const mine = ++deal.current;
    game.current = null;
    setView(null);
    setDealFailed(false);
    try {
      const { id, view: first, opening } = await post<{ id: string; view: View; opening: string }>('/games');
      if (mine !== deal.current) return;
      game.current = id;
      setView(first);
      avatarRef.current.event(opening, 60);
    } catch (err) {
      if (mine !== deal.current) return;
      console.warn(err);
      if (retry) return dealGame(false);
      setDealFailed(true);
    }
  }, []);
  useEffect(() => { if (avatar.phase === 'starting') void dealGame(); }, [avatar.phase]);

  // Marco's picture of the board follows the board.
  useEffect(() => { if (view) avatar.state(boardState(view)); }, [view]);

  if (avatar.phase === 'idle') return <Lobby onPlay={(mic) => void avatar.start({ mic })} />;

  return (
    <div className="pm-app">
      <header className="pm-top">
        <Logo />
        {view && !view.over && (
          <ol className="pm-rounds" aria-label={`Round ${Math.min(view.round, view.rounds)} of ${view.rounds}`}>
            {Array.from({ length: view.rounds }, (_, i) => {
              const result = view.results[i];
              const state = result ? (result.correct ? 'is-right' : 'is-missed') : i === view.round - 1 ? 'is-now' : '';
              return <li key={i} className={state} />;
            })}
          </ol>
        )}
        <p className="pm-score" aria-live="polite"><b>{view?.score ?? 0}</b> pts</p>
        <CallControls avatar={avatar} className="pm-controls" />
      </header>

      <main className="pm-main">
        <div className="pm-board">
          {view?.over ? <Summary view={view} live={live} busy={busy} onAgain={() => (live ? void press('new') : void avatar.start({ mic: avatar.micOn }))} /> : <Postcard view={view} failed={dealFailed} onRetry={() => void dealGame()} />}
          <Clues view={view} busy={busy} live={live} onCommand={(command) => void press(command)} />
        </div>

        <aside className="pm-host" aria-label={`${HOST}, your host`}>
          <HostVideo avatar={avatar} name={HOST} poster={marco} className="pm-host-video">
            <CallStatus avatar={avatar} name={HOST} again="Call Marco again" />
          </HostVideo>
          <p className="pm-nameplate"><b>{HOST}</b> your host{live && <span className="pm-onair">On air</span>}</p>
        </aside>

        <ChatPanel
          avatar={avatar} name={HOST} className="pm-chat" placeholder="Type a city, or ask for a clue…"
          empty={<>Say your guess out loud, or type it here.</>}
        />
      </main>
    </div>
  );
}
