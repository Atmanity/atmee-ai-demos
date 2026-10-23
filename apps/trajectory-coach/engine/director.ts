// What the host is told, and how it acts (persona.py, tools.py and the coach
// in table.py, rebuilt for the Avatar API's tools).
//
// The range decides everything; the host coaches. It moves the launcher, takes
// the shot and changes the challenge only by calling the range's tools, and
// each tool answers with the range's own outcome: `fire` waits for the ball to
// come down and returns where it landed, so the host's first words after
// "fire" are the real result. Every number it says has already been computed
// once, by the range: a model that recomputes a range in its head gets it
// wrong often enough to be dangerous in an app whose whole promise is that the
// numbers are real. So the result sentence is quoted, never summarised.
//
// - INSTRUCTIONS: the host's role and the rules the original paid for (never
//   "aim first", never read the aim back, never ask whether to fire, never
//   guess a shot in the air, numbers exactly as written).
// - TOOLS: aim, fire, choose_challenge, start_over. Answered in the page by
//   `Controls` (controls.ts), which runs the range.
// - rangeState: what is on the student's screen, rebuilt from the same
//   snapshot the page draws (which, while a shot is in the air, has no result
//   in it to leak), so questions about it need no tool.
// - said / pressed: the texts the host speaks from, as tool results or, for
//   what the student did on screen, as events.
import type { AppTool } from '../../../server/app-server.ts';
import { CHALLENGES } from './challenges.ts';
import type { RangeSnapshot, Target } from './types.ts';

/** The host's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are the coach on Arcwise, a projectile-motion practice range, with one student. Keep your own name. The student sees the range drawn to scale: the launcher, an arrow they drag to aim, the target, faint trails of earlier shots and a Fire button. You cannot see it; the live range in your context says what is on it. You teach by having them shoot, then explaining what the numbers did. Opinionated, warm, allergic to folklore: forty-five degrees maximises range on level ground with no wind, and most challenges here exist to show it is not a universal answer.

The range moves only when you call its tools:
- aim: whenever the student says where to aim ("try forty degrees", "twenty-five at thirty", "a bit steeper", "more power", "lob it"). Pass the exact numbers they said, even outside the limits, never one changed to fit; for a change with no number, pass their words as request. If they also say to fire ("forty and fire"), set then_fire.
- fire: "fire", "send it", "shoot", "go", "let it fly", "again" ARE the instruction. Call fire at once: never ask them to confirm, never say they must aim first (the launcher always has an aim). fire waits for the landing and tells you where the ball came down.
- choose_challenge: when they ask for a challenge by name, or for the next one.
- start_over: only when they ask to start the current challenge over or clear the trails.
Call the tool every time, even when you think you know what will happen. Saying "it's away" or "the Moon is up" without the call changes nothing on their screen and misleads them.

Numbers: the range computes every one. Say the figures in a result exactly as written; never round them, recompute one in your head or invent one. Never guess where a shot will land or whether it will clear: only fire can tell you. If a tool refuses, say why plainly with its numbers and describe nothing as done.

Coaching: after a miss, say what happened from the result, then give one change: steeper, flatter, more speed or less. One change at a time. Never tell them the angle or speed that would clear a challenge; let them find it. After an aim, give one short opinion of it (steep, flat, plenty of speed, not enough) and never read the numbers back: the arrow shows them. Never end a turn by asking whether to fire: they will tell you.

Questions about the last shot ("why did that miss?"), the challenge, the conditions or the limits: answer from the live range in your context, no tool needed. When the student uses the arrow, the Fire button or the challenge list on screen, you are told what happened; carry on from that, and never repeat a result you have already given.

Speak only what you say aloud: no lists, labels or markdown. One short sentence by default, two when a number needs explaining; under 30 words. Say numbers the way a person speaks them: "thirty-nine point two metres", "twelve degrees".`;

const awaits = (timeoutSeconds: number) => ({ mode: 'await' as const, timeoutSeconds });
const noArgs = { type: 'object', properties: {}, additionalProperties: false };

/** The range's tools. Each is answered in the page, which runs the range. */
export const TOOLS: AppTool[] = [
  {
    type: 'function', name: 'aim',
    description: 'Points the launcher. Call it whenever the student says where to aim, before reacting. Pass only what they changed: an angle with no speed leaves the speed alone. Use their exact numbers even outside the limits; the range refuses those itself, with the numbers. For a change with no number ("a bit steeper", "more power", "lob it"), pass their words as request.',
    parameters: {
      type: 'object',
      properties: {
        angle_deg: { type: 'number', description: 'The launch angle in degrees they asked for, exactly as said.' },
        speed_ms: { type: 'number', description: 'The launch speed in metres per second they asked for, exactly as said.' },
        request: { type: 'string', minLength: 1, maxLength: 120, description: 'Their words, when they asked for a change with no number: "a bit steeper", "more power", "lob it like a mortar".' },
        then_fire: { type: 'boolean', description: 'True when they also asked to fire straight after ("forty at twenty and fire"). The result then says where the shot landed.' },
      },
      additionalProperties: false,
    },
    'x-atmee': awaits(16),
  },
  {
    type: 'function', name: 'fire',
    description: 'Takes the shot at the current aim and waits for it to land (a few seconds); the result says where it came down and whether it cleared the challenge. Call it whenever the student says fire, send it, shoot, go or again.',
    parameters: noArgs,
    'x-atmee': awaits(15),
  },
  {
    type: 'function', name: 'choose_challenge',
    description: 'Puts a challenge on the range with a clean scoreboard. Call it when the student asks for a challenge by name or for the next one; never on your own.',
    parameters: {
      type: 'object',
      properties: {
        challenge: {
          type: 'string',
          enum: [...CHALLENGES.map((c) => c.id), 'next'],
          description: `The challenge: ${CHALLENGES.map((c) => `${c.id} (${c.name})`).join(', ')}, or next for the one after the current one.`,
        },
      },
      required: ['challenge'],
      additionalProperties: false,
    },
    'x-atmee': awaits(10),
  },
  {
    type: 'function', name: 'start_over',
    description: 'Clears the shots and trails on the current challenge and puts the launcher back to its starting aim. Only when the student asks to start over or clear the board; never on your own.',
    parameters: noArgs,
    'x-atmee': awaits(10),
  },
];

