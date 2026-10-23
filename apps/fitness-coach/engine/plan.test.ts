// Ported from the original `test_plan.py` (parity with upstream's
// fitness_advisor, plan side) and the rebuild-line cases of
// `test_the_injury_is_acknowledged.py`. This is a port, so the interesting
// failures are not "does it work" but "did it quietly stop behaving like the
// thing it replaced".
import { describe, expect, it } from 'vitest';
import {
  acceptGoal,
  baseMoveName,
  buildFallbackPlan,
  buildStartMovePrompt,
  displayMoveOptions,
  findStep,
  looksLikeLevelOnly,
  normalizeLevel,
  planFromData,
  planFromLlmText,
  planPrompt,
  rebuildSummaryLine,
  resolvePlanMove,
} from './plan.ts';
import { parseConstraints, EMPTY } from './constraints.ts';
import type { FitnessPlan } from './types.ts';

const aPlan = (): FitnessPlan => ({
  plan_title: 'Quiet power full body',
  goal: 'Full body',
  level: 'Beginner',
  duration_minutes: 20,
  warmup_steps: ['March in place, 30 seconds', 'Arm circles, 30 seconds each direction'],
  workout_steps: ['Goblet squats, 12 reps', 'Incline push-ups, 10 reps', 'Plank hold, 30 seconds'],
  coaching_cues: ['Own the tempo'],
});
const who = { goal: 'Full body', level: 'Beginner' };

describe('goals and levels', () => {
  it.each(['beginner', 'i am probably advanced', 'advanced', 'intermediate level'])('does not take a level as a goal: %s', (text) => {
    // Asked what they want to TRAIN, people answer "beginner"; accepting it
    // built "Your Beginner beginner plan".
    expect(looksLikeLevelOnly(text)).toBe(true);
    expect(acceptGoal(text)).toBeNull();
  });

  it.each([['Full body', 'Full body'], ['  glutes and core!  ', 'glutes and core'], ['', null]] as const)('accepts and tidies a real goal: %j', (text, expected) => {
    expect(acceptGoal(text)).toBe(expected);
  });

  it('still accepts a goal that mentions a level', () => {
    // "Beginner strength" is one of the board's own buttons.
    expect(acceptGoal('beginner strength')).toBe('beginner strength');
  });

  it.each([['beginner', 'Beginner'], ['I have some experience', 'Intermediate'], ['make it intense', 'Advanced'], ['purple', null], ['', null]] as const)(
    'normalises levels to the three the board shows: %j',
    (text, expected) => expect(normalizeLevel(text)).toBe(expected),
  );
});

describe('the plan', () => {
  it('extracts a plan from a chatty model response', () => {
    const plan = planFromLlmText('Sure thing! {"plan_title": "Sunrise reset", "duration_minutes": 18, "warmup_steps": ["March, 30s"], "workout_steps": ["Squats, 12"], "coaching_cues": ["Tall chest"]} hope that helps', who);
    expect(plan.plan_title).toBe('Sunrise reset');
    expect(plan.duration_minutes).toBe(18);
    expect(plan.workout_steps).toEqual(['Squats, 12']);
  });

  it.each([['0', 20], ['2', 5], ['240', 60], ['"nonsense"', 20], ['null', 20]] as const)('clamps the duration to something a human would do: %s', (raw, expected) => {
    // It renders as "N min" beside a workout the user is about to follow, and the model has answered both 0 and 240.
    expect(planFromLlmText(`{"plan_title": "x", "duration_minutes": ${raw}}`, who).duration_minutes).toBe(expected);
  });

  it('falls back per section rather than rendering an empty board', () => {
    const plan = planFromLlmText('{"plan_title": "Only a title"}', { goal: 'Core', level: 'Beginner' });
    expect(plan.warmup_steps.length && plan.workout_steps.length && plan.coaching_cues.length).toBeTruthy();
  });

  it('throws on a response with no JSON at all, so the caller falls back', () => {
    expect(() => planFromLlmText('I cannot do that right now.', who)).toThrow();
  });

  it('reads a structured model answer the same way, junk and all', () => {
    const plan = planFromData({ plan_title: '  Strong   start ', duration_minutes: 240, warmup_steps: ['Arm circles', 42, null, { a: 1 }, ''], workout_steps: [] }, who);
    expect(plan.plan_title).toBe('Strong start');
    expect(plan.duration_minutes).toBe(60);
    expect(plan.warmup_steps).toEqual(['Arm circles', '42']);
    expect(plan.workout_steps.length).toBeGreaterThan(0);
  });

  it('keeps at most six steps of at most 120 characters', () => {
    const plan = planFromData({ workout_steps: Array.from({ length: 9 }, (_, i) => `${'x'.repeat(200)} ${i}`) }, who);
    expect(plan.workout_steps).toHaveLength(6);
    expect(plan.workout_steps.every((s) => s.length <= 120)).toBe(true);
  });

  it('builds a coachable fallback plan', () => {
    const plan = buildFallbackPlan('Full body', 'Beginner');
    expect(plan.workout_steps.length && plan.warmup_steps.length).toBeTruthy();
    expect(plan.duration_minutes).toBeGreaterThan(0);
  });

  it('asks the model for the limits, not only the goal', () => {
    expect(planPrompt('glutes', 'Beginner', parseConstraints('only 20 minutes, bad knee'))).toContain('20 minutes');
    expect(planPrompt('glutes', 'Beginner', EMPTY)).toBe('Build my Beginner glutes plan now. JSON only.');
  });
});

