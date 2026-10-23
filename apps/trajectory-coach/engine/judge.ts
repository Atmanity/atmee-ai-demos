// Turning words into actions on the range: rules first, a model call only for
// what the rules cannot read.
//
// The host acts through tools now (director.ts), and an LLM is good at hearing
// "forty-five at twenty-four" as two numbers. What it should not do is decide
// how far "a bit steeper" goes, or whether a turn was a request to fire. So the
// words still come here, in two places:
//
// - the aim tool's `request`: a change with no number in it ("a bit steeper",
//   "more power", "lob it like a mortar") is read by these rules, with fixed
//   steps ("a bit" = 3°), and what they cannot read goes to the app's model on
//   the server (`INTERPRET_SCHEMA`, `interpretPrompt`), validated here;
// - the safety net (`mustDo`): when the student clearly says "fire", "start
//   over" or names a challenge and the host does not call the tool, the page
//   does it. "fire" is the original's whole-utterance matcher (FireWatch): the
//   WHOLE turn must be the command, so a question about firing never fires.
//
// A request outside the launcher's limits is passed through, never clamped:
// the range refuses it with the numbers, and that refusal is the teaching
// moment.
import { CHALLENGES } from './challenges.ts';
import { pyRound } from './flight.ts';
import type { Aim, Command, Intent, Limits } from './types.ts';

// ---------------------------------------------------------------------------
// "fire": the whole utterance, decided in code (FIRE_PHRASES, is_fire_request)
// ---------------------------------------------------------------------------

/**
 * Ways a person says "take the shot", as whole utterances.
 *
 * The original's model would not call its `fire` tool: four requests in one
 * session ("fire", "fire", "send it") each came back with an invented
 * precondition ("you need to aim first") while the launcher sat aimed at 45°
 * with the numbers on screen. An optional tool is something a model can
 * DESCRIBE instead of calling. Here the host does call a tool, and the safety
 * net (`mustDo`) still fires from these words when it does not.
 */
export const FIRE_PHRASES: ReadonlySet<string> = new Set([
  'fire', 'fire it', 'fire away', 'fire it now', 'fire now',
  'send it', 'send it now', 'shoot', 'shoot it', 'take the shot',
  'let it go', 'let it fly', 'launch', 'launch it', 'go', 'do it',
  'try it', 'release', 'pull the trigger', 'let her rip', 'let it rip',
]);

/**
 * "Again": the same shot once more. Kept apart from the original's list and
 * just as strict (the whole utterance).
 */
export const AGAIN_PHRASES: ReadonlySet<string> = new Set([
  'again', 'same again', 'fire again', 'shoot again', 'go again', 'try again', 'send it again', 'do it again',
  'one more time', 'once more', 'another shot', 'same shot again', 'same again please', 'and again',
]);

const COURTESY_HEADS = ['please ', 'ok ', 'okay ', 'now ', 'just ', 'alright '];
const COURTESY_TAILS = [' please', ' now', ' then'];

/**
 * Whether this whole utterance is the instruction to take the shot.
 *
 * Deliberately strict: the WHOLE turn must be the command, with courtesies
 * stripped. A rule that also matched "why did that miss?" or "should I fire
 * flatter?" would take a shot the student was only asking about, which is
 * worse than the bug it fixes. (Two changes from the original: courtesies
 * are stripped until none is left, so "ok please fire" counts as well as
 * "please ok fire"; and the AGAIN_PHRASES count too.)
 */
export function isFireRequest(text: string): boolean {
  let cleaned = (text || '').trim().toLowerCase().split(/\s+/).join(' ');
  for (const edge of '.!?,') cleaned = cleaned.split(edge).join(' ');
  cleaned = cleaned.split(/\s+/).filter(Boolean).join(' ');
  for (let changed = true; changed;) {
    changed = false;
    for (const head of COURTESY_HEADS) while (cleaned.startsWith(head)) { cleaned = cleaned.slice(head.length); changed = true; }
    for (const tail of COURTESY_TAILS) while (cleaned.endsWith(tail)) { cleaned = cleaned.slice(0, -tail.length); changed = true; }
  }
  return FIRE_PHRASES.has(cleaned) || AGAIN_PHRASES.has(cleaned);
}

