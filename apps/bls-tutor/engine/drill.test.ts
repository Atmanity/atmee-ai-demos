// The drill's actions, as Alex's tools and the buttons reach them. The cases
// from the original's table and tool tests, re-expressed against run(): an
// answer graded and narrated in one result, the two-miss rescue riding on the
// answer that triggered it, refusals that come back as sentences, the
// emergency watch on every answer, and the one way off the card.
import { describe, expect, test } from 'vitest';
import { isAction, NO_DRILL, run, viewOf } from './drill.ts';
import { EMERGENCY_LINE } from './lines.ts';
import { ADULT_CARDIAC_ARREST, CHOKING_ADULT, RECOVERY_POSITION } from './scenarios.ts';
import { ALREADY_AT_MENU, BlsTutor, IN_EMERGENCY, SCENARIO_FINISHED, STEP_UNRESOLVED, UNKNOWN_SCENARIO } from './tutor.ts';

const ADULT = ADULT_CARDIAC_ARREST.id;
const first = ADULT_CARDIAC_ARREST.steps[0];

function drill(scenario: string | null = ADULT) {
  const tutor = new BlsTutor();
  if (scenario) tutor.startScenario(scenario);
  return { tutor, view: () => viewOf(tutor) };
}

describe('starting a drill', () => {
  test.each([
    ['choking', 'choking_adult'], ['the pool one', 'child_cardiac_arrest'], ['the one where someone collapsed', ADULT],
    ['the second one', 'child_cardiac_arrest'], ['you pick', ADULT], ['Unresponsive but breathing', 'recovery_position'],
    ['adult choking', 'choking_adult'], ['choking_adult', 'choking_adult'], ['How about the bus stop one?', 'recovery_position'],
  ])('"%s" starts %s, with its scene and first question', (words, id) => {
    const { tutor } = drill(null);
    const out = run(tutor, 'start_scenario', { scenario: words });
    expect(out.applied).toBe(true);
    expect(tutor.scenario?.id).toBe(id);
    expect(out.text).toContain(tutor.scenario!.opening);
    expect(out.text).toContain(tutor.scenario!.steps[0].prompt);
  });

  test('a drill it does not have is refused with the menu, and nothing changes', () => {
    const { tutor } = drill();
    const out = run(tutor, 'start_scenario', { scenario: 'motorcycle crash' });
    expect(out.applied).toBe(false);
    expect(out.reason).toBe(UNKNOWN_SCENARIO);
    expect(out.text).toContain('choking at dinner');
    expect(tutor.scenario?.id).toBe(ADULT);
  });

  test('mid-drill it switches, from the first step', () => {
    const { tutor, view } = drill();
    run(tutor, 'show_step');
    run(tutor, 'start_scenario', { scenario: "let's do choking instead" });
    expect(view().scenario?.id).toBe('choking_adult');
    expect(view().step_index).toBe(0);
  });
});

