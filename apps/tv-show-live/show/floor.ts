// Who has the floor. The speech model is made for calls: while the other one
// talks, a listener says "mm-hmm", "yeah" and "ok" (its backchannel, which a
// public session cannot turn off), and on air those were heard over every
// answer. The one who starts speaking first holds the floor until their voice's
// stretch ends; what the other says meanwhile is kept off the air. If the other
// is still speaking when the floor comes free, it passes to them from then on.
import type { Role } from './booth.ts';

export interface Floor {
  /** A role's voice starts or ends a stretch of speech. */
  speaking(role: Role, on: boolean): void;
  /** Whether what this role says now goes on air. */
  onAir(role: Role): boolean;
  /** Whether any of this role's current (or just-ended) stretch went on air. */
  wentOnAir(role: Role): boolean;
}

export function createFloor(): Floor {
  let holder: Role | null = null;
  const talking: Record<Role, boolean> = { host: false, guest: false };
  // Whether each role's stretch has been on air at all.
  const aired: Record<Role, boolean> = { host: false, guest: false };
  const other = (r: Role): Role => (r === 'host' ? 'guest' : 'host');

  return {
    speaking(role, on) {
      talking[role] = on;
      if (on) {
        if (holder === null) holder = role;
        aired[role] = holder === role;
        return;
      }
      if (holder !== role) return;
      holder = talking[other(role)] ? other(role) : null;
      if (holder) aired[holder] = true;
    },
    onAir(role) { return holder === null || holder === role; },
    wentOnAir(role) { return aired[role]; },
  };
}
