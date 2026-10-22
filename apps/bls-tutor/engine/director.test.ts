// What the avatar is told: within the API's limits, never a step the learner
// has not reached, the live step only in its staged block, and the emergency
// line word for word wherever it is asked for.
import { describe, expect, test } from 'vitest';
import { drillState, NOTES, say } from './director.ts';
import { act, viewOf } from './drill.ts';
import { EMERGENCY_LINE, SAFETY_LINE } from './lines.ts';
import { SCENARIOS } from './scenarios.ts';
import { BlsTutor } from './tutor.ts';
import type { View } from './types.ts';

const STATE_LIMIT = 3858;

/** Every view a learner can reach in a scenario, step by step: asked, missed once, resolved, and the debrief. */
function* walk(id: string): Generator<{ view: View; index: number }> {
  const tutor = new BlsTutor();
  tutor.startScenario(id);
  const steps = SCENARIOS.find((s) => s.id === id)!.steps;
  for (let index = 0; index < steps.length; index++) {
    yield { view: viewOf(tutor), index };
    tutor.answer('', 'something unrelated');
    yield { view: viewOf(tutor), index };
    tutor.answer('', 'still unrelated');
    yield { view: viewOf(tutor), index };
    tutor.reveal();   // the second miss's rescue (drill.ts): the step is shown
    yield { view: viewOf(tutor), index };
    tutor.nextStep();
  }
  yield { view: viewOf(tutor), index: steps.length };
}

describe('limits', () => {
  test('every standing note fits the 2,000-character limit', () => {
    expect(NOTES.length).toBeGreaterThan(0);
    for (const note of NOTES) expect(note.length).toBeLessThanOrEqual(2000);
  });

  test('the state stays under 3,858 characters in every phase of every scenario', () => {
    let longest = 0;
    const menu = viewOf(new BlsTutor());
    longest = Math.max(longest, drillState(menu).length);
    for (const scenario of SCENARIOS) for (const { view } of walk(scenario.id)) longest = Math.max(longest, drillState(view).length);
    const card = new BlsTutor();
    card.emergency();
    longest = Math.max(longest, drillState(viewOf(card)).length);
    expect(longest).toBeLessThan(STATE_LIMIT);
  });
});

describe('never a step the learner has not reached', () => {
  test('in any state, any scenario, any point of it', () => {
    for (const scenario of SCENARIOS) {
      for (const { view, index } of walk(scenario.id)) {
        const state = drillState(view);
        for (const later of scenario.steps.slice(index + 1)) {
          expect(state, `${scenario.id} at ${index}: ${later.key}`).not.toContain(later.label);
          expect(state, `${scenario.id} at ${index}: ${later.key}`).not.toContain(later.teach);
          expect(state).not.toContain(later.hint);
        }
      }
    }
  });

  test('nor in the event texts, which are built from the same view', () => {
    const tutor = new BlsTutor();
    const start = act(tutor, { intent: { kind: 'start_scenario', id: 'adult_cardiac_arrest' }, from: 'button' });
    const later = SCENARIOS[0].steps.slice(1);
    for (const step of later) expect(start.event).not.toContain(step.label);
    const shown = act(tutor, { intent: { kind: 'reveal' }, from: 'button' });
    const next = act(tutor, { intent: { kind: 'next' }, from: 'button' });
    for (const step of later.slice(1)) {
      expect(shown.event).not.toContain(step.label);
      expect(next.event).not.toContain(step.label);
      expect(next.event).not.toContain(step.teach);
    }
  });
});

describe('the live step is staged, and only while it is asked', () => {
  test('its key facts and hint are there, fenced by the rule', () => {
    const tutor = new BlsTutor();
    tutor.startScenario('adult_cardiac_arrest');
    const step = SCENARIOS[0].steps[0];
    const state = drillState(viewOf(tutor));
    expect(state).toContain(step.teach);
    expect(state).toContain(step.hint);
    expect(state).toContain('never to be said, hinted at or used to judge unless they ask');
    expect(state).toContain('You do not grade');
  });

  test('between steps: the next question, not its answer; at the end, the debrief with the real score', () => {
    const tutor = new BlsTutor();
    tutor.startScenario('adult_cardiac_arrest');
    tutor.reveal();
    const coaching = drillState(viewOf(tutor));
    expect(coaching).toContain(SCENARIOS[0].steps[1].prompt);
    expect(coaching).toContain('only when they say next, ready, go on, continue or yes');
    const last = new BlsTutor();
    last.startScenario('recovery_position');
    for (let i = 0; i < 4; i++) { last.reveal(); last.nextStep(); }
    last.answer('', 'stay with him and keep checking his breathing');
    expect(drillState(viewOf(last))).toContain('the scenario is complete, with 1 of 5 right');
  });

  test('the menu stages each scenario\'s scene and first question', () => {
    const state = drillState(viewOf(new BlsTutor()));
    for (const scenario of SCENARIOS) {
      expect(state).toContain(scenario.opening);
      expect(state).toContain(scenario.steps[0].prompt);
      // ...and nothing past the first question.
      for (const step of scenario.steps) expect(state).not.toContain(step.label);
    }
  });
});

describe('the safety lines', () => {
  test('the safety line rides in every state and in the opening, verbatim', () => {
    expect(drillState(viewOf(new BlsTutor()))).toContain(SAFETY_LINE);
    expect(say.opening(null)).toContain(SAFETY_LINE);
  });

  test('the emergency card\'s exact words, in the note, the state and the event', () => {
    const tutor = new BlsTutor();
    tutor.emergency();
    const state = drillState(viewOf(tutor));
    expect(state).toContain(EMERGENCY_LINE);
    expect(state).not.toMatch(/Step \d+ of/);
    expect(NOTES.some((n) => n.includes(EMERGENCY_LINE))).toBe(true);
    expect(say.emergency()).toContain(`word for word, and nothing else: "${EMERGENCY_LINE}"`);
  });
});
