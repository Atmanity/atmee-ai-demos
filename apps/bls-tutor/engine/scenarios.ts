// The BLS content, static, and on the SERVER only.
//
// Every clinical number the learner can hear or read comes from THIS file. The
// avatar is never asked to remember a compression rate, a depth or a ratio: it
// is handed `teach` and `hint` and says them back. That is the whole reason the
// content is data rather than prompt: a tutor that invents "about 80 a minute"
// because it sounded plausible is worse than no tutor, and a prompt cannot be
// diffed.
//
// Sequences follow the AHA/ERC lay-rescuer algorithms (2020/2021 guidelines,
// unchanged in the 2025 focused updates for these four sequences). They are a
// teaching aid, not a certification course; SAFETY_LINE says so wherever the
// app speaks or draws.
//
// Grading is deterministic and lives in tutor.ts: `expected` is an any-of list
// of substrings that mean the learner got the idea, `forbidden` is the specific
// wrong move this step catches, and `forbiddenNote` is what they hear when they
// make it. No model call decides whether an answer was right.
//
// NEVER import this file from page/: whatever the page imports is shipped to
// the browser, and a step's `label` is the answer to the question on screen.
// (page/imports.test.ts guards it.)
import { EMERGENCY_LINE, SAFETY_LINE } from './lines.ts';

export { EMERGENCY_LINE, SAFETY_LINE };

/**
 * One rung of the ladder. `label` is the answer as much as the prompt, which
 * is why the snapshot hides it until the step is resolved: a panel showing
 * "Start chest compressions" three rungs early has answered its own question.
 */
export interface Step {
  key: string;
  label: string;
  /** What the learner is asked, out loud, when this step becomes current. */
  prompt: string;
  /** Any-of substrings that count as getting it. */
  expected: readonly string[];
  /** The full teaching line, with every number this step is allowed to state. */
  teach: string;
  /** A nudge after a wrong attempt: points, does not answer. */
  hint: string;
  /** The specific wrong move this step catches, checked BEFORE `expected`. */
  forbidden: readonly string[];
  forbiddenNote: string;
  /** Which picture the panel draws for this step. */
  visual: string;
  /** Only set where a rate is actually being taught. */
  metronomeBpm: number | null;
}

export interface Scenario {
  id: string;
  title: string;
  victim: string;
  opening: string;
  steps: readonly Step[];
}

type StepInput = Omit<Step, 'forbidden' | 'forbiddenNote' | 'visual' | 'metronomeBpm'> & Partial<Pick<Step, 'forbidden' | 'forbiddenNote' | 'visual' | 'metronomeBpm'>>;

const step = (s: StepInput): Step => Object.freeze({ forbidden: [], forbiddenNote: '', visual: 'scene', metronomeBpm: null, ...s });

// Expected phrases are matched as substrings of the answer, both put through
// one normaliser first (tutor.ts answerForm: digits for numbers, one form for
// "30:2", "you" for I and me, "they" for he and she, no articles), so each
// phrase says the action once, and never as a word that also turns up in a
// wrong one: a bare "2" took "push 2 inches" as the breaths cycle, "five"
// took "five more back blows" as thrusts, "call" took "call out to him" as
// calling 911. answers.test.ts holds, for every step, the answers people
// give, right and wrong, and grading must take the whole table.

/** Calling for help, as people say it (not "call out to him", which is checking for a response). */
const CALL_FOR_HELP = [
  '911', '112', '999', 'emergency', 'ambulance', 'paramedic', 'call for help', 'call someone', 'call police',
  'phone', 'dial', 'get help', 'send for help', 'send someone', 'shout for help',
] as const;

/**
 * Finding out whether someone responds and breathes, as concepts rather than
 * exact strings (tutor.ts matches(): " + " all of, "|" any of, each from a
 * word start, "$" a whole word), so pronouns and word order do not matter:
 * asking whether they are ok is a checking word plus "ok"; a breathing check
 * is a looking or listening word plus breathing or a breath. "Breathe" on its
 * own, and "breaths", are how people say giving breaths, so neither counts.
 */
