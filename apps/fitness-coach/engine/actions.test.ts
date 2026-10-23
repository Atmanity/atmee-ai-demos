// The host's tools and the user's taps, end to end against a real coach: each
// result carries the coach's real outcome (the plan that landed, what a limit
// changed, the stop), a tool that builds a plan waits for it, and the safety
// stop wins from every direction.
import { describe, expect, it } from 'vitest';
import { conditionLabel, hold, planChange, press, Relay, runTool } from './actions.ts';
import { Coach, type CoachOptions } from './coach.ts';
import { clearanceLine } from './constraints.ts';
import type { FitnessPlan, Outcome } from './types.ts';

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

const lungePlan = (goal = 'Full body', level = 'Beginner'): FitnessPlan => ({
  plan_title: 'Full Body Starter', goal, level, duration_minutes: 25,
  warmup_steps: ['High knees, 30 seconds', 'Shoulder rolls, 30 seconds'],
  workout_steps: ['Walking lunges, 10 each leg', 'Push-ups, 10 reps', 'Glute bridge, 12 reps'],
  coaching_cues: ['Move with control'],
});

/** A plan model whose answers wait until the test releases them. */
function parkedModel() {
  const gates: (() => void)[] = [];
  const generatePlan: CoachOptions['generatePlan'] = (req) => new Promise((resolve) => gates.push(() => resolve(lungePlan(req.goal, req.level))));
  return { generatePlan, pending: () => gates.length, release: (i = gates.length - 1) => gates[i]() };
}

function setup(opts: CoachOptions = {}) {
  const coach = new Coach(opts);
  const relay = new Relay(coach);
  const streamed: Outcome[] = [];
  relay.listen((o) => streamed.push(o));
  const tool = (name: string, args: Record<string, unknown> = {}, waitMs = 2000) => runTool(coach, relay, name, args, waitMs);
  return { coach, relay, streamed, tool };
}

describe('choosing what to train and the level', () => {
  it('records a goal and asks the level', async () => {
    const { tool } = setup();
    const run = await tool('set_goal', { goal: 'glutes and legs' });
    expect(run.view.stage).toBe('level');
    expect(run.view.flow.goal).toBe('Glutes + legs');
    expect(run.text).toContain('ask their level');
  });

  it('answers a goal and a level with the plan itself, not "I am building it"', async () => {
    const { tool } = setup();
    const run = await tool('set_goal', { goal: 'core and cardio', level: 'beginner' });
    expect(run.view.plan).not.toBeNull();
    expect(run.text).toMatch(/^The plan is on the screen now/);
    expect(run.text).not.toContain('putting together');
  });

  it('waits for the plan model, so the first reply is the plan; the stream carries only the screen', async () => {
    const model = parkedModel();
    const { tool, streamed } = setup({ generatePlan: model.generatePlan });
    await tool('set_goal', { goal: 'mobility' });
    const pending = tool('set_level', { level: 'intermediate' });
    await flush();
    expect(model.pending()).toBe(1);
    model.release();
    const run = await pending;
    expect(run.text).toContain('The plan is on the screen now');
    expect(run.view.stage).toBe('move');
    // The plan's own announcement went into the result, not to the host a second time.
    expect(streamed.flatMap((o) => o.events)).toEqual([]);
    expect(streamed.at(-1)?.view.plan).not.toBeNull();
  });

  it('says the plan is still coming when the model is slow, and the landing follows on the stream', async () => {
    const model = parkedModel();
    const { tool, streamed } = setup({ generatePlan: model.generatePlan });
    await tool('set_goal', { goal: 'mobility' });
    const run = await tool('set_level', { level: 'beginner' }, 20);
    expect(run.text).toContain('NOT on the screen yet');
    expect(run.text).toContain('You will be told when it lands');
    model.release();
    await flush();
    expect(streamed.flatMap((o) => o.events).map((e) => e.text).join(' ')).toContain('The plan is on the screen now');
  });

  it('takes a level passed as the goal as the level', async () => {
    const { tool } = setup();
    const run = await tool('set_goal', { goal: 'beginner' });
    expect(run.view.stage).toBe('goal');
    expect(run.view.overheardLevel).toBe('Beginner');
    expect(run.text).toContain('got it on the level');
  });

  it('will not change the goal under a plan without the user asking to start over', async () => {
    const { tool } = setup();
    await tool('set_goal', { goal: 'glutes', level: 'beginner' });
    const run = await tool('set_goal', { goal: 'mobility' });
    expect(run.view.flow.goal).toBe('Glutes');
    expect(run.text).toContain('call start_over only if they say yes');
  });

  it('makes the plan easier or harder from where it is, and says so at either end', async () => {
    const { tool } = setup();
    expect((await tool('set_level', { level: 'harder' })).text).toContain('no plan yet');
    await tool('set_goal', { goal: 'full body', level: 'beginner' });
    const harder = await tool('set_level', { level: 'harder' });
    expect(harder.view.plan!.level).toBe('Intermediate');
    expect(harder.text).toContain('rebuilt at intermediate level');
    await tool('set_level', { level: 'easier' });
    expect((await tool('set_level', { level: 'easier' })).text).toContain('already at the easiest level');
    expect((await tool('set_level', { level: 'beginner' })).text).toContain('already is beginner');
  });
});

