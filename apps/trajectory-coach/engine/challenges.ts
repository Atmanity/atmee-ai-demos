// The six challenges, and what counts as clearing one (ported from
// challenges.py).
//
// Also pure. `flight.ts` says where the ball went; this says whether that was
// the shot the challenge asked for, and produces the one sentence of coaching
// that carries the numbers. Both halves are here rather than in the avatar
// because a physics coach that occasionally gets the arithmetic wrong is worse
// than no coach: the learner cannot tell which sentences to trust.
//
// Each challenge exists to make one point that is hard to believe until you
// have seen it:
//
// - wall40: 45° maximises *range*, and range is not what a wall asks for.
// - zone30: two angles land in the same place. Complementary angles, and the
//   low one gets there in half the time.
// - maxrange: with the speed capped and the ground level, 45° really is the
//   answer. This is the case the rule was made for, and the only one here.
// - headwind: wind takes horizontal speed and leaves hang time alone, so the
//   fix is a flatter, faster shot, not a lofted one.
// - ceiling: apex depends only on the vertical component, so a roof is a cap
//   on sin θ, and distance has to come from speed instead.
// - moonshot: range scales as 1/g. The same shot goes six times further on the
//   Moon, which people nod at and still get wrong by a factor of six.
//
// `teach` is the punchline and is deliberately NOT in the snapshot until the
// challenge is cleared: printing "45° is not the answer here" beside the aiming
// arrow turns the exercise into reading.
import { heightAt, pyG, pyRound, pyStr, type Flight } from './flight.ts';
import type { Limits, PublicChallenge, Target } from './types.ts';

/** The launcher's mechanical limits. Speed has a per-challenge ceiling on top; the angle range is the machine. */
export const ANGLE_LIMITS: [number, number] = [5, 85];
export const SPEED_MIN = 5;
export const SPEED_MAX = 40;

export interface Challenge {
  id: string;
  name: string;
  blurb: string;
  target: Target;
  teach: string;
  wind_ms: number;
  gravity: number;
  speed_max: number;
  ceiling_m: number | null;
  start_aim: [number, number];
}

const challenge = (c: Partial<Challenge> & Pick<Challenge, 'id' | 'name' | 'blurb' | 'target' | 'teach'>): Challenge => ({
  wind_ms: 0, gravity: 9.81, speed_max: SPEED_MAX, ceiling_m: null, start_aim: [45, 20], ...c,
});

export const limitsOf = (c: Challenge): Limits => ({ angle: [ANGLE_LIMITS[0], ANGLE_LIMITS[1]], speed: [SPEED_MIN, c.speed_max] });

export function publicChallenge(c: Challenge, withTeach: boolean): PublicChallenge {
  const out: PublicChallenge = { id: c.id, name: c.name, blurb: c.blurb, target: { ...c.target }, wind_ms: c.wind_ms, gravity: c.gravity, ceiling_m: c.ceiling_m };
  if (withTeach) out.teach = c.teach;
  return out;
}

export const CHALLENGES: readonly Challenge[] = [
  challenge({
    id: 'wall40',
    name: 'Clear the wall',
    blurb: 'A three-metre wall, forty metres out. Get over it.',
    target: { kind: 'wall', x_m: 40, h_m: 3 },
    teach: 'Forty-five degrees maximises range, and range is not what a wall asks for. What matters is your height as you pass forty metres, so you either steepen the shot or put more speed behind it.',
    start_aim: [45, 20],
  }),
  challenge({
    id: 'zone30',
    name: 'Land in the zone',
    blurb: 'A four-metre landing zone centred thirty metres out.',
    target: { kind: 'zone', x_m: 30, w_m: 4 },
    teach: 'Two angles land in the same place: anything and its complement — twenty-five and sixty-five, thirty and sixty. The low one gets there in half the time, which is why nobody lobs a throw to first base.',
    start_aim: [45, 18],
  }),
  challenge({
    id: 'maxrange',
    name: 'Furthest on a capped launcher',
    blurb: 'Speed capped at eighteen. Land past thirty-two metres.',
    target: { kind: 'distance', min_m: 32 },
    teach: 'This is the one case where forty-five degrees really is the answer: level ground, no wind, speed fixed. Range is v squared over g times sine of twice the angle, and sine peaks at ninety — so twice forty-five.',
    speed_max: 18,
    start_aim: [30, 18],
  }),
  challenge({
    id: 'headwind',
    name: 'Into the headwind',
    blurb: 'A two-metre wall thirty-five metres out, into a six-metre headwind.',
    target: { kind: 'wall', x_m: 35, h_m: 2 },
    teach: 'The wind takes horizontal speed and leaves your hang time exactly as it was. Lofting the shot buys you seconds the wind then spends for you — flatten it and add speed instead.',
    wind_ms: -6,
    start_aim: [45, 22],
  }),
  challenge({
    id: 'ceiling',
    name: 'Under the roof',
    blurb: 'Land past twenty-five metres without going above six.',
    target: { kind: 'distance', min_m: 25 },
    teach: 'Apex depends only on the vertical component, so a roof is a cap on sine theta and nothing else. Once the angle is pinned, the only place distance can come from is speed.',
    ceiling_m: 6,
    start_aim: [30, 20],
  }),
  challenge({
    id: 'moonshot',
    name: 'On the Moon',
    blurb: 'Lunar gravity, and a six-metre zone sixty metres out.',
    target: { kind: 'zone', x_m: 60, w_m: 6 },
    teach: "Range is v squared over g: cut gravity to a sixth and the very same shot goes six times further. Nobody's intuition survives leaving Earth, which is why you aim by arithmetic and not by feel.",
    gravity: 1.62,
    start_aim: [45, 12],
  }),
];