describe('picking the starting move', () => {
  it('matches a named move to its plan step', () => {
    expect(resolvePlanMove(aPlan(), 'goblet squats')).toBe('Goblet squats');
  });

  it('matches a partial name', () => {
    expect(resolvePlanMove(aPlan(), 'arm circles')).toBe('Arm circles');
  });

  it('matches a singular to its plural', () => {
    expect(resolvePlanMove(aPlan(), 'squat')).toBe('Goblet squats');
  });

  it.each([
    ['the first workout move', 'Goblet squats'],
    ['first warm-up', 'March in place'],
    ['second move', 'Arm circles'],
    ['last workout exercise', 'Plank hold'],
  ])('resolves a positional phrase to a plan step: %s', (phrase, expected) => {
    // The demo prompt is built from the step's name, so "the first one" has
    // to become a real exercise or the clip demonstrates the phrase itself.
    expect(resolvePlanMove(aPlan(), phrase)).toBe(expected);
  });

  it.each(['yes', 'ok', 'ready', ''])('resolves a vague answer to nothing: %j', (vague) => {
    // Null makes the coach ask again; a loose match renders and pays for a
    // demo of a move the user never asked for.
    expect(resolvePlanMove(aPlan(), vague)).toBeNull();
  });

  it('resolves a move that is not in the plan to nothing', () => {
    expect(resolvePlanMove(aPlan(), 'handstand walk')).toBeNull();
  });

  it('does not match a short word inside another word', () => {
    // New in this port: upstream compared raw substrings and relied on its
    // model to hand over a clean phrase, so "go" matched "good mornings".
    const plan = { ...aPlan(), warmup_steps: ['Bodyweight good mornings, 8 reps'] };
    expect(resolvePlanMove(plan, 'go')).toBeNull();
  });

  it('strips reps from a step name', () => {
    expect(baseMoveName('Goblet squats, 12 reps')).toBe('Goblet squats');
  });

  it.each([
    // Heard live: "I will make 10 minutes of cat-cow stretches (1 minute) easy
    // to follow." A leading quantity and a trailing parenthetical are dosage.
    ['10 minutes of cat-cow stretches (1 minute)', 'cat-cow stretches'],
    ['3 x Goblet squats', 'Goblet squats'],
    ['30 seconds of high knees', 'high knees'],
    ['Arm circles (30 seconds each direction)', 'Arm circles'],
    // ...but a parenthetical that names a VARIANT is part of the move.
    ['Push-up (knees)', 'Push-up (knees)'],
    ['Squat (goblet)', 'Squat (goblet)'],
    // Live: "Cat-Cow Stretch, 1 minute" became "Cat" when a bare hyphen split it.
    ['Cat-Cow Stretch, 1 minute', 'Cat-Cow Stretch'],
    ['Push-ups, 10 reps', 'Push-ups'],
    ['Sit-ups, 15 reps', 'Sit-ups'],
    ['Step-ups, 10 each side', 'Step-ups'],
    ['Wall sit - 30 seconds', 'Wall sit'],
    ['Push-ups, 12 reps', 'Push-ups'],
    ['Dead bug — 8 reps each side', 'Dead bug'],
    ['Plank hold: 30 seconds', 'Plank hold'],
    // All dosage: there is no name to find, and an empty name resolves to nothing.
    ['30 seconds', '30 seconds'],
  ])('names the move and not its dosage: %s', (step, expected) => {
    expect(baseMoveName(step)).toBe(expected);
  });

  it('resolves a hyphenated move and names it in full', () => {
    const plan = aPlan();
    plan.warmup_steps = ['Cat-Cow Stretch, 1 minute', ...plan.warmup_steps];
    expect(resolvePlanMove(plan, 'cat cow')).toBe('Cat-Cow Stretch');
    expect(displayMoveOptions(plan)).toContain('Cat-Cow Stretch');
  });

  it('reads the options line as move names', () => {
    expect(displayMoveOptions(aPlan()).startsWith('March in place, Arm circles')).toBe(true);
  });

  it('finds a step by its move name, and only while it is on the plan', () => {
    expect(findStep(aPlan(), 'plank hold')).toBe('Plank hold, 30 seconds');
    expect(findStep(aPlan(), 'Walking lunges')).toBeNull();
  });
});