// ---------------------------------------------------------------------------
// Normalising what was said: lower case, number words to digits, units to tokens
// ---------------------------------------------------------------------------

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const DIGIT: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
/** "one" is a number only next to a unit or a step ("one degree", "one more"); "the windy one" is not. */
const ONE_IS_A_NUMBER = new Set(['deg', 'degree', 'degrees', 'metre', 'metres', 'meter', 'meters', 'm', 'ms', 'more', 'less', 'point', 'hundred', 'and']);

const isDigits = (t: string | undefined) => t !== undefined && /^\d+(?:\.\d+)?$/.test(t);

function readNumber(t: string[], i: number): { text: string; next: number } | null {
  let j = i;
  let value: number;
  if (isDigits(t[j])) {
    value = Number(t[j]);
    j += 1;
  } else {
    let v = 0;
    let any = false;
    if (t[j] === 'a' && (t[j + 1] === 'couple' || t[j + 1] === 'few')) {
      // "a couple more degrees", "a few degrees steeper"
      return { text: t[j + 1] === 'couple' ? '2' : '3', next: j + (t[j + 2] === 'of' ? 3 : 2) };
    }
    if ((t[j] === 'a' || t[j] === 'one') && t[j + 1] === 'hundred') { v = 100; j += 2; any = true; }
    else if (t[j] in SMALL && t[j + 1] === 'hundred') { v = SMALL[t[j]] * 100; j += 2; any = true; }
    if (any && t[j] === 'and' && (t[j + 1] in TENS || t[j + 1] in SMALL)) j += 1;
    if (t[j] in TENS) {
      v += TENS[t[j]];
      j += 1;
      any = true;
      if (t[j] in SMALL && SMALL[t[j]] > 0 && SMALL[t[j]] < 10) { v += SMALL[t[j]]; j += 1; }
    } else if (t[j] in SMALL) {
      if (t[j] === 'one' && !any && !ONE_IS_A_NUMBER.has(t[j + 1] ?? '')) return null;
      v += SMALL[t[j]];
      j += 1;
      any = true;
    }
    if (!any) return null;
    value = v;
  }
  if (t[j] === 'point' && (t[j + 1] in DIGIT || /^\d+$/.test(t[j + 1] ?? ''))) {
    let digits = '';
    j += 1;
    while (j < t.length && (t[j] in DIGIT || /^\d+$/.test(t[j]))) { digits += DIGIT[t[j]] ?? t[j]; j += 1; }
    value = Number(`${Math.trunc(value)}.${digits}`);
  }
  if (t[j] === 'and' && t[j + 1] === 'a' && t[j + 2] === 'half') { value += 0.5; j += 3; }
  return { text: String(value), next: j };
}

