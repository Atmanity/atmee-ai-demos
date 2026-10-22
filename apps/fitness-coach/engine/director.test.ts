// What the avatar is told. The API's limits hold, the screen and the state
// never disagree (the original's `test_the_note_tells_the_truth.py`), the
// predictable next answer is staged, and under a hold nothing invites coaching.
import { describe, expect, it } from 'vitest';
import { Coach } from './coach.ts';
import { clearanceLine, parseConstraints } from './constraints.ts';
import { boardState, NOTE_MAX, NOTES, say, spokenGoal, STATE_MAX, videoLine } from './director.ts';
import { judge } from './judge.ts';
import type { FitnessPlan, View } from './types.ts';

const toPlan = () => {
  const coach = new Coach({ seed: 's1' });
  coach.command('goal', 'Full body');
  coach.command('level', 'Beginner');
  return coach;
};

const long = (n: number) => 'Ｑ'.repeat(n);

describe('the limits of the API', () => {
  it('keeps every standing note within 2,000 characters', () => {
    expect(NOTES.length).toBeGreaterThan(0);
    for (const note of NOTES) expect(note.length).toBeLessThanOrEqual(NOTE_MAX);
  });

  it('keeps the worst board within the state limit, and never loses the step', () => {
    const coach = toPlan();
    const view = coach.view();
    const huge: FitnessPlan = {
      plan_title: long(80), goal: long(100), level: 'Intermediate', duration_minutes: 35,
      warmup_steps: Array(6).fill(long(120)), workout_steps: Array(6).fill(long(120)), coaching_cues: Array(6).fill(long(120)),
    };
    const worst: View = {
      ...view,
      plan: huge,
      rebuilding: true,
      stage: 'coach',
      flow: { ...view.flow, start_move: long(100) },
      video: { status: 'error', request_id: '0'.repeat(36), prompt: long(400), message: long(200) },
      constraints: { minutes: 20, equipment: 'none', injuries: ['knee', 'back', 'shoulder', 'wrist', 'ankle', 'hip', 'neck', 'elbow'] },
      acknowledged: ['your knee', 'your back', 'your shoulder', 'your wrist', 'your ankle', 'your hip', '20 minutes', 'no equipment', 'no lunges', 'no burpees'],
    };
    const text = boardState(worst);
    expect(text.length).toBeLessThanOrEqual(STATE_MAX);
    expect(text).toContain('Now coaching');
  });
});

describe('the screen and the state tell the same story', () => {
  it('is never absent, even before there is a plan', () => {
    const text = boardState(new Coach().view());
    expect(text).toContain('Plan: nothing on the screen yet.');
    expect(text).toContain('Step 1 of 4');
  });

  it('lists only the moves on the board after a rebuild removed some', async () => {
    // After a torn ACL rebuilt the plan in code, the original's coach read the
    // PRE-injury move list aloud: the panel was safe and the voice was not.
    const coach = toPlan();
    expect(boardState(coach.view())).toContain('Bodyweight squats');
    coach.hear(await judge('I have a torn ACL', coach.context()), 'typed');
    const text = boardState(coach.view());
    expect(text).not.toContain('squats');
    for (const step of coach.view().plan!.workout_steps) expect(text).toContain(step);
  });

  it('does not claim a rebuild has landed while it is in flight', () => {
    const coach = toPlan();
    const view = { ...coach.view(), rebuilding: true, constraints: { injuries: ['knee'] } };
    const text = boardState(view);
    expect(text).toContain('IN FLIGHT');
    expect(text).toContain('OLD ones');
    expect(text).toContain('has NOT been updated');
    expect(text).not.toContain('already obeys these');
    expect(boardState({ ...view, rebuilding: false })).toContain('already obeys these');
  });

  it('says a demo is ready only when it is', () => {
    expect(videoLine({ status: 'generating', request_id: 'r', prompt: 'p' }, true, 'Plank hold')).toContain('NOT on the screen yet');
    expect(videoLine({ status: 'ready', request_id: 'r', prompt: 'p', video_url: '/x' }, true, 'Plank hold')).toContain('READY');
    expect(videoLine(null, false, '')).toContain('never promise one');
    for (const status of ['generating', 'error', 'unavailable'] as const) {
      expect(videoLine({ status, request_id: 'r', prompt: 'p' }, true, 'Plank hold')).not.toContain('READY');
    }
  });

  it('never repeats the demo prompt or the clip address', () => {
    // A superseded render's prompt names a stale move.
    const coach = toPlan();
    const view: View = { ...coach.view(), stage: 'coach', flow: { ...coach.view().flow, start_move: 'Plank hold' }, video: { status: 'ready', request_id: 'r', prompt: 'A fitness trainer demonstrates walking lunges', video_url: '/api/apps/fitness-coach/clips/abc' } };
    const text = boardState(view);
    expect(text).not.toContain('walking lunges');
    expect(text).not.toContain('/api/apps');
  });
});

describe('the next answer, staged', () => {
  it('stages the level question at the goal step, and a known level', () => {
    expect(boardState(new Coach().view())).toContain('ask their level');
    const coach = new Coach();
    coach.hear({ constraints: parseConstraints(''), intent: null, level: 'Beginner' }, 'spoken');
    expect(boardState(coach.view())).toContain('They already said their level is beginner');
  });

  it('names the goals the screen actually shows', () => {
    for (const seed of ['xyz', 'abc', 'fitness']) {
      const view = new Coach({ seed }).view();
      const text = boardState(view);
      for (const goal of view.goalOptions) expect(text).toContain(spokenGoal(goal));
      expect(say.start(view)).toContain(spokenGoal(view.goalOptions[0]));
    }
    expect(spokenGoal('Fat-loss HIIT')).toBe('fat-loss HIIT');
    expect(spokenGoal('Glutes + legs')).toBe('glutes and legs');
  });

  it('stages an honest answer to a move pick, with demos off and on', () => {
    const off = toPlan().view();
    expect(boardState(off)).toContain('demo videos are off');
    const on = { ...off, demos: true };
    expect(boardState(on)).toContain('making a short demo');
    expect(boardState(on)).toContain('never say it is ready');
  });

  it('marks the events the state already covered as staged, and only those', () => {
    const coach = new Coach();
    const goal = coach.command('goal', 'Full body');
    expect(goal.events[0].staged).toBe(true);
    const level = coach.command('level', 'Beginner');
    expect(level.events.map((e) => Boolean(e.staged))).toEqual([true, false]);
  });
});

describe('under a hold', () => {
  const held = async () => {
    const coach = toPlan();
    coach.command('move', coach.view().plan!.workout_steps[0]);
    coach.hear(await judge("I'm 7 months pregnant", coach.context()), 'spoken');
    return coach.view();
  };

  it('names no move and stages no coaching', async () => {
    const view = await held();
    const text = boardState(view);
    expect(text).toContain('SESSION ON HOLD');
    expect(text).toContain('doctor');
    expect(text).toContain('NOT adapted');
    for (const step of [...view.plan!.warmup_steps, ...view.plan!.workout_steps]) expect(text).not.toContain(step.split(',')[0]);
    expect(text).not.toMatch(/READY|rendering|Step \d of 4|making a short demo/);
  });

  it('gives the avatar the exact sentence, and the board the same words', () => {
    const text = say.clearance(['pregnancy']);
    expect(text).toContain(clearanceLine(['pregnancy']));
    expect(text).toContain('Do not suggest any exercise');
  });
});
