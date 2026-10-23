// Kibitz: chess against Sasha, a club player who explains her moves. The
// board (the rules, Sasha's move choice, every refusal) runs here in the page,
// because chess has no secrets. Sasha calls the board's tools for whatever the
// player asks it to do (a move, a side, a strength, resigning, a new game) and
// speaks from what they return: a move's result already carries her reply.
// Moves made by hand and buttons act at once, and she is told by an event.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, HostVideo, useAvatar, useToolNet, BackToApps, useCaptionToggle, type Avatar, type ToolCall } from '../../../src/kit/index.ts';
import { actionFor, boardState, pressed, say } from '../engine/director.ts';
import { ChessMatch } from '../engine/game.ts';
import { mustDo, readsAsMove, typedMove } from '../engine/judge.ts';
import type { Lead } from '../engine/director.ts';
import { Table, type Outcome } from '../engine/table.ts';
import type { Action, ChessSnapshot } from '../engine/types.ts';
import { Game, type Intent, type Sent } from './Game.tsx';
import { Logo, Lobby } from './Lobby.tsx';
import { Scoresheet } from './Scoresheet.tsx';
import { isSoundMuted, setSoundMuted, sounds } from './sounds.ts';
import portrait from '../host/portrait.jpg';
import './kibitz.css';

const ID = 'chess-opponent';
export const HOST = 'Sasha';
/** A beat between the player's move landing and Sasha's reply, so both are seen. */
const REPLY_MS = 700;

/** Tools that start a new game: after one, the safety net deals no other. */
const RESETS = new Set(['choose_side', 'new_game']);
/** As the kit's net counts a call made shortly before the words. */
const EARLY_MS = 6000;

/** What an action did: the words Sasha speaks from, whether the board changed, and whether its call is still the current one. */
interface Done { text: string; ttl: number; applied: boolean; reason: string; current: boolean }

/** What an action from a call that has ended answers: nothing was done for it. */
const ENDED: Done = { text: 'Nothing changed: that call has ended.', ttl: 0, applied: false, reason: '', current: false };

/** An intent as a board action, the tool it stands for, and how Sasha is told of it. */
function intentAction(intent: Intent): [Action, string, string] {
  switch (intent.kind) {
    case 'move': return [{ kind: 'move', text: intent.move }, 'play_move', 'moved a piece by hand'];
    case 'new_game': return [{ kind: 'new' }, 'new_game', 'pressed "New game"'];
    case 'set_side': return [{ kind: 'side', side: intent.side }, 'choose_side', `pressed "Play ${intent.side === 'white' ? 'White' : 'Black'}"`];
    case 'set_difficulty': return [{ kind: 'difficulty', level: intent.level }, 'set_strength', `set Sasha's strength to "${intent.level}"`];
    case 'resign': return [{ kind: 'resign' }, 'resign', 'pressed "Resign"'];
  }
}

/** What the board says while nothing can be played, in Sasha's terms. */
function lockedCopy(avatar: Avatar): string | null {
  switch (avatar.phase) {
    case 'live': return null;
    case 'ended': return `Call ended. Call ${HOST} again to play on from here.`;
    case 'failed': return `${HOST} couldn't make it. Try calling her again.`;
    default: return `${HOST} is taking her seat…`;
  }
}