describe('limits', () => {
  it('banks a limit before the plan and builds the plan around it', async () => {
    const { tool } = setup();
    const noted = await tool('add_limits', { words: 'my left knee is bad' });
    expect(noted.text).toContain('Noted on your knee');
    expect(noted.text).toContain('will be built around it');
    const run = await tool('set_goal', { goal: 'full body', level: 'beginner' });
    expect(run.view.plan!.workout_steps.join(' ')).not.toMatch(/squat/i);
    expect(run.text).toContain('built around their knee');
  });

  it('rebuilds the plan on the screen and says exactly what changed', async () => {
    const { tool } = setup();
    await tool('set_goal', { goal: 'full body', level: 'beginner' });
    const run = await tool('add_limits', { words: 'I have a bad knee' });
    expect(run.text).toMatch(/^Noted on your knee\./);
    expect(run.text).toContain('That takes bodyweight squats out of your workout');
    expect(run.view.plan!.workout_steps.join(' ')).not.toMatch(/squat/i);
  });

  it('waits for a rebuild by the model, and the stream does not repeat it', async () => {
    let calls = 0;
    const model = parkedModel();
    const { tool, streamed } = setup({ generatePlan: (req) => (calls++ === 0 ? Promise.resolve(lungePlan(req.goal, req.level)) : model.generatePlan!(req)) });
    await tool('set_goal', { goal: 'full body', level: 'beginner' });
    streamed.length = 0;
    const pending = tool('add_limits', { words: 'my knee is bad' });
    await flush();
    model.release();
    const run = await pending;
    expect(run.text).toContain('That takes walking lunges and high knees out of your workout');
    expect(streamed.flatMap((o) => o.events)).toEqual([]);
  });

  it('says plainly when the words hold no limit it can use, and when a limit is already in', async () => {
    const { tool } = setup();
    expect((await tool('add_limits', { words: 'I am a bit tired today' })).text).toContain('Nothing in those words is a limit');
    await tool('add_limits', { words: 'only 20 minutes' });
    expect((await tool('add_limits', { words: 'twenty minutes max' })).text).toContain('Already noted: 20 minutes');
  });
});

describe('moves', () => {
  it('starts a move by name or position, and says when one is not on the plan', async () => {
    const { tool } = setup();
    expect((await tool('start_move', { move: 'the plank' })).text).toContain('no plan on the screen');
    await tool('set_goal', { goal: 'full body', level: 'beginner' });
    const first = await tool('start_move', { move: 'the first warm-up move' });
    expect(first.view.flow.start_move).toBe('March in place');
    expect(first.view.stage).toBe('coach');
    expect(first.text).toContain('Starting March in place');
    expect((await tool('start_move', { move: 'the plank' })).view.flow.start_move).toBe('Plank hold');
    const missing = await tool('start_move', { move: 'burpees' });
    expect(missing.text).toContain('not on today');
    expect(missing.view.flow.start_move).toBe('Plank hold');
  });

  it('starts over only to the goal, keeping the limits', async () => {
    const { tool } = setup();
    await tool('add_limits', { words: 'no equipment' });
    await tool('set_goal', { goal: 'full body', level: 'beginner' });
    const run = await tool('start_over');
    expect(run.view.stage).toBe('goal');
    expect(run.view.plan).toBeNull();
    expect(run.view.constraints.equipment).toBe('none');
    expect(run.text).toContain('Ask what they want to train');
  });
});

