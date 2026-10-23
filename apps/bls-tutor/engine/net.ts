// The learner's words, read by rules, for the two jobs the page still does
// itself now that the host acts through tools:
//
// - the safety net (`mustDo`): when the learner clearly asks for an action
//   that is safe to do twice (show me, next, go back, pick a drill, false
//   alarm) and the host does not call the tool, the page does it;
// - the way off the emergency card (`clearedBy`): the host's resume_practice
//   is honoured only if the learner's own words since the card went up say
//   plainly that nobody is in danger.
//
// Answers are never matched here: grading belongs to the drill, and a second
// grade would use up one of the learner's two attempts.
//
// Page-safe: it imports no scenario content (the page must never ship a
// step's label). Scenario ids are plain strings; judge.ts resolves names on
// the server.
import { clearsEmergency, isRealEmergency } from './safety.ts';
import type { Action, Phase } from './types.ts';

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
 * advance. A bare "yes" is left to the host: it answers whatever was asked.
 */
export const ADVANCE_PHRASES: readonly string[] = [
  'next', 'next step', 'next please', 'ok next', 'okay next', 'ready', "i'm ready", 'im ready', 'i am ready',
  'go on', 'go ahead', 'carry on', 'move on', 'continue', "what's next", 'whats next',
  'next one', 'next question', "let's move on", 'lets move on', "let's go on", 'lets go on', "let's continue", 'lets continue',
  'ready for the next one', 'ready for the next step', 'on to the next one', 'next one please',
];
const advance = wholly(ADVANCE_PHRASES);

/** Whether a line is a bare request for the next step. */
export function isAdvanceRequest(text: string): boolean {
  const t = clean(text);
  return Boolean(t) && advance(t);
}

/**
 * "Show me", "I don't know": the learner asks to be taught the step. Kept to
 * plain requests; "what do I do?" is left to the host (it may want a hint).
 */
const REVEAL = [
  'show me', 'can you show me', 'could you show me', 'show me the answer', 'show me the step', 'show me how', 'show the answer',
  'tell me the answer', 'just tell me', "what's the answer", 'whats the answer', 'what is the answer',
  "i don't know", 'i dont know', 'i do not know', "don't know", 'dont know', 'no idea', 'i have no idea', "i've no idea", 'no clue', 'i have no clue',
  'i give up', 'give up', "i'm stuck", 'im stuck', 'pass', 'i pass',
  'reveal', 'reveal it', 'reveal the answer', 'reveal the step', 'teach me', 'i forgot', "i can't remember", 'i cant remember',
];
const shown = wholly(REVEAL);

/** Whether a line only asks to be shown the step. */
export function wantsShown(text: string): boolean {
  const t = clean(text);
  return Boolean(t) && shown(t);
}

// ---- leaving a scenario ----------------------------------------------------