describe('grading an answer', () => {
  test('right: graded, confirmed, and taught with every number as written', () => {
    const { tutor, view } = drill();
    const out = run(tutor, 'check_answer', { answer: 'make sure the scene is safe' });
    expect(out.text).toContain('RIGHT');
    expect(out.text).toContain(first.teach);
    expect(out.text).toContain('without changing any number');
    expect(view().phase).toBe('coaching');
    expect(view().score.correct).toBe(1);
  });

  test('one wrong attempt is nudged, not answered', () => {
    const { tutor, view } = drill();
    const out = run(tutor, 'check_answer', { answer: 'I would call his wife' });
    expect(out.text).toContain('NOT RIGHT');
    expect(out.text).toContain(first.hint);
    expect(out.text).not.toContain(first.teach);
    expect(view().phase).toBe('answering');
    expect(view().attempts).toBe(1);
  });

  test('the second miss opens the step in the same result: one narration, the teaching line, no nudge', () => {
    const { tutor, view } = drill();
    run(tutor, 'check_answer', { answer: 'no idea really' });
    const out = run(tutor, 'check_answer', { answer: 'check his pockets' });
    expect(out.text).toContain('second miss');
    expect(out.text).toContain(first.teach);
    expect(out.text).toContain(first.label);
    expect(out.text).not.toContain(first.hint);
    expect(view().phase).toBe('coaching');
    expect(view().steps![0]).toMatchObject({ status: 'done', outcome: 'shown' });
  });

  test('a wrong order is told as the order, not as "not recognised"', () => {
    const { tutor } = drill();
    run(tutor, 'show_step'); run(tutor, 'next_step');
    run(tutor, 'show_step'); run(tutor, 'next_step');
    const out = run(tutor, 'check_answer', { answer: 'start compressions' });
    expect(out.text).toContain('Call for help before compressions.');
  });

  test('the compressions step is taught with its numbers', () => {
    const { tutor } = drill();
    for (let i = 0; i < 3; i++) { run(tutor, 'show_step'); run(tutor, 'next_step'); }
    const out = run(tutor, 'check_answer', { answer: 'heel of my hand in the centre of the chest, push hard and fast' });
    expect(out.text).toContain('100 to 120 a minute');
    expect(out.text).toContain('2 inches');
  });

  test('between steps an answer is the drill\'s refusal, not a grade', () => {
    const { tutor, view } = drill();
    run(tutor, 'show_step');
    const out = run(tutor, 'check_answer', { answer: 'tap and shout' });
    expect(out.applied).toBe(false);
    expect(out.text).toContain('between steps');
    expect(out.text).not.toContain('*');
    expect(view().score.correct).toBe(0);
  });

  test('with no drill running, every step action says to pick one', () => {
    for (const action of ['check_answer', 'show_step', 'give_hint', 'next_step'] as const) {
      const out = run(new BlsTutor(), action, { answer: 'call 911' });
      expect(out.applied, action).toBe(false);
      expect(out.reason, action).toBe(NO_DRILL);
    }
  });
});

describe('show me, a hint, next', () => {
  test('show me teaches the step and marks it as shown', () => {
    const { tutor, view } = drill();
    const out = run(tutor, 'show_step');
    expect(out.text).toContain(first.teach);
    expect(out.text).toContain(first.label);
    expect(view().steps![0].outcome).toBe('shown');
  });

  test('a hint is the step\'s hint, for the screen too, and changes nothing', () => {
    const { tutor, view } = drill();
    const out = run(tutor, 'give_hint');
    expect(out.hint).toBe(first.hint);
    expect(out.text).toContain(first.hint);
    expect(out.text).not.toContain(first.teach);
    expect(view().attempts).toBe(0);
    expect(view().phase).toBe('answering');
  });

  test('next does not skip an unanswered step', () => {
    const { tutor, view } = drill();
    const out = run(tutor, 'next_step');
    expect(out.applied).toBe(false);
    expect(out.reason).toBe(STEP_UNRESOLVED);
    expect(view().step_index).toBe(0);
  });

  test('next asks the next question; a second next is refused, so the safety net cannot skip a step', () => {
    const { tutor, view } = drill();
    run(tutor, 'show_step');
    const out = run(tutor, 'next_step');
    expect(out.text).toContain(ADULT_CARDIAC_ARREST.steps[1].prompt);
    expect(run(tutor, 'next_step').applied).toBe(false);
    expect(view().step_index).toBe(1);
  });

  test('show me twice: the second is refused, and the step stays as it was', () => {
    const { tutor, view } = drill();
    run(tutor, 'check_answer', { answer: 'check the scene is safe' });
    expect(run(tutor, 'show_step').applied).toBe(false);
    expect(view().steps![0].outcome).toBe('correct');
  });

  test('after the last step, next brings up the review with the real score', () => {
    const { tutor, view } = drill(RECOVERY_POSITION.id);
    let text = '';
    for (const _ of RECOVERY_POSITION.steps) { run(tutor, 'show_step'); text = run(tutor, 'next_step').text; }
    expect(view().phase).toBe('debrief');
    expect(text).toContain('0 of 5');
    expect(run(tutor, 'next_step').reason).toBe(SCENARIO_FINISHED);
  });
});

