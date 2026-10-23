// What Alex is told, and how he acts. The drill decides everything; Alex
// instructs. He never knows a step's answer before the learner has resolved
// it: he calls the drill's tools, and every verdict, hint, taught step and
// next question comes back as a tool result he speaks from.
//
// The page imports this (it sends the state), so it reads only the View:
// never scenarios.ts, where every step's answer is.
import type { AppTool } from '../../../server/app-server.ts';
import { EMERGENCY_LINE, EMERGENCY_TITLE, SAFETY_LINE } from './lines.ts';
import type { View } from './types.ts';

const quote = (s: string) => `"${s}"`;
const MENU = 'an adult collapse in a café, a child by a pool, choking at dinner, or someone unresponsive but breathing';

/** Alex's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are Alex, a calm paramedic instructor running CPR and first-aid practice drills for one learner in Bystander. It is practice, not certification and not medical advice. The drill on their screen holds four scenarios, asks one step at a time and grades every answer against the lay-rescuer algorithm; you reach it only through its tools.
- When the learner says what they would do, call check_answer with their words, as close to verbatim as you can, before reacting, and answer only from its result. Never say right, wrong, close, "not quite" or "exactly" on your own: the drill decides, sometimes differently than you would.
- "Show me", "I don't know", "tell me": call show_step. A hint or a clue: call give_hint. Never make up a step, a hint or a teaching point.
- "Next", "ready", "go on", or yes when you asked whether they are ready: call next_step.
- When they pick a drill ("let's do choking", "the pool one", "you choose"), call start_scenario with their words. When they want out of the one they are in ("go back", "a different one", "this is too hard"), call leave_scenario, then ask which they would like. Both only when they ask, never on your own.
- NUMBERS: never state a compression rate, depth, ratio, timing or count from memory. Every number comes word for word from a tool result or the live screen in your context; if you do not have it, do not estimate or round.
- This step's answer and the steps after it are hidden from you on purpose: never guess at them, list the steps or teach ahead.
- The screen changes only when you call a tool. Saying "let's move on" or "here is the step" without the call changes nothing and misleads them: call the tool every time, even when you think you know.
- Questions about what is on screen (the scene, the question, the score, the steps done): answer from the live screen in your context, no tool needed.
- When they press a button on screen, the drill tells you what happened; carry on from that. A tool that refuses gives you a sentence: say it calmly and never pretend anything happened.
REAL EMERGENCIES outrank the drill. If anything they say sounds like someone really needs help now (not breathing, collapsed, "this is real", "should I call 911?"), call stop_for_emergency at once and say what it returns, word for word. Never coach CPR or any protocol for a real emergency. A learner narrating the drill ("I'd check if he's breathing", "in this scenario") is practising. While the red card is up, tell them to call 911 (112 in Europe) and stay on the line with the dispatcher; call resume_practice only when they say plainly that nobody is in danger, and never talk them back into practice yourself.
Short sentences, one idea at a time, at most two sentences before you let them think. Praise specifically ("good, scene first") and correct without blame. Say only what you would say aloud: no lists, labels or markdown.`;

const awaits = (timeoutSeconds = 12) => ({ mode: 'await' as const, timeoutSeconds });
const noArgs = { type: 'object', properties: {}, additionalProperties: false };

/** The drill's tools. Each is answered by the server, which owns the drill. */
export const TOOLS: AppTool[] = [
  {
    type: 'function', name: 'check_answer',
    description: 'Grades what the learner would do for the step on their screen, against the drill\'s algorithm. Call it whenever they describe an action as their answer ("I\'d check the scene", "call 911", "start compressions"), before reacting.',
    parameters: { type: 'object', properties: { answer: { type: 'string', minLength: 1, maxLength: 400, description: 'What the learner said they would do, as close to their words as you can.' } }, required: ['answer'], additionalProperties: false },
    'x-atmee': awaits(),
  },
  { type: 'function', name: 'show_step', description: 'Shows and teaches the current step when the learner asks to be shown, says they do not know, or gives up. The step then counts as shown, not as got.', parameters: noArgs, 'x-atmee': awaits() },
  { type: 'function', name: 'give_hint', description: 'Gives the drill\'s hint for the current step, without its answer. Call it when the learner asks for a hint or a clue.', parameters: noArgs, 'x-atmee': awaits() },
  { type: 'function', name: 'next_step', description: 'Moves on to the next step, or to the end-of-drill review after the last one, once the current step is answered or shown. Call it when the learner says next, ready, go on, or yes to moving on.', parameters: noArgs, 'x-atmee': awaits() },
  {
    type: 'function', name: 'start_scenario',
    description: 'Starts the drill the learner names: an adult collapse in a café, a child by a pool, choking at dinner, or someone unresponsive but breathing. Only when they ask for one; it restarts any drill in progress.',
    parameters: { type: 'object', properties: { scenario: { type: 'string', minLength: 1, maxLength: 120, description: 'The drill as the learner named it ("choking", "the pool one", "you pick").' } }, required: ['scenario'], additionalProperties: false },
    'x-atmee': awaits(),
  },
  { type: 'function', name: 'leave_scenario', description: 'Leaves the drill in progress and goes back to the list of drills, when the learner wants out ("go back", "a different one", "this is too hard"). Only when they ask.', parameters: noArgs, 'x-atmee': awaits() },
  { type: 'function', name: 'stop_for_emergency', description: 'Stops the drill and covers the learner\'s screen with a red Call 911 card. Call it at once if anything they say sounds like a real emergency happening now rather than the drill. Returns the line to say.', parameters: noArgs, 'x-atmee': awaits(8) },
  { type: 'function', name: 'resume_practice', description: 'Takes the red emergency card down and returns to practice. Only when the learner has said plainly that nobody is in danger (a false alarm, only practising); the app checks their words.', parameters: noArgs, 'x-atmee': awaits(8) },
];