const CHECK_RESPONSE = [
  'respon', 'unrespon', 'shout', 'tap', 'shake', 'wake', 'can you hear',
  'ask|check|see|is|are|whether|if|tap|shout|can + ok$',
  'look|listen|feel|check|see|watch|whether|if|is|are + breathing|breathes|breathe$|breath$',
  'chest ris', 'chest move',
] as const;

/** Lay rescuers do not check a pulse: the same correction wherever it comes up. */
const NO_PULSE = { forbidden: ['pulse', 'carotid', 'wrist'], forbiddenNote: 'Lay rescuers do not check for a pulse — it wastes time and is unreliable. Check response and normal breathing.' } as const;

export const ADULT_CARDIAC_ARREST: Scenario = {
  id: 'adult_cardiac_arrest',
  title: 'Adult collapse in a café',
  victim: 'adult',
  opening: 'A man in his fifties has just slumped off his chair in a busy café. He is on the floor and not moving. You are the closest person to him.',
  steps: [
    step({
      key: 'scene_safe',
      label: 'Check the scene is safe',
      prompt: 'You have just seen him go down. What is the very first thing you do?',
      expected: ['safe', 'danger', 'hazard', 'look around', 'scene', 'risk'],
      teach: 'First, check the scene is safe — traffic, water, electricity, fire, spilled liquid. A second casualty helps nobody.',
      hint: 'Before you touch him at all, what do you check about where you are?',
      visual: 'scene',
    }),
    step({
      key: 'check_response',
      label: 'Check for response and normal breathing',
      prompt: 'The floor is clear. How do you find out whether he needs CPR?',
      expected: [...CHECK_RESPONSE, 'are you ok', 'talk to him'],
      teach: 'Tap his shoulders and shout. If there is no response, look at his chest for up to 10 seconds: no normal breathing, or only gasping, means cardiac arrest.',
      hint: 'Two things: can you wake him, and is he breathing normally?',
      forbidden: ['pulse', 'carotid', 'wrist'],
      forbiddenNote: 'Lay rescuers do not check for a pulse — it wastes time and is unreliable. Check response and normal breathing.',
      visual: 'victim_face',
    }),
    step({
      key: 'call_911',
      label: 'Call 911 and send for an AED',
      prompt: 'No response, and he is only gasping. What now?',
      expected: [...CALL_FOR_HELP, 'aed', 'defib'],
      teach: 'Call 911 — speaker on, phone down — and send someone specific for the nearest AED. Alone with a phone, call first, then start compressions.',
      hint: 'You need two things on their way before you are busy with your hands.',
      forbidden: ['compress', 'cpr', 'push', 'chest'],
      forbiddenNote: 'Call for help before compressions.',
      visual: 'phone_aed',
    }),
    step({
      key: 'compressions',
      label: 'Start chest compressions',
      prompt: 'Help is coming. Put your hands where, and do what?',
      expected: ['compress', 'cpr', 'chest', 'push', 'pump', 'centre', 'center'],
      teach: 'Heel of one hand on the centre of the chest, other hand on top. Push hard and fast: at least 2 inches — 5 centimetres — deep, 100 to 120 a minute, and let the chest come all the way back up each time.',
      hint: 'Where exactly do your hands go, and how fast are you pushing?',
      visual: 'torso_hands',
      metronomeBpm: 110,
    }),
    step({
      key: 'breaths',
      label: 'Add rescue breaths if you are trained and willing',
      prompt: 'You are trained and you have a barrier. What is the cycle?',
      expected: ['30 to 2', '30:2', '30-2', '30/2', '30 2', '30 and 2', '30 compressions', '30 chest compressions', 'thirty to two', 'thirty and two', 'thirty compressions', 'thirty chest compressions', '2 breaths', 'two breaths', 'rescue breath'],
      teach: '30 compressions to 2 breaths. Tilt the head, lift the chin, each breath about 1 second, just enough to see the chest rise. Untrained or unwilling? Compression-only CPR is still good CPR.',
      hint: 'It is a ratio — compressions to breaths.',
      visual: 'airway',
    }),
    step({
      key: 'aed',
      label: 'Use the AED as soon as it arrives',
      prompt: 'Someone runs back with an AED. What do you do with it?',
      expected: ['turn it on', 'switch it on', 'turn on', 'switch on', 'power it on', 'pads', 'shock', 'what it says', 'follow the', 'follow its', 'prompts', 'instructions', 'use it', 'use the aed', 'use the defib', 'attach', 'stand clear'],
      teach: 'Turn it on and do what it says. Pads on bare, dry skin — upper right chest and lower left side. Stand clear for the analysis and the shock, then go straight back to compressions.',
      hint: 'It talks you through it — but what do you do first, and where do the pads go?',
      visual: 'aed_pads',
    }),
    step({
      key: 'continue_until',
      label: 'Keep going until help takes over',
      prompt: 'Two minutes in and your arms are burning. When do you stop?',
      expected: [
        'takes over', 'take over', 'paramedic', 'ems arriv', 'ems come', 'ems get', 'until ems', 'swap', 'switch', 'wakes', 'wake up',
        'breathing normally', 'breathes normally', 'breathe normally', 'starts breathing', 'start breathing', 'breathing on his own',
        'help arriv', 'help come', 'help get', 'ambulance arriv', 'ambulance come', 'ambulance get', 'until help', 'until the ambulance',
        'tells you to stop', 'tell you to stop', 'says to stop', 'say to stop',
      ],
      teach: 'Keep going until EMS takes over, the AED tells you to stop, or he starts breathing normally. Swap rescuers about every 2 minutes — tired hands push shallow.',
      hint: 'There are three things that let you stop, and one that lets you rest.',
      visual: 'handover',
    }),
  ],
};

