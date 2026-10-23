// What the user told the coach they have to work around.
//
// Ported from the original `constraints.py`. The plan prompt used to be,
// literally, "Build my {level} {goal} plan now". Everything else the user said
// ("I only have twenty minutes", "no equipment at all", "my left knee is bad")
// reached the model as conversation and the PLAN as nothing: the coach said
// "let's keep it to twenty minutes without lunges" while the board still read
// 25 min and listed lunges, the worst failure this kind of app has.
//
// So constraints are domain state. They are parsed out of whatever the user
// typed or said, go into the plan prompt, are enforced in CODE after the model
// answers (a model asked for 20 minutes returns 25 often enough to matter), and
// are drawn on the board so the user can see what was heard.
//
// Pure by design: no model, no I/O. Decided from strings, tested from strings.
import type { ConstraintsPayload, FitnessPlan } from './types.ts';

/**
 * Minutes below/above which a spoken number is not a workout length. "2
 * minutes" is a joke and "400 minutes" is a mis-transcription; both would draw
 * a duration chip the user never asked for.
 */
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 120;

const MINUTES_RE = /\b(?:only\s+|just\s+|about\s+|max(?:imum)?\s+|under\s+)?(\d{1,3})\s*(?:-|\s)?\s*(?:min|mins|minute|minutes)\b/i;
// New in this port: durations in words. A speech recogniser may write
// "twenty minutes", and the original only read digits, so a spoken time cap
// could miss silently.
const SPOKEN_MINUTES_RE = /\b(twenty[\s-]five|thirty[\s-]five|forty[\s-]five|five|ten|fifteen|twenty|thirty|forty|fifty|sixty|ninety)\s*(?:-|\s)?\s*(?:min|mins|minute|minutes)\b/i;
const NUMBER_WORDS: Record<string, number> = {
  five: 5, ten: 10, fifteen: 15, twenty: 20, 'twenty five': 25, thirty: 30, 'thirty five': 35,
  forty: 40, 'forty five': 45, fifty: 50, sixty: 60, ninety: 90,
};
const HALF_HOUR_RE = /\bhalf an hour\b/i;
const ONE_HOUR_RE = /\b(?:an|one|1)\s+hour\b/i;

const NO_EQUIPMENT_RE = /\b(?:no|without|don'?t have (?:any )?|haven'?t got (?:any )?)\s*(?:gym\s+)?(?:equipment|kit|weights|gear)\b|\bbody\s*weight only\b|\bonly body\s*weight\b|\bnothing (?:at home|to train with)\b/i;

