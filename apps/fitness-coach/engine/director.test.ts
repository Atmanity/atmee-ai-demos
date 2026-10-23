// What the host is told. The tools and the rules fit the API's limits, the
// screen and the state never disagree (the original's
// `test_the_note_tells_the_truth.py`), nothing secret reaches the state, and
// under a hold nothing invites coaching.
import { describe, expect, it } from 'vitest';
import { Coach } from './coach.ts';
import { clearanceLine, parseConstraints } from './constraints.ts';
import { boardState, HOLD_LINE, INSTRUCTIONS, INSTRUCTIONS_MAX, PLAN_WAIT_MS, say, spokenGoal, STATE_MAX, TOOLS, videoLine } from './director.ts';
import type { FitnessPlan, View } from './types.ts';

const toPlan = () => {
  const coach = new Coach({ seed: 's1' });
  coach.command('goal', 'Full body');
  coach.command('level', 'Beginner');
  return coach;
};

const long = (n: number) => 'Ｑ'.repeat(n);

describe('the limits of the API', () => {
  it('keeps the instructions within 4,000 characters, naming every tool', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX);
    for (const tool of TOOLS) expect(INSTRUCTIONS, tool.name).toContain(tool.name);
  });

  it('declares tools the API accepts: names, descriptions, schemas, all awaited in time', () => {
    expect(TOOLS.length).toBeLessThanOrEqual(30);
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
      expect(['web_search', 'lookup']).not.toContain(tool.name);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeLessThanOrEqual(500);
      expect(tool.parameters.type).toBe('object');
      expect(JSON.stringify(tool.parameters).length).toBeLessThanOrEqual(4096);
      expect(tool['x-atmee']?.mode).toBe('await');
      expect(tool['x-atmee']!.timeoutSeconds!).toBeLessThanOrEqual(28);
    }
    expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(24576);
  });

  it('accepts any arguments that could reach the page: no enums, patterns or tight lengths, extra fields allowed', () => {
    const walk = (schema: Record<string, unknown>) => {
      expect(schema).not.toHaveProperty('enum');
      expect(schema).not.toHaveProperty('pattern');
      expect(schema).not.toHaveProperty('format');
      expect(schema).not.toHaveProperty('minLength');
      expect(schema.additionalProperties).not.toBe(false);
      if (typeof schema.maxLength === 'number') expect(schema.maxLength).toBeGreaterThanOrEqual(500);
      for (const child of Object.values((schema.properties ?? {}) as Record<string, Record<string, unknown>>)) walk(child);
    };
    for (const tool of TOOLS) {
      walk(tool.parameters);
      expect(((tool.parameters.required ?? []) as string[]).length, tool.name).toBeLessThanOrEqual(1);
    }
  });

  it('tells the host to call, not narrate, even for one word answering its own question', () => {
    expect(INSTRUCTIONS).toContain('even a single word answering your own question');
    expect(INSTRUCTIONS).toContain('Never say an action happened');
    expect(INSTRUCTIONS).toContain('"Beginner, please"');
  });

  it('asks for every limit in one add_limits call', () => {
    const addLimits = TOOLS.find((t) => t.name === 'add_limits')!;
    expect(addLimits.description).toContain('every limit they said in one call');
    expect(INSTRUCTIONS).toContain('call add_limits once with ALL of their words');
  });

  it('opens without a second greeting', () => {
    const view = new Coach({ seed: 'abc' }).view();
    for (const text of [say.start(view), say.resume(view)]) {
      expect(text).toMatch(/^You have just greeted them; do not greet or introduce yourself again\./);
      expect(text).not.toMatch(/introduce yourself as/i);
    }
  });

  it('waits for a plan for less time than the tools that build one wait for the answer', () => {
    for (const name of ['set_goal', 'set_level', 'add_limits']) {
      const tool = TOOLS.find((t) => t.name === name)!;
      expect(PLAN_WAIT_MS / 1000, name).toBeLessThan(tool['x-atmee']!.timeoutSeconds! - 4);
    }
  });

  it('lets the host start over only when asked', () => {
    const startOver = TOOLS.find((t) => t.name === 'start_over')!;
    expect(startOver.description).toMatch(/only when the user asks/i);
    expect(startOver.description).toMatch(/never on your own/i);
    // A result that mentions starting over leaves the decision to the user.
    expect(say.goalLocked(toPlan().view())).toContain('only if they say yes');
  });

  it('keeps the worst screen within the state limit, and never loses the step', () => {
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

  it('lists only the moves on the screen after a rebuild removed some', () => {
    // After a torn ACL rebuilt the plan in code, the original's coach read the
    // PRE-injury move list aloud: the panel was safe and the voice was not.
    const coach = toPlan();
    expect(boardState(coach.view())).toContain('Bodyweight squats');
    coach.hear({ constraints: parseConstraints('I have a torn ACL'), intent: null });
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

  it('says a move video is ready only when it is, and never promises one when there are none', () => {
    expect(videoLine({ status: 'generating', request_id: 'r', prompt: 'p' }, true, 'Plank hold')).toContain('NOT on the screen yet');
    expect(videoLine({ status: 'ready', request_id: 'r', prompt: 'p', video_url: '/x' }, true, 'Plank hold')).toContain('READY');
    expect(videoLine(null, false, '')).toContain('never promise');
    expect(videoLine({ status: 'unavailable', request_id: '', prompt: '' }, false, 'Plank hold')).toContain('never promise');
    for (const status of ['generating', 'error', 'unavailable'] as const) {
      expect(videoLine({ status, request_id: 'r', prompt: 'p' }, true, 'Plank hold')).not.toContain('READY');
    }
  });

  it('never carries the render prompt or the clip address', () => {
    // A superseded render's prompt names a stale move; the clip address is the server's.
    const coach = toPlan();
    const view: View = { ...coach.view(), stage: 'coach', demos: true, flow: { ...coach.view().flow, start_move: 'Plank hold' }, video: { status: 'ready', request_id: 'r', prompt: 'A fitness trainer demonstrates walking lunges', video_url: '/api/apps/fitness-coach/clips/abc' } };
    const text = boardState(view);
    expect(text).not.toContain('walking lunges');
    expect(text).not.toContain('/api/apps');
    expect(text).not.toContain('clips/');
  });

  it('names the goals the screen actually shows, and a level already given', () => {
    for (const seed of ['xyz', 'abc', 'fitness']) {
      const view = new Coach({ seed }).view();
      const text = boardState(view);
      for (const goal of view.goalOptions) expect(text).toContain(spokenGoal(goal));
      expect(say.start(view)).toContain(spokenGoal(view.goalOptions[0]));
    }
    expect(spokenGoal('Fat-loss HIIT')).toBe('fat-loss HIIT');
    expect(spokenGoal('Glutes + legs')).toBe('glutes and legs');
    const coach = new Coach();
    coach.hear({ constraints: parseConstraints(''), intent: null, level: 'Beginner' });
    expect(boardState(coach.view())).toContain('They already said their level is beginner');
  });

  it('forbids inventing moves before there is a plan', () => {
    const coach = new Coach();
    expect(boardState(coach.view())).toContain('do not list or invent moves');
    coach.command('goal', 'Mobility');
    expect(boardState(coach.view())).toContain('do not list or invent moves');
  });
});

describe('under a hold', () => {
  const held = () => {
    const coach = toPlan();
    coach.command('move', coach.view().plan!.workout_steps[0]);
    coach.hear({ constraints: parseConstraints("I'm 7 months pregnant"), intent: null });
    return coach.view();
  };

  it('names no move and stages no coaching', () => {
    const view = held();
    const text = boardState(view);
    expect(text).toContain('WORKOUT STOPPED FOR SAFETY');
    expect(text).toContain('doctor');
    expect(text).toContain('NOT adapted');
    for (const step of [...view.plan!.warmup_steps, ...view.plan!.workout_steps]) expect(text).not.toContain(step.split(',')[0]);
    expect(text).not.toMatch(/READY|being made|Step \d of 4|Now coaching/);
  });

  it('gives the host the exact sentence first, and the screen the same words', () => {
    const text = say.clearance(['pregnancy']);
    expect(text.startsWith(`"${clearanceLine(['pregnancy'])}"`)).toBe(true);
    expect(text).toContain('Do not suggest any exercise');
    // A refusal under the pause also opens with what to say, not with room for a filler's "Nah, I don't agree".
    expect(say.onHold('start a move').startsWith(`"${HOLD_LINE}"`)).toBe(true);
  });
});
