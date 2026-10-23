// What the host (Sammy) is told, and how it acts. The coach (engine/coach.ts)
// decides everything: the goal, the level, the plan, the limits it obeys, the
// starting move, the move video and the safety stop. The host reaches it only
// through the tools below, and speaks from what each one returns.
//
// - INSTRUCTIONS: the host's role and the rules that came from live failures
//   (the session's tool instructions, at most 4,000 characters).
// - TOOLS: what the host can do, each one awaited so its first reply carries
//   the coach's real outcome.
// - boardState(view): the live screen as plain sentences, so questions about
//   it are answered without a tool.
// - say.*: what an action did, in words the host speaks from (a tool's result,
//   or an event after a tap or background work).
import type { AppTool } from '../../../server/app-server.ts';
import { acknowledgementLine, clearanceLine, spokenConditions, summaryLine } from './constraints.ts';
import { baseMoveName } from './plan.ts';
import type { ConstraintsPayload, FitnessPlan, Intent, VideoPayload, View } from './types.ts';

/** The Avatar API's limits. */
export const INSTRUCTIONS_MAX = 4000;
export const STATE_MAX = 3858;

/** The host's rules: the session's tool instructions. */
export const INSTRUCTIONS = `You are the coach on Spotter, coaching one person through a first workout on a live call. Spotter is on their screen; you cannot see it. Spotter decides the plan: what they train, their level, the limits it obeys, the moves, any move video and the safety stop. You reach it only through its tools, and the screen changes only when you call one.
- They say what they want to train ("glutes", "full body", "core and cardio, I'm a beginner"): call set_goal, with the level too if they said one.
- They give their level, or ask for an easier or harder plan: call set_level. It builds or rebuilds the plan.
- They mention a limit at any point (only so many minutes, no or only some equipment, a bad or sore knee, back, shoulder, wrist, ankle, hip, neck or elbow, an injury like a torn ACL, a move to avoid): call add_limits with their words. Never say the plan works around something until the result says so.
- They pick a move to start with or switch to ("the plank", "the first warm-up move"): call start_move.
- "Start over", "something else entirely": call start_over, only when they ask; never on your own.
- STOP RULE, from a real failure: if they mention pregnancy or a recent birth, chest pain, a heart condition or heart attack, high blood pressure, recent surgery or an operation, a fracture or broken bone, a concussion, dizziness or fainting, or anything else a doctor should clear first, call stop_for_safety at once, before you say anything else, and say what it returns. From then on never coach, suggest or name any exercise, warm-up, stretch or modification, never resume the plan, and never soften the stop. A sore or injured joint is a limit (add_limits), not a stop.
- Call the tool every time, even when you think you know the outcome. Never invent or assume one: a plan, a duration, a move, a video, a change. Saying "I've rebuilt it" without the call changes nothing and misleads them.
- Never name a move the live screen in your context does not list: moves are removed for their safety, so an earlier list may be out of date. Never say a move video is ready or coming unless the screen says so.
- Questions about what is on the screen (the plan, a move's reps, the limits, the level): answer from the live screen in your context, no tool needed.
- When they tap something on the screen you are told what happened; carry on from that.
How you coach: warm and gently direct. Form cues short and visual ("ribs down", "soft knees", "push the floor away", "slow on the way down"). Celebrate small wins with one honest spark, not a slogan. Never promise results or medical outcomes; no shame, no fake grind, no body or calorie talk; no invented backstory. One or two short spoken sentences, at most one question, no lists, no colons, and never mention tools, keys or systems.`;

const awaits = (timeoutSeconds: number) => ({ mode: 'await' as const, timeoutSeconds });
const noArgs = { type: 'object', properties: {}, additionalProperties: false };
const LEVEL_ENUM = ['beginner', 'intermediate', 'advanced'];

/** How long a tool that builds or rebuilds a plan waits for it, on the server (under the tool's timeout). */
export const PLAN_WAIT_MS = 13_000;

