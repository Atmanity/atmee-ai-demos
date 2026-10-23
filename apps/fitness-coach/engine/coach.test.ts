// The guided session. Ported from the logic halves of the original
// `test_clearance_stops_the_session.py`, `test_the_injury_is_acknowledged.py`,
// `test_relevel_plan.py`, `test_compound_answer_spinner.py`,
// `test_the_note_tells_the_truth.py` and `test_board.py`; their LiveKit
// plumbing (llm_node seams, speech scheduling, latches, RPC registration) is
// gone with the platform. New: the step machine that replaces the five
// AgentTasks, and the stream of background outcomes. Inputs arrive as the
// host's tools hand them over (engine/actions.ts): limits in the user's words,
// read by the constraint engine, and intents already resolved.
import { describe, expect, it } from 'vitest';
import { Coach, type CoachOptions, type Renderer } from './coach.ts';
import { clearanceLine, EMPTY, parseConstraints } from './constraints.ts';
import { moveIn, stepLevel } from './judge.ts';
import { buildFallbackPlan } from './plan.ts';
import type { FitnessPlan, Intent, Outcome, VideoPayload } from './types.ts';

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

/** Limits (or a disclosure) in the user's words, as add_limits, stop_for_safety and the page's own check hand them over. */
const limits = (coach: Coach, words: string) => coach.hear({ constraints: parseConstraints(words), intent: null });
/** An intent, as set_goal, set_level, start_move and start_over hand it over. */
const intent = (coach: Coach, wanted: Intent) => coach.hear({ constraints: EMPTY, intent: wanted });

const lungePlan = (goal = 'Full body', level = 'Beginner'): FitnessPlan => ({
  plan_title: 'Beginner Full Body Blast', goal, level, duration_minutes: 25,
  warmup_steps: ['High knees, 30 seconds', 'Shoulder rolls, 30 seconds'],
  workout_steps: ['Walking lunges, 10 each leg', 'Push-ups, 10 reps', 'Glute bridge, 12 reps'],
  coaching_cues: ['Move with control'],
});

/** A plan model whose answers wait until the test releases them. */
function parkedModel(build: (req: { goal: string; level: string }) => FitnessPlan = (r) => lungePlan(r.goal, r.level)) {
  const calls: { goal: string; level: string; minutes: number | null }[] = [];
  const gates: (() => void)[] = [];
  const generatePlan: CoachOptions['generatePlan'] = (req) => {
    calls.push({ goal: req.goal, level: req.level, minutes: req.constraints.minutes });
    return new Promise((resolve) => gates.push(() => resolve(build(req))));
  };
  return { generatePlan, calls, release: async (i = gates.length - 1) => { gates[i](); await flush(); } };
}

function fakeRenderer(available = true) {
  const state = { hooks: null as null | { onStatus: (p: VideoPayload) => void; suppressed: () => boolean }, prompts: [] as string[], stops: 0 };
  const renderer: CoachOptions['renderer'] = (hooks) => {
    state.hooks = hooks;
    const r: Renderer = {
      available: () => available,
      start: ({ prompt }) => { state.prompts.push(prompt); return { status: 'generating', request_id: `r${state.prompts.length}`, prompt }; },
      stop: () => { state.stops += 1; },
    };
    return r;
  };
  return { renderer, state };
}

function watch(coach: Coach) {
  const outcomes: Outcome[] = [];
  coach.subscribe((o) => outcomes.push(o));
  return outcomes;
}

const texts = (o: Outcome) => o.events.map((e) => e.text).join(' | ');

