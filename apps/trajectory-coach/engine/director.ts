// What the avatar is told, and when (persona.py, summary.py and the coach in
// table.py, rebuilt for the Avatar API).
//
// The range decides everything; the avatar coaches. Every number it says has
// already been computed once, by the range, and arrives in the state or an
// event: a model that recomputes a range in its head gets it wrong often
// enough to be dangerous in an app whose whole promise is that the numbers are
// real. So the result sentence is quoted, never summarised.
//
// The avatar cannot see the panel and cannot call the app. So:
// - standing rules go once, as NOTES;
// - the board goes as `state`, rebuilt from the same snapshot the page draws
//   (which, while a shot is in the air, has no result in it to leak);
// - what the avatar can be asked and answer at once is staged in the state:
//   the launcher's limits (so "try ninety degrees" is refused on the spot), the
//   six challenges (so "let's do the Moon" is set up correctly), the last
//   shot's numbers (so "why did that miss?" is answered from them);
// - outcomes go as events, one per change, and never for a change the
//   student's own spoken words caused: the avatar is already answering those,
//   and a second line for one change is how one "fire" was narrated five times.
import { CHALLENGES } from './challenges.ts';
import type { Change, Intent, RangeSnapshot, Source, Target } from './types.ts';

/** Standing rules, sent once as notes (each at most 2,000 characters). */
export const NOTES = [
  `You are a physics coach standing at a launcher on a practice range with one student. Keep your own name and background: the range is the job, not your identity. You teach projectile motion by having them shoot at things and then explaining what the numbers did. Opinionated, warm, allergic to folklore: forty-five degrees maximises range on level ground with no wind; it is not a universal answer, and most of the six challenges exist to prove that. Explain in real quantities ("you were at one point four metres going past the wall"), never in vibes. Speak only what you say aloud: no labels, lists, markdown or stage directions. One short sentence by default, two when a number needs explaining; under 30 words. Say numbers the way a person speaks them: "thirty-nine metres", "twelve degrees".`,
  `Beside you the student sees the range drawn to scale: the ground, the target, the launcher, an arrow they drag to aim, faint trails of their earlier shots, a Fire button and the list of challenges. The app sends you the live range state: treat it as ground truth for the challenge, the aim and how the last shot went. The range computes every number. The last shot's result sentence comes from the range: say its numbers EXACTLY as written; never round them, never recompute one in your head, never invent a figure the state does not contain. If the state says a shot is in the air, its result is not known yet: do not guess it and do not say where it will land; the app tells you when it is down. If they ask why a shot missed, explain from the state's numbers why the physics came out that way, then give one change: steeper, flatter, more speed or less. One change at a time.`,
  `The range, not you, moves the launcher and takes the shot: the student drags the arrow, presses Fire, types or tells you, and the app applies it a moment after you hear it. You cannot do it and you do not decide whether it worked. When they ask for an aim ("try forty degrees", "steeper", "a bit more speed"), say ONE short line with an opinion about it (flat, steep, plenty of speed, not enough) and never read the numbers back: the arrow shows them. If they ask for an aim outside the launcher's limits in the state, tell them the range will not do that, with the limit. "Fire", "send it", "shoot", "let it go", "go" and "try it" ARE the instruction to fire: the range takes the shot at once. Say one short line watching it go; never where it lands or whether it worked. Never ask them to confirm, never say they need to aim first (the launcher always has an aim) and never say they have not taken a shot as a reason not to take one. Do not end your turns by asking whether to fire: they will tell you. When they ask for another challenge, set it up from the state's list in one short line (the target and the conditions) and tell them to aim; never tell them what angle to use. When the app tells you an outcome you have already given, do not repeat it; carry on from it.`,
];

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

const num = (x: number) => String(x);

export function describeTarget(target: Target, ceilingM: number | null): string {
  let what = target.kind === 'wall' ? `a ${num(target.h_m!)} m wall ${num(target.x_m!)} m out`
    : target.kind === 'zone' ? `a ${num(target.w_m!)} m landing zone centred ${num(target.x_m!)} m out`
    : `landing past ${num(target.min_m!)} m`;
  if (ceilingM !== null) what += ` without going above ${num(ceilingM)} m`;
  return what;
}

