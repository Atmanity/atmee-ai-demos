// The workout plan, and the text handling around it.
//
// Ported from the original `plan.py` (itself upstream's logic from
// livekit_agents' fitness_advisor). Three pieces worth knowing about:
//
// - `normalizeLevel` / `looksLikeLevelOnly`: answering "beginner" when asked
//   what to TRAIN is the single most common derail, handled by refusing a
//   level as a goal.
// - `planFromData` / `planFromLlmText`: every field of a model's plan falls
//   back independently, so a plan that half-parses still renders a board.
// - `resolvePlanMove`: "the first workout move" and "arm circles" both have to
//   land on a plan step, because the demo prompt is built from its name.
import { constraintClause, type Constraints } from './constraints.ts';
import type { FitnessPlan, Level } from './types.ts';

const LEVEL_PATTERNS: [RegExp, Level][] = [
  [/\b(beginner|new|starter|easy|basic)\b/i, 'Beginner'],
  [/\b(intermediate|some experience|experienced|moderate)\b/i, 'Intermediate'],
  [/\b(advanced|hard|intense|expert)\b/i, 'Advanced'],
];

export const DEFAULT_WARMUP = ['March in place, 30 seconds', 'Arm circles, 30 seconds each direction', 'Bodyweight good mornings, 8 reps'];
export const DEFAULT_WORKOUT = ['Bodyweight squats, 12 reps', 'Incline push-ups, 10 reps', 'Glute bridges, 12 reps', 'Plank hold, 30 seconds'];
export const DEFAULT_CUES = ['Move with quiet control', 'Keep ribs down, tall chest', 'Stop if anything feels sharp'];

export const cleanSingleLine = (value: unknown, limit = 160) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

export function extractLevel(text: string): Level | null {
  for (const [pattern, level] of LEVEL_PATTERNS) if (pattern.test(text)) return level;
  return null;
}

export const normalizeLevel = (value: string) => extractLevel(cleanSingleLine(value, 80));

/**
 * True when the text is a level and nothing else. Accepting that as the goal
 * produced a plan titled "Your Beginner beginner plan" and no idea what the
 * user actually wanted.
 */
export function looksLikeLevelOnly(value: string): boolean {
  let text = cleanSingleLine(value, 100).toLowerCase();
  if (!extractLevel(text)) return false;
  text = text.replace(/\b(beginner|new|starter|easy|basic)\b/g, ' ');
  text = text.replace(/\b(intermediate|some experience|experienced|moderate)\b/g, ' ');
  text = text.replace(/\b(advanced|hard|intense|expert)\b/g, ' ');
  text = text.replace(/\b(probably|maybe|i|am|i'm|would|like|to|have|level)\b/g, ' ');
  text = text.replace(/[^a-z]+/g, ' ');
  return !text.trim();
}

const stripChars = (text: string, chars: string) => {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start])) start++;
  while (end > start && chars.includes(text[end - 1])) end--;
  return text.slice(start, end);
};

export function cleanGoalForSpeech(goal: string): string {
  const cleaned = stripChars(goal.replace(/\s+/g, ' ').trim(), ' .,!?:;');
  return cleaned ? cleaned.slice(0, 48) : 'that';
}

/** The goal as recorded, or null when it is not a goal at all. */
export function acceptGoal(value: string): string | null {
  const cleaned = stripChars(cleanSingleLine(value, 100), ' .,!?;:');
  if (!cleaned || looksLikeLevelOnly(cleaned)) return null;
  return cleaned;
}

export function coerceSteps(values: unknown, fallback: readonly string[]): string[] {
  const list = Array.isArray(values) ? values : [];
  const steps = list
    .filter((step) => typeof step === 'string' || typeof step === 'number')
    .map((step) => cleanSingleLine(step, 120))
    .filter(Boolean);
  return steps.length ? steps.slice(0, 6) : [...fallback];
}

/**
 * A plan good enough to coach from when the model gave nothing. Never throws:
 * a session where the model hiccuped should show a workout, not an empty board.
 */
export function buildFallbackPlan(goal: string, level: string): FitnessPlan {
  return {
    plan_title: `Your ${level} ${goal} plan`,
    goal,
    level,
    duration_minutes: 20,
    warmup_steps: [...DEFAULT_WARMUP],
    workout_steps: [...DEFAULT_WORKOUT],
    coaching_cues: [...DEFAULT_CUES],
  };
}