function gameLine(s: ChessSnapshot | null): string {
  if (!s) return 'Setting up';
  if (s.result) return 'Game over';
  const move = Math.floor(s.history.length / 2) + 1;
  return s.opening ? `Move ${move} · ${s.opening}` : `Move ${move}`;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function App() {
  const [snapshot, setSnapshot] = useState<ChessSnapshot | null>(null);
  const [thinking, setThinking] = useState(false);
  const table = useRef<Table | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const avatarRef = useRef<Avatar | null>(null);
  /**
   * The current call's number. Bumped when a call starts and when it ends, so
   * whatever was started for a call (a queued action, Sasha's reply after its
   * pause, an event about it) can tell it is stale and do nothing.
   */
  const call = useRef(0);
  /** The pauses before Sasha's replies, each cancellable: a call's pauses end with it. */
  const pauses = useRef(new Set<() => void>());
  /** When each action was last taken, by anyone (Sasha, the net, a button); 'reset' for any new game. */
  const acted = useRef(new Map<string, number>());
  const touch = useCallback((name: string) => {
    acted.current.set(name, Date.now());
    if (RESETS.has(name)) acted.current.set('reset', Date.now());
  }, []);

  /** The same board twice is no change (so a local refusal message survives). */
  const show = useCallback((next: ChessSnapshot) => {
    setSnapshot((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);

  /** One board change at a time, whatever its route. */
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task);
    queue.current = run.catch((err) => console.warn('[chess-opponent]', err));
    return run;
  }, []);

  /** A pause that resolves true when it runs its course, false when its call ends first. */
  const pause = useCallback((ms: number) => new Promise<boolean>((resolve) => {
    const cancel = () => { clearTimeout(id); pauses.current.delete(cancel); resolve(false); };
    const id = setTimeout(() => { pauses.current.delete(cancel); resolve(true); }, ms);
    pauses.current.add(cancel);
  }), []);

  /** The call is over (hung up, failed, or the page is going): nothing started for it may act any more. */
  const endCall = useCallback(() => {
    call.current += 1;
    for (const cancel of [...pauses.current]) cancel();
    acted.current.clear();
  }, []);

  /**
   * Sasha's own move, a beat after whatever made it her turn, for call `mine`.
   * Null when that call ends during the beat: her move then waits for the
   * next call, which plays it as it opens.
   */
  const opponent = useCallback(async (lead: Lead & { fen: string }, mine: number): Promise<Outcome | null> => {
    setThinking(true);
    const ran = await pause(REPLY_MS);
    if (!ran) return null;   // the call ended mid-pause; its end cleared the flag
    setThinking(false);
    if (mine !== call.current) return null;
    const outcome = table.current!.reply(lead);
    show(outcome.snapshot);
    return outcome;
  }, [pause, show]);

  /** One board action, from any route, and what Sasha is to say about it (her own reply included). */
  const act = useCallback((action: Action): Promise<Done> => {
    const mine = call.current;
    return enqueue(async () => {
      // Queued behind something else while its call ended: dropped, untouched.
      if (mine !== call.current) return ENDED;
      const t = table.current;
      if (!t) throw new Error('the board is still being set up; try again in a moment');
      const first = t.act(action);
      show(first.snapshot);
      const last = first.next ? await opponent(first.next, mine) : first;
      if (!last) return { ...ENDED, applied: first.applied, reason: first.reason ?? '' };
      return { text: last.event?.text ?? 'Nothing changed on the board.', ttl: last.event?.ttl ?? 30, applied: first.applied, reason: first.reason ?? '', current: mine === call.current };
    });
  }, [enqueue, opponent, show]);

  // Sasha's tool calls: the board acts, the screen follows, the result is what she says.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    const action = actionFor(name, args ?? {});
    if (typeof action === 'string') return action;
    touch(name);
    return (await act(action)).text;
  }, [act, touch]);

  // If Sasha agrees to "I resign" or "go easy on me" without calling the tool, the board does it and tells her.
  const net = useToolNet({
    match: (text) => {
      const s = table.current?.snapshot();
      if (!s) return null;
      const call = mustDo(text, { moves: s.history.length, over: s.phase === 'game-over' });
      return call ? { id: `net-${Date.now()}`, ...call } : null;
    },
    run: async (call) => {
      // Already done since the words, by a button or another tool: a reset
      // Sasha made with choose_side is not to be followed by the net's new_game.
      // (A throw here is the kit's way to stand down: nothing is told.)
      const heardAt = Number(call.id.slice(4)) || Date.now();
      const since = acted.current.get(RESETS.has(call.name) ? 'reset' : call.name) ?? 0;
      if (since >= heardAt - EARLY_MS) throw new Error(`${call.name} was already taken care of`);
      return String(await onToolCall(call));
    },
    avatar: () => avatarRef.current!,
  });
  // The host's words over the video: off by default, since the chat carries them.
  const cc = useCaptionToggle(ID, false);
  const avatar = useAvatar(ID, { onToolCall: net.watch(onToolCall), onUserSaid: (text) => net.heard(text) });
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  /** A move by hand or a button acts at once; Sasha cannot see the screen, so she is told. */
  const send = useCallback(async (intent: Intent, what?: string): Promise<Sent> => {
    const [action, name, how] = intentAction(intent);
    touch(name);
    try {
      const done = await act(action);
      if (done.current) avatarRef.current?.event(pressed(what ?? how, done.text), done.ttl);
      return { applied: done.applied, reason: done.reason };
    } catch (err) {
      console.warn('[chess-opponent]', err);
      return { applied: false, reason: 'The board is not set up yet.' };
    }
  }, [act, touch]);

  /**
   * A typed line written as a move ("Nf6", "e2e4", "O-O") goes to the board at
   * once, like a move by hand: played (chess.js's exact reading when it is
   * legal now), or refused under the board; Sasha is told either way. Anything
   * else is a chat turn she answers (and calls the tools for).
   */
  const onTyped = (text: string) => {
    const s = table.current?.snapshot();
    if (!s || !readsAsMove(text)) return void avatar.say(text);
    const line = text.trim();
    avatar.record(line);
    void send({ kind: 'move', move: typedMove(line, s) ?? line.replace(/\.$/, '') }, `typed the move "${line}"`);
  };

  // A call that ends takes everything started for it along: its pauses, its
  // queued actions, its events. Leaving the page ends it too.
  useEffect(() => {
    if (avatar.phase !== 'ended' && avatar.phase !== 'failed') return;
    endCall();
    setThinking(false);
  }, [avatar.phase]);
  useEffect(() => endCall, []);

  // The board is set up while Sasha is on her way (the player sees it during
  // the wait); calling her again on the same page carries on the same game.
  useEffect(() => {
    if (avatar.phase !== 'starting') return;
    const mine = ++call.current;
    let t = table.current;
    let lead: (Lead & { fen: string }) | undefined;
    const s = t?.snapshot();
    if (t && s && (s.history.length > 0 || s.result)) {
      show(s);
      // A game under way is carried on. If the last call ended in her pause, her move comes now.
      if (s.turn !== 'agent') return void avatar.event(say.resume(s), 60);
      lead = { fen: s.fen, note: say.resume(s) };
    } else {
      // A fresh board (an untouched one too: a call that never connected).
      if (!t) {
        t = new Table(new ChessMatch());
        table.current = t;
        console.info('[chess-opponent] match seed=%d (new ChessMatch("white", seed) replays its tie-breaks)', t.match.seed);
      }
      const opening = t.start();
      show(opening.snapshot);
      if (!opening.next) return void (opening.event && avatar.event(opening.event.text, opening.event.ttl));
      lead = opening.next;
    }
    void enqueue(async () => {
      const reply = await opponent(lead!, mine);
      if (reply?.event && mine === call.current) avatarRef.current?.event(reply.event.text, reply.event.ttl);
    });
  }, [avatar.phase]);

  // Sasha's picture of the board follows the board.
  useEffect(() => { if (snapshot) avatar.state(boardState(snapshot)); }, [snapshot]);

  if (avatar.phase === 'idle') return <Lobby onPlay={(mic) => void avatar.start({ mic })} />;

  const theirSide = snapshot ? (snapshot.user_color === 'white' ? 'Black' : 'White') : null;
  const showClock = live && avatar.secondsLeft !== null && avatar.secondsLeft <= 180;

  return (
    <div className="kb-app">
      <header className="kb-top">
        <BackToApps avatar={avatar} name={HOST} /><Logo />
        <p className="kb-game-line">{gameLine(snapshot)}</p>
        <SoundToggle />
        <CallControls avatar={avatar} className="kb-call-controls" />
      </header>

      <main className="kb-main">
        <section className={`kb-host${avatar.audioBlocked ? ' is-blocked' : ''}`} aria-label={`${HOST}, your opponent`}>
          <HostVideo avatar={avatar} captions={cc.on} onToggleCaptions={cc.toggle} name={HOST} poster={portrait} className="kb-host-video">
            <CallStatus avatar={avatar} name={HOST} again={`Call ${HOST} again`} />
          </HostVideo>
          <div className="kb-nameplate">
            <p className="kb-nameplate-name"><b>{HOST}</b><span>Club player{theirSide ? ` · plays ${theirSide}` : ''}</span></p>
            {showClock && <p className="kb-clock" title="Time left on this call">{clock(avatar.secondsLeft!)} left</p>}
          </div>
        </section>

        <Game state={snapshot} send={send} thinking={thinking} host={HOST} locked={lockedCopy(avatar)} />

        <ChatPanel
          avatar={avatar} name={HOST} className="kb-chat" placeholder="Type a move, or say something to Sasha…" onSubmit={onTyped}
          empty={<>Say your move out loud or type it here: <q>e4</q>, <q>knight to f3</q>, <q>castle</q>. Ask for Black or an easier game any time.</>}
        />

        <Scoresheet state={snapshot} host={HOST} />
      </main>
    </div>
  );
}

function SoundToggle() {
  const [muted, setMuted] = useState(() => isSoundMuted());
  const toggle = () => {
    const next = !muted;
    setMuted(next);
    setSoundMuted(next);
    if (!next) sounds.buttonTap();
  };
  return (
    <button type="button" className="kb-icon-button" onClick={toggle} aria-pressed={!muted} title={muted ? 'Turn board sounds on' : 'Turn board sounds off'}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
        {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
      </svg>
      <span className="kb-sr">{muted ? 'Board sounds are off' : 'Board sounds are on'}</span>
    </button>
  );
}