/** "Try forty-five degrees at twenty m/s!" → "try 45 deg at 20 ms". Commas survive as " , " (clause breaks). */
export function normalize(text: string): string {
  const cleaned = (text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/°/g, ' deg ')
    .replace(/\bm\s*\/\s*s(?:ec)?\b/g, ' ms ')
    .replace(/['’`]/g, '')
    .replace(/[,;:]/g, ' , ')
    .replace(/(\d)\.(\d)/g, '$1§$2')
    .replace(/[.!?]+/g, ' , ')
    .replace(/[^a-z0-9§, ]+/g, ' ')
    .replace(/§/g, '.')
    .replace(/(\d)([a-z])/g, '$1 $2');
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length;) {
    const n = readNumber(tokens, i);
    if (n) { out.push(n.text); i = n.next; } else { out.push(tokens[i]); i += 1; }
  }
  return out.join(' ')
    .replace(/\b(?:metres?|meters?|m)(?: (?:a|per|every|each))? (?:second|sec|s)\b/g, 'ms')
    .replace(/\bmps\b/g, 'ms')
    .replace(/\b(?:degrees?|degs?)\b/g, 'deg')
    .replace(/\s+/g, ' ')
    .replace(/^[ ,]+|[ ,]+$/g, '');
}

// ---------------------------------------------------------------------------
// What a normalised line is
// ---------------------------------------------------------------------------

const LEADING_NOISE = /^(?:(?:ok|okay|alright|all right|so|well|um|uh|uhm|hmm|hm|oh|right|and|but|hey|coach|yeah|yes|no|wait|actually|,)\s+)+/;
const FIRE_NOISE = /^(?:(?:ok|okay|alright|all right|so|well|hey|coach|right|and|yeah|yes|,)\s+)+/;
const QUESTION = /^(?:why|what|whats|how|hows|where|wheres|when|which|who|whose|is|isnt|are|arent|was|wasnt|were|werent|does|doesnt|did|didnt|should|shouldnt|has|hasnt|have|havent|am|might|must|would it|will it|could it|can it|do you think|do i|do we|do you)\b/;
const SUGGESTION = /^(?:how about|what about|why not|why dont (?:we|you|i))\b/;

/** A question or a musing is the avatar's to answer, never an action ("should I fire flatter?", "what if I try forty?"). */
export function isQuestion(normalized: string): boolean {
  const t = normalized.replace(LEADING_NOISE, '');
  return QUESTION.test(t) && !SUGGESTION.test(t);
}

/** Words that may surround a command without changing it ("ok let's do the moon one please"). */
const FILLER = new Set(`
  , ok okay alright all right so well um uh uhm hmm hm oh right yeah yes no sure cool great nice good fine please thanks thank
  now just then again instead maybe perhaps even lets let us me we i you it its this that the a an to on onto in into for with at
  about how what why dont go do try give put make set take bring switch change move load pick choose play show have want wanna
  would like id ill can could will shall need gonna one challenge coach launcher shot arrow aim point and up
`.split(/\s+/).filter(Boolean));

/** Stricter, for "next", "start over" and challenge names: "next shot" is not "next one". */
const COMMAND_FILLER = new Set([...FILLER].filter((w) => !['shot', 'arrow', 'launcher', 'aim', 'point', 'up'].includes(w)));

const onlyFiller = (text: string, filler: ReadonlySet<string> = FILLER) => text.split(/\s+/).filter(Boolean).every((w) => filler.has(w));

function without(text: string, rx: RegExp): string | null {
  const m = rx.exec(text);
  return m ? `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}` : null;
}

const RESET = /\b(?:start (?:it |this |that |this one |that one |the challenge |this challenge )?(?:over|again|afresh)|reset(?: it| the range| the challenge| this| everything)?|restart(?: it| this| that| the challenge| this challenge| this one)?|clear (?:the |my )?(?:trails|board|scoreboard|range|shots|history)|wipe (?:it|the board|the trails|the slate)(?: clean)?|from scratch|fresh start|clean slate)\b/;
const NEXT = /\b(?:next(?: one| challenge)?|another challenge|(?:a )?(?:new|different) challenge|a different one|move on|something (?:else|different))\b/;

/** What each challenge is called out loud, most specific first (the Moon has a zone too; the headwind has a wall). */
const ALIASES: [string, RegExp][] = [
  ['moonshot', /\b(?:moon ?shot|on the moon|(?:the )?moon|lunar(?: one| gravity)?)\b/],
  ['headwind', /\b(?:into the (?:head ?)?wind|head ?wind|(?:the )?wind(?:y)?)\b/],
  ['ceiling', /\b(?:under the roof|(?:the )?roof|(?:the )?ceiling)\b/],
  ['maxrange', /\b(?:furthest on a capped launcher|max(?:imum)? ?range|(?:the )?capped(?: launcher)?|(?:the )?(?:furthest|farthest|longest) (?:one|challenge))\b/],
  ['zone30', /\b(?:land(?:ing)? in the zone|(?:the )?(?:landing )?zone)\b/],
  ['wall40', /\b(?:clear the wall|(?:the )?wall|first challenge)\b/],
];

export interface JudgeContext { aim: Aim; limits: Limits; challengeId: string }

/**
 * The action a line asks for, or null when it is not one (a question, small
 * talk, a request for the challenge already up). Run on the aim tool's words
 * and, through `mustDo`, on everything the student says or types.
 */
export function commandIn(text: string, ctx: JudgeContext): Command | null {
  if (isFireRequest(text)) return { kind: 'fire' };
  const said = normalize(text);
  // "Coach, fire!" too; but not "no, fire" or "wait, fire".
  if (isFireRequest(said.replace(FIRE_NOISE, ''))) return { kind: 'fire' };
  const t = said.replace(LEADING_NOISE, '');
  if (!t || isQuestion(t)) return null;

  const reset = without(t, RESET);
  if (reset !== null && onlyFiller(reset, COMMAND_FILLER)) return { kind: 'reset' };
  const next = without(t, NEXT);
  if (next !== null && onlyFiller(next, COMMAND_FILLER)) return { kind: 'next' };
  for (const [id, rx] of ALIASES) {
    const rest = without(t, rx);
    if (rest === null) continue;
    // Naming the challenge already up is talk, not a request to wipe its scoreboard.
    if (onlyFiller(rest, COMMAND_FILLER)) return id === ctx.challengeId ? null : { kind: 'challenge', id };
    break;
  }
  return aimIn(t, ctx);
}

// ---------------------------------------------------------------------------
// Aims: absolute ("forty degrees", "twenty-five at thirty") and relative ("a bit steeper")
// ---------------------------------------------------------------------------

/** Steps for a relative request: "a bit", plain, "a lot". */
export const STEPS = { angle: [3, 5, 10], speed: [1, 2, 5] } as const;

const N = String.raw`(\d+(?:\.\d+)?)`;
const SMALL_STEP = /\b(?:a (?:little|tiny|teeny|wee) bit|a little|a bit|a tad|a touch|a smidge|a hair|a notch|slightly|marginally|fractionally|little|bit|notch)\b/;
const BIG_STEP = /\b(?:a whole lot|a lot|lots|loads|much|way|far|a ton|heaps|massively|significantly|seriously)\b/;

type Dim = 'angle' | 'speed';
const UP_WORDS = /^(?:more|up|higher|steeper|raise|raise it|add|plus|extra|faster|harder)$/;
const SPEED_WORDS = /^(?:faster|slower|harder|softer)$/;

// Explicit steps: "5 deg steeper", "2 ms faster", "5 more", "up 10", "steeper by 5", "add 3 deg".
const DELTA_AFTER = new RegExp(String.raw`\b(?:by )?${N} (?:(deg|ms) )?(more|less|fewer|extra|higher|lower|steeper|flatter|up|down|faster|slower|harder|softer)(?: (deg|ms))?\b`);
const DELTA_BEFORE = new RegExp(String.raw`\b(up|down|steeper|flatter|higher|lower|faster|slower|harder|softer|raise it|drop it|lower it|add|plus|minus|take off|knock off|subtract)(?: it)?(?: by| another| an extra)? ${N}(?: (deg|ms))?\b`);

const SPEED_MAX_RX = /\b(?:full|max(?:imum)?|top) (?:power|speed|whack|throttle)\b|\bas (?:hard|fast) as (?:it|you|i) can\b|\bflat out\b/;
const SPEED_MIN_RX = /\b(?:min(?:imum)?|lowest|slowest) (?:power|speed)\b/;
const STRAIGHT_UP = /\bstraight up\b|\bvertical(?:ly)?\b/;

const SPEED_NOUN = '(?:speed|power|oomph|umph|juice|punch|velocity|force|welly|gas|pace|muscle)';
const ANGLE_NOUN = '(?:angle|loft|arc|elevation)';
const SPEED_UP = new RegExp(String.raw`\b(?:(?:more|higher|bigger|greater|extra|increase|raise|up)(?: the)? ${SPEED_NOUN}|faster|harder|stronger|quicker|(?:speed|power) (?:it )?up|crank it(?: up)?|put more (?:into|behind|on) it)\b`);
const SPEED_DOWN = new RegExp(String.raw`\b(?:(?:less|lower|smaller|reduce|decrease|drop|cut)(?: the)? ${SPEED_NOUN}|slower|softer|gentler|weaker|lighter|easier|(?:slow|calm|ease) (?:it )?(?:down|off)|back off|not so (?:hard|fast)|less hard)\b`);
// Longest first: an alternation takes the first branch that matches, and a
// bare "lower" would leave "the angle" of "lower the angle" behind.
const ANGLE_UP = new RegExp(String.raw`\b(?:(?:more|higher|bigger|greater|increase|raise)(?: the)? ${ANGLE_NOUN}|(?:raise|lift|tilt|angle|point|bring|move|nudge|bump|push) (?:it |the angle |the launcher |the arrow )?(?:up|higher)|(?:lob|loft|raise|lift) it|steeper|higher|loftier|up)\b`);
const ANGLE_DOWN = new RegExp(String.raw`\b(?:(?:less|lower|smaller|reduce|decrease|drop)(?: the)? ${ANGLE_NOUN}|(?:less|not so|not as) steep|(?:drop|lower|tilt|angle|point|bring|move|nudge|bump) (?:it |the angle |the launcher |the arrow )?(?:down|lower)|flatten(?: it)?(?: out)?|drop it|flatter|lower|shallower|down)\b`);

const ANGLE_ABS = [
  new RegExp(String.raw`\b${N} deg\b`),
  new RegExp(String.raw`\b(?:angle|elevation)(?: of| to| at| is)? ${N}\b`),
  new RegExp(String.raw`\b${N} (?:for the )?(?:angle|elevation)\b`),
];
const SPEED_ABS = [
  new RegExp(String.raw`\b${N} ms\b`),
  new RegExp(String.raw`\b(?:speed|power|velocity)(?: of| to| at| is)? ${N}\b`),
  new RegExp(String.raw`\b${N} (?:for the )?(?:speed|velocity)\b`),
];

interface ClauseAim { angle?: number; speed?: number }

function clauseAim(clause: string, base: Aim, limits: Limits): ClauseAim | null {
  let s = ` ${clause} `;
  const found: ClauseAim = {};
  const take = (rx: RegExp): RegExpExecArray | null => {
    const m = rx.exec(s);
    if (m) s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
    return m;
  };
  const set = (dim: Dim, value: number) => { if (found[dim] === undefined) found[dim] = pyRound(value, 1); };

  // How big a relative step: "a bit", plain, "a lot".
  const step = take(SMALL_STEP) ? 0 : take(BIG_STEP) ? 2 : 1;

  for (let m = take(DELTA_AFTER); m; m = take(DELTA_AFTER)) {
    const [, n, unitBefore, word, unitAfter] = m;
    const dim: Dim = (unitBefore ?? unitAfter) === 'ms' || ((unitBefore ?? unitAfter) === undefined && SPEED_WORDS.test(word)) ? 'speed' : 'angle';
    const sign = UP_WORDS.test(word) ? 1 : -1;
    set(dim, (dim === 'angle' ? base.angle_deg : base.speed_ms) + sign * Number(n));
  }
  for (let m = take(DELTA_BEFORE); m; m = take(DELTA_BEFORE)) {
    const [, word, n, unit] = m;
    const dim: Dim = unit === 'ms' || (unit === undefined && SPEED_WORDS.test(word)) ? 'speed' : 'angle';
    const sign = UP_WORDS.test(word) ? 1 : -1;
    set(dim, (dim === 'angle' ? base.angle_deg : base.speed_ms) + sign * Number(n));
  }

  if (take(SPEED_MAX_RX)) set('speed', limits.speed[1]);
  if (take(SPEED_MIN_RX)) set('speed', limits.speed[0]);
  if (take(STRAIGHT_UP)) set('angle', 90);   // past the rail: refused with the numbers, which is the lesson

  if (take(SPEED_UP)) set('speed', base.speed_ms + STEPS.speed[step]);
  if (take(SPEED_DOWN)) set('speed', base.speed_ms - STEPS.speed[step]);

  for (const rx of SPEED_ABS) { const m = take(rx); if (m) set('speed', Number(m[1])); }
  for (const rx of ANGLE_ABS) { const m = take(rx); if (m) set('angle', Number(m[1])); }

  // Relative angle words come after the absolute ones so that "up" in
  // "speed it up" or "40 deg" has already been taken by what it belongs to.
  if (take(ANGLE_UP)) set('angle', base.angle_deg + STEPS.angle[step]);
  if (take(ANGLE_DOWN)) set('angle', base.angle_deg - STEPS.angle[step]);

  // Unitless numbers: "25 at 30", "40 deg at 20", "at 20", or one bare number (an angle).
  const pair = take(new RegExp(String.raw`\b${N} at ${N}\b`));
  if (pair && found.angle === undefined && found.speed === undefined) { set('angle', Number(pair[1])); set('speed', Number(pair[2])); }
  else if (pair) return null;
  // "40 deg at 20": "at" names the speed once the angle is known ("aim at 40" is an angle).
  if (found.angle !== undefined && found.speed === undefined) {
    const atSpeed = take(new RegExp(String.raw`\bat ${N}\b`));
    if (atSpeed) set('speed', Number(atSpeed[1]));
  }
  const bare = [...s.matchAll(new RegExp(String.raw`\b${N}\b`, 'g'))];
  if (bare.length > 1) return null;
  if (bare.length === 1) {
    if (found.angle !== undefined) return null;
    take(new RegExp(String.raw`\b${N}\b`));
    set('angle', Number(bare[0][1]));
  }
  if (!onlyFiller(s)) return null;
  return found;
}

/** "Fire at forty degrees", "shoot it flatter": the verb first, then the aim it is for. */
const FIRE_LEAD = /^(?:fire|shoot|launch)(?: it)?\s+(?:at\s+|with\s+)?/;

function aimIn(said: string, ctx: JudgeContext): Command | null {
  const firstFire = FIRE_LEAD.test(said);
  const t = firstFire ? said.replace(FIRE_LEAD, '') : said;
  const clauses = t.split(/\s*,\s*|\s+(?:and then|and|then|but|plus)\s+/)
    .map((c) => c.replace(/^(?:(?:and|then|but|plus|so)\s+)+/, '').trim()).filter(Boolean);
  let angle: number | undefined;
  let speed: number | undefined;
  let thenFire = firstFire;
  for (const [i, clause] of clauses.entries()) {
    // "forty degrees and fire": a whole fire phrase as the LAST clause, after an aim.
    if (i === clauses.length - 1 && i > 0 && isFireRequest(clause)) { thenFire = true; break; }
    if (onlyFiller(clause)) continue;
    const base = { angle_deg: angle ?? ctx.aim.angle_deg, speed_ms: speed ?? ctx.aim.speed_ms };
    const found = clauseAim(clause, base, ctx.limits);
    if (!found) return null;
    if (found.angle !== undefined) angle = found.angle;
    if (found.speed !== undefined) speed = found.speed;
  }
  if (angle === undefined && speed === undefined) return null;
  return { kind: 'aim', ...(angle !== undefined && { angle_deg: angle }), ...(speed !== undefined && { speed_ms: speed }), ...(thenFire && { thenFire }) };
}

/** What a command does to the range, in order (a refused step stops the rest). */
export function intentsFor(command: Command): Intent[] {
  switch (command.kind) {
    case 'fire': return [{ kind: 'fire' }];
    case 'aim': return [{ kind: 'set_aim', angle_deg: command.angle_deg ?? null, speed_ms: command.speed_ms ?? null }, ...(command.thenFire ? [{ kind: 'fire' } as const] : [])];
    case 'challenge': return [{ kind: 'start_challenge', id: command.id }];
    case 'next': return [{ kind: 'next_challenge' }];
    case 'reset': return [{ kind: 'reset' }];
  }
}

// ---------------------------------------------------------------------------
// The model fallback, for the aim tool's words (server.ts runs it; it is validated here)
// ---------------------------------------------------------------------------

const AIM_ISH = /\b(?:\d|deg|ms\b|angle|elevation|speed|power|oomph|umph|juice|punch|velocity|steep|flat|high|low|loft|lob|arc|hard|soft|fast|slow|gentl|strong|weak|aim|wind|headwind|tailwind|gravity|planet|space|moon|lunar|roof|ceiling|wall|zone|challenge|furthest|farthest|cap|up\b|down\b|more\b|less\b|bit\b|touch|notch|tad\b|nudge|bump|oomph|welly)/;

/** Whether a line the rules could not read is worth the model's time: short, not a question, and about aiming or a challenge. */
export function worthAsking(text: string): boolean {
  const t = normalize(text).replace(LEADING_NOISE, '');
  if (!t || isQuestion(t) || isFireRequest(text)) return false;
  return t.split(' ').length <= 14 && AIM_ISH.test(t);
}

export const INTERPRET_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['aim', 'challenge', 'none'], description: 'What the student asks the range to do.' },
    angle_deg: { type: 'number', nullable: true, description: 'For "aim": the new launch angle in degrees, only if they changed it; otherwise null.' },
    speed_ms: { type: 'number', nullable: true, description: 'For "aim": the new launch speed in metres a second, only if they changed it; otherwise null.' },
    challenge_id: { type: 'string', nullable: true, description: 'For "challenge": the id of the challenge they asked for; otherwise null.' },
  },
  required: ['action'],
};

