// Reading the host's tool arguments the way people say them, and the phrases
// the page's safety net acts on when the host does not.
import { describe, expect, it } from 'vitest';
import { goalIn, levelAsked, moveAsked, moveIn, mustDo, mustSetLevel, mustStartMove, mustStop, readLevel, stepLevel, type NetContext } from './judge.ts';
import { buildFallbackPlan } from './plan.ts';

const plan = buildFallbackPlan('Full body', 'Beginner');
// warm-up: March in place, Arm circles, Bodyweight good mornings
// workout: Bodyweight squats, Incline push-ups, Glute bridges, Plank hold

describe('a goal, as the host passes it', () => {
  it.each([
    ['Full body please', 'Full body'],
    ['I want to work on my glutes', 'Glutes'],
    ['core and cardio', 'Core + cardio'],
    ['Some HIIT today', 'HIIT'],
    ['mobility', 'Mobility'],
    ['upper body strength', 'Upper body strength'],
    ["core and cardio, I'm a beginner", 'Core + cardio'],
  ])('lands on the board’s words where it can: %s', (said, goal) => {
    expect(goalIn(said)).toBe(goal);
  });

  it('does not take a hurt body part as a goal', () => {
    expect(goalIn('my back is sore', ['back'])).toBeNull();
    expect(goalIn('my back is sore but I want core', ['back'])).toBe('Core');
  });

  it('finds nothing in words that name no goal', () => {
    for (const said of ['beginner', 'I only have 20 minutes', 'hello']) expect(goalIn(said), said).toBeNull();
  });
});

describe('a move, as the host passes it', () => {
  it.each([
    ["Let's start with the squats", 'Bodyweight squats'],
    ['the plank', 'Plank hold'],
    ['can we do the glute bridges?', 'Glute bridges'],
    ['the first warm-up move', 'March in place'],
    ['the last one', 'Plank hold'],
    ["I'll go with arm circles please", 'Arm circles'],
    ['incline push ups', 'Incline push-ups'],
    ['show me a demo of arm circles', 'Arm circles'],
  ])('lands on a plan move: %s', (said, move) => {
    expect(moveIn(plan, said)).toBe(move);
  });

  it('does not read "the one with" as move number one', () => {
    expect(moveIn(plan, 'the one with the bridge')).toBe('Glute bridges');
  });

  it('finds nothing for a move that is not on the plan', () => {
    for (const said of ['burpees', 'handstand walk', 'ok']) expect(moveIn(plan, said), said).toBeNull();
  });
});

describe('easier and harder', () => {
  it('steps one level from where the plan is, and stays at either end', () => {
    expect(stepLevel('Beginner', 'harder')).toBe('Intermediate');
    expect(stepLevel('Advanced', 'easier')).toBe('Intermediate');
    expect(stepLevel('Advanced', 'harder')).toBe('Advanced');
    expect(stepLevel('Beginner', 'easier')).toBe('Beginner');
    expect(stepLevel('', 'harder')).toBeNull();
  });
});

describe('the safety net', () => {
  it('does what the words clearly ask for, and only what is safe to do twice', () => {
    const cases: [string, string | null][] = [
      ["Let's start over", 'start_over'], ['can we do a new plan', 'start_over'], ['I want a different goal', 'start_over'],
      ['I only have 20 minutes', 'add_limits'], ['no equipment at all', 'add_limits'], ['my left knee is bad', 'add_limits'],
      ['I have a torn ACL', 'add_limits'], ['no lunges please', 'add_limits'], ['twenty minutes, tops', 'add_limits'],
      // Left to the host: a level change ("harder" twice is two levels), a goal, a move, a question, small talk.
      ['make it harder', null], ['glutes please', null], ['the plank', null], ['how many reps?', null], ['thanks!', null],
      ["I don't want to start over", null], ['no need to start over', null],
      // A stop is the safety check's, not this net's.
      ["I'm pregnant and have 20 minutes", null],
    ];
    for (const [said, expected] of cases) expect(mustDo(said)?.name ?? null, said).toBe(expected);
  });

  it('hands the user’s own words to add_limits', () => {
    expect(mustDo('My left knee is bad')).toEqual({ name: 'add_limits', arguments: { words: 'My left knee is bad' } });
  });

  it('stops for a condition no exercise swap makes safe, at any point', () => {
    const cases: [string, boolean][] = [
      ["I'm 7 months pregnant", true], ['I had a heart attack two years ago', true], ['I had surgery last month', true],
      ['I get dizzy when I stand up fast', true], ['I fainted at the gym last week', true], ['I broke my wrist, it is a fracture', true],
      ['my knee is sore', false], ['that was a dizzying number of reps', false], ['thanks for the cooperation', false], ['my treadmill is broken', false],
    ];
    for (const [said, stops] of cases) expect(Boolean(mustStop(said)), said).toBe(stops);
    expect(mustStop("I'm 7 months pregnant")).toEqual({ name: 'stop_for_safety', arguments: { condition: "I'm 7 months pregnant" } });
  });
});