/** The coach's tools. Each is answered by the page, which asks the server. */
export const TOOLS: AppTool[] = [
  {
    type: 'function', name: 'set_goal',
    description: 'Records what the user wants to train, and their level if they said it in the same breath; with a level known it builds their plan and says what is on the screen. Call it whenever they say what they want to train.',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', minLength: 1, maxLength: 80, description: 'What they want to train, in their words, e.g. "glutes", "core and cardio", "mobility".' },
        level: { type: 'string', enum: LEVEL_ENUM, description: 'Their level, only if they said it.' },
      },
      required: ['goal'], additionalProperties: false,
    },
    'x-atmee': awaits(20),
  },
  {
    type: 'function', name: 'set_level',
    description: 'Records the user\'s level and builds their plan, or rebuilds the plan on the screen at another level, and says what is on the screen. Call it when they give their level or ask for an easier or harder plan.',
    parameters: {
      type: 'object',
      properties: { level: { type: 'string', enum: [...LEVEL_ENUM, 'easier', 'harder'], description: 'The level they named, or "easier" / "harder" to move one level from the plan on the screen.' } },
      required: ['level'], additionalProperties: false,
    },
    'x-atmee': awaits(20),
  },
  {
    type: 'function', name: 'add_limits',
    description: 'Records something the user has to work around (a time limit, the equipment they have, a sore or injured joint, a move to avoid) and rebuilds any plan on the screen to obey it. Call it whenever they mention one, at any step.',
    parameters: {
      type: 'object',
      properties: { words: { type: 'string', minLength: 1, maxLength: 300, description: 'Their words about it, e.g. "only twenty minutes", "no equipment", "my left knee is bad", "no jumping".' } },
      required: ['words'], additionalProperties: false,
    },
    'x-atmee': awaits(20),
  },
  {
    type: 'function', name: 'start_move',
    description: 'Starts the user on a move from the plan on the screen, or switches to another, and says how to coach it. Call it when they pick a move ("the plank", "the first warm-up move") or ask to see one.',
    parameters: {
      type: 'object',
      properties: { move: { type: 'string', minLength: 1, maxLength: 80, description: 'The move as they said it, by name or by position.' } },
      required: ['move'], additionalProperties: false,
    },
    'x-atmee': awaits(10),
  },
  {
    type: 'function', name: 'start_over',
    description: 'Clears the plan and goes back to choosing what to train; the limits they gave are kept. Only when the user asks to start over or train something else; never on your own.',
    parameters: noArgs,
    'x-atmee': awaits(8),
  },
  {
    type: 'function', name: 'stop_for_safety',
    description: 'Stops the workout for a condition a doctor should clear first (pregnancy, chest pain, a heart condition, high blood pressure, recent surgery, a fracture, a concussion, dizziness, fainting) and gives you the words to say. Call it at once when the user mentions one.',
    parameters: {
      type: 'object',
      properties: { condition: { type: 'string', minLength: 1, maxLength: 120, description: 'The condition in their words, e.g. "seven months pregnant", "a heart attack last year".' } },
      required: ['condition'], additionalProperties: false,
    },
    'x-atmee': awaits(8),
  },
];

const quoted = (s: string) => `"${s}"`;
/** A goal as said mid-sentence: "Glutes + legs" -> "glutes and legs", HIIT kept. */
export const spokenGoal = (goal: string) =>
  goal.replace(/ \+ /g, ' and ').split(' ').map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
const names = (steps: string[]) => steps.map(baseMoveName).join(', ');

function toConstraints(c: ConstraintsPayload) {
  return { minutes: c.minutes ?? null, equipment: c.equipment ?? '', avoid: c.avoid ?? [], injuries: c.injuries ?? [], clearance: c.clearance ?? [] };
}

/** The six goals the screen shows (dealt by engine/goals.ts, as the board deals them), as the host may name them. */
export const goalsOnScreen = (v: View) => spokenConditions(v.goalOptions.map(spokenGoal));

function planLine(plan: FitnessPlan | null, detail: number): string {
  if (!plan) return 'Plan: nothing on the screen yet.';
  const steps = (list: string[]) => {
    if (!list.length) return 'nothing safe to offer';
    return (detail >= 2 ? list : list.map(baseMoveName)).join('; ');
  };
  const cues = detail >= 1 && plan.coaching_cues.length ? ` Form cues: ${plan.coaching_cues.join('; ')}.` : '';
  return `Plan on the screen: ${quoted(plan.plan_title)}, ${plan.level}, ${plan.duration_minutes} minutes. `
    + `Warm-up: ${steps(plan.warmup_steps)}. Workout, in order: ${steps(plan.workout_steps)}.${cues}`;
}

/**
 * The move video in the words the host answers in. Never the render prompt:
 * it names a move, and a superseded render's prompt is one more stale list.
 */
export function videoLine(video: VideoPayload | null, demos: boolean, move: string): string {
  const of = move ? ` of ${move}` : '';
  if (!demos && (!video || video.status === 'unavailable')) return 'There are no move videos: coach every move in words, and never promise or mention a video.';
  if (!video) return 'Move video: none made yet; start_move makes one for the move they pick.';
  switch (video.status) {
    case 'ready': return `Move video${of}: READY and playing on the screen.`;
    case 'generating': return `Move video${of}: still being made, NOT on the screen yet; it takes a minute or two.`;
    case 'error': return `Move video${of}: FAILED, there is no clip on the screen. Do not promise one.`;
    default: return 'There are no move videos: coach every move in words, and never promise one.';
  }
}

