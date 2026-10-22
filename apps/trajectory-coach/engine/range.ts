// The range: the one writer over the launcher, and the clock that lands shots.
//
// This replaces the original's StateStore + reducer + lander (table.py). Every
// way of changing the range (a drag, the Fire button, a typed or spoken line,
// the landing) arrives here as an intent with its source; `Launcher` validates
// before it mutates, so a refusal leaves the range exactly as it was and
// carries a sentence somebody can say out loud.
//
// The landing is the range's own. A shot is resolved when it is fired but
// becomes VISIBLE when it lands, and somebody has to say when that is: the
// range does, off the `play_s` it put in the snapshot, plus a little slack so
// the verdict never appears before the ball is down. The page's animation reads
// the same `play_s` and only decides when each frame is drawn; it cannot land
// a shot (`land` from anyone but the range is refused), so a remounted canvas
// cannot leave the range in "flying" forever.
//
// It runs in the page: nothing here is secret (the landing point is the last
// point of the curve the page animates, and the teaching points ship in
// challenges.ts), and the page is the one process, so there is no second clock
// to agree with.
import { Launcher, LauncherRefusal } from './launcher.ts';
import type { Change, Intent, RangeSnapshot, Result, Source } from './types.ts';

/** Slack on the landing timer: the verdict must not be on screen before the ball is down. */
export const LANDING_SLACK_S = 0.15;

type Timer = unknown;
export interface Clock {
  schedule(fn: () => void, ms: number): Timer;
  cancel(timer: Timer): void;
}
// Looked up at call time, so tests can swap the global timers.
const realClock: Clock = {
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export class Range {
  seq = 0;
  private listeners = new Set<(change: Change) => void>();
  private landing: Timer | null = null;

  constructor(readonly launcher: Launcher = new Launcher(), private clock: Clock = realClock) {}

  snapshot(): RangeSnapshot { return this.launcher.snapshot(); }

  /** Every applied change, in order. Returns the unsubscribe. */
  subscribe(listener: (change: Change) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  apply(intent: Intent, by: Source): Result {
    const previous = this.snapshot();
    try {
      switch (intent.kind) {
        case 'set_aim': this.launcher.setAim(intent.angle_deg ?? null, intent.speed_ms ?? null); break;
        case 'fire': this.launcher.fire(); break;
        case 'land':
          // The moment the verdict becomes visible: a source that could send it
          // could sit on a shot it did not like.
          if (by !== 'range') throw new LauncherRefusal('Only the range calls a shot down.');
          this.launcher.land();
          break;
        case 'start_challenge': this.launcher.startChallenge(intent.id); break;
        case 'next_challenge': this.launcher.nextChallenge(); break;
        case 'reset': this.launcher.reset(); break;
        default: throw new LauncherRefusal(`'${(intent as { kind?: unknown }).kind}' isn't something this range can do.`);
      }
    } catch (err) {
      if (err instanceof LauncherRefusal) return { applied: false, reason: err.message };
      throw err;
    }
    this.seq += 1;
    const snapshot = this.snapshot();
    if (intent.kind === 'fire') this.scheduleLanding(snapshot.last_shot?.play_s ?? 0);
    // A new or reset challenge mid-flight leaves nothing to land. Cancelling
    // (rather than letting the old timer be refused) matters: the original's
    // timer would otherwise bring down the NEXT shot early.
    else if (snapshot.phase !== 'flying') this.cancelLanding();
    const change: Change = { seq: this.seq, intent, by, snapshot, previous };
    for (const listener of [...this.listeners]) listener(change);
    return { applied: true, seq: this.seq, snapshot };
  }

  /** Whether a landing is scheduled (a shot is in the air). */
  get landingPending(): boolean { return this.landing !== null; }

  dispose(): void {
    this.cancelLanding();
    this.listeners.clear();
  }

  private scheduleLanding(playS: number) {
    this.cancelLanding();
    this.landing = this.clock.schedule(() => {
      this.landing = null;
      this.apply({ kind: 'land' }, 'range');
    }, (playS + LANDING_SLACK_S) * 1000);
  }

  private cancelLanding() {
    if (this.landing === null) return;
    this.clock.cancel(this.landing);
    this.landing = null;
  }
}