describe('the guided flow (the five AgentTasks, now the app’s own steps)', () => {
  it('opens on the goal, with the six goals on the screen and an opening for the avatar', () => {
    const coach = new Coach({ seed: 'abc' });
    const open = coach.open();
    expect(open.view.stage).toBe('goal');
    expect(open.view.goalOptions).toHaveLength(6);
    expect(open.events).toHaveLength(1);
    expect(open.events[0].text).toContain('what they want to train');
  });

  it('walks goal, level, plan and starting move from taps, with no model at all', () => {
    const coach = new Coach();
    const goal = coach.command('goal', 'Full body');
    expect(goal.view.stage).toBe('level');
    expect(goal.events[0].text).toContain('ask their level');

    const level = coach.command('level', 'Beginner');
    expect(level.view.stage).toBe('move');
    expect(level.view.plan?.plan_title).toBe('Your Beginner Full body plan');
    // The level's own line first, then the plan: never "it's up" before "I'm building it".
    expect(level.events.map((e) => e.text)).toEqual([
      expect.stringContaining('putting together'),
      expect.stringContaining('The plan is on the screen now'),
    ]);

    const move = coach.command('move', level.view.plan!.workout_steps[0]);
    expect(move.view.stage).toBe('coach');
    expect(move.view.flow.start_move).toBe('Bodyweight squats');
    // No key: coached in words, and the board never spins for a clip that cannot come.
    expect(move.view.video?.status).toBe('unavailable');
    expect(move.events[0].text).toContain('no video');
  });

  it('builds the plan in the background and streams it when it lands', async () => {
    const model = parkedModel();
    const coach = new Coach({ generatePlan: model.generatePlan });
    const outcomes = watch(coach);
    coach.command('goal', 'Glutes + legs');
    const level = coach.command('level', 'Intermediate');
    expect(level.view.stage).toBe('planning');
    expect(level.view.planning).toBe(true);
    await model.release();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].view.stage).toBe('move');
    expect(outcomes[0].view.seq).toBeGreaterThan(level.view.seq);
    expect(texts(outcomes[0])).toContain('The plan is on the screen now');
  });

  it('falls back to the built-in plan when the model fails or hangs', async () => {
    const coach = new Coach({ generatePlan: () => new Promise(() => {}), planTimeoutMs: 10 });
    const outcomes = watch(coach);
    coach.command('goal', 'Mobility');
    coach.command('level', 'Beginner');
    await new Promise((r) => setTimeout(r, 30));
    expect(outcomes.at(-1)?.view.plan?.workout_steps).toEqual(buildFallbackPlan('Mobility', 'Beginner').workout_steps);
  });

  it('records a goal and a level given together, and the limits said with them bind the plan', () => {
    const coach = new Coach();
    const out = coach.hear({
      constraints: parseConstraints("I want to train core and cardio, I'm a beginner, and I've only got twenty minutes"),
      intent: { kind: 'goal', goal: 'Core + cardio', level: 'Beginner' },
    });
    expect(out.view.flow.goal).toBe('Core + cardio');
    expect(out.view.flow.level).toBe('Beginner');
    expect(out.view.plan?.duration_minutes).toBe(20);
  });

  it('does not broadcast a level heard in passing as chosen', () => {
    // The original drew "Beginner, setting up your plan…" while the flow was
    // still waiting to be told, and the spinner never resolved.
    const coach = new Coach();
    const out = coach.hear({ constraints: parseConstraints(''), intent: null, level: 'Beginner' });
    expect(out.view.flow.level).toBe('');
    expect(out.view.overheardLevel).toBe('Beginner');
    expect(out.handled).toBe(false);
    // ...and it is the answer once a goal comes, not a question asked again.
    const goal = coach.command('goal', 'Mobility');
    expect(goal.view.flow.level).toBe('Beginner');
    expect(goal.view.plan).not.toBeNull();
  });

  it('asks for the goal again when only a level was given', () => {
    const coach = new Coach();
    const out = intent(coach, { kind: 'level', level: 'Beginner' });
    expect(out.view.stage).toBe('goal');
    expect(out.view.overheardLevel).toBe('Beginner');
    expect(out.events[0].text).toContain('got it on the level');
  });

  it('takes a starting move the host heard, by name or by position', () => {
    for (const [said, move] of [["Let's start with the squats", 'Bodyweight squats'], ['the first warm-up move', 'March in place']]) {
      const coach = new Coach();
      coach.command('goal', 'Full body');
      const plan = coach.command('level', 'Beginner').view.plan!;
      expect(intent(coach, { kind: 'move', move: moveIn(plan, said)! }).view.flow.start_move, said).toBe(move);
    }
  });

  it('says a move is not on the plan', () => {
    const coach = new Coach();
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    const out = intent(coach, { kind: 'unknownMove', heard: 'burpees' });
    expect(out.events[0].text).toContain('not on today');
    expect(out.view.flow.start_move).toBe('');
  });

  it('renders a demo when a key is configured, and says when it is ready', () => {
    const fake = fakeRenderer(true);
    const coach = new Coach({ renderer: fake.renderer });
    const outcomes = watch(coach);
    coach.command('goal', 'Full body');
    const plan = coach.command('level', 'Beginner').view.plan!;
    const move = coach.command('move', plan.warmup_steps[1]);
    expect(move.view.video?.status).toBe('generating');
    expect(move.events[0].text).toContain('NOT on the screen yet');
    expect(fake.state.prompts[0]).toContain('Arm circles');
    fake.state.hooks!.onStatus({ status: 'ready', request_id: 'r1', prompt: '', video_url: '/api/apps/fitness-coach/clips/x' });
    expect(outcomes.at(-1)?.view.video?.status).toBe('ready');
    expect(texts(outcomes.at(-1)!)).toContain('The demo of Arm circles is on the screen now');
  });

  it('refuses a tap that cannot be taken, in words', () => {
    const coach = new Coach();
    expect(coach.command('level', 'Beginner').refused).toContain('Choose what to train first');
    expect(coach.command('move', 'Squats').refused).toContain('no plan yet');
    expect(coach.command('goal', 'beginner').refused).toBeTruthy();
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    expect(coach.command('goal', 'Mobility').refused).toContain('Start over');
    expect(coach.command('move', 'Handstand walk').refused).toContain('not on the plan');
  });
});