// ---------------------------------------------------------------------------
// The live range, as the host's state
// ---------------------------------------------------------------------------

const num = (x: number) => String(x);

export function describeTarget(target: Target, ceilingM: number | null): string {
  let what = target.kind === 'wall' ? `a ${num(target.h_m!)} m wall ${num(target.x_m!)} m out`
    : target.kind === 'zone' ? `a ${num(target.w_m!)} m landing zone centred ${num(target.x_m!)} m out`
    : `landing past ${num(target.min_m!)} m`;
  if (ceilingM !== null) what += ` without going above ${num(ceilingM)} m`;
  return what;
}

export function conditions(c: RangeSnapshot['challenge']): string {
  const parts: string[] = [];
  if (c.wind_ms) parts.push(`a ${num(Math.abs(c.wind_ms))} m/s ${c.wind_ms > 0 ? 'tail' : 'head'}wind`);
  if (Math.abs(c.gravity - 9.81) > 0.01) parts.push(`gravity of ${num(c.gravity)} m/s² (Earth's is 9.81)`);
  return parts.length ? `Conditions: ${parts.join(' and ')}.` : 'Conditions: level ground, no wind, Earth gravity.';
}

const numberOf = (id: string) => CHALLENGES.findIndex((c) => c.id === id) + 1;

/**
 * The live range, as the host's state (at most 3,858 characters). Built from
 * the snapshot, so while a shot is in the air there is no result in it, and a
 * challenge's teaching point only once it is cleared.
 */
