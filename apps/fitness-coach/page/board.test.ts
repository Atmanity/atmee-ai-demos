import { describe, expect, it } from 'vitest';

import {
  NO_OPTIMISM,
  boardMode,
  emptySectionNotice,
  goalOptions,
  limitLabel,
  moveAction,
  moveCaption,
  moveFromPrompt,
  refusalReason,
  seededShuffle,
  settleOptimism,
  videoLabel,
} from './board.ts';
import { INITIAL_FLOW, type FitnessFlow, type FitnessPlan, type FitnessVideo } from './parsers.ts';

/**
 * The branching this board does, without a DOM. Ported from the original
 * panel's `board.test.ts`: for as long as these decisions were inline in the
 * component, the only way to check them was to look at the running board,
 * which is how the video stage came to say "Choose a starting move" over a
 * render that had already failed.
 */

const flow = (over: Partial<FitnessFlow> = {}): FitnessFlow => ({ ...INITIAL_FLOW, ...over });

const A_PLAN: FitnessPlan = {
  plan_title: 'Quiet power full body',
  goal: 'Full body',
  level: 'Beginner',
  duration_minutes: 20,
  warmup_steps: ['March in place'],
  workout_steps: ['Goblet squats'],
  coaching_cues: ['Ribs down'],
};

const video = (over: Partial<FitnessVideo> = {}): FitnessVideo => ({
  status: 'generating',
  requestId: 'r1',
  prompt: '',
  ...over,
});

describe('which world the board is in', () => {
  it('opens on the choosers, with no stage and nothing to plan', () => {
    const mode = boardMode(flow(), null, null);
    expect(mode).toMatchObject({
      hold: '',
      showVideoStage: false,
      showSelectionCards: true,
      showLevelSelection: false,
      isPlanning: false,
    });
  });

  it('offers the level as soon as a goal is chosen, spoken or tapped', () => {
    expect(boardMode(flow({ goal: 'Mobility' }), null, null).showLevelSelection).toBe(true);
    expect(
      boardMode(flow(), null, null, { goal: 'Mobility', level: '' }).showLevelSelection,
    ).toBe(true);
  });

  it('shows the planning spinner only once both answers are in', () => {
    const mode = boardMode(flow({ goal: 'Mobility' }), null, null, {
      goal: '',
      level: 'Beginner',
    });
    expect(mode.isPlanning).toBe(true);
    expect(mode.selectedLevel).toBe('Beginner');
  });

  it('prefers the untacknowledged tap over what the agent last said', () => {
    // The tap has to look accepted before the flow update returns, or the
    // button feels broken for a round-trip.
    const mode = boardMode(flow({ goal: 'Mobility' }), null, null, {
      goal: 'Full body',
      level: '',
    });
    expect(mode.selectedGoal).toBe('Full body');
  });

  it('puts the stage up once there is a plan or a clip, and retires the choosers', () => {
    const withPlan = boardMode(flow(), A_PLAN, null);
    expect(withPlan.showVideoStage).toBe(true);
    expect(withPlan.showSelectionCards).toBe(false);
    expect(boardMode(flow(), null, video()).showVideoStage).toBe(true);
  });

  it('stops the whole board when the coach has stopped', () => {
    // The symptom this prevents: the panel carried on asking "What do you want
    // to train?" seconds after the coach said out loud that she could not
    // program for this person.
    const mode = boardMode(flow({ constraints: { clearance: ['pregnancy'] } }), null, null);
    expect(mode.hold).toContain('pregnancy');
    expect(mode.showSelectionCards).toBe(false);
    expect(mode.showLevelSelection).toBe(false);
    expect(mode.isPlanning).toBe(false);
  });

  it('takes a finished demo off the screen the moment the session is held', () => {
    // The agent-side hold only stops NEW publishes. A clip that reached
    // `ready` before the user mentioned their pregnancy is already in state
    // and is never retracted — and the stage renders ABOVE the hold card, so
    // the board drew "Session on hold" and then autoplayed a workout demo
    // underneath it.
    const held = flow({ constraints: { clearance: ['pregnancy'] } });
    const ready = video({ status: 'ready', videoUrl: 'https://example.test/clip.mp4' });
    expect(boardMode(held, A_PLAN, ready).showVideoStage).toBe(false);
  });

  it('takes a render still in flight, and a failed one, off with it', () => {
    // "Rendering demo… this can take a minute or two" over a session that has
    // stopped is a promise nobody is going to keep, and a render failure is
    // nobody's problem once the workout is not happening.
    const held = flow({ constraints: { clearance: ['chest pain'] } });
    expect(boardMode(held, null, video({ status: 'generating' })).showVideoStage).toBe(false);
    expect(boardMode(held, null, video({ status: 'error' })).showVideoStage).toBe(false);
    expect(boardMode(held, A_PLAN, null).showVideoStage).toBe(false);
  });

  it('still shows the stage when there is no hold', () => {
    // The guard is on the clearance hold, not on having a clip: this is what
    // the fix must not break.
    expect(boardMode(flow(), A_PLAN, video({ status: 'ready' })).showVideoStage).toBe(true);
  });
});

