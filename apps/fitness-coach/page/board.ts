/**
 * What the board is showing, and the small decisions that go with it.
 *
 * Ported from the original panel's `board.ts`: the one part of the panel with
 * real branching (which world the user is looking at) as pure functions, so it
 * is tested without a DOM. The goal deal moved to `engine/goals.ts` (the
 * avatar's state names the same six goals the board shows) and is re-exported
 * here. The move buttons' words (`moveAction`) and the video label
 * (`videoLabel`) are Spotter's: every choice the coach can be asked for out
 * loud has a control on the board too.
 */

import { clearanceNotice } from './parsers.ts';
import type {
  FitnessConstraints,
  FitnessFlow,
  FitnessPlan,
  FitnessVideo,
} from './parsers.ts';

/** The goal and level the user has chosen, optimistic tap included. */
export interface Selection {
  goal: string;
  level: string;
}

export const NO_OPTIMISM: Selection = { goal: '', level: '' };

/** Which question the app has just published an answer to. */
export type Answered = 'goal' | 'level';

/**
 * The optimism left once the app has answered a question itself.
 *
 * A tap is a GUESS at what the app is about to say, and it is worth holding
 * only until the app says something. It used to be dropped on a plan or on a
 * refusal and on nothing else, so a spoken change of mind never cleared it:
 * tap "Full body", then say "actually glutes", and the app had glutes while
 * `boardMode` — which prefers optimism — kept the header, the highlight and
 * the "Setting up your…" line on Full body, for the rest of the onboarding.
 *
 * A new GOAL settles the level too: the level that was tapped was tapped for
 * the goal that is no longer the goal.
 *
 * Returns the SAME object when there was nothing to settle, so the caller's
 * `setState` bails out rather than re-rendering the board on every flow packet
 * that happens to carry a goal.
 */
export function settleOptimism(answered: Answered, optimistic: Selection): Selection {
  if (answered === 'goal') return optimistic.goal || optimistic.level ? NO_OPTIMISM : optimistic;
  if (!optimistic.level) return optimistic;
  return { goal: optimistic.goal, level: '' };
}

export interface BoardMode {
  /** The clearance sentence, or `''` when the session is running normally. */
  hold: string;
  showVideoStage: boolean;
  showSelectionCards: boolean;
  showLevelSelection: boolean;
  isPlanning: boolean;
  selectedGoal: string;
  selectedLevel: string;
}

/**
 * Which world the board is in.
 *
 * `optimistic` is the tap that has not been acknowledged yet — the panel's own
 * view state, which is why it is a parameter rather than something read from
 * the flow. With no optimism it is exactly a function of what the app said.
 */
export function boardMode(
  flow: FitnessFlow,
  plan: FitnessPlan | null,
  video: FitnessVideo | null,
  optimistic: Selection = NO_OPTIMISM,
): BoardMode {
  const selectedGoal = optimistic.goal.trim() || flow.goal.trim();
  const selectedLevel = optimistic.level.trim() || flow.level.trim();
  // The app has stopped: no plan will be published, no demo will render, and
  // every tool and tap that would advance the flow is refused. Without this the
  // board carried on asking "What do you want to train?", or sat on "Setting up
  // your beginner Full body plan…" for the rest of the call — a screen
  // contradicting a coach who had just said she had to stop.
  const hold = clearanceNotice(flow.constraints);
  const showSelectionCards = !plan && !video && !hold;
  return {
    hold,
    // `&& !hold` because a clip that reached `ready` BEFORE the disclosure is
    // already in state and is never retracted — the server-side hold only stops
    // NEW publishes. Without this the stage kept the <video> mounted, autoplay
    // and looping, directly above a card saying the session had stopped for
    // safety reasons: a workout demo playing at someone the coach had just
    // declined to program for. The same applies to a render still in flight
    // ("Rendering…" over a stopped session) and to the failure card, which is
    // now nobody's problem.
    showVideoStage: (Boolean(plan) || Boolean(video)) && !hold,
    showSelectionCards,
    showLevelSelection: showSelectionCards && Boolean(selectedGoal),
    isPlanning: showSelectionCards && Boolean(selectedGoal && selectedLevel),
    selectedGoal,
    selectedLevel,
  };
}

/* -------------------------------------------------------------------------
 * Which move is being demoed
 * ---------------------------------------------------------------------- */

/**
 * The generation prompt's shape, server-side
 * (`engine/plan.ts` buildStartMovePrompt): "A fitness trainer demonstrates X for a
 * beginner workout focused on …". Everything after the move is direction for
 * the renderer and means nothing to the user.
 */
const PROMPT_TEMPLATE = /demonstrates\s+(.+?)\s+for\s+an?\s/i;
const PROMPT_LOOSE = /demonstrates\s+(.+?)(?:[.,]|$)/i;

const CAPTION_MAX = 64;

function tidy(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
  if (one.length <= CAPTION_MAX) return one;
  return `${one.slice(0, CAPTION_MAX - 1).trimEnd()}…`;
}

/**
 * The move a render prompt is about, or `''` when the prompt is not one of
 * ours.
 *
 * Returning `''` rather than the prompt is the point: the raw prompt is
 * developer-speak ("vertical full-body framing, no complex camera cuts") and
 * it was being printed on the failure card, where the user is already annoyed.
 */