describe('a clearance disclosure stops the session', () => {
  it.each([
    ["I'm 7 months pregnant", 'pregnancy'],
    ['I had a heart attack two years ago', 'a cardiac history'],
    ['I had surgery on my abdomen last month', 'recent surgery'],
    ['sometimes I get chest pain when I push hard', 'chest pain'],
  ])('gives the host the exact words for a disclosure: %s', (said, condition) => {
    const coach = new Coach();
    const out = limits(coach, said);
    expect(out.handled).toBe(true);
    expect(out.view.stage).toBe('hold');
    expect(out.events).toHaveLength(1);
    expect(out.events[0].text).toContain(clearanceLine([condition]));
    expect(out.events[0].ttl).toBe(60);
  });

  it('says it once per condition, not once per turn', () => {
    const coach = new Coach();
    limits(coach, "I'm 7 months pregnant");
    expect(limits(coach, 'so what should I do').events).toEqual([]);
    const again = limits(coach, 'also I had surgery last month');
    expect(again.events[0].text).toContain('recent surgery');
    expect(again.events[0].text).not.toContain('pregnancy and');
  });

  it('refuses every tap that would advance the plan', () => {
    const coach = new Coach();
    coach.command('goal', 'Full body');
    coach.hear({ constraints: parseConstraints("I'm 7 months pregnant"), intent: null });
    for (const [command, value] of [['level', 'Beginner'], ['goal', 'Mobility'], ['move', 'Squats'], ['restart', ''], ['relevel', 'Advanced']] as const) {
      const out = coach.command(command, value);
      expect(out.refused, command).toContain('paused');
      expect(out.view.plan, command).toBeNull();
      expect(out.view.flow.level, command).toBe('');
    }
  });

  it('answers a request on hold by repeating the hold, and does nothing for words that ask for nothing', () => {
    const coach = new Coach();
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    limits(coach, "I'm 7 months pregnant");
    const ask = intent(coach, { kind: 'move', move: 'Bodyweight squats' });
    expect(ask.handled).toBe(true);
    expect(ask.events[0].text).toContain('on hold');
    expect(ask.view.flow.start_move).toBe('');
    expect(limits(coach, 'how are you today?').handled).toBe(false);
  });

  it('does not restart plan building behind the hold for a later limit', async () => {
    const model = parkedModel();
    const coach = new Coach({ generatePlan: model.generatePlan });
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    await model.release(0);
    limits(coach, "I'm 7 months pregnant");
    const later = limits(coach, 'actually make it 20 minutes');
    expect(model.calls).toHaveLength(1);
    expect(later.view.rebuilding).toBe(false);
    expect(later.view.plan?.duration_minutes).toBe(25);
  });

  it('never publishes a plan that was being built when the hold landed', async () => {
    const model = parkedModel();
    const coach = new Coach({ generatePlan: model.generatePlan });
    const outcomes = watch(coach);
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    limits(coach, "I'm 7 months pregnant");
    await model.release(0);
    expect(coach.view().plan).toBeNull();
    expect(outcomes.flatMap((o) => o.events)).toEqual([]);
  });

  it('says nothing about a rebuild that lands after the hold, and keeps the old plan', async () => {
    // The ordering that matters: the rebuild is PARKED inside the model call
    // when the disclosure lands. The original published nothing but still said
    // "That takes walking lunges... out of your workout" over a board reading
    // 25 minutes with lunges: three owed promises broken at once.
    let calls = 0;
    const model = parkedModel();
    const coach = new Coach({ generatePlan: (req) => (calls++ === 0 ? Promise.resolve(lungePlan()) : model.generatePlan!(req)) });
    const outcomes = watch(coach);
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    await flush();
    const before = coach.view().plan;
    limits(coach, 'my left knee is bad');
    expect(coach.view().rebuilding).toBe(true);
    limits(coach, "also I'm 7 months pregnant");
    outcomes.length = 0;
    await model.release();
    expect(coach.view().plan).toEqual(before);
    expect(outcomes.flatMap((o) => o.events)).toEqual([]);
    expect(coach.view().rebuilding).toBe(false);
  });

  it('neither shows nor announces a clip that finishes after the hold', async () => {
    const fake = fakeRenderer(true);
    const coach = new Coach({ renderer: fake.renderer });
    const outcomes = watch(coach);
    coach.command('goal', 'Full body');
    coach.command('move', coach.command('level', 'Beginner').view.plan!.workout_steps[0]);
    limits(coach, "I'm 7 months pregnant");
    expect(fake.state.stops).toBeGreaterThan(0);
    expect(fake.state.hooks!.suppressed()).toBe(true);
    outcomes.length = 0;
    fake.state.hooks!.onStatus({ status: 'ready', request_id: 'r1', prompt: '', video_url: '/x' });
    expect(outcomes).toEqual([]);
    expect(coach.view().video?.status).not.toBe('ready');
  });
});