export const CHILD_CARDIAC_ARREST: Scenario = {
  id: 'child_cardiac_arrest',
  title: 'Child unresponsive by a pool',
  victim: 'child',
  opening: 'A seven-year-old has been pulled from a pool. She is limp on the poolside and is not moving. You are alone with her; other guests are at the far end.',
  steps: [
    step({
      key: 'scene_safe',
      label: 'Check the scene is safe',
      prompt: 'What is your first move as you reach her?',
      expected: ['safe', 'danger', 'hazard', 'scene', 'wet', 'slip', 'water edge', 'away from the water', 'away from the pool', 'away from the edge', 'clear of the water', 'clear of the pool', 'back from the edge'],
      teach: 'Check the scene: slippery poolside, deep water, anything that could put you in the pool too. Move her clear of the water edge.',
      hint: 'Before anything else, what about where you both are?',
      visual: 'scene',
    }),
    step({
      key: 'check_response',
      label: 'Check for response and normal breathing',
      prompt: 'She is clear of the edge. How do you decide she needs CPR?',
      expected: [...CHECK_RESPONSE, 'talk'],
      teach: 'Tap and shout. No response, and no normal breathing over up to 10 seconds — gasping does not count — means start CPR.',
      hint: 'Can you wake her, and is she breathing normally?',
      forbidden: ['pulse', 'carotid'],
      forbiddenNote: 'Lay rescuers do not check a pulse. Check response and normal breathing.',
      visual: 'victim_face',
    }),
    step({
      key: 'cpr_first',
      label: 'Give 2 minutes of CPR before leaving her',
      prompt: 'You are alone and your phone is in your bag across the deck. Call first, or start CPR?',
      // NO bare "first" or "start" here. The prompt offers two options and one
      // of them is "call first", which substring-matched "first" and was graded
      // CORRECT, teaching the exact inverse of this step in a drill people take
      // to learn what to do to a child.
      expected: ['cpr', 'compress', 'two minutes', '2 minutes', 'rescue breath', 'breaths first', 'give breaths', 'give her breaths', 'oxygen'],
      teach: "A child's arrest is usually a breathing problem, so oxygen comes first: give about 2 minutes — 5 cycles — of CPR before leaving her to call. If someone else is there, they call while you start.",
      hint: 'A child is not a small adult — what usually caused this arrest?',
      forbidden: ['call first', 'call 911 first', 'phone first', 'call before'],
      forbiddenNote: "Not for a child on your own. A child's arrest is usually a breathing problem, so oxygen comes first: about 2 minutes — 5 cycles — of CPR before you leave her to call.",
      visual: 'child_torso',
    }),
    step({
      key: 'call_911',
      label: 'Call 911 and get an AED',
      prompt: 'Two minutes of CPR done. What now?',
      expected: [...CALL_FOR_HELP, 'aed', 'defib'],
      teach: 'Now call 911 — speaker on — and get an AED if one is nearby. Then straight back to CPR.',
      hint: 'You have bought her two minutes of oxygen. What still has not happened?',
      visual: 'phone_aed',
    }),
    step({
      key: 'compressions_child',
      label: 'Compress with one or two hands',
      prompt: 'Back on her chest. How deep, how fast, and with what?',
      expected: ['one hand', 'two hand', 'compress', 'chest', 'depth', 'third', 'inch', 'cm', 'fast'],
      teach: 'One or two hands on the centre of the chest — whatever gets the depth. About one third of the chest depth, roughly 2 inches or 5 centimetres, at 100 to 120 a minute, with full recoil.',
      hint: 'Same rate as an adult; the depth is measured differently.',
      visual: 'child_torso',
      metronomeBpm: 110,
    }),
    step({
      key: 'ratio_child',
      label: 'Use 30:2 alone, 15:2 with a second rescuer',
      prompt: 'A lifeguard arrives to help. Does your cycle change?',
      // The answer is the change to 15:2: "30", "ratio" or "changes" alone took
      // "no, it stays 30 to 2" and "nothing changes" as right.
      expected: ['15', 'fifteen'],
      teach: 'Alone it is 30 compressions to 2 breaths. With a second trained rescuer on a child it becomes 15 to 2.',
      hint: 'The ratio is not the same alone as it is with help.',
      forbidden: ['still 30', 'stays 30', 'stays at 30', 'stay at 30', 'keep 30', 'keep it at 30', 'keep going at 30', 'still thirty', 'stays thirty', 'stays at thirty', 'keep thirty', 'keep it at thirty', 'keep going at thirty', 'same ratio', 'ratio stays', 'ratio is the same'],
      forbiddenNote: 'It does change: alone it is 30 to 2, but with a second trained rescuer on a child it becomes 15 to 2.',
      visual: 'airway',
    }),
    step({
      key: 'aed_pediatric',
      label: 'Use the AED with paediatric pads if available',
      prompt: 'The AED is here. Anything different for a child?',
      expected: ['pediatric', 'paediatric', 'child pad', 'children pad', "child's pad", 'kid pad', 'child setting', 'child mode', 'attenuat', 'adult pad', 'small pad', 'smaller pad', 'front and back', 'front to back', 'front-and-back'],
      teach: 'Use paediatric pads or the child setting if the AED has them. If it only has adult pads, use them — an unshocked shockable rhythm is worse. Keep the pads from touching: front and back is fine.',
      hint: 'The machine may have a second set of pads in the lid.',
      visual: 'aed_pads',
    }),
  ],
};