export function interpretPrompt(utterance: string, ctx: JudgeContext): string {
  const list = CHALLENGES.map((c) => `${c.id} ("${c.name}": ${c.blurb})`).join('; ');
  return `A student at a projectile-motion practice range said: "${utterance}"
Speech recognition may have misheard words. The launcher is aimed at ${ctx.aim.angle_deg} degrees and ${ctx.aim.speed_ms} metres a second. The challenge on the range is ${ctx.challengeId}. The challenges are: ${list}.
Decide what they are asking the range to do:
- "aim": point the launcher differently. Give the new angle and/or speed as absolute numbers and null for whatever they did not change. For a relative request, step from the current aim: "a bit" is about ${STEPS.angle[0]} degrees or ${STEPS.speed[0]} metre a second, a plain "steeper" or "more speed" about ${STEPS.angle[1]} degrees or ${STEPS.speed[1]} metres a second, "a lot" about ${STEPS.angle[2]} degrees or ${STEPS.speed[2]} metres a second. A shot described by its shape is an aim too: a lob, "like a mortar" or "sky-high" is steep (about 70 degrees); a line drive, "flat" or "like a laser" is low (about 20 degrees); "give it some welly" or "like a rocket" is more speed. Use the exact number they said; never change it to fit a limit.
- "challenge": put up a different challenge: its id.
- "none": anything else: a question, asking for advice ("should I go steeper?"), small talk, asking to fire, or asking for the challenge already on the range.`;
}