describe('a limit reshapes the plan, and is acknowledged once', () => {
  it('rebuilds the plan in code for a typed injury, and lets the avatar answer the line', async () => {
    const coach = new Coach({ generatePlan: async (r) => lungePlan(r.goal, r.level) });
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    await flush();
    const outcomes = watch(coach);
    const out = limits(coach, 'my left knee is bad, what should I start with?');
    expect(out.handled).toBe(false);
    expect(out.view.acknowledged).toEqual(['your knee']);
    expect(out.view.rebuilding).toBe(true);
    await flush();
    const landed = outcomes.at(-1)!;
    expect(landed.view.rebuilding).toBe(false);
    expect(landed.view.plan!.workout_steps.join(' ')).not.toMatch(/lunge/i);
    expect(landed.view.plan!.warmup_steps.join(' ')).not.toMatch(/high knee/i);
    expect(texts(landed)).toContain('That takes walking lunges and high knees out of your workout');
  });

  it('rebuilds at once without a model, and says what it removed', async () => {
    const coach = new Coach();
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    const out = limits(coach, 'I have a bad knee');
    expect(out.view.plan!.workout_steps.join(' ')).not.toMatch(/squat/i);
    expect(texts(out)).toContain('That takes bodyweight squats out of your workout');
  });

  it('acknowledges each thing once, and a new thing again', async () => {
    const coach = new Coach();
    expect(limits(coach, "I've got a bad knee").view.acknowledged).toEqual(['your knee']);
    expect(limits(coach, 'so what do we do about my bad knee').view.acknowledged).toEqual(['your knee']);
    expect(limits(coach, "and I've only got 20 minutes").view.acknowledged).toEqual(['your knee', '20 minutes']);
  });

  it('gives a limit banked mid-rebuild its own pass', async () => {
    const model = parkedModel();
    const coach = new Coach({ generatePlan: model.generatePlan });
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    await model.release(0);
    limits(coach, 'my knee is bad');
    limits(coach, 'and only 20 minutes');
    expect(model.calls).toHaveLength(2);
    await model.release(1);
    expect(model.calls).toHaveLength(3);
    expect(model.calls[2].minutes).toBe(20);
    await model.release(2);
    expect(coach.view().plan!.duration_minutes).toBe(20);
    expect(coach.view().rebuilding).toBe(false);
  });

  it('still says what changed when the model fails during a rebuild', async () => {
    let calls = 0;
    const coach = new Coach({ generatePlan: async (r) => { if (calls++) throw new Error('the model is having a moment'); return lungePlan(r.goal, r.level); } });
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    await flush();
    const outcomes = watch(coach);
    limits(coach, 'my knee is bad');
    await flush();
    expect(texts(outcomes.at(-1)!)).toContain('walking lunges');
    expect(coach.view().plan!.workout_steps).not.toContain('Walking lunges, 10 each leg');
  });

  it('binds a limit heard while the first plan was being built', async () => {
    const model = parkedModel();
    const coach = new Coach({ generatePlan: model.generatePlan });
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    limits(coach, 'oh and my knee is bad');
    await model.release(0);
    expect(coach.view().plan!.workout_steps.join(' ')).not.toMatch(/lunge/i);
  });

  it('takes down a demo of a move the rebuild removed (new in this port)', async () => {
    const fake = fakeRenderer(true);
    const coach = new Coach({ renderer: fake.renderer, generatePlan: async (r) => lungePlan(r.goal, r.level) });
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    await flush();
    coach.command('move', 'Walking lunges, 10 each leg');
    const outcomes = watch(coach);
    limits(coach, 'my knee is bad');
    await flush();
    const landed = outcomes.at(-1)!;
    expect(landed.view.flow.start_move).toBe('');
    expect(landed.view.video).toBeNull();
    expect(landed.view.stage).toBe('move');
    expect(texts(landed)).toContain('Walking lunges is not on the new plan, so it has been taken off the screen');
  });
});