export const CHOKING_ADULT: Scenario = {
  id: 'choking_adult',
  title: 'Choking at a dinner table',
  victim: 'adult',
  opening: 'Mid-meal, the woman opposite you stands up suddenly, both hands at her throat, eyes wide. The table has gone quiet.',
  steps: [
    step({
      key: 'assess_choking',
      label: 'Ask if she is choking and check her cough',
      prompt: 'She is clutching her throat. What do you do first?',
      expected: ['ask', 'are you choking', 'cough', 'speak', 'talk', 'breathe', 'check'],
      teach: 'Ask "are you choking?" and see whether she can speak, cough or breathe. A forceful cough is a mild obstruction; silence, a weak cough, or no air is a severe one.',
      hint: 'Before you touch her — what one question tells you how bad this is?',
      forbidden: ['back blow', 'thrust', 'heimlich', 'hit her'],
      forbiddenNote: 'Find out how bad it is first — a person coughing forcefully is clearing it better than you can.',
      visual: 'choking_person',
    }),
    step({
      key: 'encourage_cough',
      label: 'If she can cough, let her cough',
      prompt: 'She manages a loud, forceful cough and a word. What now?',
      expected: ['cough', 'encourage', 'let her', 'stay', 'watch', 'nothing'],
      teach: 'Mild obstruction: encourage her to keep coughing and stay with her. Do not hit or thrust — you can turn a mild blockage into a complete one.',
      hint: 'Her own cough is the strongest tool in the room right now.',
      forbidden: ['back blow', 'thrust', 'heimlich'],
      forbiddenNote: 'She is still moving air. Encourage the cough and watch her — no blows, no thrusts yet.',
      visual: 'choking_person',
    }),
    step({
      key: 'back_blows',
      label: 'Give 5 back blows',
      prompt: 'The cough goes silent and she cannot breathe. What is your first treatment?',
      expected: ['back blow', 'back slap', 'between the shoulder', '5 back', 'five back', 'lean'],
      teach: 'Lean her well forward and give up to 5 sharp back blows between the shoulder blades with the heel of your hand, checking after each one.',
      hint: 'Lean her forward first — then something between the shoulder blades.',
      visual: 'back_blows',
    }),
    step({
      key: 'abdominal_thrusts',
      label: 'Give 5 abdominal thrusts',
      prompt: 'Five back blows, still nothing. Next?',
      expected: ['abdominal', 'thrust', 'heimlich', 'navel', 'belly', 'in and up', 'inward and upward'],
      teach: 'Stand behind her, fist just above the navel, other hand over it, and pull sharply inward and upward — up to 5 thrusts. For a pregnant or very large person, use chest thrusts instead.',
      hint: 'Get behind her; your fist goes just above the navel.',
      visual: 'abdo_thrusts',
    }),
    step({
      key: 'repeat_cycle',
      label: 'Alternate 5 and 5 until it clears',
      prompt: 'Still obstructed. How long do you keep this up?',
      expected: ['repeat', 'alternate', 'again', 'until', 'cycle', 'keep going', 'clear'],
      teach: 'Alternate 5 back blows and 5 abdominal thrusts until the obstruction clears or she becomes unresponsive. Someone should be calling 911 while you work.',
      hint: 'You have two techniques — what do you do with them, and for how long?',
      visual: 'choking_person',
    }),
    step({
      key: 'if_unresponsive',
      label: 'If she goes unresponsive, lower her down and start CPR',
      prompt: 'She goes limp in your arms. What changes?',
      expected: ['cpr', 'compress', 'ground', 'floor', 'lower', '911', 'look in'],
      forbidden: ['finger sweep', 'sweep her mouth', 'sweep the mouth', 'sweep out', 'blind sweep', 'fish around'],
      forbiddenNote: 'Never a blind finger sweep. Lower her to the ground, make sure 911 is called and start CPR; look in the mouth and remove only what you can see.',
      teach: 'Lower her to the ground, make sure 911 is called, and start CPR with chest compressions. Look in the mouth before each set of breaths and remove anything you can see — never a blind finger sweep.',
      hint: 'An unresponsive choking casualty is treated like any other arrest.',
      visual: 'torso_hands',
      metronomeBpm: 110,
    }),
  ],
};