function stageLine(v: View): string {
  const { goal, level } = v.flow;
  switch (v.stage) {
    case 'goal':
      return `Step 1 of 4, what to train. The screen asks "What do you want to train?" and offers ${goalsOnScreen(v)} to tap; they can also name anything else. `
        + (v.overheardLevel ? `They already said their level is ${v.overheardLevel.toLowerCase()}; set_goal will use it. ` : '')
        + 'No plan exists yet: do not list or invent moves.';
    case 'level':
      return `Step 2 of 4, the level. Goal: ${spokenGoal(goal)}. The screen offers Beginner, Intermediate and Advanced to tap. No plan exists yet: do not list or invent moves.`;
    case 'planning':
      return `Step 3 of 4. Their ${level.toLowerCase()} ${spokenGoal(goal)} plan is being built and is NOT on the screen yet. If asked, say it will be up in a moment. Do not list or invent moves.`;
    case 'move':
      return 'Step 4 of 4, the starting move. The plan is on the screen; they pick the move to start with by tapping it or saying it.';
    case 'coach':
      return `Now coaching ${v.flow.start_move}. Talk them through it with clear, visual form cues and answer their questions about the plan; they can tap or name another move to switch.`;
    default:
      return '';
  }
}

function holdState(v: View): string {
  const conditions = spokenConditions(v.constraints.clearance ?? []);
  return 'Spotter, live screen. WORKOUT STOPPED FOR SAFETY, on hold. '
    + `The user has disclosed ${conditions}. The screen says the workout is paused until a doctor or qualified health professional clears them, and shows no exercises. The plan is frozen and NOT adapted for it, and any move video is off the screen. `
    + 'Do not coach, suggest, demo or name any exercise, warm-up, stretch or modification, do not mention the plan or a video, and say nothing that softens this. '
    + `If they ask to carry on or for a workout, kindly say again that you are not able to program around ${conditions} and that they need to be cleared by their doctor or a qualified health professional first; once they are cleared you would love to pick this up again.`;
}

/** The live screen, as the host's state. Never longer than the API allows, never a clip address or a render prompt. */
export function boardState(v: View): string {
  if (v.constraints.clearance?.length) return holdState(v);
  for (const detail of [2, 1, 0]) {
    const parts = ['Spotter, live screen.', planLine(v.plan, detail)];
    if (v.plan && v.rebuilding) {
      parts.push('A rebuild for the limits below is IN FLIGHT: the moves above are the OLD ones and the screen has not been updated yet, so do not read them out as the new plan.');
    } else if (v.plan && v.planning) {
      parts.push(`A new plan at ${v.flow.level.toLowerCase()} level is being built; the moves above are the old ones until it lands.`);
    }
    const limits = summaryLine(toConstraints(v.constraints));
    if (limits) {
      const standing = !v.plan
        ? 'The plan will be built around these.'
        : v.rebuilding
          ? 'The plan on the screen has NOT been updated for these yet; do not say it already obeys them.'
          : 'The plan on the screen already obeys these; never offer to change it to something it already is.';
      parts.push(`Limits heard: ${limits}. ${standing}`);
    }
    if (v.stage === 'move' || v.stage === 'coach' || v.video || !v.demos) parts.push(videoLine(v.video, v.demos, v.flow.start_move));
    parts.push(stageLine(v));
    const text = parts.filter(Boolean).join(' ');
    if (text.length <= STATE_MAX) return text;
  }
  return boardStateTrimmed(v);
}

/** The last resort for an outsized plan: the step line always survives. */
function boardStateTrimmed(v: View): string {
  const tail = ` ${stageLine(v)}`;
  return `Spotter, live screen. ${planLine(v.plan, 0)}`.slice(0, STATE_MAX - tail.length) + tail;
}

const describe = (intent: Intent | string) => {
  if (typeof intent === 'string') return intent;
  switch (intent.kind) {
    case 'goal': return 'choose what to train';
    case 'level': return 'pick a level';
    case 'relevel': return 'change the level of the plan';
    case 'restart': return 'start over';
    default: return 'start a move';
  }
};

