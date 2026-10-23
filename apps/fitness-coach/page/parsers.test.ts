import { describe, expect, it } from 'vitest';

import {
  applyFlow,
  clearanceNotice,
  constraintChips,
  INITIAL_FLOW,
  parseConstraints,
  parseFlow,
  parsePlan,
  parseSnapshot,
  parseVideo,
} from './parsers.ts';

/**
 * Ported from the original panel's `parsers.test.ts`. A parser that accepts
 * the wrong thing renders a broken board; one that rejects the right thing
 * renders nothing at all, with no error anywhere. These pin both edges. (The
 * envelope tests are gone with the platform's wire: the board now reads its
 * server's snapshots directly.)
 */

const A_PLAN = {
  plan_title: 'Quiet power full body',
  goal: 'Full body',
  level: 'Beginner',
  duration_minutes: 20,
  warmup_steps: ['March in place, 30 seconds'],
  workout_steps: ['Goblet squats, 12 reps', 'Plank hold, 30 seconds'],
  coaching_cues: ['Own the tempo'],
};

describe('fitness_plan_update', () => {
  it('reads the plan the agent published', () => {
    expect(parsePlan(A_PLAN)).toEqual(A_PLAN);
  });

  it('keeps a plan whose optional sections are missing', () => {
    const parsed = parsePlan({ plan_title: 'Thin plan', workout_steps: ['Squats'] });
    expect(parsed).not.toBeNull();
    expect(parsed!.warmup_steps).toEqual([]);
    expect(parsed!.coaching_cues).toEqual([]);
    expect(parsed!.duration_minutes).toBe(0);
  });

  it('titles an untitled plan rather than rendering a blank header', () => {
    expect(parsePlan({ workout_steps: ['Squats'] })!.plan_title).toBe("Today's plan");
  });

  it('drops non-string steps instead of rendering [object Object]', () => {
    const parsed = parsePlan({ workout_steps: ['Squats', 42, null, { a: 1 }, '  '] });
    expect(parsed!.workout_steps).toEqual(['Squats']);
  });

  it('rejects a plan that carries no sections at all', () => {
    // Nothing to coach from and nothing said about why. Replacing a good plan
    // with this would blank a board the user is mid-workout on.
    expect(parsePlan({ plan_title: 'Empty' })).toBeNull();
    expect(parsePlan({ plan_title: 'Empty', duration_minutes: 20 })).toBeNull();
  });

  it('keeps a plan the bans emptied, so the board can say so', () => {
    // "Safety beats completeness": a section emptied by an injury is a real
    // answer the panel renders as "nothing here is safe with your knee". It
    // used to be rejected as a broken packet, which left the coach talking
    // about a plan that was not on screen.
    const parsed = parsePlan({
      plan_title: 'Working around that knee',
      workout_steps: [],
      warmup_steps: [],
      coaching_cues: ['Stop if it pinches'],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.workout_steps).toEqual([]);
  });

  it.each([null, undefined, 'string', 42, [], true])('rejects %p', (bad) => {
    expect(parsePlan(bad)).toBeNull();
  });
});

describe('fitness_flow_update', () => {
  it('reads a full update', () => {
    expect(parseFlow({ step: 'level_selected', goal: 'Full body', level: 'Beginner' })).toEqual({
      step: 'level_selected',
      goal: 'Full body',
      level: 'Beginner',
    });
  });

  it('returns only the fields that were sent', () => {
    // The agent sends partial updates. An absent `goal` means unchanged, not
    // cleared — filling it with '' blanks the chooser mid-onboarding.
    expect(parseFlow({ step: 'goal_selected', goal: 'Mobility' })).toEqual({
      step: 'goal_selected',
      goal: 'Mobility',
    });
  });

  it('merges a patch over what is on screen', () => {
    const after = applyFlow(
      { step: 'goal_selected', goal: 'Mobility', level: '', constraints: {}, start_move: '' },
      { step: 'plan_ready' },
    );
    expect(after).toEqual({
      step: 'plan_ready',
      goal: 'Mobility',
      level: '',
      constraints: {},
      start_move: '',
    });
  });

  it('reads the move being demoed when the agent names it', () => {
    expect(parseFlow({ start_move: '  Arm circles ' })).toEqual({ start_move: 'Arm circles' });
  });

  it('tolerates an agent that does not publish the move at all', () => {
    // Older agents do not send `start_move`, and the caption falls back to the
    // render prompt. Absent must mean "unchanged", never "cleared".
    const patch = parseFlow({ step: 'plan_ready' });
    expect(patch).toEqual({ step: 'plan_ready' });
    expect(applyFlow({ ...INITIAL_FLOW, start_move: 'Arm circles' }, patch!).start_move).toBe(
      'Arm circles',
    );
  });

  it('ignores a step the panel does not know', () => {
    // A newer agent inventing a step must not put an unrenderable value in
    // state; the rest of the patch still applies.
    expect(parseFlow({ step: 'sprinting', goal: 'Core' })).toEqual({ goal: 'Core' });
  });

  it('accepts a cleared field explicitly sent as empty', () => {
    expect(parseFlow({ goal: '' })).toEqual({ goal: '' });
  });

  it.each([null, undefined, 'idle', 42, [], {}])('rejects %p', (bad) => {
    expect(parseFlow(bad)).toBeNull();
  });
});

describe('fitness_video_update', () => {
  it('reads a ready clip', () => {
    expect(
      parseVideo({
        status: 'ready',
        request_id: 'r1',
        prompt: 'goblet squats',
        video_url: 'https://storage.example.com/r1.mp4',
      }),
    ).toEqual({
      status: 'ready',
      requestId: 'r1',
      prompt: 'goblet squats',
      videoUrl: 'https://storage.example.com/r1.mp4',
    });
  });

  it('reads the in-progress state', () => {
    const parsed = parseVideo({ status: 'generating', request_id: 'r1', prompt: 'squats' });
    expect(parsed!.status).toBe('generating');
    expect(parsed!.videoUrl).toBeUndefined();
  });

  it('reads a failure with its message', () => {
    expect(parseVideo({ status: 'error', message: 'too complex' })!.message).toBe('too complex');
  });

  it('reads "no video key configured" as its own state, not an error', () => {
    // A session without video is a working session. Rendering it as a failure
    // tells the user something broke when nothing did.
    const parsed = parseVideo({ status: 'unavailable', message: 'not switched on' });
    expect(parsed!.status).toBe('unavailable');
  });

  it('rejects a ready clip with no playable URL', () => {
    // Would mount a <video> with an empty src: a broken player and no
    // explanation. Better to keep showing the spinner.
    expect(parseVideo({ status: 'ready', request_id: 'r1' })).toBeNull();
    expect(parseVideo({ status: 'ready', video_url: '' })).toBeNull();
    expect(parseVideo({ status: 'ready', video_url: 42 })).toBeNull();
  });

  it('rejects a URL scheme the page should not load', () => {
    expect(parseVideo({ status: 'ready', video_url: 'file:///tmp/x.mp4' })).toBeNull();
    expect(parseVideo({ status: 'ready', video_url: 'javascript:alert(1)' })).toBeNull();
    expect(parseVideo({ status: 'ready', video_url: '//elsewhere.example/x.mp4' })).toBeNull();
  });

  it("plays a clip from the app's own server", () => {
    // New in this port: the clip is kept and served by this app, same origin.
    expect(parseVideo({ status: 'ready', request_id: 'r1', video_url: '/api/apps/fitness-coach/clips/abc' })!.videoUrl).toBe('/api/apps/fitness-coach/clips/abc');
  });

  it('rejects a status the panel has no rendering for', () => {
    expect(parseVideo({ status: 'queued' })).toBeNull();
    expect(parseVideo({ status: '' })).toBeNull();
  });

  it.each([null, undefined, 'ready', 42, [], {}])('rejects %p', (bad) => {
    expect(parseVideo(bad)).toBeNull();
  });
});

describe("the server's snapshot", () => {
  it('rehydrates the whole board', () => {
    const snapshot = parseSnapshot({
      flow: { step: 'plan_ready', goal: 'Full body', level: 'Beginner' },
      plan: A_PLAN,
      video: { status: 'ready', request_id: 'r1', video_url: 'https://storage/r1.mp4' },
    });
    expect(snapshot!.flow.step).toBe('plan_ready');
    expect(snapshot!.plan!.plan_title).toBe('Quiet power full body');
    expect(snapshot!.video!.status).toBe('ready');
  });

  it('handles a session where nothing has happened yet', () => {
    const snapshot = parseSnapshot({ flow: { step: 'idle', goal: '', level: '' }, plan: null, video: null });
    expect(snapshot!.flow).toEqual(INITIAL_FLOW);
    expect(snapshot!.plan).toBeNull();
    expect(snapshot!.video).toBeNull();
  });

  it('survives a partly-malformed reply rather than losing the whole board', () => {
    // One bad section must not cost the others: this is the reply a panel gets
    // on every remount.
    const snapshot = parseSnapshot({ flow: 'broken', plan: A_PLAN, video: 'broken' });
    expect(snapshot!.plan).not.toBeNull();
    expect(snapshot!.flow).toEqual(INITIAL_FLOW);
    expect(snapshot!.video).toBeNull();
  });

  it.each([null, undefined, 'nope', 42, []])('rejects %p', (bad) => {
    expect(parseSnapshot(bad)).toBeNull();
  });
});


/**
 * The symptom: the user typed "only 20 minutes, no equipment, bad left knee",
 * the plan card said 25 min and listed lunges, and NOTHING on the board showed
 * that any of it had been heard. The chips are how a user can tell the
 * difference between "ignored" and "taken into account".
 */
describe('constraints on the board', () => {
  it('reads the three things people actually say', () => {
    expect(
      parseConstraints({ minutes: 20, equipment: 'none', injuries: ['knee'], avoid: ['lunge'] }),
    ).toEqual({ minutes: 20, equipment: 'none', injuries: ['knee'], avoid: ['lunge'] });
  });

  it('treats an empty block as "nothing to work around", not as noise', () => {
    // Present-and-empty has to CLEAR the chips; only a non-object is ignored.
    expect(parseConstraints({})).toEqual({});
    expect(parseConstraints('nope')).toBeNull();
  });

  it('drops a duration that is not a usable number', () => {
    expect(parseConstraints({ minutes: 0 })?.minutes).toBeUndefined();
    expect(parseConstraints({ minutes: 'soon' })?.minutes).toBeUndefined();
  });

  it('turns them into chips a human can read at a glance', () => {
    expect(constraintChips({ minutes: 20, equipment: 'none', injuries: ['knee'] })).toEqual([
      '20 min cap',
      'No equipment',
      'Working around: knee',
    ]);
  });

  it('names the kit when the user has some', () => {
    expect(constraintChips({ equipment: 'kettlebell' })).toEqual(['Only kettlebell']);
  });

  it('shows nothing rather than an empty row when nothing was said', () => {
    expect(constraintChips({})).toEqual([]);
  });

  it('carries them through a flow patch', () => {
    const patch = parseFlow({ step: 'plan_ready', constraints: { minutes: 20 } });
    expect(patch?.constraints).toEqual({ minutes: 20 });
    expect(applyFlow(INITIAL_FLOW, patch!).constraints).toEqual({ minutes: 20 });
  });

  it('leaves them alone when a patch does not mention them', () => {
    // Absent means unchanged: an older agent sending no `constraints` key must
    // not wipe chips the user is looking at.
    const current = { ...INITIAL_FLOW, constraints: { minutes: 20 } };
    expect(applyFlow(current, parseFlow({ step: 'plan_ready' })!).constraints).toEqual({
      minutes: 20,
    });
  });
});

/**
 * The symptom: the user typed "I'm 7 months pregnant", the coach said out loud
 * that she could not program around it and stopped — and the board carried on
 * asking "What do you want to train?", or sat on "Setting up your beginner
 * Full body plan…" for the rest of the call. The agent publishes `clearance`
 * on the wire precisely so the board can say why it stopped; the panel dropped
 * the field on the floor, so the screen contradicted the voice.
 */
describe('the safety hold on the board', () => {
  it('keeps the clearance the agent published', () => {
    expect(parseConstraints({ clearance: ['pregnancy'] })).toEqual({ clearance: ['pregnancy'] });
  });

  it('carries it through a flow patch and a sync reply', () => {
    const patch = parseFlow({ step: 'idle', constraints: { clearance: ['pregnancy'] } });
    expect(patch?.constraints?.clearance).toEqual(['pregnancy']);

    const snapshot = parseSnapshot({
      flow: { step: 'idle', goal: '', level: '' },
      constraints: { clearance: ['a cardiac history'] },
      plan: null,
      video: null,
    });
    expect(snapshot!.flow.constraints.clearance).toEqual(['a cardiac history']);
  });

  it('is not a "built around" chip', () => {
    // A chip under "Built around" reads as "your plan accounts for this", and
    // nothing was built around anything — the session stopped.
    expect(constraintChips({ clearance: ['pregnancy'] })).toEqual([]);
    expect(constraintChips({ minutes: 20, clearance: ['pregnancy'] })).toEqual(['20 min cap']);
  });

  it('says why the session stopped, in the same terms the coach spoke', () => {
    const notice = clearanceNotice({ clearance: ['pregnancy'] });
    expect(notice).toContain('pregnancy');
    expect(notice).toContain('not able to program');
    expect(notice).toContain('doctor');
  });

  it('names every condition that was disclosed', () => {
    expect(clearanceNotice({ clearance: ['pregnancy', 'recent surgery'] })).toContain(
      'pregnancy and recent surgery',
    );
    expect(
      clearanceNotice({ clearance: ['pregnancy', 'chest pain', 'a fracture'] }),
    ).toContain('pregnancy, chest pain and a fracture');
  });

  it('says nothing at all when nothing was disclosed', () => {
    // The notice is what the panel gates the choosers and the planning spinner
    // on, so an empty string here has to mean "carry on as normal".
    expect(clearanceNotice({})).toBe('');
    expect(clearanceNotice({ minutes: 20, injuries: ['knee'] })).toBe('');
    expect(clearanceNotice({ clearance: [] })).toBe('');
  });
});
