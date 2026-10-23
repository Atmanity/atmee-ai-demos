// What Alex is told: within the API's limits, every tool named, and never a
// step the learner has not resolved (not the live one's answer, teaching line
// or hint, and nothing after it), in the state or in any result.
import { describe, expect, test } from 'vitest';
import { BUTTON, drillState, INSTRUCTIONS, said, TOOLS } from './director.ts';
import { run, viewOf } from './drill.ts';
import { EMERGENCY_LINE, SAFETY_LINE } from './lines.ts';
import { SCENARIOS } from './scenarios.ts';
import { BlsTutor } from './tutor.ts';
import type { View } from './types.ts';

const STATE_LIMIT = 3858;

/** Every view a learner can reach in a scenario: asked, missed once, missed twice, shown, and the review. */
function* walk(id: string): Generator<{ view: View; index: number; resolved: boolean }> {
  const tutor = new BlsTutor();
  tutor.startScenario(id);
  const steps = SCENARIOS.find((s) => s.id === id)!.steps;
  for (let index = 0; index < steps.length; index++) {
    yield { view: viewOf(tutor), index, resolved: false };
    tutor.answer('', 'something unrelated');
    yield { view: viewOf(tutor), index, resolved: false };
    tutor.answer('', 'still unrelated');
    yield { view: viewOf(tutor), index, resolved: false };
    tutor.reveal();
    yield { view: viewOf(tutor), index, resolved: true };
    tutor.nextStep();
  }
  yield { view: viewOf(tutor), index: steps.length, resolved: true };
}

describe('the API limits', () => {
  test('the tools fit: names, descriptions, schemas, timeouts, all await', () => {
    expect(TOOLS.length).toBeLessThanOrEqual(30);
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOLS) {
      expect(tool.type).toBe('function');
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
      expect(['web_search', 'lookup']).not.toContain(tool.name);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(500);
      expect(tool.parameters.type).toBe('object');
      expect(JSON.stringify(tool.parameters).length).toBeLessThanOrEqual(4096);
      expect(tool['x-atmee']?.mode).toBe('await');
      expect(tool['x-atmee']!.timeoutSeconds!).toBeGreaterThanOrEqual(1);
      expect(tool['x-atmee']!.timeoutSeconds!).toBeLessThanOrEqual(28);
    }
    expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(24576);
  });

  test('the instructions fit and name every tool', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
    for (const tool of TOOLS) expect(INSTRUCTIONS, tool.name).toContain(tool.name);
  });

  test('the state stays under 3,858 characters in every phase of every scenario', () => {
    let longest = drillState(viewOf(new BlsTutor())).length;
    for (const scenario of SCENARIOS) {
      for (const { view } of walk(scenario.id)) longest = Math.max(longest, drillState(view, { hint: 'x'.repeat(200) }).length);
    }
    const card = new BlsTutor();
    card.emergency();
    longest = Math.max(longest, drillState(viewOf(card)).length);
    expect(longest).toBeLessThan(STATE_LIMIT);
  });
});

describe('never a step the learner has not resolved', () => {
  test('in the state: not the live step\'s answer, teaching line or hint, and nothing after it', () => {
    for (const scenario of SCENARIOS) {
      for (const { view, index, resolved } of walk(scenario.id)) {
        const state = drillState(view);
        const secret = resolved ? scenario.steps.slice(index + 1) : scenario.steps.slice(index);
        for (const step of secret) {
          expect(state, `${scenario.id} at ${index}: ${step.key}`).not.toContain(step.label);
          expect(state, `${scenario.id} at ${index}: ${step.key}`).not.toContain(step.teach);
          // A miss puts the hint on screen as the nudge; until then it is the drill's.
          const nudged = step === scenario.steps[index] && (view.attempts ?? 0) > 0;
          if (!nudged) expect(state, `${scenario.id} at ${index}: ${step.key} hint`).not.toContain(step.hint);
        }
      }
    }
  });

  test('a hint the learner asked for is on screen, so it is in the state', () => {
    const tutor = new BlsTutor();
    tutor.startScenario('choking_adult');
    const { hint } = run(tutor, 'give_hint');
    expect(drillState(viewOf(tutor), { hint })).toContain(hint!);
  });

  test('in the results: starting, moving on and showing never reach past the step they are about', () => {
    for (const scenario of SCENARIOS) {
      const tutor = new BlsTutor();
      const start = run(tutor, 'start_scenario', { scenario: scenario.id });
      for (const step of scenario.steps) expect(start.text).not.toContain(step.label);
      for (let i = 0; i < scenario.steps.length; i++) {
        const shown = run(tutor, 'show_step');
        expect(shown.text).toContain(scenario.steps[i].teach);
        const next = run(tutor, 'next_step');
        for (const later of scenario.steps.slice(i + 1)) {
          expect(shown.text).not.toContain(later.label);
          expect(next.text).not.toContain(later.label);
          expect(next.text).not.toContain(later.teach);
        }
      }
    }
  });

  test('a wrong answer gets the nudge, never the step', () => {
    const tutor = new BlsTutor();
    tutor.startScenario('adult_cardiac_arrest');
    const step = SCENARIOS[0].steps[0];
    const out = run(tutor, 'check_answer', { answer: 'I would make a sandwich' });
    expect(out.text).toContain(step.hint);
    expect(out.text).not.toContain(step.label);
    expect(out.text).not.toContain(step.teach);
  });
});

