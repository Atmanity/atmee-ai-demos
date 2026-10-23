/**
 * Everything the board believes, and where it stops believing it.
 *
 * Ported from the original panel's `parsers.ts`. There, the shell relayed
 * whatever arrived without reading it; here the payloads come from this app's
 * own server (an HTTP reply or the event stream), but the board still parses
 * them rather than trusting them: every function returns `null` rather than
 * throwing or half-filling a shape, and `null` means "ignore this", which
 * leaves the last good board on screen.
 */

export interface FitnessPlan {
  plan_title: string;
  goal: string;
  level: string;
  duration_minutes: number;
  warmup_steps: string[];
  workout_steps: string[];
  coaching_cues: string[];
}

export type FitnessFlowStep =
  | 'idle'
  | 'goal_selected'
  | 'level_selected'
  | 'planning'
  | 'plan_ready';

/**
 * What the user said they have to work around: a time cap, no equipment, a
 * bad knee. Every field is optional because the server omits what was never
 * said — the panel must be able to tell "no cap" from "a cap of zero".
 */
export interface FitnessConstraints {
  minutes?: number;
  /** `'none'` when they have nothing, otherwise what they named. */
  equipment?: string;
  injuries?: string[];
  avoid?: string[];
  /**
   * Conditions the coach has said out loud she cannot program around —
   * pregnancy, a cardiac history, recent surgery. Deliberately NOT an injury:
   * an injury chip reads as "your plan works around this", and nothing here
   * was worked around. The session is stopped, and this is how the board says
   * so instead of leaving a chooser or a spinner up under the silence.
   */
  clearance?: string[];
}

export const NO_CONSTRAINTS: FitnessConstraints = {};

export interface FitnessFlow {
  step: FitnessFlowStep;
  goal: string;
  level: string;
  constraints: FitnessConstraints;
  /**
   * The move the demo clip is of, in the app's own words.
   *
   * Optional on the wire (the original's older agents did not publish it), and the board falls
   * back to reading the move out of the render prompt. Never required — a
   * caption is worth having and worth living without.
   */
  start_move: string;
}

export const INITIAL_FLOW: FitnessFlow = {
  step: 'idle',
  goal: '',
  level: '',
  constraints: NO_CONSTRAINTS,
  start_move: '',
};

/**
 * The constraints block. An EMPTY object is a real answer — "nothing to work
 * around" — and must clear whatever was showing, so this returns `{}` rather
 * than null for it. Only a non-object payload is ignored.
 */
export function parseConstraints(payload: unknown): FitnessConstraints | null {
  if (!isObject(payload)) return null;
  const parsed: FitnessConstraints = {};
  const minutes = typeof payload.minutes === 'number' ? payload.minutes : Number(payload.minutes);
  if (Number.isFinite(minutes) && minutes > 0) parsed.minutes = Math.round(minutes);
  const equipment = str(payload.equipment);
  if (equipment) parsed.equipment = equipment;
  const injuries = strList(payload.injuries);
  if (injuries.length) parsed.injuries = injuries;
  const avoid = strList(payload.avoid);
  if (avoid.length) parsed.avoid = avoid;
  const clearance = strList(payload.clearance);
  if (clearance.length) parsed.clearance = clearance;
  return parsed;
}

/** One human line for the chips row, or `''` when there is nothing to say. */
export function constraintChips(c: FitnessConstraints): string[] {
  const chips: string[] = [];
  if (c.minutes) chips.push(`${c.minutes} min cap`);
  if (c.equipment === 'none') chips.push('No equipment');
  else if (c.equipment) chips.push(`Only ${c.equipment}`);
  if (c.injuries?.length) chips.push(`Working around: ${c.injuries.join(', ')}`);
  // `clearance` is deliberately absent: these chips sit under "Built around",
  // and a session that stopped was not built around anything. It gets its own
  // notice instead.
  return chips;
}

/**
 * What the board says when the coach has stopped, or `''` when she has not.
 *
 * The wording tracks the sentence the avatar is given
 * (`engine/constraints.ts` CLEARANCE_LINE_TEMPLATE) on purpose: the user hears one thing
 * and reads another otherwise, and this is the one message in the app that may
 * not be softened. Empty string is the "carry on as normal" signal the panel
 * gates its choosers and its planning spinner on.
 */
export function clearanceNotice(c: FitnessConstraints): string {
  const conditions = c.clearance ?? [];
  if (!conditions.length) return '';
  const spoken =
    conditions.length === 1
      ? conditions[0]
      : `${conditions.slice(0, -1).join(', ')} and ${conditions[conditions.length - 1]}`;
  return (
    `You have mentioned ${spoken}, and your coach is not able to program a workout ` +
    'around that — there is no exercise swap that makes it safe to guess. Please check ' +
    'with your doctor or a qualified health professional first.'
  );
}

/** A flow packet only carries what changed, so fields are optional. */
export type FitnessFlowPatch = Partial<FitnessFlow>;

export type FitnessVideoStatus = 'generating' | 'ready' | 'error' | 'unavailable';