describe('captioning the clip', () => {
  const PROMPT =
    'A fitness trainer demonstrates arm circles for a beginner workout focused on mobility. ' +
    'Show clear form in a bright modern gym, vertical full-body framing, simple pacing.';

  it('prefers the move the agent named', () => {
    expect(moveCaption(flow({ start_move: 'Glute bridge' }), video({ prompt: PROMPT }))).toBe(
      'Glute bridge',
    );
  });

  it('falls back to the move inside the render prompt', () => {
    // The agent may not publish `start_move` at all; the caption is worth
    // having and worth living without.
    expect(moveCaption(flow(), video({ prompt: PROMPT }))).toBe('arm circles');
  });

  it('never shows the developer half of the prompt', () => {
    // This is what the failure card used to print at a user who had just been
    // told their demo failed.
    expect(moveFromPrompt(PROMPT)).not.toContain('framing');
    expect(moveFromPrompt(PROMPT)).not.toContain('gym');
  });

  it('says nothing rather than something unreadable', () => {
    expect(moveCaption(flow(), null)).toBe('');
    expect(moveFromPrompt('render this thing please')).toBe('');
  });

  it('shortens a move long enough to break the stage', () => {
    const long = 'a'.repeat(200);
    expect(moveCaption(flow({ start_move: long }), null).length).toBeLessThanOrEqual(64);
  });

  it('reads a prompt the agent truncated mid-sentence', () => {
    expect(moveFromPrompt('A fitness trainer demonstrates bodyweight squats')).toBe(
      'bodyweight squats',
    );
  });
});

describe('the goal chips', () => {
  const ALL = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

  it('deals the same six every time, because the shell remounts this panel', () => {
    expect(goalOptions(ALL, 6, '')).toEqual(goalOptions(ALL, 6, ''));
    expect(seededShuffle(ALL, 'seed')).toEqual(seededShuffle(ALL, 'seed'));
  });

  it('is a shuffle, not the first six', () => {
    expect(seededShuffle(ALL, 'fitness-coach')).not.toEqual(ALL);
    expect([...seededShuffle(ALL, 'fitness-coach')].sort()).toEqual([...ALL].sort());
  });

  it('deals differently for a different seed', () => {
    expect(seededShuffle(ALL, 'one')).not.toEqual(seededShuffle(ALL, 'two'));
  });

  it('puts a spoken goal in front so the highlight has something to mark', () => {
    // "Core and cardio" arrives on the flow and may be nowhere in the six; the
    // board looked like it had not heard.
    const dealt = goalOptions(ALL, 6, 'Core + cardio');
    expect(dealt[0]).toBe('Core + cardio');
    expect(dealt).toHaveLength(6);
  });

  it('does not duplicate a goal that was already on offer', () => {
    const dealt = goalOptions(ALL, 6, ALL[0]);
    expect(dealt.filter((g) => g === ALL[0])).toHaveLength(1);
  });
});

describe('a tap the app refused', () => {
  it('reads a refusal that RESOLVED rather than threw', () => {
    // `.catch()` only ever saw transport failures; this is what the agent
    // actually answers a goal tap with during a clearance hold.
    expect(refusalReason({ ok: false, error: 'the session is on hold' })).toBe(
      'the session is on hold',
    );
  });

  it('says something rather than nothing when no reason came back', () => {
    expect(refusalReason({ ok: false })).toBeTruthy();
  });

  it('leaves an accepted tap alone', () => {
    expect(refusalReason({ ok: true })).toBeNull();
    expect(refusalReason(null)).toBeNull();
    expect(refusalReason('ok')).toBeNull();
    expect(refusalReason(undefined)).toBeNull();
  });

  it('reads the SDK intent shape too', () => {
    expect(refusalReason({ applied: false, reason: 'not your turn' })).toBe('not your turn');
  });

  it("reads this app's own refusal", () => {
    expect(refusalReason({ view: {}, handled: true, events: [], refused: 'Start over to change what you train.' })).toBe('Start over to change what you train.');
    expect(refusalReason({ view: {}, handled: true, events: [] })).toBeNull();
  });
});