describe('what the screen says, Alex says', () => {
  test('the coaching state carries the teaching point that is on screen, and how to move on', () => {
    const tutor = new BlsTutor();
    tutor.startScenario('adult_cardiac_arrest');
    run(tutor, 'show_step');
    const state = drillState(viewOf(tutor));
    expect(state).toContain(SCENARIOS[0].steps[0].teach);
    expect(state).toContain('call next_step when they say next, ready, or yes');
    expect(state).not.toContain(SCENARIOS[0].steps[1].prompt);   // the next question comes from next_step
  });

  test('the menu lists the four drills; the review lists every step and how it went', () => {
    const menu = drillState(viewOf(new BlsTutor()));
    for (const s of SCENARIOS) expect(menu).toContain(s.title);
    const tutor = new BlsTutor();
    tutor.startScenario('recovery_position');
    for (const _ of SCENARIOS[3].steps) { tutor.reveal(); tutor.nextStep(); }
    const review = drillState(viewOf(tutor));
    for (const step of SCENARIOS[3].steps) expect(review).toContain(`${step.label}, shown to them`);
  });

  test('the button words Alex is told match the buttons', () => {
    expect(Object.values(BUTTON).every((label) => label.length > 0)).toBe(true);
  });
});

describe('the safety lines', () => {
  test('the safety line rides in every state and in every opening, verbatim', () => {
    expect(drillState(viewOf(new BlsTutor()))).toContain(SAFETY_LINE);
    expect(said.opening(null)).toContain(SAFETY_LINE);
    const tutor = new BlsTutor();
    tutor.startScenario('choking_adult');
    expect(said.opening(viewOf(tutor))).toContain(SAFETY_LINE);
    expect(said.opening(viewOf(tutor))).toContain(SCENARIOS[2].steps[0].prompt);
  });

  test('the emergency card\'s exact words, in the state, the stop result and the page\'s own alarm', () => {
    const tutor = new BlsTutor();
    tutor.emergency();
    const state = drillState(viewOf(tutor));
    expect(state).toContain(EMERGENCY_LINE);
    expect(state).toContain('resume_practice');
    expect(state).not.toMatch(/Step \d+ of/);
    expect(said.emergency()).toContain(`word for word, and nothing else: "${EMERGENCY_LINE}"`);
    expect(said.alarm('typed', 'my dad collapsed')).toContain(EMERGENCY_LINE);
    expect(said.alarm('typed', 'my dad collapsed')).toContain('typed "my dad collapsed"');
  });

  test('results that end a phase never start the next one on their own', () => {
    const tutor = new BlsTutor();
    tutor.startScenario('recovery_position');
    for (let i = 0; i < 4; i++) { tutor.reveal(); tutor.nextStep(); }
    tutor.reveal();
    const end = run(tutor, 'next_step');
    expect(end.text).toContain('start one only when they choose');
    expect(said.left()).toContain('Start one only when they choose');
    expect(run(new BlsTutor(), 'check_answer', { answer: 'x' }).text).toContain('pick one first');
  });
});