/** Equipment the user says they DO have, kept as free text for the model. */
const HAVE_EQUIPMENT_RE = /\b(?:i (?:have|have got|ve got|own)|i'?ve got|just|only)\s+((?:a |an |some |two |a pair of )?(?:dumbbell|dumbbells|kettlebell|kettlebells|resistance band|bands?|barbell|pull[- ]?up bar|bench|mat|yoga mat|jump rope))\b/i;

/**
 * A body part the user says is hurt, and the movement words that part rules
 * out. Deliberately generous: coaching someone's bad knee through lunges is a
 * much worse error than dropping a squat they could have done.
 */
export const INJURY_BANS: Record<string, readonly string[]> = {
  knee: ['lunge', 'squat', 'jump', 'jumping', 'burpee', 'run', 'running', 'jog', 'jogging', 'step-up', 'step up', 'sprint', 'skater'],
  back: ['deadlift', 'good morning', 'sit-up', 'sit up', 'crunch', 'toe touch', 'superman', 'row', 'bent-over', 'bent over'],
  shoulder: ['push-up', 'push up', 'pushup', 'press', 'overhead', 'plank', 'dip', 'handstand', 'arm circle'],
  wrist: ['push-up', 'push up', 'pushup', 'plank', 'burpee', 'mountain climber', 'bear crawl', 'handstand'],
  ankle: ['jump', 'jumping', 'run', 'running', 'jog', 'jogging', 'calf raise', 'skater', 'sprint', 'burpee'],
  hip: ['lunge', 'squat', 'leg raise', 'high knee', 'hip thrust', 'sprint'],
  neck: ['sit-up', 'sit up', 'crunch', 'bridge', 'handstand', 'neck'],
  elbow: ['push-up', 'push up', 'pushup', 'curl', 'dip', 'press', 'plank'],
};
const PARTS = Object.keys(INJURY_BANS).join('|');

const INJURY_RE = new RegExp(
  `\\b(?:bad|sore|dodgy|dodgey|bum|weak|injured|hurt|painful|recovering from a|recovering)\\s+(?:left\\s+|right\\s+|lower\\s+|upper\\s+)?(${PARTS})s?\\b`
  + `|\\b(?:my\\s+)?(?:left\\s+|right\\s+|lower\\s+|upper\\s+)?(${PARTS})s?\\s+(?:is|are|'s)?\\s*(?:bad|sore|hurts?|hurting|injured|acting up|playing up)\\b`
  + `|\\b(?:bad|sore|injured)\\s+(${PARTS})s?\\b`,
  'gi',
);

/**
 * Injuries people name by the tissue rather than the joint. "I've got a torn
 * ACL" matched NOTHING, `enforce` short-circuited, and someone who had just
 * said it was handed lunges and jump squats. Mapping them onto the body part
 * reuses the ban lists that already exist.
 */
const NAMED_INJURIES: [string, string][] = [
  ['acl', 'knee'], ['mcl', 'knee'], ['pcl', 'knee'], ['meniscus', 'knee'],
  ["runner's knee", 'knee'], ['runners knee', 'knee'], ['patella', 'knee'],
  ['rotator cuff', 'shoulder'], ['frozen shoulder', 'shoulder'],
  ['impingement', 'shoulder'], ['labrum', 'shoulder'],
  ['herniated', 'back'], ['herniation', 'back'], ['slipped disc', 'back'],
  ['bulging disc', 'back'], ['sciatica', 'back'], ['lumbar', 'back'],
  ['achilles', 'ankle'], ['plantar', 'ankle'], ['shin splint', 'ankle'],
  ['carpal tunnel', 'wrist'], ['tennis elbow', 'elbow'],
  ["golfer's elbow", 'elbow'], ['golfers elbow', 'elbow'],
];

/**
 * Conditions no exercise substitution makes safe. They do not ban a movement;
 * they change what the coach is entitled to do at all. Tested live on the
 * original: told "I'm 7 months pregnant", the app said "it's really important
 * to modify exercises for your safety" and returned the identical six moves,
 * deadlifts and lateral lunges included, and never suggested seeing anyone.
 */

/**
 * A broken, cracked, fractured or dislocated body part, read from what a
 * person said: one injury verb (or its noun), a body part that verb is said
 * of, in one of the shapes people use, and no hedge cancelling it. Composed
 * rather than listed: patched phrase by phrase, the patterns pulled against
 * each other ("cracked" dropped for "cracked my back" lost "I cracked a rib";
 * a near-miss hedge on one verb but not the others). A pause has no way back,
 * so a false hold costs the whole workout; a missed one coaches a fracture.
 */
const BONES = ['bones?', 'ribs?', 'skull', 'collarbones?', 'clavicles?', 'vertebrae?', 'pelvis', 'femur', 'tibia', 'fibula', 'kneecaps?', 'patella', 'shins?', 'heels?', 'cheekbones?', 'sternum', 'nose'];
const LIMBS = ['wrists?', 'ankles?', 'arms?', 'legs?', 'foot', 'feet', 'hands?', 'toes?', 'fingers?', 'thumbs?', 'elbows?', 'hips?', 'knees?', 'shoulders?', 'jaw'];
const JOINTS = ['shoulders?', 'hips?', 'knees?', 'kneecaps?', 'patella', 'elbows?', 'fingers?', 'thumbs?', 'wrists?', 'ankles?', 'jaw', 'toes?'];

interface InjuryVerb {
  /** The past and participle forms ("broke|broken"): never the present, so "break a leg" and "I crack my knuckles" are not reports. */
  forms: string;
  /** The noun ("a wrist fracture", "a break in my arm"). */
  noun: string;
  /** Whether the noun holds with no body part ("two fractures"; not "a break", a rest). */
  nounAlone: boolean;
  /** The parts this verb is an injury of. "Broke my back/neck" and "cracked my back/neck/knee/knuckles" are idioms and stretches, so not here. */
  parts: string[];
  label: 'a fracture' | 'a dislocation';
}
const INJURY_VERBS: InjuryVerb[] = [
  { forms: 'broke|broken', noun: 'breaks?', nounAlone: false, parts: [...BONES, ...LIMBS], label: 'a fracture' },
  { forms: 'fractured|fracturing', noun: 'fractures?', nounAlone: true, parts: [...BONES, ...LIMBS, 'back', 'neck', 'spine'], label: 'a fracture' },
  { forms: 'cracked', noun: 'cracks?', nounAlone: false, parts: [...BONES, 'wrists?', 'ankles?'], label: 'a fracture' },
  { forms: 'dislocated|dislocating', noun: 'dislocations?', nounAlone: true, parts: JOINTS, label: 'a dislocation' },
];

const WHOSE = '(?:(?:my|a|an|her|his|their|the|both|one of my|two|three|a couple of|several|some)\\s+)?';
const SIDE = '(?:(?:left|right|lower|upper)\\s+)?';
const IS = "(?:is|was|are|were|got|gets|has been|have been|had been|'s|ended up)";
/** The shapes, for one verb: each a pattern whose match is the report. */
function injuryShapes(v: InjuryVerb): RegExp[] {
  const part = `${SIDE}(?:${v.parts.join('|')})`;
  const shapes = [
    // "I broke my wrist", "a broken wrist", "cracked two ribs", "dislocated my shoulder"
    `\\b(?:${v.forms})\\s+${WHOSE}${part}\\b`,
    // "my shoulder is dislocated", "my wrist got broken", "my left ankle was fractured"
    `\\b(?:my|her|his|their|the|both)\\s+${part}\\s+${IS}\\s+(?:(?:badly|completely|totally|clean)\\s+)?(?:${v.forms})\\b`,
    // "a wrist fracture", "a knee dislocation", "a rib crack"
    `\\b${part}\\s+(?:${v.noun})\\b`,
    // "a break in my arm", "a fracture of the wrist"
    `\\b(?:${v.noun})\\s+(?:in|of|to)\\s+${WHOSE}${part}\\b`,
  ];
  // "two fractures", "a stress fracture", "a dislocation last year"
  if (v.nounAlone) shapes.push(`\\b(?:${v.noun})\\b`);
  return shapes.map((shape) => new RegExp(shape, 'g'));
}
const INJURY_SHAPES = INJURY_VERBS.map((v) => ({ label: v.label, shapes: injuryShapes(v) }));

/** Negations of the verb that follows: a near miss or a denial ("I nearly broke", "never had a fracture", "didn't fracture"). */
const HEDGE = /^(?:nearly|almost|never|not|without|hardly|barely)$|n't$/;
/** Auxiliaries that may sit between such a negation and its verb ("never had a", "haven't ever"). Never the subject. */
const LEAD_IN = new Set(['have', 'had', 'has', 'ever', 'been', 'got', 'gotten', 'a', 'an', 'any', 'even']);

/**
 * Whether the report at `at` is negated: walking back from it within its
 * clause, over that verb's own auxiliaries only, a negation comes first ("I
 * nearly broke…", "I've never had a fracture", "I didn't fracture…"); or "no"
 * as the determiner of the injury itself ("no fractures", "no broken
 * bones"). The subject or any other word ends the walk, and "no" before a
 * possessive or an article is an interjection, so these are reports: "No, I
 * have broken my wrist", "oh no I broke my ankle", "no my wrist is broken".
 * For a safety rule, when unsure, hold.
 */
function hedgedAt(low: string, at: number, match: string): boolean {
  const clause = low.slice(Math.max(0, at - 80), at).split(/[,.;!?]|\b(?:and|but|so|because|though)\b/).pop() ?? '';
  const words = clause.trim().split(/\s+/).filter(Boolean).reverse();
  if (words[0] === 'no') return !/^(?:my|our|your|his|her|their|the|both|a|an)\b/.test(match);
  for (const word of words) {
    if (HEDGE.test(word)) return true;
    if (!LEAD_IN.has(word)) return false;
  }
  return false;
}

/** The injuries a line reports, in the labels the stop sentence says. */
export function injuriesIn(low: string): string[] {
  const found: string[] = [];
  for (const { label, shapes } of INJURY_SHAPES) {
    if (found.includes(label)) continue;
    for (const shape of shapes) {
      shape.lastIndex = 0;
      let match: RegExpExecArray | null;
      let reported = false;
      while ((match = shape.exec(low))) {
        if (!hedgedAt(low, match.index, match[0])) { reported = true; break; }
      }
      if (reported) { found.push(label); break; }
    }
  }
  return found;
}

/**
 * Each condition as people report it: a verb as well as a noun, any tense, a
 * plural. Literal phrases with an optional "s" missed "I broke my wrist", "I
 * fractured my ankle", "two surgeries" and "dizziness", and the workout went
 * on. Each pattern is still anchored to what only a person describing a
 * condition says (see the notes below on what must NOT match).
 */
const CLEARANCE_PATTERNS: [RegExp, string][] = [
  [/\bpregnan(?:t|cy|cies)\b/, 'pregnancy'],
  [/\bexpecting a baby\b/, 'pregnancy'],
  [/\bpost[\s-]?partum\b/, 'recent childbirth'],
  [/\b(?:just|recently) (?:had|gave birth to) (?:a|my|our) (?:baby|son|daughter|child)\b|\b(?:gave|given) birth\b/, 'recent childbirth'],
  [/\bchest pains?\b/, 'chest pain'],
  [/\bheart (?:condition|problem|disease|failure)s?\b/, 'a heart condition'],
  [/\bheart attacks?\b|\bcardiac\b|\bangina\b/, 'a cardiac history'],
  [/\bhigh blood pressure\b|\bhypertension\b/, 'high blood pressure'],
  [/\bconcuss(?:ion|ions|ed)\b/, 'a recent concussion'],
  [/\bsurger(?:y|ies)\b/, 'recent surgery'],
  // NOT a bare "operation": "cooperation" contains it, and so does "my
  // operation at work". (Breaks, cracks, fractures and dislocations are read
  // by injuriesIn: a bare "broken" is a treadmill.) A match freezes the whole
  // session with no un-halt path, so a false positive costs the user their
  // entire workout.
  [/\b(?:had|having|have had|getting|got) (?:an? )?operations?\b|\boperated on\b/, 'recent surgery'],
  // Not "a dizzying number of reps".
  [/\bdizz(?:y|iness)\b/, 'dizziness'],
  // The past tense, because that is how anyone reports it: "I fainted at the
  // gym last week" matched nothing and the person was handed a workout. Not a
  // bare "passed out" (what a gym does with flyers) and not "faint" (a smell, a noise).
  [/\b(?:fainted|fainting|faints|fainting spells?|passing out)\b/, 'fainting'],
];

/**
 * "no lunges", "avoid jumping": a move the user banned outright. Greedy to a
 * word boundary, with the plural handled AFTER the match (the old `(?:s\b|\b)`
 * ate the "s" of "press"), and tempered so the capture stops at a clause
 * boundary: plain greedy ate "no equipment and no lunges" whole and dropped
 * the lunge ban.
 */
const AVOID_MOVE_RE = /\b(?:no|avoid|skip|without|leave out|can'?t do|cannot do|don'?t want|nothing with)\s+(?:any\s+|the\s+)?([a-z](?:(?!\s+(?:and|or|but|no|avoid|skip|without)\b)[a-z -]){2,24})/gi;

/** Things the avoid pattern captures that are not movements ("no equipment" is not an exercise). */
const NOT_A_MOVE = new Set([
  'equipment', 'kit', 'weight', 'weights', 'gear', 'gym', 'time',
  'idea', 'problem', 'worry', 'rush', 'excuse', 'clue', 'thanks',
  'music', 'space', 'room', 'money', 'one', 'thing', 'stuff',
  'pressure', 'pain', 'injury', 'injuries', 'issue', 'issues',
]);

/**
 * Movement words that mean the same thing to a plan step and to a person.
 * Only these are accepted from the avoid pattern: a free-text ban would filter
 * plan steps on any noun the user happened to negate.
 */
export const KNOWN_MOVES = new Set([
  'lunge', 'squat', 'jump', 'jumping', 'burpee', 'push-up', 'push up',
  'pushup', 'plank', 'crunch', 'sit-up', 'sit up', 'deadlift', 'press',
  'run', 'running', 'jog', 'jogging', 'dip', 'row', 'curl', 'bridge',
  'mountain climber', 'jumping jack', 'high knee', 'sprint',
  'step-up', 'step up', 'kettlebell', 'dumbbell', 'overhead',
  'floor work', 'floor', 'impact',
]);

/** Anything needing kit, for the "no equipment" ban. */
export const EQUIPMENT_WORDS = [
  'dumbbell', 'kettlebell', 'barbell', 'goblet', 'band', 'machine',
  'cable', 'bench', 'medicine ball', 'slam ball', 'trx', 'pull-up bar',
  'pull up bar', 'weighted', 'with weights', 'plate', 'rope',
];

/** The shape of "yes, but". Every field is optional and independently set. */
export interface Constraints {
  /** A hard cap in minutes, or null when never given. */
  readonly minutes: number | null;
  /** 'none' when they have nothing, free text when they named what they have, '' when never said. */
  readonly equipment: string;
  /** Movement words to keep out of the plan. */
  readonly avoid: readonly string[];
  /** The body parts behind `avoid`, so the board says "working around: knee" rather than twelve verbs. */
  readonly injuries: readonly string[];
  /**
   * Conditions this app is not qualified to program around. Not a movement
   * ban: no set of substitutions makes a workout safe for these, so the only
   * honest response is to say so and defer to a professional.
   */
  readonly clearance: readonly string[];
}

export const EMPTY: Constraints = Object.freeze({ minutes: null, equipment: '', avoid: [], injuries: [], clearance: [] });

export const hasAny = (c: Constraints) =>
  Boolean(c.minutes || c.equipment || c.avoid.length || c.injuries.length || c.clearance.length);

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
export const sameConstraints = (a: Constraints, b: Constraints) =>
  a.minutes === b.minutes && a.equipment === b.equipment && sameList(a.avoid, b.avoid)
  && sameList(a.injuries, b.injuries) && sameList(a.clearance, b.clearance);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clampMinutes = (value: number) => (value >= MIN_MINUTES && value <= MAX_MINUTES ? value : null);

/**
 * Every constraint present in one utterance; EMPTY for text that carries none,
 * which is most text. Callers merge rather than replace, so a user who mentions
 * their knee ten turns after the duration keeps both.
 */
export function parseConstraints(text: string): Constraints {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return EMPTY;
  const low = raw.toLowerCase();

  let minutes: number | null = null;
  const digits = MINUTES_RE.exec(low);
  const words = digits ? null : SPOKEN_MINUTES_RE.exec(low);
  if (digits) minutes = clampMinutes(Number(digits[1]));
  else if (words) minutes = clampMinutes(NUMBER_WORDS[words[1].replace('-', ' ')] ?? 0);
  else if (HALF_HOUR_RE.test(low)) minutes = 30;
  else if (ONE_HOUR_RE.test(low)) minutes = 60;

  let equipment = '';
  if (NO_EQUIPMENT_RE.test(low)) equipment = 'none';
  else {
    const have = HAVE_EQUIPMENT_RE.exec(low);
    if (have) equipment = have[1].replace(/^(?:a |an |some |two |a pair of )/, '').trim();
  }

  const injuries: string[] = [];
  for (const match of low.matchAll(INJURY_RE)) {
    const part = match.slice(1).find(Boolean) ?? '';
    if (part && !injuries.includes(part)) injuries.push(part);
  }
  // Leading boundary only: a trailing one blocks "shin splints" and
  // "patellar", and a missed injury keeps running and jumping in the plan. The
  // leading \b is what keeps "acl" out of "obstacle", "miracle", "spectacle".
  for (const [phrase, part] of NAMED_INJURIES) {
    if (new RegExp(`\\b${escapeRe(phrase)}`).test(low) && !injuries.includes(part)) injuries.push(part);
  }

  const clearance: string[] = [];
  // Whole words, each pattern with its own forms: a bare substring made
  // "cooperation" a surgery and "a dizzying number of reps" a fainting risk.
  for (const [pattern, label] of CLEARANCE_PATTERNS) {
    if (pattern.test(low) && !clearance.includes(label)) clearance.push(label);
  }
  for (const label of injuriesIn(low)) if (!clearance.includes(label)) clearance.push(label);

  const avoid: string[] = [];
  for (const part of injuries) {
    // The body part itself is banned alongside its movements. Without this a
    // bad shoulder still allowed "Shoulder rolls" and a bad ankle "Ankle
    // circles": the safest-looking fallback warm-up was the one move
    // guaranteed to touch the injury.
    for (const word of [part, ...INJURY_BANS[part]]) if (!avoid.includes(word)) avoid.push(word);
  }

  for (const match of low.matchAll(AVOID_MOVE_RE)) {
    const phrase = match[1].trim();
    // Try the whole capture, then its head: "no jumping jacks" lands on
    // "jumping jack" and "no lunges today" on "lunge".
    for (const candidate of [phrase, phrase.split(' ')[0]].map((c) => c.trim())) {
      if (!candidate || NOT_A_MOVE.has(candidate)) continue;
      // The plural stripped at most ONE way at a time: `rstrip("s")` turned
      // "press" into "pre", and an explicit "no press" was dropped.
      const forms = [candidate];
      if (candidate.endsWith('es')) forms.push(candidate.slice(0, -2));
      if (candidate.endsWith('s')) forms.push(candidate.slice(0, -1));
      const form = forms.find((f) => KNOWN_MOVES.has(f));
      if (!form) continue;
      if (!avoid.includes(form)) avoid.push(form);
      break;
    }
  }

  return { minutes, equipment, avoid, injuries, clearance };
}

/**
 * Later wins per FIELD, and bans accumulate. Nothing here clears a constraint:
 * "actually my knee is fine" is rare, and silently un-banning a movement is the
 * more dangerous mistake. Clearance accumulates too: it was once missing from
 * this merge, so a turn whose only content was "I'm 7 months pregnant" merged
 * to a value EQUAL to the base and nothing was stored at all.
 */
export function mergeConstraints(base: Constraints, next: Constraints): Constraints {
  const add = (a: readonly string[], b: readonly string[]) => [...a, ...b.filter((x) => !a.includes(x))];
  return {
    minutes: next.minutes !== null ? next.minutes : base.minutes,
    equipment: next.equipment || base.equipment,
    avoid: add(base.avoid, next.avoid),
    injuries: add(base.injuries, next.injuries),
    clearance: add(base.clearance, next.clearance),
  };
}

/**
 * The sentence the original spoke, word for word, the first time a turn
 * disclosed a clearance condition. Through the Avatar API it can no longer be
 * spoken from code: it is sent to the avatar as the exact words to say, and
 * shown on the board as the source of truth.
 */
export const CLEARANCE_LINE_TEMPLATE =
  'I have to stop us there. You have told me about {conditions}, and I am not able to program a workout around that — '
  + 'there is no exercise swap that makes it safe for me to guess. Please check with your doctor or a qualified health '
  + 'professional first. Once they have cleared you, I would love to pick this up again.';

/** A list as one speakable phrase: "a, b and c". */
export function spokenConditions(labels: readonly string[]): string {
  const items = labels.map((l) => String(l).trim()).filter(Boolean);
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The fixed sentence for these conditions, or '' when there are none. */
export function clearanceLine(labels: readonly string[]): string {
  const conditions = spokenConditions(labels);
  return conditions ? CLEARANCE_LINE_TEMPLATE.replace('{conditions}', conditions) : '';
}

/**
 * What ONE turn added, phrased the way a coach would say it back ("your
 * knee", "20 minutes"), so an acknowledgement is about what the user just said
 * rather than a recital of everything heard. Clearance is absent on purpose:
 * it has its own sentence and hold, and an "I'm on it" beside it would read as
 * an adaptation the app has just refused to make.
 */
export function newConstraintLabels(before: Constraints, after: Constraints): string[] {
  const labels: string[] = [];
  for (const part of after.injuries) if (!before.injuries.includes(part)) labels.push(`your ${part}`);
  if (after.minutes && after.minutes !== before.minutes) labels.push(`${after.minutes} minutes`);
  if (after.equipment && after.equipment !== before.equipment) {
    labels.push(after.equipment === 'none' ? 'no equipment' : `only ${after.equipment}`);
  }
  for (const word of after.avoid) {
    if (before.avoid.includes(word)) continue;
    // An injury already names its own bans; listing them too turns one warm
    // sentence into a recital of the ban list.
    if (after.injuries.some((part) => word === part || INJURY_BANS[part].includes(word))) continue;
    labels.push(`no ${movesWord(word)}`);
  }
  return labels;
}

/** Words that are not counted moves: said as they are ("no impact", "no jumping"). */
const UNCOUNTED = new Set(['impact', 'floor', 'floor work', 'overhead', 'running', 'jumping', 'jogging']);

/**
 * A banned move as said back to the person: "no lunges", "no presses", "no
 * crunches", "no jumping". A bare "s" made "no presss" and "no jumpings", and
 * those are the words the host is given to say.
 */
export function movesWord(word: string): string {
  if (UNCOUNTED.has(word) || /ing$/.test(word)) return word;
  if (/(s|sh|ch|x|z)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

/**
 * The original's code-spoken acknowledgement, worded to read correctly before
 * or after the coach's own answer. Here it is the example the avatar is given.
 */
export const ACK_REBUILDING_TEMPLATE = "Noted on {labels} — I'm rebuilding the plan around it now.";
export const ACK_NOTED_TEMPLATE = "Noted on {labels} — I'll build the plan around it.";

export function acknowledgementLine(labels: readonly string[], rebuilding: boolean): string {
  const spoken = spokenConditions(labels);
  if (!spoken) return '';
  return (rebuilding ? ACK_REBUILDING_TEMPLATE : ACK_NOTED_TEMPLATE).replace('{labels}', spoken);
}

/** The sentence appended to the plan prompt; '' when there is nothing. */
export function constraintClause(c: Constraints): string {
  const parts: string[] = [];
  if (c.minutes) parts.push(`The whole session including warm-up must fit in ${c.minutes} minutes, so duration_minutes must be ${c.minutes} or less`);
  if (c.equipment === 'none') parts.push('They have NO equipment: bodyweight movements only');
  else if (c.equipment) parts.push(`The only equipment they have is ${c.equipment}`);
  if (c.injuries.length) parts.push(`They are working around a bad ${c.injuries.join(' and a bad ')}, so choose movements that do not load it`);
  if (c.avoid.length) parts.push(`Do not include any of: ${[...new Set(c.avoid)].sort().join(', ')}`);
  return parts.length ? `${parts.join('. ')}.` : '';
}

/** Every movement word a plan step may not contain. */
export function bannedWords(c: Constraints): string[] {
  const words = [...c.avoid];
  if (c.equipment === 'none') for (const w of EQUIPMENT_WORDS) if (!words.includes(w)) words.push(w);
  return words;
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z ]+/g, ' ');

/**
 * Whether a plan step survives the constraints. Substring matching on a
 * normalised step, not tokens: "Bodyweight lunges: 10 reps each leg" and
 * "Alternating reverse lunge" both have to fail a "lunge" ban.
 */
export function stepIsAllowed(step: string, c: Constraints): boolean {
  const text = letters(String(step ?? '')).replace(/\s+/g, ' ').trim();
  for (const word of bannedWords(c)) {
    const needle = letters(word).trim();
    if (needle && text.includes(needle)) return false;
  }
  return true;
}

/** Movements chosen to survive as many bans as possible, for a section the bans emptied. */
export const SAFE_WARMUP = ['Shoulder rolls, 30 seconds', 'Seated cat-cow, 8 slow reps', 'Ankle circles, 20 seconds each side'];
export const SAFE_WORKOUT = ['Wall sit, 20 seconds', 'Glute bridge, 12 reps', 'Dead bug, 8 reps each side', 'Standing march, 30 seconds'];

/**
 * Make the plan obey the constraints, in code. Returns a NEW plan: the
 * original once mutated its argument and returned the same object, so the
 * rebuild's fallback compared a plan with itself and never said what changed.
 *
 * A section emptied by the bans is refilled from the safe defaults that pass
 * the bans, and left EMPTY when none do: there is no `or SAFE[:1]` last resort,
 * because the one move it forced back in was a banned one. An empty section
 * admits it has nothing safe to offer; a wrong one hurts somebody.
 */
export function enforce(plan: FitnessPlan, c: Constraints): FitnessPlan {
  if (!hasAny(c)) return plan;
  const duration = c.minutes && plan.duration_minutes > c.minutes ? c.minutes : plan.duration_minutes;
  let warmup = plan.warmup_steps.filter((s) => stepIsAllowed(s, c));
  let workout = plan.workout_steps.filter((s) => stepIsAllowed(s, c));
  if (!warmup.length) warmup = SAFE_WARMUP.filter((s) => stepIsAllowed(s, c));
  if (!workout.length) workout = SAFE_WORKOUT.filter((s) => stepIsAllowed(s, c));
  return { ...plan, duration_minutes: duration, warmup_steps: warmup, workout_steps: workout, coaching_cues: [...plan.coaching_cues] };
}

/** The wire body. Absent fields are omitted so the board can tell "not said" from "said and empty". */
export function payload(c: Constraints): ConstraintsPayload {
  const body: ConstraintsPayload = {};
  if (c.minutes) body.minutes = c.minutes;
  if (c.equipment) body.equipment = c.equipment;
  if (c.injuries.length) body.injuries = [...c.injuries];
  if (c.avoid.length) body.avoid = [...c.avoid];
  // On the wire so the board can say WHY it stopped, and deliberately not an
  // injury: an injury chip reads "built around", and nothing was built around.
  if (c.clearance.length) body.clearance = [...c.clearance];
  return body;
}

/** One short line for the avatar's state, so it speaks the limits the board shows. */
export function summaryLine(c: Constraints): string {
  const bits: string[] = [];
  if (c.minutes) bits.push(`${c.minutes} min cap`);
  if (c.equipment === 'none') bits.push('no equipment');
  else if (c.equipment) bits.push(`only ${c.equipment}`);
  if (c.injuries.length) bits.push(`working around ${c.injuries.join(', ')}`);
  if (c.clearance.length) {
    // A FACT, not an instruction: a note telling the model to "say plainly
    // that you cannot program around it" was ignored live ("please name a
    // warm-up move"). The words to say are sent separately; this line only
    // stops the avatar contradicting them.
    bits.unshift(
      `SESSION ON HOLD — they have disclosed ${spokenConditions(c.clearance)}; they have been told that you cannot program `
      + 'around it and that they must be cleared by a professional. The plan is frozen and is NOT adapted for this',
    );
  }
  return bits.join(' · ');
}
