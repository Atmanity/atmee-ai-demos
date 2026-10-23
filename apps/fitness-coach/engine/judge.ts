// Reading what the host passes to a tool, and what the page's safety net
// listens for. The host decides WHEN to act (it calls a tool); the coach
// decides WHAT the words mean: a goal it can highlight on the board, the plan
// move a phrase names, a level in any case or phrasing, the level one step
// easier or harder. Rules only, no model: the readers from the first port,
// kept, plus the net's matchers.
import { parseConstraints } from './constraints.ts';
import { TRAINING_GOAL_OPTIONS } from './goals.ts';
import { resolvePlanMove, resolvePositionalMove } from './plan.ts';
import { LEVELS, type FitnessPlan, type Level, type Stage } from './types.ts';

export const norm = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

const ORDINAL = /\b(first|second|third|fourth|fifth|sixth|last|1st|2nd|3rd|4th|5th|6th)\b/;
const ORDINALS = new RegExp(ORDINAL.source, 'g');
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
 * The plan move a phrase names. A move's name wins: "the first plank" is the
 * plank, wherever it sits (an ordinal checked first started whatever move was
 * first). With no name left, "the first warm-up move" and "the last one" go by
 * position (ordinals only: "the one with the bridge" is not "move one").
 */
export function moveIn(plan: FitnessPlan, text: string): string | null {
  const t = norm(text);
  // The name, with the ordinal and the words around it taken away (so the
  // name match cannot fall back to a position itself).
  const name = movePhrase(text).replace(ORDINALS, ' ').replace(/\s+/g, ' ').trim();
  const named = name ? resolvePlanMove(plan, name) : null;
  if (named) return named;
  return ORDINAL.test(t) ? resolvePositionalMove(plan, t) : null;
}

/** A level as the host passed it (any case, a synonym, a phrase), or a step easier or harder; null when it is neither. */
export function readLevel(text: string): Level | 'easier' | 'harder' | null {
  const t = norm(String(text ?? ''));
  if (!t) return null;
  // A direction first: "too hard, make it easier" names "hard" too.
  if (/\b(easier|gentler|simpler|lighter|less intense|less hard|too hard|tone it down|dial it back|step it down|level down)\b/.test(t)) return 'easier';
  if (/\b(harder|tougher|more (challenging|intense|advanced)|too easy|step it up|kick it up|level up|bump it up)\b/.test(t)) return 'harder';
  if (/\b(beginners?|novice|newbie|new to (this|it|training)|starter|starting out|basic|easy)\b/.test(t)) return 'Beginner';
  if (/\b(intermediate|medium|moderate|middle|in between|some experience)\b/.test(t)) return 'Intermediate';
  if (/\b(advanced|expert|very experienced|hard|pro)\b/.test(t)) return 'Advanced';
  return null;
}

/** A level named outright in a phrase, with the words around it ("…, I'm a beginner"). Not "hard" or "easy": they describe a workout. */
const LEVEL_CLAUSE = /(?:[,;]\s*)?(?:\b(?:and|but)\s+)?(?:\b(?:i'?m|i am|i'?d say i'?m|probably|maybe|at)\s+)?(?:\b(?:an?|the)\s+)?(?:\b(?:total|complete|pretty much an?)\s+)?\b(beginners?|novice|intermediate|advanced|expert)\b(?:\s+(?:level|here|please))?/i;

/**
 * What to train and the level, from one phrase the host passed as the goal
 * ("core and cardio, I'm a beginner"): the level said in it, and the goal
 * without it. A goal whose own name carries a level word ("Beginner
 * strength") is only a goal.
 */
export function splitLevel(text: string): { goal: string; level: Level | null } {
  const raw = String(text ?? '').trim();
  const option = goalIn(raw);
  if (option && LEVEL_CLAUSE.test(option)) return { goal: raw, level: null };
  const found = LEVEL_CLAUSE.exec(raw);
  if (!found) return { goal: raw, level: null };
  const level = readLevel(found[1]);
  const goal = (raw.slice(0, found.index) + raw.slice(found.index + found[0].length)).replace(/\s+/g, ' ').replace(/^[\s,;.!?-]+|[\s,;.!?-]+$/g, '');
  return { goal, level: level === 'easier' || level === 'harder' ? null : level };
}

/** One level easier or harder than `current`; `current` itself at either end. Null when there is no level yet. */
export function stepLevel(current: string, way: 'easier' | 'harder'): Level | null {
  const index = LEVELS.indexOf(current as Level);
  if (index < 0) return null;
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index + (way === 'harder' ? 1 : -1)))];
}

/** A tool call the page's safety net can make for the host. */
export interface NetCall { name: 'start_over' | 'add_limits' | 'stop_for_safety' | 'set_level' | 'start_move'; arguments: Record<string, string> }

/** What is on the screen, as far as the net needs it. */
export interface NetContext { stage: Stage; level: string; plan: FitnessPlan | null }

