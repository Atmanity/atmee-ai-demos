// Turning words into app actions, as people say them at each step. Rules
// first; the model call (stubbed here) only for a free-form goal or level.
import { describe, expect, it, vi } from 'vitest';
import type { JudgeContext } from './coach.ts';
import { goalIn, judge, moveIn, type Ask } from './judge.ts';
import { buildFallbackPlan } from './plan.ts';
import type { Intent } from './types.ts';

const plan = buildFallbackPlan('Full body', 'Beginner');
// warm-up: March in place, Arm circles, Bodyweight good mornings
// workout: Bodyweight squats, Incline push-ups, Glute bridges, Plank hold
const at = (stage: JudgeContext['stage'], over: Partial<JudgeContext> = {}): JudgeContext => ({
  stage,
  plan: stage === 'move' || stage === 'coach' ? plan : null,
  goal: stage === 'goal' ? '' : 'Full body',
  level: stage === 'goal' || stage === 'level' ? '' : 'Beginner',
  ...over,
});
const intentOf = async (text: string, ctx: JudgeContext, ask?: Ask) => (await judge(text, ctx, ask)).intent;

describe('step 1, what to train', () => {
  it.each([
    ['Full body please', { kind: 'goal', goal: 'Full body' }],
    ['I want to work on my glutes', { kind: 'goal', goal: 'Glutes' }],
    ['core and cardio', { kind: 'goal', goal: 'Core + cardio' }],
    ['Some HIIT today', { kind: 'goal', goal: 'HIIT' }],
    ['mobility', { kind: 'goal', goal: 'Mobility' }],
    ['upper body strength', { kind: 'goal', goal: 'Upper body strength' }],
  ] as [string, Intent][])('hears a goal: %s', async (said, intent) => {
    expect(await intentOf(said, at('goal'))).toEqual(intent);
  });

  it('hears a goal and a level in one breath', async () => {
    expect(await intentOf("core and cardio, I'm a beginner", at('goal'))).toEqual({ kind: 'goal', goal: 'Core + cardio', level: 'Beginner' });
  });

  it('takes a bare level as a level, not a goal', async () => {
    expect(await intentOf('beginner', at('goal'))).toEqual({ kind: 'level', level: 'Beginner' });
    expect(await intentOf("I'd say intermediate", at('goal'))).toEqual({ kind: 'level', level: 'Intermediate' });
  });

  it('does not take a hurt body part as a goal', async () => {
    expect(goalIn('my back is sore', ['back'])).toBeNull();
    expect(goalIn('my back is sore but I want core', ['back'])).toBe('Core');
  });

  it('does not take a question weighing options as a choice', async () => {
    expect(await intentOf('full body or core, what do you think?', at('goal'))).toBeNull();
    expect(await intentOf('should I do beginner or intermediate?', at('level'))).toBeNull();
    expect(await intentOf('can we do intermediate?', at('level'))).toEqual({ kind: 'level', level: 'Intermediate' });
  });

  it('leaves limits, questions and small talk to the avatar', async () => {
    for (const said of ['I only have 20 minutes', 'hi there', 'what can you do?', 'my knee is bad']) {
      expect(await intentOf(said, at('goal')), said).toBeNull();
    }
  });

  it('asks the model only when the rules cannot tell', async () => {
    const ask = vi.fn(async () => ({ isGoal: true, goal: 'running endurance' }));
    expect(await intentOf('I want to get better at running up hills', at('goal'), ask)).toEqual({ kind: 'goal', goal: 'running endurance' });
    expect(ask).toHaveBeenCalledOnce();
    // Rules first: a goal the rules know never costs a model call.
    await intentOf('glutes please', at('goal'), ask);
    // Nor does a limit, a question or a greeting.
    await intentOf('I only have twenty minutes', at('goal'), ask);
    await intentOf('how does this work?', at('goal'), ask);
    await intentOf('hello', at('goal'), ask);
    expect(ask).toHaveBeenCalledOnce();
  });

  it('treats a failed model call as no intent', async () => {
    const ask: Ask = async () => { throw new Error('quota'); };
    expect(await intentOf('something to wake me up', at('goal'), ask)).toBeNull();
  });

  it('never takes a level the model returned as a goal', async () => {
    // A plan for "beginner beginner" is worse than asking for the goal again.
    const ask: Ask = async () => ({ isGoal: true, goal: 'beginner' });
    expect(await intentOf('just the beginner stuff really', at('goal'), ask)).toEqual({ kind: 'level', level: 'Beginner' });
  });
});

