// Market Desk: a live stock watchlist you build by talking, read by an
// analyst who never gives advice. The server owns the board (the feed, the
// pump, the once-a-minute refresh, the 1% announcer) and judges every line;
// the page draws the board, keeps the avatar's state in step with it (prices
// with their ages, what is arriving, the staged refusal), and relays what
// happened as events.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarStage, Composer, Transcript, useAvatar, type Avatar } from '../../../src/kit/index.ts';
import { boardState, buildNotes, say } from '../engine/director.ts';
import type { Board, Kind, Outcome } from '../engine/types.ts';
import { MarketDesk, type IntentResult } from './MarketDesk.tsx';
import { useDesk } from './useDesk.ts';
import './desk.css';

export function App() {
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [advice, setAdvice] = useState<{ asked: string; fact: string } | null>(null);
  const refusals = useRef(0);
  const live = useRef(false);
  const avatarRef = useRef<Avatar | null>(null);
  const boardRef = useRef<Board | null>(null);
  const lastState = useRef('');

  /** The avatar's picture of the board, re-sent whenever its text changes (ages tick by the minute). */
  const pushState = useCallback((board: Board | null) => {
    if (!board || !avatarRef.current) return;
    const text = boardState(board, Date.now() / 1000, { refusals: refusals.current });
    if (text === lastState.current) return;
    lastState.current = text;
    avatarRef.current.state(text);
  }, []);

  const desk = useDesk({
    // Synchronously, so the state a line is about is sent before the line.
    onBoard: (board) => { boardRef.current = board; pushState(board); },
    // The desk's own lines (a quote landing, a 1% move, a failed add) are for a live avatar only.
    onSay: (text, ttl) => { if (live.current) avatarRef.current?.event(text, ttl); },
  });

  const avatar = useAvatar('market-desk', {
    // The avatar hears the user too and has already answered by the time the
    // words arrive here; the desk's part (and anything the avatar could not
    // know) follows as an event.
    onUserSaid: (text, how) => { if (how === 'spoken') void desk.act({ text, from: 'spoken' }).then((o) => o && show(o)); },
    onLive: () => {
      live.current = true;
      const board = boardRef.current;
      avatarRef.current?.event(board?.watchlist.length ? say.startWith(board) : say.start(), 60);
    },
    onEnded: () => { live.current = false; },
  });
  avatarRef.current = avatar;

  // The standing rules go once per session (the kit delivers them on arrival).
  useEffect(() => { for (const note of buildNotes()) avatar.note(note); }, []);

  // Ages on the cards and in the state move with the clock.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { pushState(boardRef.current); }, [now, pushState]);

  // Notices and the refusal banner fade.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    if (!advice) return;
    const id = setTimeout(() => setAdvice(null), 20_000);
    return () => clearTimeout(id);
  }, [advice]);

  function show(outcome: Outcome) {
    if (outcome.advice) {
      refusals.current += 1; // the next staged refusal offers a different fact
      setAdvice(outcome.advice);
      pushState(outcome.board);
    }
    setNotice(outcome.refused ?? null);
    if (outcome.event && live.current) avatar.event(outcome.event, 45);
  }

  // A typed line is judged first: a desk action (or an advice question) is
  // recorded and acted on, and only what is not goes to the avatar as a turn.
  const onTyped = (text: string) => {
    void desk.act({ text, from: 'typed' }).then((outcome) => {
      if (outcome?.handled) {
        avatar.record(text);
        show(outcome);
      } else {
        avatar.say(text);
      }
    });
  };

  const onIntent = async (intent: { kind: Kind; symbol?: string }): Promise<IntentResult> => {
    const outcome = await desk.act({ intent });
    if (!outcome) return { applied: false, reason: 'The desk is not answering. Try again in a moment.' };
    return outcome.refused ? { applied: false, reason: outcome.refused } : { applied: true };
  };

  return (
    <div className="kit-layout">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar}
          name="Analyst"
          startLabel="Call the analyst"
          lobby={<><div className="kit-title">Market Desk</div><div className="kit-detail">Build a watchlist of up to six stocks by saying or typing a company or a ticker. The analyst reads the tape off the board and never gives advice.</div></>}
        />
        <Composer avatar={avatar} placeholder="Type a ticker or a company, or ask about the board…" onSubmit={(t) => { onTyped(t); }} />
        <Transcript avatar={avatar} names={{ avatar: 'Analyst' }} />
      </div>
      <MarketDesk board={desk.board} onIntent={onIntent} notice={desk.lost ? 'Reconnecting to the desk…' : notice} advice={advice} now={now} />
    </div>
  );
}