describe('changing the level of a plan (the original re-level fix)', () => {
  it('publishes the level asked for, not the remembered one', async () => {
    // The board kept saying Beginner while the coach said "advanced".
    const coach = new Coach();
    coach.command('goal', 'Core + cardio');
    coach.command('level', 'Beginner');
    const out = intent(coach, { kind: 'relevel', level: 'Advanced' });
    expect(out.view.plan!.level).toBe('Advanced');
    expect(out.view.flow.level).toBe('Advanced');
  });

  it('steps up and down from where it is', async () => {
    const coach = new Coach();
    coach.command('goal', 'Mobility');
    coach.command('level', 'Beginner');
    const step = (way: 'easier' | 'harder') => intent(coach, { kind: 'relevel', level: stepLevel(coach.view().flow.level, way)! });
    expect(step('harder').view.flow.level).toBe('Intermediate');
    expect(step('harder').view.flow.level).toBe('Advanced');
    expect(step('easier').view.flow.level).toBe('Intermediate');
  });

  it('says so when the plan already is that level', async () => {
    const coach = new Coach();
    coach.command('goal', 'Mobility');
    coach.command('level', 'Beginner');
    expect(coach.command('relevel', 'Beginner').events[0].text).toContain('already is beginner');
  });

  it('takes a level tap after the plan exists as a rebuild', () => {
    const coach = new Coach();
    coach.command('goal', 'Mobility');
    coach.command('level', 'Beginner');
    expect(coach.command('level', 'Advanced').view.plan!.level).toBe('Advanced');
  });
});

describe('starting over', () => {
  it('goes back to the goal and keeps the limits', async () => {
    const coach = new Coach();
    coach.command('goal', 'Mobility');
    coach.command('level', 'Beginner');
    limits(coach, 'only 20 minutes');
    const out = intent(coach, { kind: 'restart' });
    expect(out.view.stage).toBe('goal');
    expect(out.view.plan).toBeNull();
    expect(out.view.constraints.minutes).toBe(20);
  });

  it('drops a plan that was still being built', async () => {
    const model = parkedModel();
    const coach = new Coach({ generatePlan: model.generatePlan });
    coach.command('goal', 'Mobility');
    coach.command('level', 'Beginner');
    coach.command('restart');
    await model.release(0);
    expect(coach.view().plan).toBeNull();
    expect(coach.view().planning).toBe(false);
  });
});

describe('the stream of background outcomes', () => {
  it('keeps what happened while nobody listened, and hands it over in order', async () => {
    const model = parkedModel();
    const coach = new Coach({ generatePlan: model.generatePlan });
    coach.command('goal', 'Mobility');
    coach.command('level', 'Beginner');
    await model.release(0);
    const outcomes = watch(coach);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].view.plan).not.toBeNull();
  });
});