describe('step 2, the level', () => {
  it.each([['intermediate I think', 'Intermediate'], ["let's go advanced", 'Advanced'], ['beginner please', 'Beginner'], ["I'm pretty new to this", 'Beginner']])(
    'hears a level: %s',
    async (said, level) => expect(await intentOf(said, at('level'))).toEqual({ kind: 'level', level }),
  );

  it('hears a change of mind about the goal', async () => {
    expect(await intentOf('actually, glutes instead', at('level'))).toEqual({ kind: 'goal', goal: 'Glutes' });
  });

  it('asks the model for a level described rather than named', async () => {
    const ask: Ask = async () => ({ isLevel: true, level: 'Intermediate' });
    expect(await intentOf('I run three times a week', at('level'), ask)).toEqual({ kind: 'level', level: 'Intermediate' });
    const unsure: Ask = async () => ({ isLevel: false, level: '' });
    expect(await intentOf('not sure to be honest', at('level'), unsure)).toBeNull();
  });
});

describe('step 4, the starting move', () => {
  it.each([
    ["Let's start with the squats", 'Bodyweight squats'],
    ['the plank', 'Plank hold'],
    ['can we do the glute bridges?', 'Glute bridges'],
    ['the first warm-up move', 'March in place'],
    ['the last one', 'Plank hold'],
    ["I'll go with arm circles please", 'Arm circles'],
    ['incline push ups', 'Incline push-ups'],
  ])('hears a move: %s', async (said, move) => {
    expect(await intentOf(said, at('move'))).toEqual({ kind: 'move', move });
  });

  it('does not take a question about a move as a choice', async () => {
    expect(await intentOf("what's the first move?", at('move'))).toBeNull();
    expect(await intentOf('how many reps of squats should I do?', at('coach'))).toBeNull();
  });

  it('does not read "the one with" as move number one', () => {
    expect(moveIn(plan, 'the one with the bridge')).toBe('Glute bridges');
  });

  it('says a move is not on the plan', async () => {
    expect(await intentOf("let's do burpees", at('move'))).toEqual({ kind: 'unknownMove', heard: 'burpees' });
  });

  it('leaves vague answers to the avatar', async () => {
    for (const said of ['ok', 'ready', 'yes', 'sounds good']) expect(await intentOf(said, at('move')), said).toBeNull();
  });
});

describe('once a plan is on the screen', () => {
  it('hears a demo request, with or without a move', async () => {
    expect(await intentOf('show me a demo of arm circles', at('coach'))).toEqual({ kind: 'demo', move: 'Arm circles' });
    expect(await intentOf('can you show me the plank', at('coach'))).toEqual({ kind: 'demo', move: 'Plank hold' });
    expect(await intentOf('make me a video', at('coach'))).toEqual({ kind: 'demo', move: null });
    expect(await intentOf('show me a demo of handstands', at('coach'))).toEqual({ kind: 'unknownMove', heard: 'handstands' });
  });

  it('switches moves on a choice or a bare name, not on a remark', async () => {
    expect(await intentOf("now let's do the plank", at('coach'))).toEqual({ kind: 'move', move: 'Plank hold' });
    expect(await intentOf('glute bridges', at('coach'))).toEqual({ kind: 'move', move: 'Glute bridges' });
    expect(await intentOf('I did the plank', at('coach'))).toBeNull();
    expect(await intentOf('my legs are burning', at('coach'))).toBeNull();
  });

  it.each([
    ['make it advanced', 'Advanced'],
    ['rebuild that as intermediate', 'Intermediate'],
    ['advanced', 'Advanced'],
    ['make it harder', 'Intermediate'],
    ['can you make it harder?', 'Intermediate'],
    ['this is too easy', 'Intermediate'],
  ])('hears a change of level: %s', async (said, level) => {
    expect(await intentOf(said, at('coach'))).toEqual({ kind: 'relevel', level });
  });

  it('does not take a question about difficulty as a change', async () => {
    expect(await intentOf('is this too hard for me?', at('coach'))).toBeNull();
  });

  it('hears starting over', async () => {
    expect(await intentOf("let's start over", at('coach'))).toEqual({ kind: 'restart' });
    expect(await intentOf('can we do a new plan', at('move'))).toEqual({ kind: 'restart' });
  });
});

describe('every line, whatever else it is', () => {
  it('carries its constraints and any level said in passing', async () => {
    const j = await judge("glutes, I'm a beginner, I've only got twenty minutes and a bad knee", at('goal'));
    expect(j.constraints.minutes).toBe(20);
    expect(j.constraints.injuries).toEqual(['knee']);
    expect(j.level).toBe('Beginner');
  });

  it('carries a clearance disclosure at any step', async () => {
    for (const stage of ['goal', 'level', 'move', 'coach'] as const) {
      expect((await judge("I'm 7 months pregnant", at(stage))).constraints.clearance, stage).toEqual(['pregnancy']);
    }
  });
});
