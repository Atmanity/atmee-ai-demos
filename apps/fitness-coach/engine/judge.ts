// What a typed or spoken line means to the app. The original let its model
// decide by calling a tool (record_workout_goal, record_fitness_level,
// record_starting_move, request_fitness_video, display_fitness_plan); the
// Avatar API has no function calling, so the app decides itself: by rules
// first, and by its own model call only where rules cannot (a goal or a level
// said in free form). Constraints are read from every line, whatever else it is.
import type { Judgement, JudgeContext } from './coach.ts';
import { parseConstraints } from './constraints.ts';
import { TRAINING_GOAL_OPTIONS } from './goals.ts';
import { acceptGoal, cleanSingleLine, extractLevel, looksLikeLevelOnly, resolvePlanMove, resolvePositionalMove } from './plan.ts';
import { LEVELS, type FitnessPlan, type Intent, type Level } from './types.ts';

/** The app's model call (`structured()` on the server), or absent. */
export type Ask = (request: { system: string; user: string; schema: Record<string, unknown> }) => Promise<unknown>;

export const norm = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

const RESTART = /\b(start (over|again|from scratch)|new plan|from scratch|different goal|change (my|the) goal|something else entirely|reset the plan)\b/;
const QUESTION = /^(what|whats|what's|how|why|when|where|which|who|is|are|can|could|should|would|will|do|does|did)\b/;
/** A choice, even when phrased as a question ("can we do the plank?"). */
const CHOICE = /\b(start with|begin with|go with|let'?s do|lets do|let'?s go with|let'?s start|let'?s try|try|pick|choose|i'?ll do|i will do|i want to do|i'?d like to do|i'?d like to start|can we do|can we start|could we do|next|move on to|switch to|how about|what about)\b/;
const RELEVEL_VERB = /\b(make it|make the plan|make this|rebuild|redo|switch|change|bump|go|try|i'?d (like|prefer)|let'?s do|let'?s go|level|version|instead)\b/;
const POLITE_REQUEST = /^(can|could|would) (you|we) (make|rebuild|change|switch|do|redo)\b/;
const HARDER = /\b(harder|more (challenging|intense|advanced)|step it up|kick it up|level up|too easy)\b/;
const EASIER = /\b(easier|less intense|too hard|tone it down|dial it back|gentler|simpler)\b/;
const EXERCISE_WORD = /\b(squat|squats|lunge|lunges|plank|planks|push ?ups?|pushups|press|row|deadlift|hinge|burpee|burpees|crunch|crunches|sit ?ups?|curl|mountain climber|jumping jack|jack|kettlebell|dumbbell|goblet|warmup|warm up|stretch|mobility|yoga|bridge|march|circles|dead bug|wall sit)\b/;
const ORDINAL = /\b(first|second|third|fourth|fifth|sixth|last|1st|2nd|3rd|4th|5th|6th)\b/;
/** Words around a move's name that are not the name ("let's start with the squats"). */
const FILLER = /\b(let'?s|lets|let us|start|starting|begin|go|going|with|do|doing|try|pick|choose|i|i'?ll|i'?d|i'?m|will|want|wanna|to|would|like|can|could|we|you|please|okay|ok|um|uh|maybe|how|about|what|next|move|moves|on|switch|the|a|an|some|that|this|those|these|it|one|ones|two|three|four|five|six|of|for|me|us|show|demo|video|clip|make|see|now|then|and|so|yeah|yes|sure|right|just|actually|instead|again|exercise|please|first)\b/g;
const SMALL_TALK = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|yeah|nope|sure|cool|great|awesome|good|nice|um|uh|hmm)( there| you| coach)?$/;

/** Goal words people use, beyond the twenty on the board. */
const GOAL_WORDS = ['full body', 'whole body', 'upper body', 'lower body', 'core', 'abs', 'cardio', 'hiit', 'glutes', 'legs', 'arms',
  'back', 'shoulders', 'chest', 'mobility', 'flexibility', 'stretching', 'strength', 'endurance', 'stamina', 'balance', 'posture',
  'yoga', 'pilates', 'conditioning', 'fat loss', 'recovery'];
const OPTION_FORMS = TRAINING_GOAL_OPTIONS.map((option) => [norm(option.replace(/\+/g, ' and ')), option] as const);

const isQuestion = (raw: string, t: string) => /\?\s*$/.test(raw) || QUESTION.test(t);

/**
 * A goal named in the line, by rules: one of the board's twenty (so the board
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

/** The words of a line that could be a move's name, or ''. */
export const movePhrase = (text: string) => norm(text).replace(FILLER, ' ').replace(/\s+/g, ' ').trim();

/**
 * The plan move a line names. "The first warm-up" and "the last one" go by
 * position (ordinals only: "the one with the bridge" is not "move one");
 * anything else by name, after the words around it are taken away.
 */
export function moveIn(plan: FitnessPlan, text: string): string | null {
  const t = norm(text);
  if (ORDINAL.test(t)) return resolvePositionalMove(plan, t);
  const phrase = movePhrase(text);
  return phrase ? resolvePlanMove(plan, phrase) : null;
}

function relevelIn(t: string, raw: string, current: string): Level | null {
  if (isQuestion(raw, t) && !POLITE_REQUEST.test(t)) return null;
  // A direction first: "this is too hard, make it easier" names "hard" too.
  const index = LEVELS.indexOf(current as Level);
  if (index >= 0 && EASIER.test(t)) return LEVELS[Math.max(0, index - 1)];
  if (index >= 0 && HARDER.test(t)) return LEVELS[Math.min(LEVELS.length - 1, index + 1)];
  const level = extractLevel(t);
  if (level && (looksLikeLevelOnly(t) || RELEVEL_VERB.test(t) || POLITE_REQUEST.test(t))) return level;
  return null;
}

export const GOAL_SCHEMA = {
  type: 'object',
  properties: {
    isGoal: { type: 'boolean', description: 'The user is saying what they want to train or work on today.' },
    goal: { type: 'string', description: 'What they want to train, as a short label of one to four words in their own terms, e.g. "glutes", "core and cardio", "mobility"; empty if none.' },
  },
  required: ['isGoal', 'goal'],
};

export const goalPrompt = (utterance: string) => `A fitness coach asked the user what they want to train today. The user said: "${utterance}"
Speech recognition may have misheard words. Decide whether they named what they want to train or work on, and if so give it as a short label.
A level alone ("beginner"), a limit alone ("I only have 20 minutes", "my knee is bad"), a question, a greeting or small talk is not a goal.`;

export const LEVEL_SCHEMA = {
  type: 'object',
  properties: {
    isLevel: { type: 'boolean', description: 'The user is describing how experienced they are, or which level they want.' },
    level: { type: 'string', enum: ['Beginner', 'Intermediate', 'Advanced', ''], description: 'The level that fits what they said; empty if none.' },
  },
  required: ['isLevel', 'level'],
};

export const levelPrompt = (goal: string, utterance: string) => `A fitness coach asked the user which level to build their ${goal || 'workout'} plan for: beginner, intermediate or advanced. The user said: "${utterance}"
Speech recognition may have misheard words. Decide whether they answered with a level or described their experience clearly enough to pick one (new or returning after a long break is beginner; training regularly is intermediate; years of hard training is advanced). A question, small talk or "I don't know" is not a level.`;

const SYSTEM = 'You interpret one utterance for a fitness coaching app. Answer only from what the user said.';

/** What the line means at this step. Never throws: a failed model call is "no intent". */
export async function judge(text: string, ctx: JudgeContext, ask?: Ask): Promise<Judgement> {
  const raw = cleanSingleLine(text, 400);
  const constraints = parseConstraints(raw);
  const level = extractLevel(raw);
  const t = norm(raw);
  const judged = (intent: Intent | null): Judgement => ({ constraints, intent, level });
  if (!t) return judged(null);
  const question = isQuestion(raw, t);
  // "Full body or core?", "beginner or intermediate?": a question weighing
  // options is not a choice; the avatar answers it.
  const weighing = question && /\bor\b/.test(t);
  const { stage, plan } = ctx;

  if (RESTART.test(t) && (ctx.goal || plan)) return judged({ kind: 'restart' });

  if (plan || stage === 'planning') {
    const relevel = relevelIn(t, raw, ctx.level);
    if (relevel) return judged({ kind: 'relevel', level: relevel });
  }

  if (plan) {
    const strongDemo = /\b(video|demo|clip)\b/.test(t);
    const wantsDemo = strongDemo || /\bshow me\b/.test(t);
    // At the starting-move step a statement is an answer; later only a choice
    // ("let's do the plank"), a demo request or a bare move name switches moves.
    const answering = !question && (stage === 'move' || t.split(' ').length <= 3);
    if (!wantsDemo && !CHOICE.test(t) && !answering) return judged(null);
    const move = moveIn(plan, raw);
    if (move) return judged(wantsDemo ? { kind: 'demo', move } : { kind: 'move', move });
    const phrase = movePhrase(raw);
    if (strongDemo && !phrase) return judged({ kind: 'demo', move: null });
    if (phrase && (EXERCISE_WORD.test(phrase) || (strongDemo && phrase.split(' ').length <= 3))) return judged({ kind: 'unknownMove', heard: phrase });
    return judged(null);
  }

  if (weighing) return judged(null);

  if (stage === 'goal') {
    const goal = goalIn(raw, constraints.injuries);
    if (goal) return judged({ kind: 'goal', goal, ...(level ? { level } : {}) });
    if (level && looksLikeLevelOnly(raw)) return judged({ kind: 'level', level });
    // A level with no goal ("I'd say intermediate") answers the wrong question:
    // the app asks for the goal again, unless the model finds one in it.
    const levelOnly = judged(level && !question ? { kind: 'level', level } : null);
    if (!ask || question || SMALL_TALK.test(t) || constraints.minutes || constraints.equipment || constraints.injuries.length || constraints.clearance.length) {
      return levelOnly;
    }
    try {
      const verdict = (await ask({ system: SYSTEM, user: goalPrompt(raw), schema: GOAL_SCHEMA })) as { isGoal?: boolean; goal?: string };
      const named = verdict?.isGoal ? acceptGoal(String(verdict.goal ?? '')) : null;
      return named ? judged({ kind: 'goal', goal: named, ...(level ? { level } : {}) }) : levelOnly;
    } catch (err) {
      console.warn('[fitness-coach] [Judge] goal call failed (%s)', (err as Error).message);
      return levelOnly;
    }
  }

  if (stage === 'level') {
    if (level) return judged({ kind: 'level', level });
    // "Actually, glutes instead": a change of mind before the plan exists.
    const goal = goalIn(raw, constraints.injuries);
    if (goal) return judged({ kind: 'goal', goal });
    if (!ask || question || SMALL_TALK.test(t)) return judged(null);
    try {
      const verdict = (await ask({ system: SYSTEM, user: levelPrompt(ctx.goal, raw), schema: LEVEL_SCHEMA })) as { isLevel?: boolean; level?: string };
      const picked = LEVELS.find((l) => l === verdict?.level);
      return judged(verdict?.isLevel && picked ? { kind: 'level', level: picked } : null);
    } catch (err) {
      console.warn('[fitness-coach] [Judge] level call failed (%s)', (err as Error).message);
      return judged(null);
    }
  }

  return judged(null);
}