describe('leaving', () => {
  test('mid-step, with no answer, back to the list, score cleared', () => {
    const { tutor, view } = drill('choking_adult');
    run(tutor, 'show_step');
    const out = run(tutor, 'leave_scenario');
    expect(out.applied).toBe(true);
    expect(view().phase).toBe('intro');
    expect(view().score).toEqual({ correct: 0, total: 0 });
    expect(view().catalog).toHaveLength(4);
  });

  test('from the list it says so', () => {
    expect(run(new BlsTutor(), 'leave_scenario').reason).toBe(ALREADY_AT_MENU);
  });
});

describe('the real-emergency watch on answers', () => {
  test('an answer that reads as a real emergency stops the drill before it is graded', () => {
    const { tutor, view } = drill();
    const out = run(tutor, 'check_answer', { answer: 'this is real, he collapsed' });
    expect(out.emergency).toBe(true);
    expect(out.text).toContain(EMERGENCY_LINE);
    expect(view().phase).toBe('emergency');
    expect(view().emergency_message).toBe(EMERGENCY_LINE);
    expect(tutor.snapshot().attempts).toBeUndefined();   // nothing was graded
  });

  test('it is armed with no drill running too', () => {
    const { tutor } = drill(null);
    expect(run(tutor, 'check_answer', { answer: 'my dad collapsed' }).emergency).toBe(true);
    expect(tutor.phase).toBe('emergency');
  });

  test('narrating the drill is practice', () => {
    const { tutor, view } = drill();
    run(tutor, 'check_answer', { answer: "I'd check whether he's breathing" });
    expect(view().phase).not.toBe('emergency');
  });
});

describe('the red card', () => {
  test('stop_for_emergency is never refused and always hands Alex the line', () => {
    for (const scenario of [null, ADULT]) {
      const { tutor } = drill(scenario);
      const out = run(tutor, 'stop_for_emergency');
      expect(out.applied).toBe(true);
      expect(out.text).toContain(EMERGENCY_LINE);
      expect(run(tutor, 'stop_for_emergency').text).toContain(EMERGENCY_LINE);
    }
  });

  test('while it is up, nothing else moves the drill, not even starting a drill', () => {
    const { tutor, view } = drill();
    run(tutor, 'stop_for_emergency');
    for (const [action, args] of [['show_step', {}], ['next_step', {}], ['give_hint', {}], ['leave_scenario', {}], ['start_scenario', { scenario: 'choking' }]] as const) {
      const out = run(tutor, action, args);
      expect(out.applied, action).toBe(false);
      expect(out.reason, action).toBe(IN_EMERGENCY);
      expect(view().phase).toBe('emergency');
    }
  });

  test('resume puts them back where they were', () => {
    const { tutor, view } = drill(CHOKING_ADULT.id);
    run(tutor, 'show_step');
    run(tutor, 'stop_for_emergency');
    const out = run(tutor, 'resume_practice');
    expect(out.applied).toBe(true);
    expect(view().phase).toBe('coaching');
    expect(out.text).toContain('glad everyone is safe');
    expect(out.text).toContain('ready for the next step');
  });

  test('resume mid-question asks that question again; from the list, asks which drill', () => {
    const live = drill();
    run(live.tutor, 'stop_for_emergency');
    expect(run(live.tutor, 'resume_practice').text).toContain(first.prompt);
    const menu = drill(null);
    run(menu.tutor, 'stop_for_emergency');
    expect(run(menu.tutor, 'resume_practice').text).toContain('which drill');
  });

  test('resume with no card up changes nothing', () => {
    const { tutor, view } = drill();
    expect(run(tutor, 'resume_practice').applied).toBe(false);
    expect(view().phase).toBe('answering');
  });
});

test('only the drill\'s actions are actions', () => {
  expect(isAction('check_answer')).toBe(true);
  expect(isAction('defibrillate')).toBe(false);
  expect(isAction(undefined)).toBe(false);
});

test('views are what the page sees: never a label the learner has not resolved', () => {
  const view = viewOf(drill().tutor);
  for (const step of ADULT_CARDIAC_ARREST.steps) expect(JSON.stringify(view)).not.toContain(step.label);
});