export interface FitnessVideo {
  status: FitnessVideoStatus;
  requestId: string;
  prompt: string;
  /** Present only on `ready`, and always a platform-storage URL. */
  videoUrl?: string;
  /** Present on `error` and `unavailable`. */
  message?: string;
}

const FLOW_STEPS: FitnessFlowStep[] = [
  'idle',
  'goal_selected',
  'level_selected',
  'planning',
  'plan_ready',
];

const VIDEO_STATUSES: FitnessVideoStatus[] = [
  'generating',
  'ready',
  'error',
  'unavailable',
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => str(item)).filter((item) => item.length > 0);
}

function count(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

const SECTION_KEYS = ['warmup_steps', 'workout_steps', 'coaching_cues'] as const;

/**
 * The workout plan.
 *
 * An empty-but-PRESENT section is a real answer, not a broken packet: the
 * bans can empty one, and "safety beats completeness" means the board says so
 * rather than hiding it. What is rejected is a payload that carries no
 * sections at all — nothing to coach from, and replacing a good plan with it
 * would blank a board the user is mid-workout on.
 */
export function parsePlan(payload: unknown): FitnessPlan | null {
  if (!isObject(payload)) return null;
  const declared = SECTION_KEYS.some((key) => key in payload);
  const plan: FitnessPlan = {
    plan_title: str(payload.plan_title) || "Today's plan",
    goal: str(payload.goal),
    level: str(payload.level),
    duration_minutes: count(payload.duration_minutes),
    warmup_steps: strList(payload.warmup_steps),
    workout_steps: strList(payload.workout_steps),
    coaching_cues: strList(payload.coaching_cues),
  };
  if (!plan.workout_steps.length && !plan.warmup_steps.length && !declared) return null;
  return plan;
}

/**
 * A flow update. Only the fields actually present are returned, because the
 * original agent sent partial updates and an absent `goal` means "unchanged", not
 * "cleared" — filling it with `''` would blank the chooser mid-onboarding.
 */
export function parseFlow(payload: unknown): FitnessFlowPatch | null {
  if (!isObject(payload)) return null;
  const patch: FitnessFlowPatch = {};
  const step = str(payload.step);
  if (step && (FLOW_STEPS as string[]).includes(step)) {
    patch.step = step as FitnessFlowStep;
  }
  if (typeof payload.goal === 'string') patch.goal = payload.goal.trim();
  if (typeof payload.level === 'string') patch.level = payload.level.trim();
  // Absent means the server does not publish it (or has nothing to say yet);
  // present-and-empty clears a caption for a move that is no longer the one
  // on the stage.
  if (typeof payload.start_move === 'string') patch.start_move = payload.start_move.trim();
  // Absent means unchanged (older payloads had no such key); present-and-empty
  // means "nothing to work around" and must clear the chips.
  if ('constraints' in payload) {
    const constraints = parseConstraints(payload.constraints);
    if (constraints) patch.constraints = constraints;
  }
  return Object.keys(patch).length ? patch : null;
}

export function applyFlow(current: FitnessFlow, patch: FitnessFlowPatch): FitnessFlow {
  return { ...current, ...patch };
}

/**
 * The demo clip's state.
 *
 * `ready` without a playable URL is rejected rather than rendered: it would
 * mount a <video> with an empty src, which shows a broken player and no
 * explanation. The URL is this app's own clip route (a same-origin path) or
 * http(s); anything else (`file:`, `javascript:`, a protocol-relative `//`)
 * is refused.
 */
export function parseVideo(payload: unknown): FitnessVideo | null {
  if (!isObject(payload)) return null;
  const status = str(payload.status);
  if (!(VIDEO_STATUSES as string[]).includes(status)) return null;

  const video: FitnessVideo = {
    status: status as FitnessVideoStatus,
    requestId: str(payload.request_id),
    prompt: str(payload.prompt),
  };

  const url = str(payload.video_url);
  if (video.status === 'ready') {
    if (!/^(https?:\/\/|\/(?!\/))/i.test(url)) return null;
    video.videoUrl = url;
  }

  const message = str(payload.message);
  if (message) video.message = message;
  return video;
}

export interface FitnessSnapshot {
  flow: FitnessFlow;
  plan: FitnessPlan | null;
  video: FitnessVideo | null;
}

/**
 * The server's view of the board: the same three shapes in one object.
 *
 * Routed through the same three parsers on purpose: the original read its
 * rehydration reply and its live topics through one set of parsers, so they
 * could not drift apart. Here every reply and every streamed outcome is a
 * snapshot, and all of them go through this.
 */
export function parseSnapshot(payload: unknown): FitnessSnapshot | null {
  if (!isObject(payload)) return null;
  const flowPatch = parseFlow(payload.flow);
  const flow = flowPatch ? applyFlow(INITIAL_FLOW, flowPatch) : INITIAL_FLOW;
  // The sync reply carries constraints at the top level as well as inside
  // `flow`, because they outlive any one flow step.
  const constraints = parseConstraints(payload.constraints);
  return {
    flow: constraints ? { ...flow, constraints } : flow,
    plan: parsePlan(payload.plan),
    video: parseVideo(payload.video),
  };
}
