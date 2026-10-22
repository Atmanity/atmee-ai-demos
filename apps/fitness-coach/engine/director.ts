// What the avatar is told, and when. The app's step machine decides the goal,
// the level, the plan, the starting move and the demo; the avatar coaches.
//
// - NOTES: standing rules, condensed from the original AGENT_INSTRUCTIONS and
//   the hard-won "never do X" rules in its flow and notes.
// - boardState(view): the screen as plain sentences (the original `[Panel]`
//   and `[Plan constraints]` notes, merged), plus what to say if the user does
//   the predictable next thing ("pre-staged"), because the avatar answers
//   speech before the app can act on it.
// - say.*: one event text per outcome, said in the avatar's own words.
import { acknowledgementLine, clearanceLine, spokenConditions, summaryLine } from './constraints.ts';
import { baseMoveName } from './plan.ts';
import type { ConstraintsPayload, FitnessPlan, Intent, VideoPayload, View } from './types.ts';

/** The Avatar API's limits. */
export const NOTE_MAX = 2000;
export const STATE_MAX = 3858;

export const NOTES = [
  `You are coaching one person through a first workout on a live video call. A fitness app on their screen runs the session with you: it asks what they want to train and their level, builds their plan, and shows a short demo of the move they start with. Make them feel seen, capable and invited in. Be gently direct about form and safety: if something sounds risky, slow them down and give a safer option. Keep form cues visual and easy to act on, like "ribs down", "soft knees", "push the floor away", "slow on the way down". Celebrate small wins, one honest spark rather than a slogan. Never promise results or medical outcomes. No shame, no fake grind, no body or calorie talk. Do not sound like a menu, a status bot or a wellness brochure, and do not invent a personal backstory or anecdotes. Usually one or two short sentences, at most one question per turn, and never answer a question you just asked. Spoken words only, no lists or labels, and never use colon punctuation.`,
  `The app, not you, decides the goal, the level, the plan, the starting move and the demo video, and its state tells you what is on the screen. You cannot see the screen. Never invent a plan, a duration or a move, and never name a move the state does not list: moves get removed for the user's safety, so a move list from earlier in the conversation may be out of date. Never say a demo video is ready, playing or coming unless the state says so, and never mention keys, systems, tools or anything the user cannot see. When the user answers your question or picks something, follow the state's "if the user" lines: say a few words and let the app act; it tells you the outcome a moment later, and if it already has, carry on from it. The user can also tap choices on the screen; you are told about taps. When the app says the plan is on the screen, say so in a sentence and ask which move they want to start with.`,
  `When the user mentions a limit (only so many minutes, no equipment, a bad knee, back, shoulder, wrist, ankle, hip, neck or elbow, or a move they want to avoid), acknowledge it in a few words, like "Noted on your knee, I'll build the plan around it", and do not list moves until the app tells you the plan; the app enforces every limit in the plan itself. STOP RULE, from a real failure: if the user mentions pregnancy or a recent birth, chest pain, a heart condition or heart attack, high blood pressure, recent surgery or an operation, a fracture or broken bone, a concussion, dizziness or fainting, do not suggest any exercise, warm-up, stretch or modification and do not say you will adapt anything. Say that you have to stop there, that you are not able to program a workout around that because no exercise swap makes it safe to guess, and that they should check with their doctor or a qualified health professional first. The app then puts the session on hold. Nothing you say may soften that, work around it or resume the plan, and you never coach or name an exercise again in this session.`,
];

const quoted = (s: string) => `"${s}"`;
/** A goal as said mid-sentence: "Glutes + legs" -> "glutes and legs", HIIT kept. */
export const spokenGoal = (goal: string) =>
  goal.replace(/ \+ /g, ' and ').split(' ').map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
const names = (steps: string[]) => steps.map(baseMoveName).join(', ');

function toConstraints(c: ConstraintsPayload) {
  return { minutes: c.minutes ?? null, equipment: c.equipment ?? '', avoid: c.avoid ?? [], injuries: c.injuries ?? [], clearance: c.clearance ?? [] };
}

