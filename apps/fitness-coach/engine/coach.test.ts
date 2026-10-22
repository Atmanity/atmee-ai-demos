// The guided session. Ported from the logic halves of the original
// `test_clearance_stops_the_session.py`, `test_the_injury_is_acknowledged.py`,
// `test_relevel_plan.py`, `test_compound_answer_spinner.py`,
// `test_the_note_tells_the_truth.py` and `test_board.py`; their LiveKit
// plumbing (llm_node seams, speech scheduling, latches, RPC registration) is
// gone with the platform. New: the step machine that replaces the five
// AgentTasks, and the stream of background outcomes.
import { describe, expect, it } from 'vitest';
import { Coach, type CoachOptions, type Renderer } from './coach.ts';
import { clearanceLine, parseConstraints } from './constraints.ts';
import { buildFallbackPlan } from './plan.ts';
import { judge } from './judge.ts';
import type { FitnessPlan, Outcome, VideoPayload } from './types.ts';

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

/** A typed or spoken line, through the real judge (rules only, as without a model key). */
async function line(coach: Coach, text: string, how: 'typed' | 'spoken' = 'typed') {
  return coach.hear(await judge(text, coach.context()), how);
}

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
    expect(open.events[0].staged).toBeFalsy();
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
    // No key: said plainly, and the board says demos are off rather than spinning.
    expect(move.view.video?.status).toBe('unavailable');
    expect(move.events[0].text).toContain('Demo videos are off');
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

  it('records a compound spoken answer at once, and its limits bind the plan', async () => {
    const coach = new Coach();
    const out = await line(coach, "I want to train core and cardio, I'm a beginner, and I've only got twenty minutes", 'spoken');
    expect(out.view.flow.goal).toBe('Core + cardio');
    expect(out.view.flow.level).toBe('Beginner');
    expect(out.view.plan?.duration_minutes).toBe(20);
    // The avatar was told in advance what to say for this (its state), so
    // after speech the page skips the staged event; the plan's is new news.
    expect(out.events.map((e) => Boolean(e.staged))).toEqual([true, false]);
  });

  it('does not broadcast a level heard in passing as chosen', () => {
    // The original drew "Beginner, setting up your plan…" while the flow was
    // still waiting to be told, and the spinner never resolved.
    const coach = new Coach();
    const out = coach.hear({ constraints: parseConstraints(''), intent: null, level: 'Beginner' }, 'typed');
    expect(out.view.flow.level).toBe('');
    expect(out.view.overheardLevel).toBe('Beginner');
    expect(out.handled).toBe(false);
    // ...and it is the answer once a goal comes, not a question asked again.
    const goal = coach.command('goal', 'Mobility');
    expect(goal.view.flow.level).toBe('Beginner');
    expect(goal.view.plan).not.toBeNull();
  });

  it('asks for the goal again when only a level was given', async () => {
    const coach = new Coach();
    const out = await line(coach, 'beginner', 'spoken');
    expect(out.view.stage).toBe('goal');
    expect(out.view.overheardLevel).toBe('Beginner');
    expect(out.events[0]).toMatchObject({ staged: true });
    expect(out.events[0].text).toContain('got it on the level');
  });

  it('takes a spoken starting move, by name or by position', async () => {
    const coach = new Coach();
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    expect((await line(coach, "Let's start with the squats", 'spoken')).view.flow.start_move).toBe('Bodyweight squats');
    const coach2 = new Coach();
    coach2.command('goal', 'Full body');
    coach2.command('level', 'Beginner');
    expect((await line(coach2, 'the first warm-up move', 'spoken')).view.flow.start_move).toBe('March in place');
  });

  it('says a move is not on the plan, and asks which move for a bare demo request', async () => {
    const coach = new Coach();
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    expect((await line(coach, "let's do burpees")).events[0].text).toContain('not on today');
    expect((await line(coach, 'show me a demo')).events[0].text).toContain('Ask which move');
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
  ])('gives the avatar the exact words for a typed disclosure: %s', async (typed, condition) => {
    const coach = new Coach();
    const out = await line(coach, typed);
    expect(out.handled).toBe(true);
    expect(out.view.stage).toBe('hold');
    expect(out.events).toHaveLength(1);
    expect(out.events[0].text).toContain(clearanceLine([condition]));
    expect(out.events[0].ttl).toBe(60);
  });

  it('sends the words after speech too: the avatar’s own reply may already have gone wrong', async () => {
    // Live in the original: "Thank you for sharing. Please name a warm-up move."
    const out = await line(new Coach(), "I'm 7 months pregnant", 'spoken');
    expect(out.events[0].staged).toBeFalsy();
  });

  it('says it once per condition, not once per turn', async () => {
    const coach = new Coach();
    await line(coach, "I'm 7 months pregnant");
    expect((await line(coach, 'so what should I do')).events).toEqual([]);
    const again = await line(coach, 'also I had surgery last month');
    expect(again.events[0].text).toContain('recent surgery');
    expect(again.events[0].text).not.toContain('pregnancy and');
  });

  it('refuses every tap that would advance the plan', () => {
    const coach = new Coach();
    coach.command('goal', 'Full body');
    coach.hear({ constraints: parseConstraints("I'm 7 months pregnant"), intent: null }, 'typed');
    for (const [command, value] of [['level', 'Beginner'], ['goal', 'Mobility'], ['move', 'Squats'], ['restart', ''], ['relevel', 'Advanced']] as const) {
      const out = coach.command(command, value);
      expect(out.refused, command).toContain('on hold');
      expect(out.view.plan, command).toBeNull();
      expect(out.view.flow.level, command).toBe('');
    }
  });

  it('answers a spoken or typed request on hold by repeating the hold, and lets a plain question through', async () => {
    const coach = new Coach();
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    await line(coach, "I'm 7 months pregnant");
    const ask = await line(coach, "let's start with the squats");
    expect(ask.handled).toBe(true);
    expect(ask.events[0].text).toContain('on hold');
    expect(ask.view.flow.start_move).toBe('');
    expect((await line(coach, 'how are you today?')).handled).toBe(false);
  });

  it('does not restart plan building behind the hold for a later limit', async () => {
    const model = parkedModel();
    const coach = new Coach({ generatePlan: model.generatePlan });
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    await model.release(0);
    await line(coach, "I'm 7 months pregnant");
    const later = await line(coach, 'actually make it 20 minutes');
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
    await line(coach, "I'm 7 months pregnant");
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
    await line(coach, 'my left knee is bad');
    expect(coach.view().rebuilding).toBe(true);
    await line(coach, "also I'm 7 months pregnant");
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
    await line(coach, "I'm 7 months pregnant");
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
    const out = await line(coach, 'my left knee is bad, what should I start with?');
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
    const out = await line(coach, 'I have a bad knee');
    expect(out.view.plan!.workout_steps.join(' ')).not.toMatch(/squat/i);
    expect(texts(out)).toContain('That takes bodyweight squats out of your workout');
  });

  it('acknowledges each thing once, and a new thing again', async () => {
    const coach = new Coach();
    expect((await line(coach, "I've got a bad knee")).view.acknowledged).toEqual(['your knee']);
    expect((await line(coach, 'so what do we do about my bad knee')).view.acknowledged).toEqual(['your knee']);
    expect((await line(coach, "and I've only got 20 minutes")).view.acknowledged).toEqual(['your knee', '20 minutes']);
  });

  it('carries the acknowledgement in the event of a typed action, not after speech', async () => {
    const typed = await line(new Coach(), 'glutes, and I only have 20 minutes');
    expect(typed.events[0].text).toContain('Noted on 20 minutes');
    const spoken = await line(new Coach(), 'glutes, and I only have 20 minutes', 'spoken');
    expect(spoken.events[0].text).not.toContain('Noted on');
  });

  it('gives a limit banked mid-rebuild its own pass', async () => {
    const model = parkedModel();
    const coach = new Coach({ generatePlan: model.generatePlan });
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    await model.release(0);
    await line(coach, 'my knee is bad');
    await line(coach, 'and only 20 minutes');
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
    await line(coach, 'my knee is bad');
    await flush();
    expect(texts(outcomes.at(-1)!)).toContain('walking lunges');
    expect(coach.view().plan!.workout_steps).not.toContain('Walking lunges, 10 each leg');
  });

  it('binds a limit heard while the first plan was being built', async () => {
    const model = parkedModel();
    const coach = new Coach({ generatePlan: model.generatePlan });
    coach.command('goal', 'Full body');
    coach.command('level', 'Beginner');
    await line(coach, 'oh and my knee is bad');
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
    await line(coach, 'my knee is bad');
    await flush();
    const landed = outcomes.at(-1)!;
    expect(landed.view.flow.start_move).toBe('');
    expect(landed.view.video).toBeNull();
    expect(landed.view.stage).toBe('move');
    expect(texts(landed)).toContain('The demo of Walking lunges was taken off the screen');
  });
});

describe('changing the level of a plan (the original re-level fix)', () => {
  it('publishes the level asked for, not the remembered one', async () => {
    // The board kept saying Beginner while the coach said "advanced".
    const coach = new Coach();
    coach.command('goal', 'Core + cardio');
    coach.command('level', 'Beginner');
    const out = await line(coach, 'rebuild that as advanced');
    expect(out.view.plan!.level).toBe('Advanced');
    expect(out.view.flow.level).toBe('Advanced');
  });

  it('steps up and down from where it is', async () => {
    const coach = new Coach();
    coach.command('goal', 'Mobility');
    coach.command('level', 'Beginner');
    expect((await line(coach, 'make it harder')).view.flow.level).toBe('Intermediate');
    expect((await line(coach, 'this is too hard, make it easier')).view.flow.level).toBe('Beginner');
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
    await line(coach, 'only 20 minutes');
    const out = await line(coach, "let's start over");
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
