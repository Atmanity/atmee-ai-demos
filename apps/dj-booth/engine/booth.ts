// The radio clock, pure: from the player's position, when the host's break
// starts (the record's last seconds) and when the record has ended; and how
// loud the music plays under the host's voice.

export interface Playback { isPaused: boolean; isBuffering: boolean; position: number; duration: number }

/** How long before a record ends the host's break starts: back-announce, then the next intro. */
export const BREAK_MS = 10_000;
/** The music under the host's voice, as a share of the listener's music volume. */
export const DUCK = 0.3;
/** How long the host must have been quiet before the next record starts after a break. */
export const QUIET_MS = 1200;
/** How long a changed record waits for the host to start its intro before it plays anyway. */
export const INTRO_WAIT_MS = 10_000;
/** The longest the next record waits for the host to finish. */
export const HOLD_MAX_MS = 25_000;

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
  if (!p.isPaused && !c.breakCalled && left <= BREAK_MS) {
    c.breakCalled = true;
    return { clock: c, cue: 'break' };
  }
  return { clock: c, cue: null };
}

/** The music's volume: the listener's level, ducked while the host talks or holds a break. */
export const musicLevel = (volume: number, ducked: boolean) => Math.max(0, Math.min(1, volume * (ducked ? DUCK : 1)));

/** How long after the listener spoke, typed or pressed something the host may answer over a record. */
export const ANSWER_WINDOW_MS = 40_000;

/** How far into a record the host may still talk over it, as a DJ talks up to the vocal. */
export const INTRO_TALK_MS = 20_000;

/**
 * Whether the listener hears what the host starts saying now. Between records and in its
 * break, always; over a playing record, in its first INTRO_TALK_MS, or as an answer to the
 * listener however far in. Anything else (Causeur's check-ins after a silence, which a session
 * cannot turn off) would cut into the music unasked, so the page plays it silent.
 */
export function heard({ musicOn, onBreak, sinceListenerMs, positionMs }: { musicOn: boolean; onBreak: boolean; sinceListenerMs: number; positionMs: number }): boolean {
  return !musicOn || onBreak || positionMs < INTRO_TALK_MS || sinceListenerMs <= ANSWER_WINDOW_MS;
}