const stepsDone = (v: View) => (v.steps ?? [])
  .map((s, i) => (s.status === 'done' ? `(${i + 1}) ${s.label}, ${s.outcome === 'shown' ? 'shown to them' : 'they got it'}` : null))
  .filter(Boolean)
  .join('; ');

const stepCount = (v: View) => v.steps?.length ?? 0;

/**
 * The live screen, as Alex's state. Never a step the learner has not
 * resolved: not the live one's answer, teaching line or hint (until they
 * asked for it), and nothing after it.
 */
export function drillState(v: View, onScreen: { hint?: string | null } = {}): string {
  const head = `Bystander, CPR and first-aid practice: the learner's screen right now. Always on screen: ${quote(SAFETY_LINE)}`;
  if (v.phase === 'emergency') {
    return `${head} THE DRILL IS STOPPED: the learner may be in a real emergency. Their whole screen is a red card, ${quote(EMERGENCY_TITLE)}, saying ${quote(EMERGENCY_LINE)}, with buttons to call 911 and 112. Do not teach any protocol, do not ask a drill question, do not resume the drill and do not soften it: tell them to call 911 (112 in Europe, or their local emergency number) and follow the dispatcher. The card comes down only through resume_practice, when they say plainly that nobody is in danger, or through their own button "Nobody is in danger".`;
  }
  if (v.phase === 'intro' || !v.scenario) {
    const list = (v.catalog ?? []).map((c, i) => `(${i + 1}) ${c.title} (${c.victim}, ${c.steps} steps)`).join(' ');
    return `${head} The learner is choosing a drill; nothing is scored yet. On screen: ${list}. Start one with start_scenario only when they choose.`;
  }

  const s = v.scenario;
  const n = stepCount(v);
  const drill = ` Drill: ${quote(s.title)} (${s.victim}). The scene on screen: ${s.opening}`;
  if (v.phase === 'debrief') {
    return `${head}${drill} The drill is complete: they got ${v.score.correct} of ${n} steps without help. Their review on screen: ${stepsDone(v)}. Below it, the drills to try next (${MENU}); start one with start_scenario only when they choose.`;
  }

  const k = (v.step_index ?? 0) + 1;
  const done = stepsDone(v);
  const tally = ` Score: ${v.score.correct} of ${n} on their own so far.${done ? ` Steps done: ${done}.` : ''}`;
  if (v.phase === 'answering') {
    const nudge = v.last_verdict && !v.last_verdict.ok ? ` Their last answer was not right; the nudge on screen: ${quote(v.last_verdict.note)}` : '';
    const hint = onScreen.hint ? ` The hint they asked for, on screen: ${quote(onScreen.hint)}` : '';
    return `${head}${drill} Step ${k} of ${n}, waiting for their answer. The question on screen: ${quote(v.prompt ?? '')} Tries on this step: ${v.attempts ?? 0} of 2 (after a second miss the drill shows the step).${nudge}${hint}${tally} This step's answer and the steps after it are hidden from you: only check_answer, give_hint and show_step know them.`;
  }

  // coaching: the step is resolved and its teaching point is on screen.
  const step = v.steps?.[v.step_index ?? 0];
  const how = step?.outcome === 'shown' ? 'it was shown to them' : 'they got it';
  const teach = v.last_verdict?.note ? ` The teaching point on screen: ${quote(v.last_verdict.note)}` : '';
  const beat = v.metronome_bpm ? ` A metronome on screen clicks at ${v.metronome_bpm} a minute for them to practise to.` : '';
  const last = k >= n;
  return `${head}${drill} Step ${k} of ${n} is done: ${quote(step?.label ?? '')}, ${how}.${teach}${beat}${tally} The drill waits for them to be ready: call next_step when they say next, ready, or yes to moving on. ${last ? 'That was the last step: next_step brings up their review.' : 'The next question is hidden until then.'}`;
}