const OUT_PATTERNS = [
  /\bback to (the )?(scenarios?|scenario (list|menu)|drills?|drill (list|menu)|menu|main menu|start|beginning|list)\b/,
  /\b(different|another|other|new) (scenarios?|drills?)\b/,
  /\b(a )?different one\b/,
  /\b(change|switch) (the )?(scenario|drill)\b/,
  /\b(pick|choose|try|do) (a |an )?(different|another|new|other) one\b/,
  /\b(this|it|that)('s| is)( way| a bit| a little| just| really)? too (hard|difficult)\b/,
  /\b(leave|quit|exit|stop|end) (this|the) (scenario|drill|one|exercise)\b/,
  /\b(the|scenario|drill|main) menu\b/,
];
const OUT_WHOLE = new RegExp(
  `^(?:(?:${alt(FILLERS)}) )*(?:(?:can (?:we|i)|let's|lets|let us|i want to|i wanna|i'd like to|id like to|i need to) )?` +
  `(?:go back|get out|quit|stop|exit|leave|end this|cancel|start over|start again|restart)` +
  `(?: (?:please|now|this|this one|this scenario|the scenario|this drill|the drill|here))*$`,
);

/** "Go back", "pick a different one", "this is too hard", "quit", "start over". */
export function wantsOut(text: string): boolean {
  const t = clean(text);
  return OUT_WHOLE.test(t) || OUT_PATTERNS.some((p) => p.test(t));
}

// ---- naming a scenario -----------------------------------------------------

/** The menu, in order. scenarios.ts holds the content; a test keeps the two in step. */
export const MENU_ORDER = ['adult_cardiac_arrest', 'child_cardiac_arrest', 'choking_adult', 'recovery_position'] as const;

/** The menu's titles, as people refer to them ("the one where someone collapsed", "the pool one"). Condition first. */
export const TITLE_WORDS: [RegExp, string][] = [
  [/\b(dinner|table|restaurant|meal|food stuck)\b/, 'choking_adult'],
  [/\b(bus stop|bus|pavement|sidewalk|unresponsive but breathing|breathing but unresponsive)\b/, 'recovery_position'],
  [/\b(pool|poolside|drown|drowning|drowned|swimming)\b/, 'child_cardiac_arrest'],
  [/\b(collapse|collapsed|cafe|coffee shop)\b/, 'adult_cardiac_arrest'],
];
export const ORDINALS: [RegExp, number][] = [
  [/\b(the )?(first|1st)( one)?\b|\b(number|option) (one|1)\b/, 0],
  [/\b(the )?(second|2nd)( one)?\b|\b(number|option) (two|2)\b/, 1],
  [/\b(the )?(third|3rd)( one)?\b|\b(number|option) (three|3)\b/, 2],
  [/\b(the )?(fourth|4th|last)( one)?\b|\b(number|option) (four|4)\b/, 3],
];
export const LEAVES_IT_TO_YOU = /\b(surprise me|you (choose|pick|decide)|your (choice|pick)|any( one| of them)|whatever|(doesn'?t|does not) matter|(don'?t|do not) mind|random( one)?|up to you)\b/;
/** A question about a scenario is not a choice of it: "is the child one hard?" */
export const ASKS_ABOUT = /^(is|are|was|were|what|what's|whats|which|how|why|who|does|tell me about|describe|explain)\b|^do (you|they|any|all|i need)\b/;
/** The words scenarios.ts `find()` reads: a condition or an audience. */
const SCENARIO_WORDS = /\b(choking|choke|heimlich|recovery|child|kid|pediatric|paediatric|infant|adult|arrest|cardiac|cpr|compressions)\b/;

/** Whether a line at the menu names (or leaves to Alex) one of the four drills. */
export function namesScenario(text: string): boolean {
  const t = clean(text);
  if (!t || ASKS_ABOUT.test(t)) return false;
  return SCENARIO_WORDS.test(t) || TITLE_WORDS.some(([re]) => re.test(t)) || ORDINALS.some(([re]) => re.test(t)) || LEAVES_IT_TO_YOU.test(t);
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
  new RegExp(`\\b${T}( scenario| one| drill)? instead\\b`),
  new RegExp(`\\b${T} (scenario|drill)\\b`),
  new RegExp(`\\b(do|try|start|pick|choose) the ${T} one\\b`),
];
const TOKEN_TO_ID: [RegExp, string][] = [
  [/^(choking|choke)$/, 'choking_adult'],
  [/^recovery( position)?$/, 'recovery_position'],
  [/^(child|kid|pediatric|paediatric|infant|pool)$/, 'child_cardiac_arrest'],
  [/^(adult|cardiac arrest|collapse|cafe)$/, 'adult_cardiac_arrest'],
];

/** The drill a mid-scenario line asks to switch to, or null. */
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

// ---- the safety net --------------------------------------------------------

export interface NetCall { name: Action; arguments: Record<string, unknown> }

/**
 * The action the learner's words clearly ask for, among those safe to do
 * twice: show_step, next_step, leave_scenario and start_scenario are refused
 * or harmless the second time, resume_practice is idempotent. Never
 * check_answer (it uses an attempt) and never give_hint. The real-emergency
 * watch is the page's own, not this.
 */
export function mustDo(text: string, phase: Phase, current: string | null): NetCall | null {
  if (!clean(text)) return null;
  if (phase === 'emergency') return clearsEmergency(text) ? { name: 'resume_practice', arguments: {} } : null;
  if (isRealEmergency(text)) return null;
  const start: NetCall = { name: 'start_scenario', arguments: { scenario: text.trim().slice(0, 120) } };
  if (phase === 'intro' || phase === 'debrief') return namesScenario(text) ? start : null;
  if (switchRequest(text, current)) return start;
  if (wantsOut(text)) return { name: 'leave_scenario', arguments: {} };
  if (phase === 'answering' && wantsShown(text)) return { name: 'show_step', arguments: {} };
  if (phase === 'coaching' && isAdvanceRequest(text)) return { name: 'next_step', arguments: {} };
  return null;
}

/**
 * Whether the learner's lines since the emergency card went up clear it: one
 * says plainly that nobody is in danger, and nothing said after it reads as
 * an emergency again ("false alarm… no wait, he's not breathing").
 */
export function clearedBy(lines: readonly string[]): boolean {
  let cleared = false;
  for (const line of lines) {
    if (clearsEmergency(line)) cleared = true;
    else if (isRealEmergency(line)) cleared = false;
  }
  return cleared;
}