/** The six goals the screen shows (dealt by engine/goals.ts, as the board deals them), as the avatar may name them. */
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
 * The demo clip in the words the avatar answers in. Never the prompt: it names
 * a move, and a superseded render's prompt is one more stale move list.
 */
export function videoLine(video: VideoPayload | null, demos: boolean, move: string): string {
  const of = move ? ` of ${move}` : '';
  if (!video) return demos ? 'Demo video: none requested yet.' : 'Demo videos are switched OFF in this session: no clip will ever arrive, so never promise one.';
  switch (video.status) {
    case 'ready': return `Demo video${of}: READY and playing on the screen.`;
    case 'generating': return `Demo video${of}: still rendering, NOT on the screen yet; it takes a minute or two.`;
    case 'unavailable': return 'Demo video: UNAVAILABLE, demos are not switched on in this session and no clip will arrive. Do not promise one.';
    case 'error': return `Demo video${of}: FAILED, there is no clip on the screen. Do not promise one.`;
    default: return '';
  }
}

/** What the avatar says when the user picks a move, staged before they do. */
const pickLine = (demos: boolean) => (demos
  ? 'say you are making a short demo of it, which takes a minute or two and shows up on the screen when it is ready, and talk them through the setup meanwhile; never say it is ready until the app tells you'
  : 'say plainly in one short sentence that demo videos are off in this session, then talk them through that move in three or four short sentences, the setup and two or three form cues they can act on');

function stageLine(v: View): string {
  const { goal, level } = v.flow;
  switch (v.stage) {
    case 'goal':
      return `Step 1 of 4, what to train. The screen asks "What do you want to train?" and offers ${goalsOnScreen(v)} to tap. `
        + 'If the user says what they want to train, say a few words about it, like "Nice, glutes. I can build that.", then ask their level, beginner, intermediate or advanced. '
        + (v.overheardLevel
          ? `They already said their level is ${v.overheardLevel.toLowerCase()}, so do not ask for it; once they say what to train, say you are putting their plan together now. `
          : 'If they say what to train and their level together, acknowledge both and say you are putting their plan together now. ')
        + 'If they give only a level, say "got it on the level" and ask what they want to train.';
    case 'level':
      return `Step 2 of 4, the level. Goal: ${spokenGoal(goal)}. The screen offers Beginner, Intermediate and Advanced to tap. `
        + `If the user gives a level, say you are putting together their ${spokenGoal(goal)} plan now and it will be on the screen in a few seconds. Do not list or invent any moves yet.`;
    case 'planning':
      return `Step 3 of 4. Their ${level.toLowerCase()} ${spokenGoal(goal)} plan is being built and is NOT on the screen yet. If asked, say it will be up in a moment. Do not list or invent any moves.`;
    case 'move':
      return 'Step 4 of 4, the starting move. The user can tap a move on the screen or say one, by name or like "the first warm-up move". '
        + `If they name a move from the plan, ${pickLine(v.demos)}. If they name a move that is not on the plan, say it is not on today's plan and offer two moves from it. `
        + 'If they are vague ("ok", "ready"), ask them to name one move from the plan. If they ask for an easier or harder plan, say you will rebuild it at that level.';
    case 'coach':
      return `Now coaching ${v.flow.start_move}. Talk them through it with clear, visual form cues and answer their questions about the plan. `
        + (v.demos
          ? `They can tap any move on the plan for its demo. If they ask for a demo of another move from the plan, ${pickLine(true)}. If they ask for a demo without naming a move, ask which one. `
          : 'They can tap any move on the plan to switch to it; demo videos are off in this session, so coach every move in words. ')
        + 'If they ask for an easier or harder plan, say you will rebuild it at that level.';
    default:
      return '';
  }
}

function holdState(v: View): string {
  const conditions = spokenConditions(v.constraints.clearance ?? []);
  return 'Fitness coach app, live screen. SESSION ON HOLD. '
    + `The user has disclosed ${conditions}. The app has stopped the workout and the screen says so. The plan is frozen and NOT adapted for it, and any demo video is off the screen. `
    + 'Do not coach, suggest, demo or name any exercise, warm-up, stretch or modification, do not mention the plan or a demo, and say nothing that softens this. '
    + `If they ask to carry on or for a workout, kindly say again that you are not able to program around ${conditions} and that they need to be cleared by their doctor or a qualified health professional first; once they are cleared you would love to pick this up again.`;
}

