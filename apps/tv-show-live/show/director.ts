// The director: which shot is on air. The cameras are the page's own framings
// of two renders, Jada's and the guest's, never a face set into a photograph, so
// the renderer's own camera drift never shows a seam.
//
// In auto, before the guest is on, Jada is on camera 1 (a medium shot). On air
// it follows the speaker: Jada on camera 2 (a close-up), the guest on
// theirs, both together when they talk over each other. A shot holds at least
// HOLD_MS, so a quick "mm" does not cut away. For the goodbyes it is the
// two-shot. The producer can take over: Jada, the guest, or the two-shot.
import type { Role, Stage } from './booth.ts';

export type Shot = 'host-front' | 'host-side' | 'guest' | 'two';
export type ShotMode = 'auto' | 'host' | 'guest' | 'two';

export const HOLD_MS = 3_000;

export interface Director {
  readonly shot: Shot;
  stage(stage: Stage): void;
  speaking(role: Role, on: boolean): void;
  mode(mode: ShotMode): void;
  close(): void;
}

export function createDirector(opts: { onShot(shot: Shot): void; now?: () => number }): Director {
  const now = opts.now ?? Date.now;
  let stage: Stage = 'greeting';
  let mode: ShotMode = 'auto';
  let shot: Shot = 'host-front';
  let shotAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const talking: Record<Role, boolean> = { host: false, guest: false };

  const onAir = () => stage === 'on-air';
  const closing = () => stage === 'closing' || stage === 'over';

  // The shot the show should be on now, before the hold.
  const wanted = (): Shot => {
    if (mode === 'two') return 'two';
    if (mode === 'guest') return onAir() || closing() ? 'guest' : 'host-front';
    if (mode === 'host') return onAir() ? 'host-side' : 'host-front';
    if (closing()) return 'two';
    if (!onAir()) return 'host-front';
    if (talking.host && talking.guest) return 'two';
    if (talking.guest) return 'guest';
    if (talking.host) return 'host-side';
    return shot === 'host-front' ? 'host-side' : shot;   // nobody speaking: stay
  };

  const cut = (force = false) => {
    clearTimeout(timer);
    const next = wanted();
    if (next === shot) return;
    const wait = shotAt + HOLD_MS - now();
    // The producer's choice and a change of stage cut at once; a speaker change waits out the hold.
    if (!force && wait > 0) {
      timer = setTimeout(() => cut(), wait);
      return;
    }
    shot = next;
    shotAt = now();
    opts.onShot(shot);
  };

  return {
    get shot() { return shot; },
    stage(next) { stage = next; cut(true); },
    speaking(role, on) { talking[role] = on; cut(); },
    mode(next) { mode = next; cut(true); },
    close() { clearTimeout(timer); },
  };
}

/**
 * Which of Jada's renders is on (a render's pose is fixed, so she has one per
 * pose): turned to the TV while her guest is on, facing the lens when she
 * speaks to the viewers, from the opening to the trailer and the invitation,
 * and again from the wrap.
 */
export type Pose = 'front' | 'turned';
export const hostPose = (stage: Stage, wrapping: boolean): Pose => (stage === 'on-air' && !wrapping ? 'turned' : 'front');