export const RECOVERY_POSITION: Scenario = {
  id: 'recovery_position',
  title: 'Unresponsive but breathing',
  victim: 'adult',
  opening: 'A man at a bus stop is slumped on the pavement, unresponsive — but his chest is rising and falling steadily and quietly.',
  steps: [
    step({
      key: 'check_response_breathing',
      label: 'Confirm no response but normal breathing',
      prompt: 'He does not answer you. What do you establish before anything else?',
      expected: [...CHECK_RESPONSE, 'normal', '10 second'],
      ...NO_PULSE,
      teach: 'Tap and shout, then look and listen for up to 10 seconds. No response but normal, quiet breathing is a very different problem from cardiac arrest.',
      hint: 'Two findings decide everything that follows here.',
      visual: 'victim_face',
    }),
    step({
      key: 'call_911',
      label: 'Call 911',
      prompt: 'He is unresponsive and breathing normally. What now?',
      expected: [...CALL_FOR_HELP],
      teach: 'Call 911. Unresponsive is an emergency even when breathing is normal — an overdose, a stroke and a head injury all look like this.',
      hint: 'He is breathing, which is good news — it is not a reason to wait.',
      visual: 'phone_aed',
    }),
    step({
      key: 'roll_to_side',
      label: 'Roll him onto his side',
      prompt: 'Help is on the way and he is still on his back. What do you do with him?',
      expected: ['side', 'roll', 'recovery position', 'turn', 'lateral'],
      teach: 'Roll him onto his side into the recovery position: far arm across the chest, far knee bent, and roll him towards you by the shoulder and knee.',
      hint: 'On his back, his own tongue and stomach contents are the danger.',
      forbidden: ['cpr', 'compress', 'chest compression', 'aed'],
      forbiddenNote: 'He is breathing normally — do not start compressions.',
      visual: 'side_position',
    }),
    step({
      key: 'open_airway',
      label: 'Tilt the head to keep the airway open',
      prompt: 'He is on his side. What do you do with his head?',
      expected: ['tilt', 'head back', 'chin', 'airway', 'mouth down', 'mouth pointing down', 'mouth facing down', 'mouth downward', 'drain'],
      teach: 'Tilt the head back gently and keep the mouth pointing slightly down, so the airway stays open and anything that comes up drains out rather than in.',
      hint: 'The airway has to stay open, and anything that comes up has to go somewhere.',
      visual: 'airway',
    }),
    step({
      key: 'monitor_breathing',
      label: 'Keep checking his breathing until help arrives',
      prompt: 'He is stable on his side. What are you doing for the next ten minutes?',
      expected: ['watch', 'monitor', 'keep checking', 'check on', 'check his breathing', 'check breathing', 'breathing', 'breathes', 'stay', 'until', 'warm', 'other side', 'swap'],
      teach: 'Stay with him and re-check his breathing continuously. Keep him warm, and if he is on one side more than about 30 minutes, roll him to the other. If normal breathing stops, roll him onto his back and start CPR.',
      hint: 'He can deteriorate — what would make you change everything?',
      visual: 'handover',
    }),
  ],
};

