// The launcher: the stateful rules object (ported from launcher.py).
//
// `Launcher` is the whole app played out in memory, so every refusal below is
// unit-testable without a page. It validates BEFORE it mutates, which is what
// makes a refused request leave the range exactly as it was.
//
// Two decisions worth knowing about:
//
// The shot is resolved the moment it is fired. `fire()` calls the physics and
// grades the result immediately. Nothing about the outcome is decided later, by
// a timer, or by whoever happens to report the landing: there is one answer and
// it exists before the ball is a quarter of the way there.
//
// The outcome is withheld from the snapshot until it lands. The flight is in
// the snapshot while the phase is "flying" (the page needs the curve and the
// duration to animate against) but `cleared`, `miss_m`, `range_m`, `apex_m`
// and the coaching note are not. So `land()` is a phase transition and only a
// phase transition: it commits an outcome that was already computed, and it
// cannot change what that outcome is. The avatar's state is built from this
// same snapshot, so it cannot announce a result early either.
import { ANGLE_LIMITS, BY_ID, CHALLENGES, SPEED_MIN, find, grade, limitsOf, names, publicChallenge, type Challenge } from './challenges.ts';
import { TRAIL_POINTS, pyG, pyRound, solve, thin } from './flight.ts';
import type { Attempt, Phase, RangeSnapshot, Shot } from './types.ts';

/** Past attempts kept for the ghost trails: a cap, not a scroll-back. */
export const MAX_HISTORY = 8;

/**
 * How long the page takes to draw a flight, whatever the flight time was.
 * Lunar gravity gives a shot fifty seconds of hang time and nobody watches
 * that; a fast flat shot is over in three-tenths and nobody sees it.
 */
export const MIN_PLAY_S = 0.8;
export const MAX_PLAY_S = 2.5;

/**
 * The animation's duration: a presentation number, but a SHARED one. The
 * page's animation draws for this long and the range's lander commits the
 * landing just after it, so it lives in the snapshot, not in either of them.
 */
export const playSeconds = (flightS: number) => pyRound(Math.min(Math.max(Number(flightS), MIN_PLAY_S), MAX_PLAY_S), 2);

/** What the page needs to animate a shot, and nothing that says how it went. */
export const FLIGHT_KEYS = ['angle_deg', 'speed_ms', 'gravity', 'wind_ms', 'flight_s', 'play_s', 'path'] as const;
/** The verdict, added once the shot is down. */
export const OUTCOME_KEYS = ['range_m', 'apex_m', 'cleared', 'miss_m', 'note'] as const;

/** A refusal, phrased as something the student can be told out loud. */
export class LauncherRefusal extends Error {}

type FullShot = Required<Shot>;

export class Launcher {
  private clearedIds = new Set<string>();
  private current!: Challenge;
  private angle = 45;
  private speed = 20;
  private phaseNow: Phase = 'aiming';
  private pending: FullShot | null = null;
  private lastShot: FullShot | null = null;
  private attemptCount = 0;
  private bestMiss: number | null = null;
  private history: Attempt[] = [];

  constructor(challengeId?: string | null) {
    this.arm(BY_ID.get(String(challengeId ?? '')) ?? CHALLENGES[0]);
  }

  /** Put a challenge on the range, with a clean scoreboard. */
  private arm(c: Challenge) {
    this.current = c;
    [this.angle, this.speed] = c.start_aim;
    this.phaseNow = 'aiming';
    this.pending = null;
    this.lastShot = null;
    this.attemptCount = 0;
    this.bestMiss = null;
    this.history = [];
  }

  get phase(): Phase { return this.phaseNow; }
  get challenge(): Challenge { return this.current; }

  /**
   * Point the launcher. Either argument may be null to leave it alone.
   *
   * Null is not a nicety: "try forty degrees" is an angle and no speed, and a
   * parser made to supply a speed as well would supply one it half-remembered;
   * the learner would find the shot they did not ask for.
   */
  setAim(angleDeg: unknown, speedMs: unknown): void {
    if (this.phaseNow === 'flying') throw new LauncherRefusal("The shot's still in the air — wait for it to land.");
    const angle = angleDeg === null || angleDeg === undefined ? this.angle : number(angleDeg, 'an angle in degrees');
    const speed = speedMs === null || speedMs === undefined ? this.speed : number(speedMs, 'a speed in metres a second');
    const [lo, hi] = ANGLE_LIMITS;
    if (!(lo <= angle && angle <= hi)) {
      throw new LauncherRefusal(`The launcher only elevates between ${pyG(lo)} and ${pyG(hi)} degrees — ${pyG(angle)} is off the rail.`);
    }
    const cap = this.current.speed_max;
    if (!(SPEED_MIN <= speed && speed <= cap)) {
      throw new LauncherRefusal(`That's past what this launcher does — ${pyG(SPEED_MIN)} to ${pyG(cap)} metres a second.`);
    }
    this.angle = pyRound(angle, 1);
    this.speed = pyRound(speed, 1);
    // Re-arming from `scored` is deliberate: adjusting the aim after a shot is
    // the whole loop of the app, and refusing it would mean a student who drags
    // the arrow gets told off for playing the game.
    this.phaseNow = 'aiming';
  }