/** Best-effort extract of a JSON object from a model response. Throws when there is none. */
export function parsePlanJson(text: string): Record<string, unknown> {
  const match = /\{[\s\S]*\}/.exec(text || '');
  if (!match) throw new Error(`no JSON object in the plan response: ${JSON.stringify((text || '').slice(0, 200))}`);
  return JSON.parse(match[0]);
}

/**
 * Minutes, clamped: the number renders as "N min" beside a plan the user is
 * about to follow, and the model has answered both 0 and 240.
 */
export function safeDuration(value: unknown, lo = 5, hi = 60, fallback = 20): number {
  let minutes: number;
  if (typeof value === 'number' && Number.isFinite(value)) minutes = Math.trunc(value);
  else if (typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value)) minutes = parseInt(value, 10);
  else return fallback;
  return minutes ? Math.max(lo, Math.min(hi, minutes)) : fallback;
}

/** A model's plan object as a plan: every field falls back on its own. */
export function planFromData(data: Record<string, unknown>, { goal, level }: { goal: string; level: string }): FitnessPlan {
  return {
    plan_title: cleanSingleLine(data.plan_title ?? '', 80) || `Your ${level} ${goal} plan`,
    goal,
    level,
    duration_minutes: safeDuration(data.duration_minutes),
    warmup_steps: coerceSteps(data.warmup_steps, DEFAULT_WARMUP),
    workout_steps: coerceSteps(data.workout_steps, DEFAULT_WORKOUT),
    coaching_cues: coerceSteps(data.coaching_cues, DEFAULT_CUES),
  };
}

/** A model's text as a plan. Throws only when there is no JSON at all; the caller falls back. */
export const planFromLlmText = (text: string, who: { goal: string; level: string }) => planFromData(parsePlanJson(text), who);

/**
 * The system prompt for the plan call, unchanged from the original: a one-shot
 * JSON request, kept apart from the coach's spoken rules (mixing them made the
 * coach narrate JSON).
 */
export const PLAN_SYSTEM_PROMPT =
  'You are a warm and energetic fitness coach. Generate a concise, practical workout plan for the user. '
  + 'Respond with ONLY a single JSON object, no markdown, no commentary, no code fences. The JSON must have these exact keys:\n'
  + '- "plan_title": short evocative title (string)\n'
  + '- "duration_minutes": integer between 10 and 35\n'
  + '- "warmup_steps": list of 2 to 4 short strings, each with reps or duration\n'
  + '- "workout_steps": list of 3 to 6 short strings, each with reps or duration\n'
  + '- "coaching_cues": list of 2 to 4 short cue sentences\n\n'
  + 'Use vivid spoken cue language like "quiet control", "own the tempo", "soft landing", "tall chest", "strong but smooth". '
  + 'Avoid punishment language, body-shaming, calorie talk, or fake grind phrases.';

/** The same shape as a Gemini response schema, for `structured()`. */
export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    plan_title: { type: 'string' },
    duration_minutes: { type: 'integer' },
    warmup_steps: { type: 'array', items: { type: 'string' } },
    workout_steps: { type: 'array', items: { type: 'string' } },
    coaching_cues: { type: 'array', items: { type: 'string' } },
  },
  required: ['plan_title', 'duration_minutes', 'warmup_steps', 'workout_steps', 'coaching_cues'],
};

/** The user's half of the plan call. The constraints go in the prompt AND are enforced on the way out. */
export function planPrompt(goal: string, level: string, constraints: Constraints): string {
  const clause = constraintClause(constraints);
  return `Build my ${level} ${goal} plan now.${clause ? ` ${clause}` : ''} JSON only.`;
}

/**
 * The demo clip's prompt for one move. Neutral about the trainer's look: the
 * avatar's face is per avatar, and the reference sentence only appears when
 * reference images are actually configured.
 */
export function buildStartMovePrompt(move: string, goal: string, level: string, hasReference = false): string {
  const moveText = cleanSingleLine(move, 80) || 'the first exercise';
  const goalText = cleanSingleLine(goal, 80) || 'a full-body workout';
  const levelText = cleanSingleLine(level, 40) || 'beginner';
  const reference = hasReference ? 'The trainer matches the reference image. ' : '';
  return `A fitness trainer demonstrates ${moveText} for a ${levelText.toLowerCase()} workout focused on ${goalText}. ${reference}`
    + 'Show clear form in a bright modern gym, vertical full-body framing, simple pacing, no complex camera cuts. Single trainer only, no other people in frame.';
}