function conditions(c: RangeSnapshot['challenge']): string {
  const parts: string[] = [];
  if (c.wind_ms) parts.push(`a ${num(Math.abs(c.wind_ms))} m/s ${c.wind_ms > 0 ? 'tail' : 'head'}wind`);
  if (Math.abs(c.gravity - 9.81) > 0.01) parts.push(`gravity of ${num(c.gravity)} m/s² (Earth's is 9.81)`);
  return parts.length ? ` Conditions: ${parts.join(' and ')}.` : ' Conditions: level ground, no wind, Earth gravity.';
}

/**
 * The live range, as the avatar's state (at most 3,858 characters). Built
 * from the snapshot, so while a shot is in the air there is no result in it.
 */
export function rangeState(s: RangeSnapshot): string {
  const { challenge: c, aim, limits } = s;
  const parts = [
    `Trajectory coach, live range. Challenge: ${c.name} — ${describeTarget(c.target, c.ceiling_m)}.${conditions(c)}`,
    `The launcher is aimed at ${num(aim.angle_deg)} degrees and ${num(aim.speed_ms)} metres a second (the student sees this on the arrow: never read it back). Its limits: ${num(limits.angle[0])} to ${num(limits.angle[1])} degrees, ${num(limits.speed[0])} to ${num(limits.speed[1])} metres a second on this challenge; the range refuses anything outside them.`,
  ];
  const shot = s.last_shot;
  if (s.phase === 'flying' && shot) {
    parts.push(`A shot is in the air right now: ${num(shot.angle_deg)} degrees at ${num(shot.speed_ms)} metres a second, ${num(shot.flight_s)} s of real flight. Its result is not known yet: do not guess it; the app tells you when it lands.`);
  } else if (shot && shot.cleared !== undefined) {
    parts.push(`Last shot: ${num(shot.angle_deg)} degrees at ${num(shot.speed_ms)} metres a second, landed at ${num(shot.range_m!)} m, apex ${num(shot.apex_m!)} m, ${num(shot.flight_s)} s in the air: ${shot.cleared ? 'CLEARED' : `missed by ${num(shot.miss_m!)} m`}. The range's result sentence, numbers to be said exactly: "${shot.note}"`);
    if (s.phase === 'aiming') parts.push('The student has re-aimed since; the next shot will use the new aim.');
  } else {
    parts.push('No shot yet on this challenge. Firing needs nothing else: the launcher is always aimed.');
  }
  if (s.attempts) {
    const recent = s.history.slice(-4).map((h) => `${num(h.angle_deg)}° at ${num(h.speed_ms)} m/s → ${num(h.range_m)} m${h.cleared ? ' (cleared)' : ''}`).join('; ');
    const best = s.best_miss_m ? `, closest miss ${num(s.best_miss_m)} m` : '';
    parts.push(`Shots on this challenge: ${s.attempts}${best}.${recent ? ` Most recent: ${recent}.` : ''}`);
  }
  if (c.teach) {
    parts.push(s.phase === 'debrief'
      ? `They cleared it. The teaching point, to make in your own words: "${c.teach}" Then offer the next challenge.`
      : `They have cleared this challenge before; its teaching point: "${c.teach}"`);
  }
  // Staged for "let's do the Moon": the avatar answers that at once, before the
  // app has put the new challenge up, so it needs the list now.
  const done = s.catalog.filter((e) => e.cleared).length;
  const index = CHALLENGES.findIndex((x) => x.id === c.id);
  const next = CHALLENGES[(index + 1) % CHALLENGES.length];
  const list = CHALLENGES.map((x) => `${x.name}: ${x.blurb}${s.catalog.find((e) => e.id === x.id)?.cleared ? ' (cleared)' : ''}`).join(' | ');
  parts.push(`The six challenges (${done} cleared): ${list} The next one along is ${next.name}. If the student asks for one, set it up from this list; the app puts it on the range. There are no others.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Events: what to say, once the avatar has the floor
// ---------------------------------------------------------------------------

export interface Line { text: string; ttl: number }

export const say = {
  start: (s: RangeSnapshot) => `The range is set up and the student is at the launcher. The first challenge is ${s.challenge.name}: ${s.challenge.blurb} In one or two short lines, welcome them to the range, set up that challenge and tell them to drag the arrow or just say an angle. Do not tell them what angle to use.`,
  /** The landing: the app's core line (landing_cue). */
  landing: (s: RangeSnapshot) => {
    const shot = s.last_shot!;
    if (shot.cleared) {
      return `The shot has landed and they cleared it. In two short sentences: say this result without changing a number in it — "${shot.note}" — and then make this teaching point in your own words — "${s.challenge.teach ?? ''}" Then offer the next challenge.`;
    }
    const push = s.attempts < 3
      ? 'Give them one specific change to make: steeper, flatter, more speed, less.'
      : 'Explain WHY it keeps falling that way, then give them one change.';
    return `The shot has landed and it missed. Say this result out loud without changing a single number in it — "${shot.note}" — then ${push} Two short sentences at most.`;
  },
  challenge: (s: RangeSnapshot) => `A new challenge is up: ${s.challenge.name} — ${s.challenge.blurb} Set it up in one short line and tell them to aim. Do not tell them the answer.`,
  /** A typed aim: the avatar never saw the line, so it gets the original aim cue. */
  aimed: () => `The student set a new aim and the arrow shows it. Say ONE short line with an OPINION about that aim: flat, steep, plenty of speed, not enough. Do NOT say the angle or the speed back to them, in digits or in words. Do NOT ask whether they want to fire; they will tell you.`,
  reset: () => `The student cleared the scoreboard and the trails on this challenge. Say one short line inviting them to have another go.`,
  refusedAim: (reason: string, heard: boolean) => `The range refused the aim the student asked for: "${reason}" ${heard ? 'If you have not already told them, say' : 'Say'} it plainly in one short line, keeping the numbers exactly as written, and do NOT describe anything as done: the launcher did not move.`,
  refusedFire: (reason: string) => `The student asked to fire and the range refused: "${reason}" Say that in one short line.`,
  refused: (reason: string) => `The student asked the range for something it refused: "${reason}" Say it plainly in one short line and do NOT describe anything as done.`,
};

/**
 * The line a change gets, if any. One per change, and none for a change the
 * student's own speech caused (the avatar is already answering that), for a
 * drag (the coach never narrated the arrow) or for a shot leaving (its landing
 * is its line).
 */
export function lineFor(change: Change): Line | null {
  const { intent, by, snapshot, previous } = change;
  if (intent.kind === 'land') return { text: say.landing(snapshot), ttl: 20 };
  if (by === 'spoken' || by === 'range') return null;
  if (snapshot.challenge.id !== previous.challenge.id) return { text: say.challenge(snapshot), ttl: 20 };
  if (by !== 'typed') return null;
  if (intent.kind === 'set_aim') return { text: say.aimed(), ttl: 10 };
  if (intent.kind === 'reset') return { text: say.reset(), ttl: 10 };
  return null;
}

/**
 * The line a refusal gets. The panel shows every refusal; the avatar is told
 * about the ones it cannot know: typed lines, and spoken aims (the limits are
 * staged, so it may have refused already; the line says not to repeat it). A
 * spoken "fire" while a shot is up needs nothing: the state already says the
 * shot is in the air.
 */
export function refusalFor(intent: Intent, reason: string, by: Source): Line | null {
  if (by === 'panel' || by === 'range') return null;
  if (intent.kind === 'set_aim') return { text: say.refusedAim(reason, by === 'spoken'), ttl: 15 };
  if (by === 'spoken') return null;
  if (intent.kind === 'fire') return { text: say.refusedFire(reason), ttl: 15 };
  return { text: say.refused(reason), ttl: 15 };
}