export function rangeState(s: RangeSnapshot): string {
  const { challenge: c, aim, limits } = s;
  const parts = [
    `Arcwise, the live range. Challenge ${numberOf(c.id)} of ${CHALLENGES.length}: ${c.name}, ${describeTarget(c.target, c.ceiling_m)}. ${conditions(c)}`,
    `The launcher is aimed at ${num(aim.angle_deg)} degrees and ${num(aim.speed_ms)} metres a second (the arrow shows it: never read it back). Its limits on this challenge: ${num(limits.angle[0])} to ${num(limits.angle[1])} degrees, ${num(limits.speed[0])} to ${num(limits.speed[1])} metres a second.`,
  ];
  const shot = s.last_shot;
  if (s.phase === 'flying' && shot) {
    parts.push(`A shot is in the air right now: ${num(shot.angle_deg)} degrees at ${num(shot.speed_ms)} metres a second. Its result is not known yet: do not guess it.`);
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
      ? `They have just cleared it. Its teaching point: "${c.teach}"`
      : `They have cleared this challenge before; its teaching point: "${c.teach}"`);
  }
  const done = s.catalog.filter((e) => e.cleared).length;
  const list = CHALLENGES.map((x, i) => `${i + 1} ${x.name}: ${x.blurb}${s.catalog.find((e) => e.id === x.id)?.cleared ? ' (cleared)' : ''}`).join(' | ');
  parts.push(`The six challenges, ${done} cleared: ${list} To put one up, call choose_challenge.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// What the host speaks from: tool results, and events for what happened on screen
// ---------------------------------------------------------------------------

const aimWords = (s: RangeSnapshot) => `${num(s.aim.angle_deg)} degrees and ${num(s.aim.speed_ms)} metres a second`;

export const said = {
  /** The opening, sent as an event once the range is ready. */
  opening: (s: RangeSnapshot) => `The student is at the launcher and the range is set up. The challenge up is ${s.challenge.name}: ${s.challenge.blurb} Welcome them to Arcwise in one or two short lines, set up that challenge and tell them to drag the arrow or just tell you an angle. Do not suggest an angle.`,

  aimed: (s: RangeSnapshot) => `The launcher now points at ${aimWords(s)}; the arrow shows it. Give one short opinion of that aim (steep, flat, plenty of speed, not enough) without reading the numbers back, and do not ask whether to fire.`,
  aimRefused: (reason: string, s: RangeSnapshot) => `The range refused that aim: "${reason}" Say so plainly in one short line, keeping its numbers. The launcher did not move: it is still at ${aimWords(s)}.`,
  noAim: () => 'No angle, speed or words were given, so nothing moved. Ask them in one short line what they want to change.',
  unreadable: (request: string) => `The range could not read "${request}" as an aim, so nothing moved. Ask them in one short line for an angle in degrees or a speed in metres a second.`,
  aimedAndFired: (s: RangeSnapshot, landing: string) => `Aimed at ${aimWords(s)} and fired. ${landing}`,

  /** The landing: the app's core line (landing_cue). */
  landed: (s: RangeSnapshot) => {
    const shot = s.last_shot!;
    if (shot.cleared) {
      const all = s.catalog.length > 0 && s.catalog.every((e) => e.cleared);
      const then = all
        ? 'That clears all six challenges: congratulate them, and tell them their logbook (the button at the top) has every lesson to keep.'
        : 'Then ask whether they want the next challenge; put it up only if they say so.';
      return `The shot landed and cleared the challenge: "${shot.note}" Say that result without changing a number in it, then make this teaching point in your own words: "${s.challenge.teach ?? ''}" ${then}`;
    }
    const push = s.attempts < 3
      ? 'then give them one specific change: steeper, flatter, more speed or less.'
      : 'then explain WHY it keeps falling that way, and give them one change.';
    return `The shot landed and missed: "${shot.note}" Say that result out loud without changing a single number in it, ${push} Two short sentences at most.`;
  },
  joined: (landing: string) => `That shot was already in the air. ${landing}`,
  fireRefused: (reason: string) => `The range did not fire: "${reason}" Say that in one short line.`,
  cancelled: (s: RangeSnapshot) => `That shot never landed: the range was changed to ${s.challenge.name} while it was in the air. Say so in one short line; do not guess where it would have come down.`,

  challenge: (s: RangeSnapshot) => `${s.challenge.name} is up: ${s.challenge.blurb} ${conditions(s.challenge)} Set it up in one short line (the target and the conditions) and tell them to aim. Never suggest an angle or a speed.`,
  alreadyUp: (s: RangeSnapshot) => `${s.challenge.name} is already on the range; nothing changed. Carry on with it.`,
  unknownChallenge: (asked: string) => `There is no "${asked}" challenge. The six are: ${CHALLENGES.map((c) => c.name).join(', ')}. Ask which one they want.`,

  refused: (reason: string) => `The range refused that: "${reason}" Say it plainly in one short line and describe nothing as done.`,

  reset: (s: RangeSnapshot) => `${s.challenge.name} is clear: no shots, no trails, and the launcher is back at ${aimWords(s)}. Invite them to have another go in one short line.`,
};

/** Something the student did on screen, told to the host: it cannot see the screen. */
export const pressed = (what: string, outcome: string) => `The student ${what} on screen. ${outcome}`;