/** "a, b and c": one speakable phrase, or '' when there is nothing. */
export function spokenList(items: Iterable<string>): string {
  const values = [...items].map((i) => String(i).trim()).filter(Boolean);
  if (!values.length) return '';
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

/** How many removed moves are worth naming: past three it is a recital, not a reassurance. */
export const REBUILD_MOVES_SPOKEN = 3;

/**
 * One factual sentence naming what a rebuild actually changed, or '' when
 * nothing observable did: a sentence claiming a change that did not happen is
 * the failure this app is most careful about.
 */
export function rebuildSummaryLine(before: FitnessPlan, after: FitnessPlan): string {
  const removed = [
    ...before.workout_steps.filter((s) => !after.workout_steps.includes(s)),
    ...before.warmup_steps.filter((s) => !after.warmup_steps.includes(s)),
  ].map(baseMoveName);
  const minutes = after.duration_minutes;
  const retimed = minutes !== before.duration_minutes;
  if (removed.length) {
    const named = spokenList(removed.slice(0, REBUILD_MOVES_SPOKEN).map((m) => m.toLowerCase()));
    const rest = removed.length - REBUILD_MOVES_SPOKEN;
    const line = `That takes ${named}${rest > 0 ? ` and ${rest} more` : ''} out of your workout`;
    return retimed ? `${line}, and the session is now ${minutes} minutes.` : `${line}.`;
  }
  return retimed ? `That brings the session to ${minutes} minutes.` : '';
}

export function normalizeMoveText(value: string): string {
  let text = cleanSingleLine(value, 120).toLowerCase();
  text = text.replace(/\([^)]*\)/g, ' ');
  text = text.replace(/\b\d+\s*(?:reps?|sec|secs|seconds?|min|mins?|minutes?)\b/g, ' ');
  text = text.replace(/\b\d+\s*(?:each|per)\s+(?:side|leg|arm)\b/g, ' ');
  text = text.replace(/\b\d+\b/g, ' ');
  text = text.replace(/\b(?:do|the|a|an|some|please|start|with|for|me|rep|reps|slow)\b/g, ' ');
  text = text.replace(/[^a-z]+/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

const POSITION_INDEX: Record<string, number> = {
  first: 0, '1st': 0, one: 0,
  second: 1, '2nd': 1, two: 1,
  third: 2, '3rd': 2, three: 2,
  fourth: 3, '4th': 3, four: 3,
  fifth: 4, '5th': 4, five: 4,
  sixth: 5, '6th': 5, six: 5,
};

/**
 * Where a step's NAME stops and its dosage starts. A comma, colon or semicolon
 * always; a dash only when spaced ("Wall sit - 30 seconds"). A bare `-` once
 * cut "Cat-Cow Stretch, 1 minute" to "Cat", which then went into the spoken
 * acknowledgement ("I will make Cat easy to follow") and the video prompt.
 */
const STEP_DOSAGE_RE = /\s*[:;,]\s*|\s+[-–—]\s+/;
/**
 * A parenthetical, and what makes one DOSAGE rather than part of the move.
 * Only dosage is stripped: "Push-up (knees)" names a variant, and dropping it
 * renders and coaches a different exercise.
 */
const STEP_PARENS_RE = /\s*\(([^)]*)\)/g;
const DOSAGE_INSIDE_RE = /\d|\b(?:reps?|sets?|secs?|seconds?|mins?|minutes?|rounds?|each|side|sides|leg|legs|arm|arms|breaths?|per)\b/i;
/**
 * A quantity in FRONT of the name ("10 minutes of cat-cow stretches"). Units
 * longest-first and anchored, because `mins?` ahead of `minutes?` matched
 * "min" inside "minutes"; and a unit or "of" is REQUIRED, because a bare
 * leading number is not reliably dosage ("180 degree jump" is a move).
 */
const STEP_LEADING_QUANTITY_RE = /^\s*\d+\s*(?:[-–]\s*\d+\s*)?(?:(?:x|rounds?|minutes?|mins?|seconds?|secs?|reps?|sets?)\b\s*(?:of\b\s*)?|of\b\s*)/i;

/**
 * The move's NAME, with its dosage stripped from either end:
 * "Goblet squats, 12 reps" -> "Goblet squats";
 * "10 minutes of cat-cow stretches (1 minute)" -> "cat-cow stretches".
 * This name is spoken and goes into the video prompt, so anything left on it
 * is heard by the user and rendered by the provider.
 */
export function baseMoveName(step: string): string {
  let text = cleanSingleLine(step, 120).replace(STEP_PARENS_RE, (whole, inside: string) => (DOSAGE_INSIDE_RE.test(inside) ? ' ' : whole));
  text = text.replace(/\s+/g, ' ').trim().split(STEP_DOSAGE_RE)[0];
  const trimmed = stripChars(text.replace(STEP_LEADING_QUANTITY_RE, '').trim(), ' .,;:-');
  // A step that is ALL dosage has no name to find, and an empty name resolves to nothing downstream.
  return trimmed || text.trim();
}

export const planMoveOptions = (plan: FitnessPlan) => [...plan.warmup_steps, ...plan.workout_steps];

export const displayMoveOptions = (plan: FitnessPlan, limit = 6) =>
  planMoveOptions(plan).slice(0, limit).map(baseMoveName).join(', ');

/** "first workout move" or "last warm-up", mapped onto a plan step. */
export function resolvePositionalMove(plan: FitnessPlan, requested: string): string | null {
  const text = cleanSingleLine(requested, 120).toLowerCase();
  if (!text) return null;
  let section: string[];
  if (/\bwarm[\s-]?up\b|\bwarmup\b/.test(text)) section = plan.warmup_steps;
  else if (/\b(workout|main|exercise)\b/.test(text)) section = plan.workout_steps;
  else {
    // No section word: only resolve positionally when the phrase is clearly
    // positional, so "second squat variation" does not become "the second step".
    if (!/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last|one|two|three|four|five|six)\b/.test(text)) return null;
    section = planMoveOptions(plan);
  }
  if (!section.length) return null;
  if (/\blast\b/.test(text)) return baseMoveName(section[section.length - 1]);
  const match = /\b(first|1st|one|second|2nd|two|third|3rd|three|fourth|4th|four|fifth|5th|five|sixth|6th|six)\b/.exec(text);
  if (!match) return null;
  const index = POSITION_INDEX[match[1]];
  if (index === undefined || index >= section.length) return null;
  return baseMoveName(section[index]);
}