const QUESTION = /^(what|whats|what's|how|why|when|where|which|who|is|are|should|would|will|do|does|did|am)\b/;
const POLITE = /^(can|could|would) (you|we|i)\b/;
const isQuestion = (raw: string, t: string) => (/\?\s*$/.test(raw.trim()) || QUESTION.test(t)) && !POLITE.test(t);
/** Words around a level that do not change it ("Beginner, please", "can you make it a bit harder?"). */
const LEVEL_FILLER = /\b(please|thanks|thank you|i'?m|i am|i'?d|i would|say|guess|think|maybe|probably|let'?s|lets|go|with|for|a|an|the|bit|little|lot|make|it|this|that|can|could|would|you|we|do|be|level|plan|workout|one|just|so|ok|okay|yeah|yes|um|uh|hmm|put|me|down as|as|then|pretty|really|definitely|actually|now|sure|right)\b/g;

/** Every word readLevel reads a level or a step from. */
const LEVEL_WORDS = /\b(beginners?|novice|newbie|new|to|starter|starting|out|basic|easy|easier|intermediate|medium|moderate|middle|in|between|some|experience|advanced|expert|very|experienced|hard|harder|pro|tougher|gentler|simpler|lighter|less|more|intense|challenging|too|tone|dial|back|step|up|kick|bump|level)\b/g;

/**
 * A level said on its own while the level step is live ("Beginner, please.",
 * "intermediate", "can you make it a bit harder?"), as the level to set: a
 * step easier or harder becomes the level it lands on, so the net setting it
 * after the host did changes nothing. Live, Sammy answered "Beginner,
 * please." with "I've set you up" and called nothing, twice.
 */
export function levelAsked(text: string, ctx: NetContext): Level | null {
  if (ctx.stage !== 'level' && !ctx.plan) return null;
  if (ctx.stage === 'planning' || ctx.stage === 'hold') return null;
  const t = norm(text);
  if (!t || t.split(' ').length > 9 || isQuestion(text, t)) return null;
  const rest = t.replace(LEVEL_FILLER, ' ').replace(/\s+/g, ' ').trim();
  // The level must be all that is left: "beginner glute bridges" is not a level.
  if (!rest || rest.replace(LEVEL_WORDS, ' ').trim()) return null;
  const read = readLevel(rest);
  if (read === 'easier' || read === 'harder') return ctx.plan ? stepLevel(ctx.level, read) : null;
  return read;
}

/** A choice, even when phrased as a polite question ("can we do the plank?"). */
const CHOICE = /\b(start with|begin with|go with|let'?s do|lets do|let'?s go with|let'?s start|let'?s try|try|pick|choose|i'?ll do|i will do|i want to do|i'?d like to do|i'?d like to start|can we do|can we start|could we do|move on to|switch to|show me|how about|what about)\b/;

/**
 * The plan move the user asks to start once a plan is up ("Let's start with
 * the first warm-up move", "the plank"), as the move's name: starting the same
 * move again is harmless. A question or a remark ("I did the plank") is not a
 * choice.
 */
export function moveAsked(text: string, ctx: NetContext): string | null {
  if (!ctx.plan || (ctx.stage !== 'move' && ctx.stage !== 'coach')) return null;
  const t = norm(text);
  if (!t || (isQuestion(text, t) && !/^(what|how) about\b/.test(t))) return null;
  if (!CHOICE.test(t) && t.split(' ').length > 3) return null;
  return moveIn(ctx.plan, text);
}

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

/** The net's level call: the level to set, never a direction. */
export const mustSetLevel = (text: string, ctx: NetContext): NetCall | null => {
  const level = levelAsked(text, ctx);
  return level ? { name: 'set_level', arguments: { level: level.toLowerCase() } } : null;
};

/** The net's move call: the move's name on the plan. */
export const mustStartMove = (text: string, ctx: NetContext): NetCall | null => {
  const move = moveAsked(text, ctx);
  return move ? { name: 'start_move', arguments: { move } } : null;
};

const hasOrdinaryLimit = (text: string) => {
  const c = parseConstraints(text);
  return Boolean(c.minutes || c.equipment || c.injuries.length || c.avoid.length);
};

/**
 * The user's own recent words that carry a limit, for the page to attach to an
 * add_limits call: the host's words can drop one ("only twenty minutes"
 * went missing live while Sammy said it was locked in).
 */
export function limitWords(lines: readonly { text: string; at: number }[], now: number, windowMs = 30_000): string {
  return lines.filter((l) => now - l.at <= windowMs && hasOrdinaryLimit(l.text)).map((l) => l.text.trim()).join(' ').slice(-1000);
}

/**
 * A condition no exercise swap makes safe (pregnancy, a cardiac history,
 * recent surgery…), detected by the page itself from the user's own words:
 * it freezes the plan at once, whatever the host does.
 */
export function mustStop(text: string): NetCall | null {
  return parseConstraints(text).clearance.length ? { name: 'stop_for_safety', arguments: { condition: text.trim().slice(0, 120) } } : null;
}