export const BY_ID: ReadonlyMap<string, Challenge> = new Map(CHALLENGES.map((c) => [c.id, c]));

/** A challenge by id or by roughly what somebody called it. */
export function find(text: unknown): Challenge | null {
  const want = String(text ?? '').trim().toLowerCase();
  if (!want) return null;
  const byId = BY_ID.get(want);
  if (byId) return byId;
  for (const c of CHALLENGES) if (want === c.name.toLowerCase()) return c;
  for (const c of CHALLENGES) if (c.name.toLowerCase().includes(want) || c.id.includes(want)) return c;
  return null;
}

export const names = () => CHALLENGES.map((c) => c.name).join(', ');

export interface Verdict { cleared: boolean; miss_m: number; note: string }

/**
 * Did that shot do what the challenge asked, and by how much.
 *
 * `miss_m` is a single number in metres and its meaning depends on the note
 * beside it: short of a wall it is a horizontal shortfall, under the top of one
 * a vertical one. The note is the contract: it is generated here, from these
 * numbers, and the avatar is told not to change a figure in it.
 */
export function grade(c: Challenge, flight: Flight): Verdict {
  const kind = c.target.kind;
  const result = kind === 'wall' ? gradeWall(c, flight)
    : kind === 'zone' ? gradeZone(c, flight)
    : kind === 'distance' ? gradeDistance(c, flight)
    : { cleared: false, miss_m: 0, note: 'That challenge has no target.' };
  return applyCeiling(c, flight, result);
}

function gradeWall(c: Challenge, flight: Flight): Verdict {
  const x = Number(c.target.x_m);
  const h = Number(c.target.h_m);
  const height = heightAt(flight, x);
  if (height === null) {
    const short = pyRound(x - Math.max(flight.range_m, 0), 2);
    return { cleared: false, miss_m: short, note: `It came down at ${pyStr(flight.range_m)} m — ${pyStr(short)} m short of the wall, so height was never the problem.` };
  }
  if (height < h) {
    const under = pyRound(h - height, 2);
    return { cleared: false, miss_m: under, note: `You were at ${pyStr(height)} m going past ${pyG(x)} m, ${pyStr(under)} m below the top. Plenty of range — ${pyStr(flight.range_m)} m — and not enough height where it counted.` };
  }
  return { cleared: true, miss_m: 0, note: `Over with ${pyStr(pyRound(height - h, 2))} m to spare, landing at ${pyStr(flight.range_m)} m after ${pyStr(flight.flight_s)} s.` };
}

function gradeZone(c: Challenge, flight: Flight): Verdict {
  const x = Number(c.target.x_m);
  const half = Number(c.target.w_m) / 2;
  const delta = pyRound(flight.range_m - x, 2);
  if (Math.abs(delta) <= half) {
    return { cleared: true, miss_m: 0, note: `Landed at ${pyStr(flight.range_m)} m, inside the zone, apex ${pyStr(flight.apex_m)} m.` };
  }
  const over = pyRound(Math.abs(delta) - half, 2);
  const where = delta > 0 ? 'long' : 'short';
  return { cleared: false, miss_m: over, note: `Landed at ${pyStr(flight.range_m)} m — ${pyStr(over)} m ${where} of the zone, apex ${pyStr(flight.apex_m)} m, ${pyStr(flight.flight_s)} s in the air.` };
}

function gradeDistance(c: Challenge, flight: Flight): Verdict {
  const need = Number(c.target.min_m);
  if (flight.range_m >= need) {
    return { cleared: true, miss_m: 0, note: `${pyStr(flight.range_m)} m, past the ${pyG(need)} m mark, apex ${pyStr(flight.apex_m)} m.` };
  }
  const short = pyRound(need - flight.range_m, 2);
  return { cleared: false, miss_m: short, note: `${pyStr(flight.range_m)} m — ${pyStr(short)} m short of ${pyG(need)}, with an apex of ${pyStr(flight.apex_m)} m.` };
}

/** A roof overrides everything: a shot that hit it did not count. */
function applyCeiling(c: Challenge, flight: Flight, result: Verdict): Verdict {
  if (c.ceiling_m === null || flight.apex_m <= c.ceiling_m) return result;
  const over = pyRound(flight.apex_m - c.ceiling_m, 2);
  return {
    cleared: false,
    miss_m: Math.max(over, result.miss_m || 0),
    note: `Into the roof: apex ${pyStr(flight.apex_m)} m is ${pyStr(over)} m above the ${pyG(c.ceiling_m)} m limit. Distance was ${pyStr(flight.range_m)} m.`,
  };
}