/**
 * The plan step the user meant (its base name), or null when nothing matches
 * well enough. Null is a real answer: it makes the coach ask again rather than
 * render a demo of a move that is not in the plan.
 */
export function resolvePlanMove(plan: FitnessPlan, requested: string): string | null {
  const positional = resolvePositionalMove(plan, requested);
  if (positional) return positional;
  const wanted = stemmed(requested);
  if (!wanted) return null;
  const wantedTokens = new Set(wanted.split(' '));
  let best: string | null = null;
  let bestScore = 0;
  for (const step of planMoveOptions(plan)) {
    const base = baseMoveName(step);
    for (const candidate of [base, step]) {
      const normalized = stemmed(candidate);
      if (!normalized) continue;
      // Whole words, plurals aside. Upstream compared raw substrings, so "go"
      // matched "Bodyweight good mornings"; it relied on its model handing over
      // a clean move phrase, which this app does not have.
      if (wanted === normalized || ` ${normalized} `.includes(` ${wanted} `) || ` ${wanted} `.includes(` ${normalized} `)) return base;
      const tokens = new Set(normalized.split(' '));
      const overlap = [...wantedTokens].filter((t) => tokens.has(t)).length;
      const score = overlap / Math.max(wantedTokens.size, tokens.size);
      if (score > bestScore) {
        bestScore = score;
        best = base;
      }
    }
  }
  // Half the tokens is upstream's bar. Lower and "plank" matches "March in place" through one shared word.
  return bestScore >= 0.5 ? best : null;
}

/** Normalised words with a plural "s" dropped ("squats" and "squat" are one move; "press" keeps its "ss"). */
const stemmed = (text: string) => normalizeMoveText(text).split(' ').filter(Boolean).map((w) => (w.endsWith('ss') ? w : w.replace(/s$/, ''))).join(' ');

/** The plan step whose name is `move`, if it is still on the plan. */
export const findStep = (plan: FitnessPlan, move: string) =>
  planMoveOptions(plan).find((step) => baseMoveName(step).toLowerCase() === move.trim().toLowerCase()) ?? null;