/** What a tool call (or a button) did, in words Alex speaks from. */
export const said = {
  /** Once per call, when Alex arrives (on a shared host, after its own greeting). */
  opening: (v: View | null) => {
    const hello = `You are Alex, the learner's instructor in Bystander, a CPR and first-aid practice app. Greet them in one short line, then say this sentence word for word: ${quote(SAFETY_LINE)}`;
    if (!v || v.phase === 'intro' || !v.scenario) return `${hello} Then ask which drill they would like: ${MENU}. Start one only when they choose.`;
    if (v.phase === 'emergency') return said.emergency();
    if (v.phase === 'answering') return `${hello} Then set the scene of ${quote(v.scenario.title)} in your own words, ${quote(v.scenario.opening)}, and ask exactly this, then wait: ${quote(v.prompt ?? '')} Do not hint at the answer.`;
    if (v.phase === 'coaching') return `${hello} They are back mid-drill in ${quote(v.scenario.title)}, between steps: ask whether they are ready for the next step.`;
    return `${hello} Their drill ${quote(v.scenario.title)} is complete, ${v.score.correct} of ${stepCount(v)} on their own: ask whether they would like another (${MENU}).`;
  },
  started: (v: View) => `Drill started: ${quote(v.scenario!.title)}, ${stepCount(v)} steps, on their screen now. Set the scene in your own words, ${quote(v.scenario!.opening)}, then ask exactly this and wait: ${quote(v.prompt ?? '')} Do not hint at the answer and do not list the steps.`,
  right: (v: View, note: string) => `The drill graded it RIGHT: step ${(v.step_index ?? 0) + 1} of ${stepCount(v)}, ${quote(v.steps?.[v.step_index ?? 0]?.label ?? '')} (score ${v.score.correct}). Confirm it in one short line, then give this teaching point in your own calm words without changing any number: ${quote(note)} Then ask whether they are ready for the next step; call next_step only when they say so.`,
  wrong: (note: string) => `The drill graded it NOT RIGHT. Do not give them the step. Say this nudge in one short line, ${quote(note)}, and invite another try; one more miss and the drill shows them the step.`,
  rescued: (label: string, note: string) => `That was their second miss, so the drill has shown the step on their screen: ${quote(label)}. Teach it plainly and kindly, keeping every number exactly as written: ${quote(note)} No blame. Then ask whether they are ready for the next step; call next_step only when they say so.`,
  shown: (label: string, note: string) => `The step is now shown on their screen: ${quote(label)}. Teach it plainly and kindly, keeping every number exactly as written: ${quote(note)} Then ask whether they are ready for the next step; call next_step only when they say so.`,
  hint: (hint: string) => `The drill's hint for this step, which is not the answer: ${quote(hint)} Give it in your own words in one line, adding nothing, and let them try.`,
  next: (v: View) => `Step ${(v.step_index ?? 0) + 1} of ${stepCount(v)} is live on their screen. Ask exactly this in one line, then stop and wait: ${quote(v.prompt ?? '')} Do not hint at the answer.`,
  debrief: (v: View) => `That was the last step: they got ${v.score.correct} of ${stepCount(v)} without help, and their review is on screen. Give a warm two-sentence debrief with no new numbers, then ask whether they would like another drill; start one only when they choose.`,
  left: () => `They are back at the list of drills; nothing is held against them. In one short, unbothered line say that's fine and ask which they would like: ${MENU}. Start one only when they choose.`,
  unknown: (words: string) => `There is no drill called ${quote(words)}. The four are: ${MENU}. Ask which one they would like.`,
  refused: (reason: string) => `The drill refused that: ${reason.replace(/\*/g, '')} Say it calmly in one line, in your own words; nothing changed.`,
  emergency: () => `STOP THE DRILL. The learner may be in a real emergency: the drill is stopped and a red ${quote(EMERGENCY_TITLE)} card covers their screen. Say this, word for word, and nothing else: ${quote(EMERGENCY_LINE)} Do not coach CPR or any protocol, and do not ask a drill question.`,
  /** The page's own watch caught it, in words Alex did not hear (typed) or heard but did not act on. */
  alarm: (how: 'typed' | 'spoken', words: string) => `The learner ${how === 'typed' ? 'typed' : 'said'} ${quote(words.slice(0, 200))}, which sounds like a real emergency. ${said.emergency()}`,
  resumed: (v: View) => {
    const glad = 'The red card is down: the learner says nobody is in danger. In one short line say you are glad everyone is safe';
    if (v.phase === 'answering' && v.scenario) return `${glad}; the drill is back where they left it. Ask exactly this and wait: ${quote(v.prompt ?? '')}`;
    if (v.phase === 'coaching') return `${glad}; the drill is back where they left it, between steps. Ask whether they are ready for the next step.`;
    if (v.phase === 'debrief') return `${glad}; their drill was already complete. Ask whether they would like another (${MENU}).`;
    return `${glad}, then ask which drill they would like: ${MENU}.`;
  },
  keepCard: () => `The red card stays up: nothing the learner has said since it went up says plainly that nobody is in danger. Do not resume practice. Calmly tell them to call 911 (112 in Europe, or their local number) and stay on the line with the dispatcher; if this was only practice, they can tell you plainly that nobody is in danger, or press "Nobody is in danger" on the card.`,
  notStopped: () => 'The drill is not stopped; carry on from the live screen.',
};

/** A button press, told to Alex: he cannot see the screen. */
export const pressed = (button: string, outcome: string) => `The learner pressed ${quote(button)} on their screen. ${outcome}`;

/** The buttons' words, as the learner sees them and Alex is told. */
export const BUTTON = {
  reveal: 'Show me this step',
  hint: 'Give me a hint',
  next: 'Next step',
  leave: 'Choose another drill',
  resume: 'Nobody is in danger — back to practice',
} as const;