describe('a level, however it is said', () => {
  it.each([
    ['Beginner', 'Beginner'], ['a beginner', 'Beginner'], ['BEGINNER LEVEL', 'Beginner'], ["I'm new to this", 'Beginner'],
    ['intermediate', 'Intermediate'], ['Medium', 'Intermediate'], ['advanced', 'Advanced'], ['Expert', 'Advanced'],
    ['easier', 'easier'], ['a bit harder', 'harder'], ['this is too hard', 'easier'], ['too easy', 'harder'], ['more challenging', 'harder'],
    ['glutes', null], ['', null],
  ] as const)('%s', (said, read) => expect(readLevel(said)).toBe(read));
});

describe('the net for a level and a move', () => {
  const atLevel: NetContext = { stage: 'level', level: '', plan: null };
  const withPlan: NetContext = { stage: 'move', level: 'Beginner', plan };

  it('takes a level said alone while the level step is live, as the level to set', () => {
    const cases: [string, NetContext, string | null][] = [
      ['Beginner, please.', atLevel, 'Beginner'], ['intermediate', atLevel, 'Intermediate'], ["I'd say advanced", atLevel, 'Advanced'],
      ['Can you make it a bit harder?', withPlan, 'Intermediate'], ['easier please', { ...withPlan, level: 'Advanced' }, 'Intermediate'],
      ['advanced', withPlan, 'Advanced'],
      // Not alone, not live, or a question:
      ['harder', atLevel, null], ['Beginner, please.', { stage: 'goal', level: '', plan: null }, null],
      ['Beginner', { stage: 'planning', level: 'Beginner', plan: null }, null], ['Beginner', { ...withPlan, stage: 'hold' }, null],
      ['is this too hard for me?', withPlan, null], ['beginner glute bridges please', withPlan, null], ['how many reps is the glute bridge?', withPlan, null],
    ];
    for (const [said, ctx, level] of cases) expect(levelAsked(said, ctx), `${said} @${ctx.stage}`).toBe(level);
    // A step easier or harder goes out as the level it lands on: the net repeating the host's call changes nothing.
    expect(mustSetLevel('a bit harder please', withPlan)).toEqual({ name: 'set_level', arguments: { level: 'intermediate' } });
  });

  it('takes a move asked for once a plan is up, as the move on the plan', () => {
    const cases: [string, NetContext, string | null][] = [
      ["Let's start with the first warm-up move.", withPlan, 'March in place'], ['the plank', withPlan, 'Plank hold'],
      ['can we do the glute bridges?', { ...withPlan, stage: 'coach' }, 'Glute bridges'], ['how about the plank', withPlan, 'Plank hold'],
      ['How many reps is the glute bridge?', withPlan, null], ['I did the plank', { ...withPlan, stage: 'coach' }, null],
      ["Let's do burpees", withPlan, null], ['the plank', atLevel, null], ['Can we just do the plank anyway?', { ...withPlan, stage: 'hold' }, null],
    ];
    for (const [said, ctx, move] of cases) expect(moveAsked(said, ctx), `${said} @${ctx.stage}`).toBe(move);
    expect(mustStartMove('the plank', withPlan)).toEqual({ name: 'start_move', arguments: { move: 'Plank hold' } });
  });
});