/** The live screen, as the avatar's state. Never longer than the API allows. */
export function boardState(v: View): string {
  if (v.constraints.clearance?.length) return holdState(v);
  for (const detail of [2, 1, 0]) {
    const parts = ['Fitness coach app, live screen.', planLine(v.plan, detail)];
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
      const said = v.acknowledged.length ? ` You have already acknowledged ${spokenConditions(v.acknowledged)}; do not acknowledge it again.` : '';
      parts.push(`Limits heard: ${limits}. ${standing}${said}`);
    }
    if (v.stage === 'move' || v.stage === 'coach' || v.video) parts.push(videoLine(v.video, v.demos, v.flow.start_move));
    else if (!v.demos) parts.push(videoLine(null, false, ''));
    parts.push(stageLine(v));
    const text = parts.filter(Boolean).join(' ');
    if (text.length <= STATE_MAX) return text;
  }
  return boardStateTrimmed(v);
}

/** The last resort for an outsized plan: the stage line always survives. */
function boardStateTrimmed(v: View): string {
  const tail = ` ${stageLine(v)}`;
  return `Fitness coach app, live screen. ${planLine(v.plan, 0)}`.slice(0, STATE_MAX - tail.length) + tail;
}

const describe = (intent: Intent) => {
  switch (intent.kind) {
    case 'goal': return 'choose what to train';
    case 'level': return 'pick a level';
    case 'relevel': return 'change the level of the plan';
    case 'restart': return 'start over';
    default: return 'start a move';
  }
};

/** The ack clause for a typed line that also carried new limits, appended to its event. */
export const ackClause = (labels: string[], rebuilding: boolean) =>
  labels.length ? ` They also told you about ${spokenConditions(labels)}: acknowledge that in a few words, like "${acknowledgementLine(labels, rebuilding)}"` : '';

/** The limits a plan was built around, as a phrase ("a 20 minute cap, no equipment and your knee"). */
export function builtAround(c: ConstraintsPayload): string {
  const bits: string[] = [];
  if (c.minutes) bits.push(`a ${c.minutes} minute cap`);
  if (c.equipment === 'none') bits.push('no equipment');
  else if (c.equipment) bits.push(`only ${c.equipment}`);
  for (const part of c.injuries ?? []) bits.push(`their ${part}`);
  return spokenConditions(bits);
}