export const SCENARIOS: readonly Scenario[] = [ADULT_CARDIAC_ARREST, CHILD_CARDIAC_ARREST, CHOKING_ADULT, RECOVERY_POSITION];

export const SCENARIOS_BY_ID: Readonly<Record<string, Scenario>> = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

/** The default opening scenario, and the one the menu lists first. */
export const DEFAULT_SCENARIO_ID = ADULT_CARDIAC_ARREST.id;

/**
 * Said back verbatim when the learner asks for a scenario this app does not
 * have. Written out rather than joined from SCENARIOS because it is a sentence,
 * not a rendering, and it must not change shape when content moves.
 */
export const UNKNOWN_SCENARIO_REASON = "I don't have that scenario — I teach adult arrest, child arrest, choking, and recovery position.";

/** The menu the panel draws. */
export function catalog() {
  return SCENARIOS.map((s) => ({ id: s.id, title: s.title, victim: s.victim, steps: s.steps.length }));
}

/**
 * Look a scenario up by id, tolerating spoken forms ("the child one").
 *
 * Resolved as CONDITION first, then audience, not by whichever alias happens
 * to appear leftmost. A left-to-right token scan made "adult choking" start
 * cardiac arrest, because "adult" was seen before "choking": the modifier beat
 * the thing being asked about.
 */
export function find(scenarioId: string | null | undefined): Scenario | null {
  const key = (scenarioId ?? '').trim().toLowerCase().replaceAll(' ', '_').replaceAll('-', '_');
  if (Object.hasOwn(SCENARIOS_BY_ID, key)) return SCENARIOS_BY_ID[key];

  const tokens = new Set(key.split('_'));
  const any = (words: string[]) => words.some((w) => tokens.has(w));

  // What is happening. These decide the scenario on their own: there is one
  // choking drill and one recovery drill, whoever it is being done to.
  if (any(['choking', 'choke', 'heimlich'])) return CHOKING_ADULT;
  if (any(['recovery', 'side'])) return RECOVERY_POSITION;

  // Who it is happening to. Only meaningful once the condition is arrest,
  // which is also the sensible reading of a bare "adult" or "child".
  if (any(['child', 'kid', 'pediatric', 'paediatric', 'infant'])) return CHILD_CARDIAC_ARREST;
  if (any(['adult', 'arrest', 'cardiac', 'cpr', 'compressions'])) return ADULT_CARDIAC_ARREST;
  return null;
}