describe('the demo prompt', () => {
  it('names the move and asks for one trainer', () => {
    const prompt = buildStartMovePrompt('Goblet squats', 'Full body', 'Beginner');
    expect(prompt).toContain('Goblet squats');
    expect(prompt).toContain('Single trainer only');
  });

  it('mentions a reference image only when one exists', () => {
    // The face is per avatar; claiming a reference that was never sent confuses the generation.
    expect(buildStartMovePrompt('Squats', 'Full body', 'Beginner')).not.toContain('reference image');
    expect(buildStartMovePrompt('Squats', 'Full body', 'Beginner', true)).toContain('reference image');
  });

  it('still makes a usable prompt from an empty move', () => {
    expect(buildStartMovePrompt('', '', '')).toContain('the first exercise');
  });
});

describe('what a rebuild changed', () => {
  const before = (): FitnessPlan => ({
    plan_title: 'Beginner Full Body Blast', goal: 'full body', level: 'Beginner', duration_minutes: 25,
    warmup_steps: ['High knees, 30 seconds', 'Shoulder rolls, 30 seconds'],
    workout_steps: ['Walking lunges, 10 each leg', 'Push-ups, 10 reps', 'Glute bridge, 12 reps'],
    coaching_cues: ['Move with control'],
  });

  it('can only claim a change that happened', () => {
    expect(rebuildSummaryLine(before(), before())).toBe('');
    expect(rebuildSummaryLine(before(), { ...before(), duration_minutes: 20 })).toBe('That brings the session to 20 minutes.');
  });

  it('names what it removed, and the new length', () => {
    const after = { ...before(), duration_minutes: 20, workout_steps: ['Push-ups, 10 reps', 'Glute bridge, 12 reps'], warmup_steps: ['Shoulder rolls, 30 seconds'] };
    expect(rebuildSummaryLine(before(), after)).toBe('That takes walking lunges and high knees out of your workout, and the session is now 20 minutes.');
  });

  it('summarises a long removal list rather than reciting it', () => {
    const long = { ...before(), workout_steps: ['Walking lunges, 10 each leg', 'Jump squats, 12 reps', 'Burpees, 8 reps', 'Mountain climbers, 30 seconds', 'Step-ups, 10 each side'] };
    const line = rebuildSummaryLine(long, { ...long, workout_steps: ['Glute bridge, 12 reps'] });
    expect(line).toContain('and 2 more');
    expect(line.split(',').length - 1).toBeLessThanOrEqual(2);
  });
});
