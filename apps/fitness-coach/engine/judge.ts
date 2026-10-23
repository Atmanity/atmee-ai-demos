// Reading what the host passes to a tool, and what the page's safety net
// listens for. The host decides WHEN to act (it calls a tool); the coach
// decides WHAT the words mean: a goal it can highlight on the board, the plan
// move a phrase names, the level one step easier or harder. Rules only, no
// model: these are the hard-won readers from the first port, kept.
import { parseConstraints } from './constraints.ts';
import { TRAINING_GOAL_OPTIONS } from './goals.ts';
import { resolvePlanMove, resolvePositionalMove } from './plan.ts';
import { LEVELS, type FitnessPlan, type Level } from './types.ts';

export const norm = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

const ORDINAL = /\b(first|second|third|fourth|fifth|sixth|last|1st|2nd|3rd|4th|5th|6th)\b/;
/** Words around a move's name that are not the name ("let's start with the squats"). */
const FILLER = /\b(let'?s|lets|let us|start|starting|begin|go|going|with|do|doing|try|pick|choose|i|i'?ll|i'?d|i'?m|will|want|wanna|to|would|like|can|could|we|you|please|okay|ok|um|uh|maybe|how|about|what|next|move|moves|on|switch|the|a|an|some|that|this|those|these|it|one|ones|two|three|four|five|six|of|for|me|us|show|demo|video|clip|make|see|now|then|and|so|yeah|yes|sure|right|just|actually|instead|again|exercise|please|first)\b/g;

/** Goal words people use, beyond the twenty on the board. */
const GOAL_WORDS = ['full body', 'whole body', 'upper body', 'lower body', 'core', 'abs', 'cardio', 'hiit', 'glutes', 'legs', 'arms',
  'back', 'shoulders', 'chest', 'mobility', 'flexibility', 'stretching', 'strength', 'endurance', 'stamina', 'balance', 'posture',
  'yoga', 'pilates', 'conditioning', 'fat loss', 'recovery'];
const OPTION_FORMS = TRAINING_GOAL_OPTIONS.map((option) => [norm(option.replace(/\+/g, ' and ')), option] as const);

/**
 * A goal named in the words, by rules: one of the board's twenty (so the board
 * highlights it), or the goal words as said ("Glutes", "Core and arms"). A
 * body part the user said is hurt is not a goal ("my back is sore").
 */
export function goalIn(text: string, injured: readonly string[] = []): string | null {
  const t = ` ${norm(text)} `;
  for (const [form, option] of OPTION_FORMS) if (t.includes(` ${form} `)) return option;
  const found = GOAL_WORDS
    .filter((w) => t.includes(` ${w} `) && !injured.some((part) => w.startsWith(part)))
    .sort((a, b) => t.indexOf(` ${a} `) - t.indexOf(` ${b} `))
    .slice(0, 3)
    .map((w) => (w === 'hiit' ? 'HIIT' : w));
  if (!found.length) return null;
  const label = found.join(' and ');
  return label[0].toUpperCase() + label.slice(1);
}

/** The words of a phrase that could be a move's name, or ''. */
export const movePhrase = (text: string) => norm(text).replace(FILLER, ' ').replace(/\s+/g, ' ').trim();

/**
 * The plan move a phrase names. "The first warm-up" and "the last one" go by
 * position (ordinals only: "the one with the bridge" is not "move one");
 * anything else by name, after the words around it are taken away.
 */
export function moveIn(plan: FitnessPlan, text: string): string | null {
  const t = norm(text);
  if (ORDINAL.test(t)) return resolvePositionalMove(plan, t);
  const phrase = movePhrase(text);
  return phrase ? resolvePlanMove(plan, phrase) : null;
}

/** One level easier or harder than `current`; `current` itself at either end. Null when there is no level yet. */
export function stepLevel(current: string, way: 'easier' | 'harder'): Level | null {
  const index = LEVELS.indexOf(current as Level);
  if (index < 0) return null;
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index + (way === 'harder' ? 1 : -1)))];
}

/** A tool call the page's safety net can make for the host. */
export interface NetCall { name: 'start_over' | 'add_limits' | 'stop_for_safety'; arguments: Record<string, string> }

const START_OVER = /\b(start (over|again|from scratch)|from scratch|new plan|different goal|change (my|the) goal|something else entirely|reset the plan)\b/;
const NOT = /\b(don'?t|do not|no need to|not|never|rather not)\b[\w' ]{0,16}\b(start|from scratch|new plan|different|change|reset)/;

/**
 * The action the user's words clearly ask for, among those safe to do twice
 * (starting over twice lands on the same empty board; a limit recorded twice
 * merges to the same limits). The page's safety net does it when the host
 * does not call the tool itself. A level change is left out: "harder" twice
 * is two levels.
 */
export function mustDo(text: string): NetCall | null {
  const t = norm(text);
  if (!t) return null;
  if (START_OVER.test(t) && !NOT.test(t)) return { name: 'start_over', arguments: {} };
  const heard = parseConstraints(text);
  // A stop is the safety check's (mustStop): nothing else is done for these words.
  if (heard.clearance.length) return null;
  if (heard.minutes || heard.equipment || heard.injuries.length || heard.avoid.length) return { name: 'add_limits', arguments: { words: text.trim().slice(0, 300) } };
  return null;
}

/**
 * A condition no exercise swap makes safe (pregnancy, a cardiac history,
 * recent surgery…), detected by the page itself from the user's own words:
 * it freezes the plan at once, whatever the host does.
 */
export function mustStop(text: string): NetCall | null {
  return parseConstraints(text).clearance.length ? { name: 'stop_for_safety', arguments: { condition: text.trim().slice(0, 120) } } : null;
}
