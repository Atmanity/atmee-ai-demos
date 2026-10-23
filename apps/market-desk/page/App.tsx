// Outcry: a live stock watchlist you build by talking, read by Reese, an
// analyst who never gives advice. Reese calls the desk's tools (add, focus,
// refresh, remove, clear) and speaks from their results; the page answers
// those calls through the server, draws the board, keeps Reese's picture of
// it current, and tells Reese about button presses and the desk's own news.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallControls, callCopy, CallStatus, ChatPanel, clock, HostVideo, useAvatar, useToolNet, type Avatar, type ToolCall } from '../../../src/kit/index.ts';
import { boardState, say } from '../engine/director.ts';
import { mustDo } from '../engine/judge.ts';
import type { Board, Kind } from '../engine/types.ts';
import { DeskBoard, type IntentResult } from './Board.tsx';
import { Closing } from './Closing.tsx';
import { Lobby, Logo } from './Lobby.tsx';
import { Tape } from './Tape.tsx';
import portrait from '../host/portrait.jpg';
import { useDesk } from './useDesk.ts';
import './outcry.css';

const HOST = 'Reese';

export function App() {
  const [entered, setEntered] = useState(false);
  const [wantMic, setWantMic] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const avatarRef = useRef<Avatar | null>(null);
  const liveRef = useRef(false);
  const boardRef = useRef<Board | null>(null);

  // The desk's own lines (a 1% move on the stock on watch, a quote that outlived Reese's wait) are for a live call only.
  const desk = useDesk({ enabled: entered, onSay: (text, ttl) => { if (liveRef.current) avatarRef.current?.event(text, ttl); } });
  boardRef.current = desk.board;

  // Reese's tool calls: the server acts (and waits for the quote), the board follows, the result is what Reese says.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    const reply = await desk.tool(name, args ?? {});
    setNotice(reply.refused ?? null);
    return reply.text;
  }, [desk.tool]);

  // If Reese says "clearing it" without calling clear_board, the desk does it and says so.
  const net = useToolNet({
    match: (text) => {
      const call = boardRef.current ? mustDo(text, boardRef.current) : null;
      return call ? { id: `net-${Date.now()}`, ...call } : null;
    },
    run: async (call) => String(await onToolCall(call)),
    avatar: () => avatarRef.current!,
  });

  const avatar = useAvatar('market-desk', {
    onToolCall: net.watch(onToolCall),
    onUserSaid: (text) => net.heard(text),
    // The opening, from the board as it is when Reese arrives (the user may have added while the call connected).
    onLive: () => {
      const board = boardRef.current;
      avatarRef.current?.event(board?.watchlist.length ? say.startWith(board) : say.start(), 60);
    },
  });
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';
  liveRef.current = live;

  // A button acts at once; Reese cannot see the screen, so Reese is told what it did.
  const press = useCallback(async (kind: Kind, symbol = ''): Promise<IntentResult> => {
    try {
      const reply = await desk.act(kind, symbol);
      if (liveRef.current) avatarRef.current?.event(reply.text, 30);
      return reply.refused ? { applied: false, reason: reply.refused } : { applied: true };
    } catch (err) {
      console.warn('[market-desk]', err);
      return { applied: false, reason: 'The board isn’t answering. Try again in a moment.' };
    }
  }, [desk.act]);

  // Ages on the board, and in Reese's picture of it, move with the clock.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Reese's picture of the board follows the board.
  const lastState = useRef('');
  useEffect(() => {
    if (!desk.board) return;
    const text = boardState(desk.board, now / 1000);
    if (text === lastState.current) return;
    lastState.current = text;
    avatar.state(text);
  }, [desk.board, now]);

  // A refusal from a tool call fades like the board's own.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(id);
  }, [notice]);

  const call = (mic: boolean) => {
    setWantMic(mic);
    setEntered(true);
    void avatar.start({ mic });
  };

  if (!entered) return <Lobby onStart={call} />;

  return (
    <div className="oc-app">
      <header className="oc-top">
        <Logo />
        <Tape board={desk.board} />
        <CallControls avatar={avatar} className="oc-controls" />
      </header>

      <main className="oc-main">
        <Booth avatar={avatar} live={live} wantMic={wantMic} />

        <div className="oc-desk">
          {avatar.phase === 'ended' && <Closing board={desk.board} now={now} host={HOST} onAgain={() => void avatar.start({ mic: wantMic })} />}
          <DeskBoard board={desk.board} onIntent={press} notice={desk.lost ? 'Reconnecting to your board…' : notice} now={now} host={HOST} />
        </div>

        <ChatPanel
          avatar={avatar} name={HOST} className="oc-chat" placeholder={`Ask ${HOST}, or name a stock…`}
          empty={<>Name a stock out loud or type it here: “put Nvidia up”, “what’s Tesla doing?”</>}
        />
      </main>
    </div>
  );
}

/** Reese's booth: the video with a nameplate, and on a phone the last thing Reese said beside it. */
function Booth({ avatar, live, wantMic }: { avatar: Avatar; live: boolean; wantMic: boolean }) {
  const lastLine = [...avatar.lines].reverse().find((line) => line.who === 'avatar')?.text ?? '';
  const words = avatar.speaking && avatar.caption ? avatar.caption : lastLine;
  // On a phone the video is too small to carry the call's status, so it is said beside it.
  const status = avatar.phase === 'idle' ? { title: `Calling ${HOST}…`, detail: '' } : callCopy(avatar, HOST);
  return (
    <aside className="oc-booth" aria-label={`${HOST}, your analyst`}>
      <HostVideo avatar={avatar} name={HOST} poster={portrait} className="oc-video">
        {avatar.phase === 'idle' ? (
          // Before the call is placed (the browser may be asking for the microphone).
          <div className="call-status" role="status">
            <span className="call-spinner" aria-hidden="true" />
            <strong>Calling {HOST}…</strong>
            <span>{wantMic ? 'Allow the microphone if your browser asks.' : 'This takes a few seconds.'}</span>
          </div>
        ) : (
          <CallStatus avatar={avatar} name={HOST} again={`Call ${HOST} again`} />
        )}
      </HostVideo>
      <div className="oc-plate">
        <span className="oc-plate-name">{HOST}</span>
        <span className="oc-plate-role">Your analyst</span>
        {live && (
          <span className="oc-onair">
            On the line{avatar.secondsLeft !== null && avatar.secondsLeft <= 120 ? ` · ${clock(avatar.secondsLeft)} left` : ''}
          </span>
        )}
      </div>
      {live && words && <p className="oc-lastline" aria-hidden="true">{words}</p>}
      {!live && status && <p className="oc-lastline is-status" aria-hidden="true"><b>{status.title}</b> {status.detail}</p>}
    </aside>
  );
}