/** The limits a plan was built around, as a phrase ("a 20 minute cap, no equipment and their knee"). */
export function builtAround(c: ConstraintsPayload): string {
  const bits: string[] = [];
  if (c.minutes) bits.push(`a ${c.minutes} minute cap`);
  if (c.equipment === 'none') bits.push('no equipment');
  else if (c.equipment) bits.push(`only ${c.equipment}`);
  for (const part of c.injuries ?? []) bits.push(`their ${part}`);
  return spokenConditions(bits);
}

/** What an action did, in words the host speaks from. */
export const say = {
  start: (v: View) => `Spotter is open on the user's screen, asking what they want to train, with six choices to tap (${goalsOnScreen(v)}). Introduce yourself as their coach for today in one sentence, then ask what they want to train today, naming a few options such as full body, HIIT, glutes, core or mobility. Two short sentences at most, ending on the question.`,
  resume: (v: View) => `The user called you back; Spotter is where you left it${v.stage === 'hold' ? ', stopped for their safety' : ''}. Welcome them back in one sentence and carry on from the live screen in your context.`,
  goal: (goal: string) => `Recorded: they want to train ${spokenGoal(goal)}, and the screen now asks their level. Say a few words about it, like "Nice, ${spokenGoal(goal)}, I can build that", then ask their level, beginner, intermediate or advanced.`,
  goalAndLevel: (goal: string, level: string) => `Recorded: ${spokenGoal(goal)} at ${level.toLowerCase()} level. Their plan is being put together now and is NOT on the screen yet. Say you are putting together their ${level.toLowerCase()} ${spokenGoal(goal)} plan. Do not list or invent any moves.`,
  levelOnly: (level: string) => `Recorded their level (${level.toLowerCase()}), but not what they want to train. Say "got it on the level" in your own words and ask what they want to train today.`,
  level: (goal: string, level: string) => `Recorded: ${level.toLowerCase()} for ${spokenGoal(goal)}. Their plan is being put together now and is NOT on the screen yet. Say you are putting together their ${level.toLowerCase()} ${spokenGoal(goal)} plan. Do not list or invent any moves.`,
  planReady: (plan: FitnessPlan, around: string) => `The plan is on the screen now: ${quoted(plan.plan_title)}, ${plan.level.toLowerCase()}, ${plan.duration_minutes} minutes${around ? `, built around ${around}` : ''}. Warm-up ${names(plan.warmup_steps) || 'none'}. Workout ${names(plan.workout_steps) || 'none'}. Tell them it is up in one short sentence without reading every move, then ask which move they want to start with; they can tap one.`,
  replanned: (plan: FitnessPlan, droppedMove: string) => `The plan was rebuilt at ${plan.level.toLowerCase()} level and is on the screen now: ${quoted(plan.plan_title)}, ${plan.duration_minutes} minutes. Workout ${names(plan.workout_steps) || 'none'}. Tell them in one short sentence.${droppedMove ? ` The video of ${droppedMove} is off the screen because the moves changed; ask which move they want to start with now.` : ''}`,
  rebuilt: (line: string, plan: FitnessPlan, droppedMove: string) => `The plan was rebuilt around the limits they gave. ${line} Tell them that in your own words in one sentence. The moves on the screen now are ${names([...plan.warmup_steps, ...plan.workout_steps]) || 'none'}; name no others.${droppedMove ? ` The demo of ${droppedMove} was taken off the screen because it is no longer on the plan; ask which move they want to start with now.` : ''}`,
  moveNoDemo: (move: string) => `Starting ${move}; it is highlighted on the screen. Talk them through it in three or four short sentences, the setup and two or three form cues they can act on. There is no video for it, so do not mention one.`,
  moveRendering: (move: string) => `Starting ${move}. A short video of it is being made; it takes a minute or two and is NOT on the screen yet. Tell them, then talk them through the setup meanwhile. Do not say it is ready.`,
  switchMove: (move: string) => `Switched to ${move}; it is highlighted on the screen. Talk them through it in three or four short sentences, the setup and two or three form cues they can act on.`,
  moveAgain: (move: string, video: VideoPayload | null) => `${move} is already the move on the screen${video?.status === 'ready' ? ' with its video playing' : ''}. Carry on coaching it.`,
  demoReady: (move: string) => `The demo of ${move} is on the screen now. Point them to it in one short sentence, like "Your video is up on the screen, give it a watch."`,
  demoFailed: (move: string) => `The demo of ${move} did not come through, so there is no clip. Say so plainly in one short sentence and keep coaching the move in words. Do not promise to try again.`,
  notOnPlan: (heard: string, plan: FitnessPlan) => `${quoted(heard)} is not on today's plan. Say so kindly and offer moves from it, like ${names(plan.warmup_steps.concat(plan.workout_steps).slice(0, 3))}; start one only when they pick it.`,
  noPlanYet: () => 'There is no plan on the screen yet, so no move can start. Say you will get to moves as soon as their plan is built.',
  whichMove: (plan: FitnessPlan) => `No move was named. Ask which move from the plan they want, like ${names(plan.warmup_steps.concat(plan.workout_steps).slice(0, 3))}.`,
  sameLevel: (level: string) => `The plan on the screen already is ${level.toLowerCase()}. Say so briefly.`,
  relevel: (level: string) => `Rebuilding the plan at ${level.toLowerCase()} level; the new plan is NOT on the screen yet. Say you are rebuilding it. Do not list moves yet.`,
  restart: () => 'Started over: the plan is cleared and the screen asks what they want to train again; the limits they gave are kept. Ask what they want to train today.',
  /**
   * The original spoke this sentence from code, word for word. The API cannot:
   * a result is said in the host's own words. So the exact words go in, and
   * the screen shows the same words as the source of truth.
   */
  clearance: (conditions: string[]) => `IMPORTANT, safety. The user has told you about ${spokenConditions(conditions)}. The workout is stopped and the screen says so. Say this to them, as close to word for word as you can, and nothing else: ${quoted(clearanceLine(conditions))} Do not suggest any exercise or modification, and do not mention the plan or a video.`,
  onHold: (intent: Intent | string) => `The user asked to ${describe(intent)}, but the workout is on hold for their safety. Kindly say again that you are not able to continue until a doctor or qualified health professional clears them. Suggest no exercise.`,

  // Only the tools say these.
  noGoal: () => 'No goal was given. Ask what they want to train today.',
  goalLocked: (v: View) => `Their ${spokenGoal(v.flow.goal || 'current')} plan is already ${v.plan ? 'on the screen' : 'being built'}. Training something else means starting over: ask whether they want to start over, and call start_over only if they say yes.`,
  noLevel: () => 'No level was given. Ask whether they are a beginner, intermediate or advanced.',
  noPlanToChange: () => 'There is no plan yet to make easier or harder. Ask their level, beginner, intermediate or advanced.',
  levelEdge: (level: string, way: 'easier' | 'harder') => `The plan is already at the ${way === 'easier' ? 'easiest' : 'hardest'} level, ${level.toLowerCase()}. Say so briefly${way === 'easier' ? ', and that they can take every move slower and stop short of strain' : ''}.`,
  limitUnread: () => 'Nothing in those words is a limit the plan can work around, so nothing changed. It can work around a time limit, the equipment they have, a sore or injured knee, back, shoulder, wrist, ankle, hip, neck or elbow (or an injury like a torn ACL), or a named move to avoid. Tell them briefly and ask them to put it one of those ways.',
  limitKnown: (summary: string, planned: boolean) => `Already noted: ${summary}. ${planned ? 'The plan on the screen already works around it.' : 'Their plan will be built around it.'} Say so in a few words.`,
  limitNoted: (labels: string[], building: boolean) => `Noted on ${spokenConditions(labels)}; ${building ? 'the plan being built will obey it' : 'their plan will be built around it'}. Acknowledge it in a few words, like ${quoted(acknowledgementLine(labels, false))}, then carry on from the screen.`,
  limitApplied: (labels: string[], change: string) => `Noted on ${spokenConditions(labels)}. ${change}`,
  limitNoChange: (labels: string[]) => `Noted on ${spokenConditions(labels)}. The plan on the screen already works around it, so nothing had to change. Tell them so in one sentence.`,
  stillBuilding: (v: View) => `Their ${v.flow.level.toLowerCase()} ${spokenGoal(v.flow.goal)} plan is still being built and is NOT on the screen yet. Say it will be up in a moment. Do not list or invent moves. You will be told when it lands.`,
  stillRebuilding: (labels: string[]) => `${labels.length ? `Noted on ${spokenConditions(labels)}. ` : ''}The plan is being reworked and the screen has NOT changed yet. Say so in a few words and name no moves. You will be told when it lands.`,
  notAStop: () => 'That is a limit to work around, not a reason to stop, so the workout carries on.',
  nothingNew: (v: View) => `Nothing changed: ${v.plan ? 'the plan on the screen stays as it is' : v.planning ? 'their plan is still being built' : 'the screen is where it was'}. Carry on from the live screen in your context.`,
};

/** A tap on the screen, told to the host: it cannot see the screen. */
export const pressed = (what: string, outcome: string) => `The user tapped ${what} on the screen. ${outcome}`;
