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
//   "aim first", never repeat the student's numbers, never ask whether to
//   fire, never guess a shot in the air, numbers exactly as written), and the
//   live runs' (call, never narrate an action).
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
- fire: "fire", "send it", "shoot", "go", "let it fly", "again" ARE the instruction, even said while you are still talking or welcoming them. Call fire at once: never ask them to confirm, never tell them to set an aim first (the launcher always has one). fire waits for the landing and tells you where the ball came down.
- choose_challenge: when they ask for a challenge by name, or for the next one.
- start_over: when they ask to start over, reset, or clear the board or the trails.
Every request that changes the screen is a tool call, even a single word answering your own question (a challenge name, "yes", "next"). Call the tool every time, even when you think you know what will happen. Never say an action happened (it's away, it's reset, the Moon is up) unless a tool's result said so: without the call nothing on their screen changes.

Numbers: the range computes every one. Say the figures in a result exactly as written; never round them, recompute one in your head or invent one. Never guess where a shot will land or whether it will clear: only fire can tell you. If a tool refuses, say why plainly with its numbers and describe nothing as done.

Coaching: after a miss, say what happened from the result, then give one change: steeper, flatter, more speed or less. One change at a time. Never tell them the angle or speed that would clear a challenge; let them find it. After an aim, follow its result: name the new angle or speed when it says to, never repeat numbers they just said, and never predict whether the shot will clear or where it will land before fire tells you. Never end a turn by asking whether to fire: they will tell you.

Questions about the last shot ("why did that miss?"), the challenge, the conditions or the limits: answer from the live range in your context, no tool needed. When the student uses the arrow, the Fire button or the challenge list on screen, you are told what happened; carry on from that, and never repeat a result you have already given.