/** The model's answer as a command, or null when it is unusable or asks for nothing. Never trusted further than this. */
export function commandFromModel(raw: unknown, ctx: JudgeContext): Command | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? pyRound(v, 1) : undefined);
  if (r.action === 'aim') {
    const angle = finite(r.angle_deg);
    const speed = finite(r.speed_ms);
    if (angle === undefined && speed === undefined) return null;
    return { kind: 'aim', ...(angle !== undefined && { angle_deg: angle }), ...(speed !== undefined && { speed_ms: speed }) };
  }
  if (r.action === 'challenge') {
    const id = typeof r.challenge_id === 'string' ? r.challenge_id.trim().toLowerCase() : '';
    if (!CHALLENGES.some((c) => c.id === id) || id === ctx.challengeId) return null;
    return { kind: 'challenge', id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The safety net: what the page does when the host does not call the tool
// ---------------------------------------------------------------------------

/** The range as the judge needs it. */
export const contextOf = (s: { aim: Aim; limits: Limits; challenge: { id: string } }): JudgeContext => ({ aim: s.aim, limits: s.limits, challengeId: s.challenge.id });

/** The challenge after this one, wrapping (the launcher's "next"). */
export function nextChallengeId(id: string): string {
  const index = CHALLENGES.findIndex((c) => c.id === id);
  return CHALLENGES[(index + 1) % CHALLENGES.length].id;
}

export interface NetCall { name: 'fire' | 'start_over' | 'choose_challenge'; arguments: Record<string, unknown> }

/**
 * The tool call the student's words clearly ask for, among the actions safe to
 * do twice: a shot at the same aim (the physics is exact, so it lands in the
 * same place; a second one while the first flies is refused), a clean
 * scoreboard, a challenge by its id (the same id again changes nothing; "next"
 * is pinned to the one after the challenge up when the words were said).
 * Aims are left out: "a bit steeper" done twice would move twice.
 */
export function mustDo(text: string, ctx: JudgeContext): NetCall | null {
  const command = commandIn(text, ctx);
  switch (command?.kind) {
    case 'fire': return { name: 'fire', arguments: {} };
    case 'reset': return { name: 'start_over', arguments: {} };
    case 'challenge': return { name: 'choose_challenge', arguments: { challenge: command.id } };
    case 'next': return { name: 'choose_challenge', arguments: { challenge: nextChallengeId(ctx.challengeId) } };
    default: return null;
  }
}