describe('a section the bans emptied', () => {
  it('names the limit in the words the user used', () => {
    expect(limitLabel({ injuries: ['left knee'] })).toBe('left knee');
    expect(limitLabel({ equipment: 'none' })).toBe('no-equipment limit');
    expect(limitLabel({ minutes: 20 })).toBe('20 min cap');
  });

  it('offers a way out instead of hiding the section', () => {
    expect(emptySectionNotice({ injuries: ['knee'] }, 'warmup')).toBe(
      'Nothing here is safe with your knee — ask your coach for an alternative.',
    );
    expect(emptySectionNotice({ injuries: ['knee'] }, 'workout')).toBeTruthy();
  });

  it('says nothing when the section is just thin', () => {
    // No constraint behind it, nothing to explain: this is a thin plan, not a
    // refusal, and inventing a reason would be worse than the gap.
    expect(emptySectionNotice({}, 'warmup')).toBe('');
  });

  it('never blames the bans for an empty Form cues list', () => {
    // `constraints.enforce` filters warmup_steps and workout_steps and nothing
    // else, so a ban cannot empty the cues. The notice was being printed there
    // anyway, telling the user that COACHING CUES were not safe with their
    // knee and to ask for an alternative — to a cue.
    expect(emptySectionNotice({ injuries: ['knee'] }, 'cues')).toBe('');
    expect(emptySectionNotice({ minutes: 20 }, 'cues')).toBe('');
  });
});

describe('a tap the app has now answered for itself', () => {
  it('drops the tapped goal when the agent publishes a different one', () => {
    // Tap "Full body", say "actually glutes": the agent has glutes and the
    // header read Full body for the rest of the onboarding, because optimism
    // was only ever cleared by a plan or a refusal.
    const settled = settleOptimism('goal', { goal: 'Full body', level: 'Beginner' });
    expect(settled).toEqual(NO_OPTIMISM);
    expect(boardMode(flow({ goal: 'Glutes + legs' }), null, null, settled).selectedGoal).toBe(
      'Glutes + legs',
    );
  });

  it('drops the tapped level too, since it was chosen for the old goal', () => {
    expect(settleOptimism('goal', { goal: '', level: 'Advanced' }).level).toBe('');
  });

  it('keeps the goal when it is only the level the agent answered', () => {
    // The goal question is settled separately; clearing it here would flip the
    // board back to the goal chooser mid-answer.
    expect(settleOptimism('level', { goal: 'Mobility', level: 'Beginner' })).toEqual({
      goal: 'Mobility',
      level: '',
    });
  });

  it('hands back the very same object when there is nothing to settle', () => {
    // The caller settles from an effect on every flow update, so an equal-but-
    // new object here would re-render the board for every packet that mentions
    // a goal.
    expect(settleOptimism('goal', NO_OPTIMISM)).toBe(NO_OPTIMISM);
    const goalOnly = { goal: 'Mobility', level: '' };
    expect(settleOptimism('level', goalOnly)).toBe(goalOnly);
  });

  it('follows a spoken level once the tap is settled', () => {
    const settled = settleOptimism('level', { goal: 'Mobility', level: 'Beginner' });
    const mode = boardMode(flow({ goal: 'Mobility', level: 'Advanced' }), null, null, settled);
    expect(mode.selectedLevel).toBe('Advanced');
  });
});

describe('the move buttons and the video label', () => {
  it('offers moves to start with, then to see or switch to, and nothing before a plan or under a hold', () => {
    expect(moveAction('move', true, true)).toBe('Start here');
    expect(moveAction('coach', true, true)).toBe('Show me');
    expect(moveAction('coach', false, true)).toBe('Switch to');
    for (const stage of ['goal', 'level', 'planning', 'hold'] as const) expect(moveAction(stage, true, true), stage).toBe('');
    expect(moveAction('move', true, false)).toBe('');
  });

  it('always says which world the video stage is in', () => {
    expect(videoLabel(null, true)).toBe('Pick a move to see it');
    // Known up front: with no video key, the stage never pretends a clip may come.
    expect(videoLabel(null, false)).toBe('Coached in words');
    expect(videoLabel(video({ status: 'generating' }), true)).toBe('Making your video');
    expect(videoLabel(video({ status: 'ready' }), true)).toBe('Video ready');
    expect(videoLabel(video({ status: 'error' }), true)).toBe('Video didn’t come through');
    expect(videoLabel(video({ status: 'unavailable' }), false)).toBe('Coached in words');
    // No label says "demo": the word is the team's, not the product's.
    for (const v of [null, video({ status: 'generating' }), video({ status: 'ready' }), video({ status: 'error' })]) {
      expect(videoLabel(v, true)).not.toMatch(/demo/i);
    }
  });
});
