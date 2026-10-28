// Who has the floor. The speech model is made for calls: while the other one
// talks, a listener says "mm-hmm", "yeah" and "ok" (its backchannel, which a
// public session cannot turn off). The one who starts speaking first holds the
// floor until their voice's stretch ends. If the other is still speaking when
// the floor comes free, it passes to them from then on.
//
// What the listener says meanwhile never reaches the speaker's session (that
// would cut them off), and only a short reaction reaches the air: the first
// REACTION_MS of it, at most one every REACTION_GAP_MS per avatar. All of it
// on air sounded like talking over each other; none of it left the listener
// a statue.
import type { Role } from './booth.ts';

export const REACTION_MS = 1_200;
export const REACTION_GAP_MS = 8_000;

export interface Floor {
  /** A role's voice starts or ends a stretch of speech. */
  speaking(role: Role, on: boolean): void;
  /** Whether this role holds (or may take) the floor: what it says goes on air in full. */
  onAir(role: Role): boolean;
  /** Whether what this role says right now is heard: on air, or a short reaction. */
  audible(role: Role): boolean;
  /** Whether any of this role's current (or just-ended) stretch went on air. */
  wentOnAir(role: Role): boolean;
}

export function createFloor(opts: { now?: () => number } = {}): Floor {
  const now = opts.now ?? Date.now;
  let holder: Role | null = null;
  const talking: Record<Role, boolean> = { host: false, guest: false };
  // Whether each role's stretch has been on air at all.
  const aired: Record<Role, boolean> = { host: false, guest: false };
  // The current reaction, if this stretch is one that may be heard, and when the last began.
  const reactionAt: Record<Role, number | null> = { host: null, guest: null };
  const lastReaction: Record<Role, number> = { host: -Infinity, guest: -Infinity };
  const other = (r: Role): Role => (r === 'host' ? 'guest' : 'host');
  const onAir = (role: Role) => holder === null || holder === role;

  return {
    speaking(role, on) {
      talking[role] = on;
      if (on) {
        if (holder === null) holder = role;
        aired[role] = holder === role;
        reactionAt[role] = null;
        if (!aired[role] && now() - lastReaction[role] >= REACTION_GAP_MS) {
          reactionAt[role] = now();
          lastReaction[role] = now();
        }
        return;
      }
      reactionAt[role] = null;
      if (holder !== role) return;
      holder = talking[other(role)] ? other(role) : null;
      if (holder) aired[holder] = true;
    },
    onAir,
    audible(role) {
      if (onAir(role)) return true;
      const at = reactionAt[role];
      return at !== null && now() - at < REACTION_MS;
    },
    wentOnAir(role) { return aired[role]; },
  };
}
