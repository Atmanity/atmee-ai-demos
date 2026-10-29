// The radio clock, pure: from the player's position, when the host's break
// starts (the record's last seconds) and when the record has ended; and how
// loud the music plays under the host's voice.

export interface Playback { isPaused: boolean; isBuffering: boolean; position: number; duration: number }

/**
 * How long before a record ends the host's break starts: about an eighth of the record, 8 to 20
 * seconds, so most of the talk is over the record's ducked outro rather than over silence after it.
 */
export const breakLead = (durationMs: number) => Math.min(20_000, Math.max(8_000, durationMs * 0.12));
/** The music under the host's voice, as a share of the listener's music volume. */
export const DUCK = 0.3;
/** How long the host must have been quiet before the next record starts after a break. */
export const QUIET_MS = 1200;
/** How long a held record waits for the host to start talking before it plays anyway: the show's opening gets longer. */
export const INTRO_WAIT_MS = { break: 5_000, change: 5_000, opener: 15_000 } as const;
/**
 * The longest a held record waits, from the moment it is held, before it starts under the host
 * (ducked): after a record ends, a change of record, and the show's opening (which waits for the
 * whole opening, as the listener hears no music yet).
 */
export const HOLD_MAX_MS = { break: 4_000, change: 5_000, opener: 25_000 } as const;
export type Hold = keyof typeof HOLD_MAX_MS;

export interface Clock {
  /** The record the clock follows. */
  id: string | null;
  breakCalled: boolean;
  ended: boolean;
  /** Milliseconds left at the last update while it played. */
  lastLeft: number;
}

export const freshClock = (id: string | null = null): Clock => ({ id, breakCalled: false, ended: false, lastLeft: Infinity });

export type Cue = 'break' | 'ended' | null;

/** One player update for the record `id`: the clock after it, and the cue it raises (at most one). */
export function tick(clock: Clock, id: string, p: Playback): { clock: Clock; cue: Cue } {
  const c = clock.id === id ? { ...clock } : freshClock(id);
  if (c.ended || p.duration <= 0) return { clock: c, cue: null };
  const left = p.duration - p.position;
  // The end: the last half second, or a player that stopped back at 0 just after its last seconds.
  if (left <= 600 || (p.isPaused && p.position === 0 && c.lastLeft <= 3000)) {
    c.ended = true;
    return { clock: c, cue: 'ended' };
  }
  if (!p.isPaused && p.position > 0) c.lastLeft = left;
  if (!p.isPaused && !c.breakCalled && left <= breakLead(p.duration)) {
    c.breakCalled = true;
    return { clock: c, cue: 'break' };
  }
  return { clock: c, cue: null };
}

/** The music's volume: the listener's level, ducked while the host talks or holds a break. */
export const musicLevel = (volume: number, ducked: boolean) => Math.max(0, Math.min(1, volume * (ducked ? DUCK : 1)));

/** How soon after the listener's words the host's answer must start to be heard over a record. */
export const ANSWER_WINDOW_MS = 20_000;
/** How soon after an answer ends a follow-up (its reply to a tool's result) may start and still be heard. */
export const FOLLOW_UP_MS = 6_000;

/** How far into a record the host may still talk over it, as a DJ talks up to the vocal. */
export const INTRO_TALK_MS = 20_000;

/**
 * Whether the listener hears what the host starts saying now. Between records and in its
 * break, always; over a playing record, in its first INTRO_TALK_MS, or as its answer to the
 * listener: starting within ANSWER_WINDOW_MS of their words, or within FOLLOW_UP_MS of that
 * answer ending. Anything else (Causeur's check-ins after a silence, which a session cannot
 * turn off) would cut into the music unasked, so the page plays it silent.
 */
export function heard({ musicOn, onBreak, positionMs, sinceListenerMs, sinceAnswerMs }: {
  musicOn: boolean; onBreak: boolean; positionMs: number; sinceListenerMs: number; sinceAnswerMs: number;
}): boolean {
  return !musicOn || onBreak || positionMs < INTRO_TALK_MS || sinceListenerMs <= ANSWER_WINDOW_MS || sinceAnswerMs <= FOLLOW_UP_MS;
}

/** Whether an utterance starting now answers the listener (for the follow-up allowance). */
export const answering = (sinceListenerMs: number, sinceAnswerMs: number) => sinceListenerMs <= ANSWER_WINDOW_MS || sinceAnswerMs <= FOLLOW_UP_MS;
