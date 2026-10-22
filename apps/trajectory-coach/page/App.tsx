// Trajectory Coach: the avatar coaches; the range (in this page) decides.
//
// Three ways in, one range:
// - the panel (drag, Fire, chips): applied at once; the avatar is told what it
//   cannot see (a new challenge) and, for every shot, the landing;
// - a typed line: judged first; an action is applied and recorded, anything
//   else goes to the avatar as a typed turn, with the state already current;
// - speech: the avatar heard it and is already answering; the app judges the
//   transcript, applies the action, and tells the avatar only what its reply
//   could not know (a refusal, the landing).
// The page owns the clock that lands each shot (engine/range.ts), so the
// result reaches the state, the panel and the avatar together, after the ball
// is down.
import { useEffect, useRef, useState } from 'react';
import { AvatarStage, Composer, Transcript, useAvatar } from '../../../src/kit/index.ts';
import { NOTES, lineFor, rangeState, refusalFor, say } from '../engine/director.ts';
import { commandIn, intentsFor, worthAsking, type JudgeContext } from '../engine/judge.ts';
import type { Command, Source } from '../engine/types.ts';
import { RangePanel } from './RangePanel.tsx';
import { useRange } from './useRange.ts';
import './range.css';

const API = '/api/apps/trajectory-coach';
// The original's appParams.startChallenge: ?challenge=moonshot opens on the Moon.
const START = new URLSearchParams(location.search).get('challenge');

/** The app's model, for a line the rules could not read. Null when there is none, it is unsure, or it is slow. */
async function interpret(text: string, ctx: JudgeContext): Promise<Command | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 6000);
  try {
    const res = await fetch(`${API}/interpret`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
      body: JSON.stringify({ text, aim: ctx.aim, challengeId: ctx.challengeId }),
    });
    if (!res.ok) return null;
    const { command } = (await res.json()) as { command: Command | null };
    return command && (command.kind === 'aim' || command.kind === 'challenge') ? command : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function App() {
  const [thinking, setThinking] = useState(0);
  const avatar = useAvatar('trajectory-coach', {
    onUserSaid: (text, how) => { if (how === 'spoken') void hear(text, 'spoken'); },
  });
  const live = avatar.phase === 'live';
  const liveRef = useRef(live);
  liveRef.current = live;
  // Inside "45 at 24 and fire" the aim needs no opinion: the landing speaks for the shot.
  const quietAim = useRef(false);

  const { range, state, seq, message, dispatch } = useRange(START, {
    // One line per change, and none for what the student's own words caused
    // (director.ts). Nothing is said to a session that is not on: a shot that
    // lands after the end must not greet the next session.
    onChange: (change) => {
      if (quietAim.current && change.intent.kind === 'set_aim') return;
      const line = lineFor(change);
      if (line && liveRef.current) avatar.event(line.text, line.ttl);
    },
    onRefused: (intent, reason, by) => {
      const line = refusalFor(intent, reason, by);
      if (line && liveRef.current) avatar.event(line.text, line.ttl);
    },
  });

  /** Apply a command's intents in order; a refused step stops the rest ("forty and fire" at ninety fires nothing). */
  function run(command: Command, by: Source) {
    const intents = intentsFor(command);
    quietAim.current = intents.length > 1;
    try {
      for (const intent of intents) if (!dispatch(intent, by).applied) return;
    } finally {
      quietAim.current = false;
    }
  }

  /** A line of words: rules first, then the app's model for what sounds like an aim. Resolves to whether it was an action. */
  async function hear(text: string, by: 'spoken' | 'typed'): Promise<boolean> {
    const s = range.snapshot();
    const ctx: JudgeContext = { aim: s.aim, limits: s.limits, challengeId: s.challenge.id };
    let command = commandIn(text, ctx);
    if (!command && worthAsking(text)) {
      setThinking((n) => n + 1);
      try { command = await interpret(text, ctx); } finally { setThinking((n) => n - 1); }
    }
    if (!command) return false;
    run(command, by);
    return true;
  }

  // The rules and the opening, said while the avatar is on its way (the kit
  // delivers them on arrival). The opening names the challenge actually up.
  useEffect(() => {
    if (avatar.phase !== 'starting') return;
    for (const note of NOTES) avatar.note(note);
    avatar.event(say.start(range.snapshot()), 60);
  }, [avatar.phase]);

  // The avatar's picture of the range follows the range.
  useEffect(() => { avatar.state(rangeState(state)); }, [state]);

  // A typed line is judged first; only what isn't an action goes to the avatar.
  const onTyped = (text: string) => {
    void hear(text, 'typed').then((acted) => (acted ? avatar.record(text) : avatar.say(text)));
  };

  return (
    <div className="kit-layout tc-app">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar} name="Your coach" startLabel="Step up to the launcher"
          lobby={<><div className="kit-title">Trajectory Coach</div><div className="kit-detail">A practice range drawn to scale. Drag the arrow or say an angle, fire, and your coach explains in real numbers why it fell short.</div></>}
        />
        <Composer avatar={avatar} placeholder='Try "forty degrees", "fire", or ask why it missed…' onSubmit={(t) => { onTyped(t); }} />
        <Transcript avatar={avatar} names={{ avatar: 'Coach' }} />
      </div>
      <RangePanel state={state} seq={seq} live={live} message={message} thinking={thinking > 0} onIntent={(intent) => { dispatch(intent, 'panel'); }} />
    </div>
  );
}
