// What a typed or spoken line means to the drill: rules only, no model.
//
// The original's model decided this by choosing a tool (answer_step,
// reveal_step, advance_step, choose_scenario, leave_scenario,
// resume_practice). The Avatar API has no function calling, so the app reads
// the learner's words itself. Grading stays where it always was (tutor.ts,
// substring matching); what is decided here is only WHICH action a line is.
//
// The emergency watch is not here: drill.ts runs it on every line before this
// is consulted, and the page runs it again before anything is sent.
//
// Runs on the server (it reads the scenario names in scenarios.ts).
import { DEFAULT_SCENARIO_ID, find, SCENARIOS } from './scenarios.ts';
import { clearsEmergency } from './safety.ts';
import type { Intent, Phase } from './types.ts';

/** Lower-cased, accents and punctuation gone, curly apostrophes straightened, single-spaced. */
export function clean(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/(^| )'+|'+( |$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (phrases: readonly string[]) => [...phrases].sort((a, b) => b.length - a.length).map(escape).join('|');

/** Words that carry no meaning of their own around a request ("um, okay, show me please"). */
const FILLERS = ['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'hmmm', 'hm', 'mm', 'ok', 'okay', 'so', 'well', 'sorry', 'honestly', 'oh', 'ah', 'please', 'then', 'i guess', 'i think', 'just', 'actually', 'yeah', 'no', 'right', 'alright', 'all right', 'really'];

/** A line made only of these phrases (at least one) and fillers. */
function wholly(phrases: readonly string[]) {
  const re = new RegExp(`^(?:(?:${alt(FILLERS)}) )*(?:${alt(phrases)})(?: (?:${alt([...phrases, ...FILLERS])}))*$`);
  return (t: string) => re.test(t);
}

/**
 * A turn that means "move me on", and nothing else. Matched whole, not by
 * substring: "next I would check the airway" is an answer, not a request to
 * advance, and skipping a rung in a CPR drill on a stray word is the one
 * mistake this app must not make.
 */
export const ADVANCE_PHRASES: readonly string[] = [
  'next', 'next step', 'next please', 'ok next', 'okay next', 'ready', "i'm ready", 'im ready',
  'go on', 'go ahead', 'carry on', 'move on', 'continue', "what's next", 'whats next',
  // Added in the port, where these are matched by rule rather than read by a model.
  'next one', 'next question', "let's move on", 'lets move on', "let's go on", 'lets go on', "let's continue", 'lets continue',
  'i am ready', 'ready for the next one', 'ready for the next step', 'on to the next one', 'next one please',
];

/** In coaching only, after "say next when you're ready": a bare yes means next. */
const AFFIRMATIVES = ['yes', 'yes please', 'yep', 'yup', 'sure', "let's go", 'lets go', "let's do it", 'lets do it', 'go', 'ready now'];

const advance = wholly(ADVANCE_PHRASES);
const advanceOrYes = wholly([...ADVANCE_PHRASES, ...AFFIRMATIVES]);

/** Whether a user turn is a bare request for the next step. */
export function isAdvanceRequest(text: string): boolean {
  const t = clean(text);
  return Boolean(t) && advance(t);
}

/** "Show me", "I don't know": the original's reveal_step ("they say they don't know, ask you to tell them, or ask what the right answer is"). */
const REVEAL = [
  'show me', 'can you show me', 'could you show me', 'show me the answer', 'show me the step', 'show me how', 'show the answer',
  'tell me', 'can you tell me', 'could you tell me', 'tell me the answer', "what's the answer", 'whats the answer', 'what is the answer', 'what is it',
  "i don't know", 'i dont know', 'i do not know', "don't know", 'dont know', 'no idea', 'i have no idea', "i've no idea", 'no clue', 'i have no clue',
  'not sure', "i'm not sure", 'im not sure', 'i give up', 'give up', "i'm stuck", 'im stuck', 'stuck', 'pass', 'i pass',
  'reveal', 'reveal it', 'reveal the answer', 'reveal the step', 'teach me', 'i forgot', "i can't remember", 'i cant remember',
  'what do i do', 'what should i do', 'what do i do now', 'what should i do now', 'what do i do first', 'what should i do first', 'what do you do',
];
const wantsShown = wholly(REVEAL);

/** Skipping is asking for `next` on an unanswered step, which the drill refuses on purpose. */
const SKIP = ['skip', 'skip it', 'skip this', 'skip this one', 'skip this step', 'skip the step', 'can we skip this', 'can we skip it', 'can i skip this', 'can i skip it', 'can we skip this one', 'can i skip this one'];
const skips = wholly(SKIP);

/** Talk, not an answer: it must not count as a wrong attempt (two of those and the step is shown). */
const ACKS = [
  'ok', 'okay', 'yes', 'yeah', 'yep', 'sure', 'right', 'alright', 'all right', 'got it', 'i see', 'thanks', 'thank you', 'cool', 'great',
  'good', 'nice', 'hello', 'hi', 'hey', 'wait', 'hold on', 'one sec', 'one second', 'just a sec', 'just a second', 'give me a second',
  'give me a sec', 'give me a moment', 'give me a minute', 'let me think', 'let me think about it', 'thinking', 'uh huh', 'mhm', 'pardon',
  'what', 'huh', 'interesting', 'wow', 'makes sense', 'that makes sense', 'understood', 'i understand', 'can you hear me', 'are you there',
  'sounds good', 'got you', 'gotcha', 'fine', 'hmm okay', 'oh okay',
];
const acknowledges = wholly(ACKS);
const ASKS_FOR_HINT = /\b(hint|hints|clue|clues)\b/;
const ASKS_TO_REPEAT = /\b(repeat|say (that|it) again|what was the question|what's the question|whats the question|come again|didn'?t (hear|catch) (that|you|it))\b/;
const WH_QUESTION = /^(what|what's|whats|why|how|how's|hows|when|where|who|which|whose|are you|do you|did you|is that|was that)\b/;
const ANSWER_SHAPED = /^(what about|how about|what if (i|we|you)|what i'?d|what i would|what i do|how i'?d|how i would)\b/;

/** In `answering`: something said to the instructor rather than an answer to the step. */
export function isTalk(text: string): boolean {
  const t = clean(text);
  if (t.length < 2) return true;
  if (acknowledges(t) || ASKS_FOR_HINT.test(t) || ASKS_TO_REPEAT.test(t)) return true;
  return WH_QUESTION.test(t) && !ANSWER_SHAPED.test(t);
}

// ---- leaving a scenario -------------------------------------------------------

const OUT_PATTERNS = [
  /\bback to (the )?(scenarios?|scenario (list|menu)|menu|main menu|start|beginning|list)\b/,
  /\b(different|another|other|new) scenarios?\b/,
  /\b(a )?different one\b/,
  /\b(change|switch) (the )?scenario\b/,
  /\b(pick|choose|try|do) (a |an )?(different|another|new|other) one\b/,
  /\b(this|it|that)('s| is)( way| a bit| a little| just| really)? too (hard|difficult)\b/,
  /\b(leave|quit|exit|stop|end) (this|the) (scenario|drill|one|exercise)\b/,
  /\b(the|scenario|main) menu\b/,
];
const OUT_WHOLE = new RegExp(
  `^(?:(?:${alt(FILLERS)}) )*(?:(?:can (?:we|i)|let's|lets|let us|i want to|i wanna|i'd like to|id like to|i need to) )?` +
  `(?:go back|get out|quit|stop|exit|leave|end this|cancel|start over|start again|restart)` +
  `(?: (?:please|now|this|this one|this scenario|the scenario|the drill|here))*$`,
);

/** The original's leave_scenario: "go back", "pick a different one", "this is too hard", "stop", "quit", "start over". */
export function wantsOut(text: string): boolean {
  const t = clean(text);
  return OUT_WHOLE.test(t) || OUT_PATTERNS.some((p) => p.test(t));
}

// ---- naming a scenario -----------------------------------------------------------

/** The menu's titles, as people refer to them ("the one where someone collapsed", "the pool one"). Condition first, as find() does. */
const TITLE_WORDS: [RegExp, string][] = [
  [/\b(dinner|table|restaurant|meal|food stuck)\b/, 'choking_adult'],
  [/\b(bus stop|bus|pavement|sidewalk|unresponsive but breathing|breathing but unresponsive)\b/, 'recovery_position'],
  [/\b(pool|poolside|drown|drowning|drowned|swimming)\b/, 'child_cardiac_arrest'],
  [/\b(collapse|collapsed|cafe|coffee shop)\b/, 'adult_cardiac_arrest'],
];
const ORDINALS: [RegExp, number][] = [
  [/\b(the )?(first|1st)( one)?\b|\b(number|option) (one|1)\b/, 0],
  [/\b(the )?(second|2nd)( one)?\b|\b(number|option) (two|2)\b/, 1],
  [/\b(the )?(third|3rd)( one)?\b|\b(number|option) (three|3)\b/, 2],
  [/\b(the )?(fourth|4th|last)( one)?\b|\b(number|option) (four|4)\b/, 3],
];
const LEAVES_IT_TO_YOU = /\b(surprise me|you (choose|pick|decide)|your (choice|pick)|any( one| of them)|whatever|(doesn'?t|does not) matter|(don'?t|do not) mind|random( one)?|up to you)\b/;
/** A question about a scenario is not a choice of it: "is the child one hard?" */
const ASKS_ABOUT = /^(is|are|was|were|what|what's|whats|which|how|why|who|does|tell me about|describe|explain)\b|^do (you|they|any|all|i need)\b/;

/** A scenario named anywhere in the line, at the menu: its id, or null. */
export function scenarioNamedIn(text: string): string | null {
  const t = clean(text);
  if (!t) return null;
  const found = find(t);
  if (found) return found.id;
  for (const [pattern, id] of TITLE_WORDS) if (pattern.test(t)) return id;
  for (const [pattern, index] of ORDINALS) if (pattern.test(t)) return SCENARIOS[index].id;
  if (LEAVES_IT_TO_YOU.test(t)) return DEFAULT_SCENARIO_ID;
  return null;
}

/**
 * Mid-scenario, a scenario's name is usually part of an answer ("start child
 * CPR", "use the adult pads", "let's do the heimlich"), so only a line that
 * frames it as a switch counts, and naming the scenario already running is
 * never a switch.
 */
const T = '(choking|choke|recovery position|recovery|child|kid|pediatric|paediatric|infant|pool|adult|cardiac arrest|collapse|cafe)';
const SWITCH_FRAMES = [
  new RegExp(`\\b(switch|change|go|move) (over )?to (the )?${T}\\b`),
  new RegExp(`\\b(let's|lets|let us|can we|could we|shall we|i want to|i wanna|i'd like to|id like to|i'd rather|id rather|i would rather|rather) (do|try|practise|practice|switch to|go to|move to|start) (the )?${T}\\b`),
  new RegExp(`\\b${T}( scenario| one)? instead\\b`),
  new RegExp(`\\b${T} scenario\\b`),
  new RegExp(`\\b(do|try|start|pick|choose) the ${T} one\\b`),
];
const TOKEN_TO_ID: [RegExp, string][] = [
  [/^(choking|choke)$/, 'choking_adult'],
  [/^recovery( position)?$/, 'recovery_position'],
  [/^(child|kid|pediatric|paediatric|infant|pool)$/, 'child_cardiac_arrest'],
  [/^(adult|cardiac arrest|collapse|cafe)$/, 'adult_cardiac_arrest'],
];

export function switchRequest(text: string, current: string | null): string | null {
  const t = clean(text);
  for (const frame of SWITCH_FRAMES) {
    const m = frame.exec(t);
    if (!m) continue;
    const token = m.slice(1).reverse().find((g) => g && TOKEN_TO_ID.some(([re]) => re.test(g)));
    const id = TOKEN_TO_ID.find(([re]) => token && re.test(token))?.[1] ?? null;
    if (id && id !== current) return id;
  }
  return null;
}

// ---- the whole judgement ---------------------------------------------------------

/**
 * The drill action a line asks for, or null when it is talk for the avatar.
 * Checked in this order: the way off the emergency card; a scenario named; the
 * way out of a scenario; moving on; being shown; talk; and, while a step is
 * live, an answer.
 */
export function interpret(text: string, phase: Phase, current: string | null = null): Intent | null {
  const t = clean(text);
  if (!t) return null;

  if (phase === 'emergency') return clearsEmergency(text) ? { kind: 'ack_safety' } : null;

  const choosing = phase === 'intro' || phase === 'debrief';
  const out = wantsOut(t);
  let named: string | null = null;
  if (choosing) named = ASKS_ABOUT.test(t) ? null : scenarioNamedIn(t);
  else named = switchRequest(t, current) ?? (out ? scenarioNamedIn(t) : null);
  if (named && !(named === current && !choosing)) return { kind: 'start_scenario', id: named };
  if (out) return { kind: 'leave_scenario' };

  if (phase === 'intro') return null;
  if ((phase === 'coaching' ? advanceOrYes(t) : advance(t)) || skips(t)) return { kind: 'next' };
  if (phase !== 'answering') return null;
  if (wantsShown(t)) return { kind: 'reveal' };
  if (isTalk(t)) return null;
  return { kind: 'answer', step_key: '', text };
}