export const say = {
  start: (v: View) => `The fitness app is open on the user's screen: it asks what they want to train, with six choices to tap (${goalsOnScreen(v)}). Introduce yourself as their coach for today in one sentence, then ask what they want to train today, naming a few options such as full body, HIIT, glutes, core or mobility. Two short sentences at most, ending on the question.`,
  resume: (v: View) => `The user is back on the call; the fitness app on their screen is where you left it. Welcome them back in one sentence and carry on from the screen as the state describes it${v.stage === 'hold' ? ', which is on hold' : ''}.`,
  goal: (goal: string) => `The user chose ${spokenGoal(goal)} as what they want to train. Say a few words about it, like "Nice, ${spokenGoal(goal)}. I can build that.", then ask their level, beginner, intermediate or advanced.`,
  goalAndLevel: (goal: string, level: string) => `The user chose ${spokenGoal(goal)} at ${level.toLowerCase()} level. Say you are putting together their ${level.toLowerCase()} ${spokenGoal(goal)} plan now and it will be on the screen in a few seconds. Do not list or invent any moves.`,
  levelOnly: (level: string) => `The user gave their level (${level.toLowerCase()}) but not what they want to train. Say "got it on the level" in your own words and ask what they want to train today.`,
  level: (goal: string, level: string) => `The user picked ${level.toLowerCase()} for ${spokenGoal(goal)}. Say you are putting together their ${level.toLowerCase()} ${spokenGoal(goal)} plan now and it will be on the screen in a few seconds. Do not list or invent any moves.`,
  planReady: (plan: FitnessPlan, around: string) => `The plan is on the screen now: ${quoted(plan.plan_title)}, ${plan.duration_minutes} minutes${around ? `, built around ${around}` : ''}. Warm-up ${names(plan.warmup_steps) || 'none'}. Workout ${names(plan.workout_steps) || 'none'}. Tell them it is up in one short sentence without reading every move, then ask which move they want to start with; they can tap one on the screen.`,
  replanned: (plan: FitnessPlan, droppedMove: string) => `The plan was rebuilt at ${plan.level.toLowerCase()} level and is on the screen now: ${quoted(plan.plan_title)}, ${plan.duration_minutes} minutes. Workout ${names(plan.workout_steps) || 'none'}. Tell them in one short sentence.${droppedMove ? ` The demo of ${droppedMove} is off the screen because the moves changed; ask which move they want to start with now.` : ''}`,
  rebuilt: (line: string, plan: FitnessPlan, droppedMove: string) => `The app rebuilt the plan around the limits the user gave. ${line} Tell them that in your own words in one sentence. The moves on the screen now are ${names([...plan.warmup_steps, ...plan.workout_steps]) || 'none'}; name no others.${droppedMove ? ` The demo of ${droppedMove} was taken off the screen because it is no longer on the plan; ask which move they want to start with now.` : ''}`,
  moveNoDemo: (move: string) => `The user chose ${move}. Demo videos are off in this session, so there is no clip. Say that plainly in one short sentence, then talk them through ${move} in three or four short sentences, the setup and two or three form cues they can act on.`,
  moveRendering: (move: string) => `The user chose ${move}. A short demo of it is rendering; it takes a minute or two and is NOT on the screen yet. Tell them you are making a demo of ${move}, then talk them through the setup meanwhile. Do not say it is ready.`,
  switchMove: (move: string) => `The user switched to ${move}. Talk them through ${move} in three or four short sentences, the setup and two or three form cues they can act on.`,
  moveAgain: (move: string, video: VideoPayload | null) => `The user chose ${move} again, which is already the move on the screen${video?.status === 'ready' ? ' with its demo playing' : ''}. Carry on coaching it.`,
  demoReady: (move: string) => `The demo of ${move} is on the screen now. Point them to it in one short sentence, like "Your demo is up on the screen now, give it a watch."`,
  demoFailed: (move: string) => `The demo of ${move} did not come through, so there is no clip. Say so plainly in one short sentence and offer to talk them through the move instead. Do not promise to try again.`,
  askWhichMove: (plan: FitnessPlan) => `The user asked for a demo but did not name a move. Ask which move from the plan, like ${names(plan.warmup_steps.concat(plan.workout_steps).slice(0, 3))}.`,
  notOnPlan: (heard: string, plan: FitnessPlan) => `The user asked for ${quoted(heard)}, which is not on today's plan. Say so kindly and offer moves from it, like ${names(plan.warmup_steps.concat(plan.workout_steps).slice(0, 3))}.`,
  noPlanYet: () => 'The user asked about a move, but there is no plan on the screen yet. Say you will get to moves as soon as their plan is built.',
  sameLevel: (level: string) => `The user asked for a ${level.toLowerCase()} plan, and the plan on the screen already is ${level.toLowerCase()}. Say so briefly.`,
  relevel: (level: string) => `The user asked for the plan at ${level.toLowerCase()} level. Say you are rebuilding it at ${level.toLowerCase()}; the new plan will be on the screen in a few seconds. Do not list moves yet.`,
  restart: () => 'The user wants to start over. The screen asks what they want to train again, and the limits they mentioned are kept. Ask what they want to train today.',
  /**
   * The original spoke this sentence from code, word for word. The API cannot:
   * an event is said in the avatar's own words. So the exact words go in the
   * event, and the board shows them as the source of truth.
   */
  clearance: (conditions: string[]) => `IMPORTANT, safety. The user has told you about ${spokenConditions(conditions)}. Stop the workout now. Say this to them, as close to word for word as you can, and nothing else: ${quoted(clearanceLine(conditions))} Do not suggest any exercise or modification, and do not mention the plan or a demo.`,
  onHold: (intent: Intent) => `The user asked to ${describe(intent)}, but the session is on hold. Kindly say again that you are not able to continue until a doctor or qualified health professional clears them. Suggest no exercise.`,
};
