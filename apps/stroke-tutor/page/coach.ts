// The coaching line's way to the avatar: one cue at a time, the newest only.
//
// A learner can draw three strokes in the time the teacher takes to say one
// sentence. Events wait for the floor and cannot be withdrawn once sent, so
// sending each verdict as it lands makes the teacher coach strokes that are
// long gone, one after another. The original coach spoke once per STATE, not
// once per change, for the same reason. Here a cue is held while the avatar
// is speaking (or not yet in the room) and replaced by any newer one; it goes
// once the avatar has been quiet for a moment. The board's `state` is always
// current, so nothing a dropped cue said is lost to the avatar.
import type { Outcome } from '../engine/types.ts';
import { TTL } from '../engine/director.ts';

export interface Cue { text: string; ttlS: number }

/** Quiet this long after speaking = the avatar's turn is over (gaps inside a reply are under a second). */
export const QUIET_MS = 1200;

export interface Coach {
  /** A new cue; it replaces any cue still waiting. */
  push(cue: Cue): void;
  live(on: boolean): void;
  speaking(on: boolean): void;
  /** Drop what is waiting (a new lesson, the page going away). */
  clear(): void;
  /** The cue waiting to go, if any (for tests and debugging). */
  waiting(): Cue | null;
}

export function createCoach(send: (text: string, ttlS: number) => void, quietMs = QUIET_MS, now = () => Date.now()): Coach {
  let isLive = false;
  let isSpeaking = false;
  let quiet = true;
  let held: { cue: Cue; since: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (!held || !isLive || isSpeaking || !quiet) return;
    const { cue, since } = held;
    held = null;
    // A cue that waited out its own ttl while the avatar talked is stale.
    if (now() - since > cue.ttlS * 1000) return;
    send(cue.text, cue.ttlS);
  };

  return {
    push(cue) {
      held = { cue, since: now() };
      flush();
    },
    live(on) {
      if (on === isLive) return;
      isLive = on;
      // The clock starts when the avatar can hear: a cue held through a slow arrival is not stale.
      if (on && held) held.since = now();
      flush();
    },
    speaking(on) {
      if (on === isSpeaking) return;
      isSpeaking = on;
      clearTimeout(timer);
      if (on) {
        quiet = false;
        return;
      }
      timer = setTimeout(() => { quiet = true; flush(); }, quietMs);
    },
    clear() {
      held = null;
      clearTimeout(timer);
      quiet = !isSpeaking;
    },
    waiting: () => held?.cue ?? null,
  };
}

/**
 * Which outcome the avatar hears about. A refusal of something pressed or drawn
 * on the board is shown there and not spoken (the original panel did the
 * same); one the learner asked for in words is said, because the avatar has
 * already answered them and must not leave it at "let's see".
 */
export function cueFor(outcome: Outcome, from: 'panel' | 'typed' | 'spoken'): Cue | null {
  if (!outcome.event) return null;
  if (outcome.refused && from === 'panel') return null;
  return { text: outcome.event, ttlS: TTL.cue };
}