export function moveFromPrompt(prompt: string): string {
  const text = (prompt || '').trim();
  if (!text) return '';
  const exact = PROMPT_TEMPLATE.exec(text);
  if (exact) return tidy(exact[1]);
  const loose = PROMPT_LOOSE.exec(text);
  if (loose) return tidy(loose[1]);
  return '';
}

/**
 * What to caption the video stage with: the move being demoed.
 *
 * `flow.start_move` is the app's own word for it and is preferred wherever
 * the payload carries it; the original's older agents did not send it, so the
 * prompt is the fallback rather than the source.
 */
export function moveCaption(flow: FitnessFlow, video: FitnessVideo | null): string {
  const named = (flow.start_move || '').trim();
  if (named) return tidy(named);
  return moveFromPrompt(video?.prompt ?? '');
}

/* -------------------------------------------------------------------------
 * The goal chips (dealt in engine/goals.ts, where the avatar's state reads them too)
 * ---------------------------------------------------------------------- */

export { GOAL_COUNT, GOAL_SEED, goalOptions, seededShuffle, TRAINING_GOAL_OPTIONS } from '../engine/goals.ts';

/* -------------------------------------------------------------------------
 * Refusals
 * ---------------------------------------------------------------------- */

/**
 * The reason a tap was refused, or `null` when it was not.
 *
 * A refusal RESOLVES rather than throwing (`{ok: false, error}` in the
 * original, `{refused}` from this app's server): in the original, a goal tap
 * during a clearance hold, the one refusal that matters in this app, left the
 * button looking accepted and the board advancing past a session the coach had
 * just stopped.
 */
export function refusalReason(reply: unknown): string | null {
  if (typeof reply !== 'object' || reply === null || Array.isArray(reply)) return null;
  const body = reply as Record<string, unknown>;
  if (typeof body.refused === 'string' && body.refused.trim()) return body.refused.trim();
  const refused = body.ok === false || body.applied === false;
  if (!refused) return null;
  const said = typeof body.error === 'string' ? body.error.trim() : '';
  const because = said || (typeof body.reason === 'string' ? body.reason.trim() : '');
  return because || 'your coach could not record that';
}

/* -------------------------------------------------------------------------
 * Sections the bans emptied
 * ---------------------------------------------------------------------- */

/** How to name the limit that emptied a section, in the user's own terms. */
export function limitLabel(c: FitnessConstraints): string {
  if (c.injuries?.length) return c.injuries.join(' and ');
  if (c.avoid?.length) return `${c.avoid.join(', ')} restriction`;
  if (c.equipment === 'none') return 'no-equipment limit';
  if (c.equipment) return `${c.equipment}-only limit`;
  if (c.minutes) return `${c.minutes} min cap`;
  return '';
}

/** The three lists the plan card draws. */
export type PlanSection = 'warmup' | 'workout' | 'cues';

/**
 * The sections a ban can actually empty.
 *
 * Server-side, `enforce` (engine/constraints.ts) filters `warmup_steps` and
 * `workout_steps` against the bans and leaves `coaching_cues` alone — cues are
 * words, and no injury makes "ribs down" unsafe. So an empty cue list is a
 * model that wrote none, never a refusal.
 */
const BANNABLE: ReadonlySet<PlanSection> = new Set<PlanSection>(['warmup', 'workout']);

/**
 * What an emptied section says instead of disappearing.
 *
 * "Safety beats completeness" is one of the app's owed promises, and the
 * silent version of it — the section simply not rendering — reads as a plan
 * that forgot the warm-up rather than one that had nothing safe to put there.
 *
 * `''` in the two cases where there is nothing honest to say:
 *
 * - nothing was heard — an empty section with no constraint behind it is a
 *   thin plan, not a refusal, and has nothing to explain;
 * - the section is one the bans cannot empty. The notice was being printed
 *   over Form cues, where it claimed "Nothing here is safe with your knee —
 *   ask your coach for an alternative" about COACHING CUES: an alternative to
 *   what, and unsafe how? Nothing renders instead.
 */
export function emptySectionNotice(c: FitnessConstraints, section: PlanSection): string {
  if (!BANNABLE.has(section)) return '';
  const limit = limitLabel(c);
  if (!limit) return '';
  return `Nothing here is safe with your ${limit} — ask your coach for an alternative.`;
}

/* -------------------------------------------------------------------------
 * The plan's move buttons, and the move video's caption
 * ---------------------------------------------------------------------- */

/** Which flow step the board is at, as the server's stage names it. */
export type BoardStage = 'goal' | 'level' | 'planning' | 'move' | 'coach' | 'hold';

/**
 * What tapping a plan move does, in the button's words, or `''` when moves
 * cannot be tapped (no call, no plan yet, or the workout is paused).
 */
export function moveAction(stage: BoardStage, demos: boolean, live: boolean): string {
  if (!live) return '';
  if (stage === 'move') return 'Start here';
  if (stage === 'coach') return demos ? 'Show me' : 'Switch to';
  return '';
}

/**
 * The move video's label. Always says which world it is in, because a
 * prominent empty box reads as broken (the original brief's own rule); and
 * without videos the move is simply coached in words.
 */
export function videoLabel(video: FitnessVideo | null, demos: boolean): string {
  switch (video?.status) {
    case 'ready': return 'Video ready';
    case 'generating': return 'Making your video';
    case 'error': return 'Video didn’t come through';
    case 'unavailable': return 'Coached in words';
    default: return demos ? 'Pick a move to see it' : 'Coached in words';
  }
}