describe('the safety stop', () => {
  it('stops at once and gives the exact words; every other tool then repeats the stop', async () => {
    const { tool } = setup();
    await tool('set_goal', { goal: 'full body', level: 'beginner' });
    const run = await tool('stop_for_safety', { condition: 'seven months pregnant' });
    expect(run.view.stage).toBe('hold');
    expect(run.text).toContain(clearanceLine(['pregnancy']));
    for (const [name, args] of [['set_level', { level: 'advanced' }], ['start_move', { move: 'squats' }], ['add_limits', { words: '20 minutes' }], ['start_over', {}], ['set_goal', { goal: 'mobility' }]] as const) {
      const after = await tool(name, args);
      expect(after.text, name).toContain('on hold');
      expect(after.view.stage, name).toBe('hold');
    }
  });

  it('gives the words again when the page stopped first, since the host has not said them yet', async () => {
    const { coach, tool } = setup();
    expect(hold(coach, "I'm 7 months pregnant")!.stage).toBe('hold');
    expect((await tool('stop_for_safety', { condition: 'pregnant' })).text).toContain(clearanceLine(['pregnancy']));
  });

  it('stops for a condition the rules do not know, in plain words; a sore joint is a limit instead', async () => {
    const stroke = setup();
    const run = await stroke.tool('stop_for_safety', { condition: 'I had a stroke in the spring' });
    expect(run.view.stage).toBe('hold');
    expect(run.view.constraints.clearance).toEqual(['a stroke in the spring']);
    const knee = setup();
    const limit = await knee.tool('stop_for_safety', { condition: 'my knee is sore' });
    expect(limit.view.stage).toBe('goal');
    expect(limit.view.constraints.injuries).toEqual(['knee']);
    expect(limit.text).toContain('not a reason to stop');
  });

  it('stops even when a condition is passed as a limit', async () => {
    const { tool } = setup();
    const run = await tool('add_limits', { words: 'I had heart surgery last month' });
    expect(run.view.stage).toBe('hold');
    expect(run.text).toContain('IMPORTANT, safety');
  });

  it('ends a tool that is waiting for a plan as soon as the page stops, with the stop', async () => {
    const model = parkedModel();
    const { coach, relay, tool } = setup({ generatePlan: model.generatePlan });
    await tool('set_goal', { goal: 'mobility' });
    const pending = tool('set_level', { level: 'beginner' }, 10_000);
    await flush();
    hold(coach, 'I get dizzy and sometimes faint');
    relay.poke();
    const run = await pending;
    expect(run.view.stage).toBe('hold');
    expect(run.view.plan).toBeNull();
    expect(run.text).toContain('IMPORTANT, safety');
    model.release();
    await flush();
    expect(coach.view().plan).toBeNull();
  });

  it('is only found in words that carry a condition', () => {
    const { coach } = setup();
    expect(hold(coach, 'my knee is sore')).toBeNull();
    expect(coach.view().stage).toBe('goal');
  });

  it('says an unknown condition plainly, never as a sentence about "I"', () => {
    expect(conditionLabel('a recent stroke')).toBe('a recent stroke');
    expect(conditionLabel("I've got epilepsy")).toBe('epilepsy');
    expect(conditionLabel('my doctor told me I should not exercise right now')).toBe('a health condition');
  });
});

describe('taps', () => {
  it('acts at once and tells the host what was tapped, with the plan itself when it landed', () => {
    const { coach } = setup();
    expect(press(coach, 'goal', 'Mobility').event).toContain('The user tapped the goal "Mobility"');
    const level = press(coach, 'level', 'Beginner');
    expect(level.view.plan).not.toBeNull();
    expect(level.event).toContain('The plan is on the screen now');
    expect(level.event).not.toContain('putting together');
  });

  it('refuses in words, telling the host nothing, when the workout is paused', () => {
    const { coach } = setup();
    hold(coach, 'I had an operation last week');
    const out = press(coach, 'goal', 'Mobility');
    expect(out.refused).toContain('paused');
    expect(out.event).toBeUndefined();
  });
});

describe('what changed on the plan', () => {
  it('is nothing when nothing changed', () => {
    const coach = new Coach();
    coach.command('goal', 'Mobility');
    coach.command('level', 'Beginner');
    expect(planChange(coach.view(), coach.view())).toBe('');
  });
});

it('refuses a tool it does not have', async () => {
  const { tool } = setup();
  await expect(tool('web_search', {})).rejects.toThrow('unknown tool');
});