  /** Take the shot. Resolves it completely and returns it. */
  fire(): FullShot {
    if (this.phaseNow === 'flying') throw new LauncherRefusal("It's already in the air.");
    const flight = solve(this.angle, this.speed, this.current.gravity, this.current.wind_ms);
    const verdict = grade(this.current, flight);
    this.pending = { ...flight, ...verdict, play_s: playSeconds(flight.flight_s) };
    this.attemptCount += 1;
    this.phaseNow = 'flying';
    return { ...this.pending };
  }

  /**
   * Commit the shot that is in the air. Decides nothing.
   *
   * The outcome was fixed at `fire()`; this makes it visible, files the
   * attempt, and moves the phase on. Only the range's own lander calls it
   * (range.ts), off the play time it put in the snapshot.
   */
  land(): FullShot {
    if (this.phaseNow !== 'flying' || this.pending === null) throw new LauncherRefusal('Nothing is in the air.');
    const shot = this.pending;
    this.pending = null;
    this.lastShot = shot;
    const miss = Number(shot.miss_m || 0);
    this.bestMiss = this.bestMiss === null ? miss : Math.min(this.bestMiss, miss);
    this.history.push({ angle_deg: shot.angle_deg, speed_ms: shot.speed_ms, range_m: shot.range_m, cleared: Boolean(shot.cleared), path: thin(shot.path, TRAIL_POINTS) });
    this.history.splice(0, Math.max(0, this.history.length - MAX_HISTORY));
    if (shot.cleared) {
      this.clearedIds.add(this.current.id);
      this.phaseNow = 'debrief';
    } else {
      this.phaseNow = 'scored';
    }
    return { ...shot };
  }

  startChallenge(challengeId: unknown): void {
    const c = find(challengeId);
    if (!c) throw new LauncherRefusal(`I don't have that one — I've got: ${names()}.`);
    this.arm(c);
  }

  /** The next one along, wrapping. Never refused: "that was the last challenge" is a dead end at exactly the moment somebody is enjoying it. */
  nextChallenge(): void {
    const index = (CHALLENGES.findIndex((c) => c.id === this.current.id) + 1) % CHALLENGES.length;
    this.arm(CHALLENGES[index]);
  }

  /** Same challenge, clean scoreboard. */
  reset(): void {
    this.arm(this.current);
  }

  /**
   * The public projection: everything the page draws and the avatar is told.
   *
   * `teach` appears only once the challenge is cleared. It is not a secret (it
   * ships in this file) but printing "forty-five is not the answer here" beside
   * the aiming arrow turns a physics exercise into a reading exercise.
   */
  snapshot(): RangeSnapshot {
    const flying = this.phaseNow === 'flying';
    const shot = flying ? this.pending : this.lastShot;
    return {
      phase: this.phaseNow,
      challenge: publicChallenge(this.current, this.clearedIds.has(this.current.id)),
      aim: { angle_deg: this.angle, speed_ms: this.speed },
      limits: limitsOf(this.current),
      last_shot: shotView(shot, !flying),
      attempts: this.attemptCount,
      best_miss_m: this.bestMiss,
      history: this.history.map((h) => ({ ...h, path: h.path.map((p) => [p[0], p[1]] as [number, number]) })),
      catalog: CHALLENGES.map((c) => ({ id: c.id, name: c.name, cleared: this.clearedIds.has(c.id) })),
    };
  }
}

function shotView(shot: FullShot | null, outcome: boolean): Shot | null {
  if (!shot) return null;
  const keys: readonly (keyof FullShot)[] = outcome ? [...FLIGHT_KEYS, ...OUTCOME_KEYS] : FLIGHT_KEYS;
  const out: Record<string, unknown> = {};
  for (const key of keys) if (key in shot) out[key] = key === 'path' ? shot.path.map((p) => [p[0], p[1]]) : shot[key];
  return out as unknown as Shot;
}

function number(value: unknown, what: string): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new LauncherRefusal(`I need ${what} — I couldn't read that one.`);
  return n;
}
