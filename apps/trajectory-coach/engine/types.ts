// What the engine, the page and the server share.
//
// The snapshot is the original's `Launcher.snapshot()` projection, field for
// field. Note what `Shot` says about the verdict: the outcome fields are
// optional not because they are sometimes uninteresting but because, while the
// ball is in the air, the projection does not contain them at all.

export type Phase = 'aiming' | 'flying' | 'scored' | 'debrief';

/** `[x_m, y_m]`, metres, ground at y = 0. */
export type Point = [number, number];

export interface Target {
  kind: 'wall' | 'zone' | 'distance';
  x_m?: number;
  h_m?: number;
  w_m?: number;
  min_m?: number;
}

/** A challenge as the snapshot shows it. */
export interface PublicChallenge {
  id: string;
  name: string;
  blurb: string;
  target: Target;
  wind_ms: number;
  gravity: number;
  ceiling_m: number | null;
  /** The punchline. Absent until the challenge has been cleared. */
  teach?: string;
}

export interface Aim { angle_deg: number; speed_ms: number }

export interface Limits { angle: [number, number]; speed: [number, number] }

export interface Shot {
  angle_deg: number;
  speed_ms: number;
  gravity: number;
  wind_ms: number;
  /** Real hang time, in seconds. What the coach says. */
  flight_s: number;
  /** How long the page takes to draw it. The animation and the lander both use it. */
  play_s: number;
  path: Point[];
  /** From here down: present only once the shot is on the ground. */
  range_m?: number;
  apex_m?: number;
  cleared?: boolean;
  miss_m?: number;
  note?: string;
}

export interface Attempt { angle_deg: number; speed_ms: number; range_m: number; cleared: boolean; path: Point[] }

export interface CatalogEntry { id: string; name: string; cleared: boolean }

export interface RangeSnapshot {
  phase: Phase;
  challenge: PublicChallenge;
  aim: Aim;
  limits: Limits;
  last_shot: Shot | null;
  attempts: number;
  best_miss_m: number | null;
  history: Attempt[];
  catalog: CatalogEntry[];
}

/** What can be done to the range. `land` is the range's own, off its timer. */
export type Intent =
  | { kind: 'set_aim'; angle_deg?: number | null; speed_ms?: number | null }
  | { kind: 'fire' }
  | { kind: 'land' }
  | { kind: 'start_challenge'; id: string }
  | { kind: 'next_challenge' }
  | { kind: 'reset' };

/**
 * Who asked: the student's hands on the screen (the arrow, the steppers, Fire,
 * the challenge list), the host through one of its tools, or the range itself
 * (only the landing). It decides who tells the host what happened: a tool's
 * result does for the host's own calls; the screen's are told as events.
 */
export type Source = 'panel' | 'host' | 'range';

export type Result =
  | { applied: true; seq: number; snapshot: RangeSnapshot }
  | { applied: false; reason: string };

/** One applied intent, as the range's listeners see it. */
export interface Change {
  seq: number;
  intent: Intent;
  by: Source;
  snapshot: RangeSnapshot;
  previous: RangeSnapshot;
}

/** What a line of words asks the range to do (judge.ts): the aim tool's words, and the safety net's phrases. */
export type Command =
  | { kind: 'fire' }
  | { kind: 'aim'; angle_deg?: number; speed_ms?: number; thenFire?: boolean }
  | { kind: 'challenge'; id: string }
  | { kind: 'next' }
  | { kind: 'reset' };