Speak only what you say aloud: no lists, labels or markdown. One short sentence by default, two when a number needs explaining; under 30 words. Say numbers the way a person speaks them: "thirty-nine point two metres", "twelve degrees".`;

const awaits = (timeoutSeconds: number) => ({ mode: 'await' as const, timeoutSeconds });
// Lenient on purpose: the platform checks a call against its schema before the
// page sees it and answers a misfit "invalid arguments" to the host, which then
// often says the action happened. So no enums, no closed objects, no tight
// lengths: the page reads whatever arrives (controls.ts) and asks when unsure.
const noArgs = { type: 'object', properties: {} };

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
        request: { type: 'string', maxLength: 500, description: 'Their words, when they asked for a change with no number: "a bit steeper", "more power", "lob it like a mortar".' },
        then_fire: { type: 'boolean', description: 'True when they also asked to fire straight after ("forty at twenty and fire"). The result then says where the shot landed.' },
      },
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
          maxLength: 500,
          description: `Which one: ${CHALLENGES.map((c) => `${c.id} (${c.name})`).join(', ')}, or "next" for the one after the current one. Their own words work too ("the Moon", "the windy one").`,
        },
      },
      required: ['challenge'],
    },
    'x-atmee': awaits(10),
  },
  {
    type: 'function', name: 'start_over',
    description: 'Clears the shots and trails on the current challenge and puts the launcher back to its starting aim. Call it when the student asks to start over, reset or clear the board; never on your own.',
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
    `The launcher is aimed at ${num(aim.angle_deg)} degrees and ${num(aim.speed_ms)} metres a second (the arrow shows it). Its limits on this challenge: ${num(limits.angle[0])} to ${num(limits.angle[1])} degrees, ${num(limits.speed[0])} to ${num(limits.speed[1])} metres a second.`,
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
const AFTER_AIM = 'Do not predict whether it will clear or where it will land, and do not ask whether to fire.';

/**
 * Every result starts with its plain outcome ("Done:", "Refused:", "Landed,
 * missed:"…): the platform has the host say a filler line of its own while a
 * tool runs, and the reply's first real words must be the range's.
 */
export const said = {
  /** The opening, sent as an event once the range is ready. The host's own greeting has already introduced him. */
  opening: (s: RangeSnapshot) => `You have just greeted them; do not greet or introduce yourself again. The student is at the launcher and the challenge up is ${s.challenge.name}: ${s.challenge.blurb} In one or two short lines, set up that challenge and tell them to drag the arrow or just tell you an angle. Do not suggest an angle.`,

  /** An aim from their own numbers: they know them, so they are not repeated. */
  aimed: (s: RangeSnapshot) => `Done: the launcher is at ${aimWords(s)}, as they asked; the arrow shows it. Give one short opinion of the shape of that aim (steep, flat, plenty of speed, not much) without repeating their numbers. ${AFTER_AIM}`,
  /**
   * An aim that came at least partly from words ("a bit steeper"): what the
   * words set is new to them, so it is named; a number they gave themselves
   * is not repeated.
   */
  stepped: (s: RangeSnapshot, before: RangeSnapshot, fromWords: { angle: boolean; speed: boolean }) => {
    const moved = [
      s.aim.angle_deg !== before.aim.angle_deg && `the angle from ${num(before.aim.angle_deg)} to ${num(s.aim.angle_deg)} degrees`,
      s.aim.speed_ms !== before.aim.speed_ms && `the speed from ${num(before.aim.speed_ms)} to ${num(s.aim.speed_ms)} metres a second`,
    ].filter(Boolean).join(' and ');
    const name = [fromWords.angle && 'angle', fromWords.speed && 'speed'].filter(Boolean).join(' and ') || 'aim';
    const own = [!fromWords.angle && s.aim.angle_deg !== before.aim.angle_deg && 'angle', !fromWords.speed && s.aim.speed_ms !== before.aim.speed_ms && 'speed'].filter(Boolean).join(' or ');
    return `Done: moved ${moved || `nothing: it was already at ${aimWords(s)}`}. Tell them the new ${name} once, in words, with one short opinion of its shape${own ? `; do not repeat the ${own} they gave you` : ''}. ${AFTER_AIM}`;
  },
  aimRefused: (reason: string, s: RangeSnapshot) => `Refused: "${reason}" The launcher did not move; it is still at ${aimWords(s)}. Say that plainly in one short line, keeping the numbers.`,
  noAim: () => 'Nothing moved: no angle, speed or words came with the call. Ask them in one short line what they want to change.',
  unreadable: (request: string) => `Nothing moved: the range could not read "${request}" as an aim. Ask them in one short line for an angle in degrees or a speed in metres a second.`,
  aimedAndFired: (s: RangeSnapshot, landing: string) => `${landing} (The shot went at ${aimWords(s)}, as they asked.)`,

  /** The landing: the app's core line (landing_cue). */
  landed: (s: RangeSnapshot) => {
    const shot = s.last_shot!;
    if (shot.cleared) {
      const all = s.catalog.length > 0 && s.catalog.every((e) => e.cleared);
      const then = all
        ? 'That clears all six challenges: congratulate them, and tell them their logbook (the button at the top) has every lesson to keep.'
        : 'Then ask whether they want the next challenge; put it up only if they say so.';
      return `Landed, cleared: "${shot.note}" Say that result without changing a number in it, then make this teaching point in your own words: "${s.challenge.teach ?? ''}" ${then}`;
    }
    const push = s.attempts < 3
      ? 'then give them one specific change: steeper, flatter, more speed or less.'
      : 'then explain WHY it keeps falling that way, and give them one change.';
    return `Landed, missed: "${shot.note}" Say that result out loud without changing a single number in it, ${push} Two short sentences at most.`;
  },
  joined: (landing: string) => `${landing} (That shot was already in the air when you called fire; it was the one.)`,
  fireRefused: (reason: string) => `Not fired: "${reason}" Say that in one short line.`,
  cancelled: (s: RangeSnapshot) => `Not landed: the range was changed to ${s.challenge.name} while the shot was in the air, so it never came down. Say so in one short line; do not guess where it would have landed.`,

  challenge: (s: RangeSnapshot) => `Done: ${s.challenge.name} is up: ${s.challenge.blurb} ${conditions(s.challenge)} Set it up in one short line (the target and the conditions) and tell them to aim. Never suggest an angle or a speed.`,
  alreadyUp: (s: RangeSnapshot) => `Already up: ${s.challenge.name} is on the range; nothing changed. Carry on with it.`,
  unknownChallenge: (asked: string) => `Not done: ${asked ? `there is no "${asked}" challenge` : 'no challenge was named'}. The six are: ${CHALLENGES.map((c) => c.name).join(', ')}. Ask which one they want.`,

  callEnded: () => 'Nothing done: the call ended before the range could act.',

  refused: (reason: string) => `Refused: "${reason}" Say it plainly in one short line and describe nothing as done.`,

  reset: (s: RangeSnapshot) => `Done: ${s.challenge.name} is clear: no shots, no trails, and the launcher is back at ${aimWords(s)}. Invite them to have another go in one short line.`,
};

/** Something the student did on screen, told to the host: it cannot see the screen. */
export const pressed = (what: string, outcome: string) => `The student ${what} on screen. ${outcome}`;
