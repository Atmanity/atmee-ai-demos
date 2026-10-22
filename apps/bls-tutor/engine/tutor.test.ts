// The rules, pure (ported from test_tutor.py). No server, no avatar.
//
// Each test is named after the symptom it prevents. The clinical content is
// checked for shape, not for medicine: what this file guards is that the app
// cannot show a step early, cannot skip one, and cannot let a number reach the
// learner from anywhere but scenarios.ts.
import { describe, expect, test } from 'vitest';
import * as scenarios from './scenarios.ts';
import { EMERGENCY_LINE, SAFETY_LINE, SCENARIOS } from './scenarios.ts';
import { ALREADY_AT_MENU, BETWEEN_STEPS, BlsTutor, grade, SCENARIO_FINISHED, STEP_UNRESOLVED, TutorRefusal, UNKNOWN_SCENARIO, wrongStep } from './tutor.ts';

function started(id = 'adult_cardiac_arrest') {
  const tutor = new BlsTutor();
  tutor.startScenario(id);
  return tutor;
}

/** Get past the current step however possible, without asserting on it. */
const resolveCurrent = (tutor: BlsTutor) => tutor.reveal();

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof TutorRefusal) return err.reason;
    throw err;
  }
  throw new Error('expected a refusal');
}

const find = (id: string) => scenarios.find(id)!;

// ------------------------------------------------------------------ content

describe('content', () => {
  test('every scenario has teachable steps', () => {
    // A scenario with an empty step list is a drill that ends at "ready?".
    expect(SCENARIOS).toHaveLength(4);
    for (const scenario of SCENARIOS) {
      expect(scenario.steps.length, scenario.id).toBeGreaterThan(0);
      for (const step of scenario.steps) {
        expect(step.label && step.prompt && step.teach && step.hint, `${scenario.id}/${step.key}`).toBeTruthy();
        expect(step.expected.length, `${scenario.id}/${step.key} cannot be answered`).toBeGreaterThan(0);
        if (step.forbidden.length) expect(step.forbiddenNote, `${scenario.id}/${step.key}`).toBeTruthy();
      }
    }
  });

  test('step keys are unique within a scenario', () => {
    // Duplicate keys make `answer` ambiguous about which rung it graded.
    for (const scenario of SCENARIOS) {
      const keys = scenario.steps.map((s) => s.key);
      expect(new Set(keys).size, scenario.id).toBe(keys.length);
    }
  });

  test('spoken scenario names resolve', () => {
    // "let's do choking" must not read as an unknown scenario.
    expect(find('choking').id).toBe('choking_adult');
    expect(find('child').id).toBe('child_cardiac_arrest');
    expect(find('recovery position').id).toBe('recovery_position');
    expect(find('adult').id).toBe('adult_cardiac_arrest');
    expect(scenarios.find('underwater welding')).toBeNull();
  });
});

// ------------------------------------------------------------------ grading

describe('grading', () => {
  test('accepts the idea, not the wording', () => {
    const step = scenarios.ADULT_CARDIAC_ARREST.steps[0];
    expect(grade(step, "I'd make sure the scene is safe first").ok).toBe(true);
    expect(grade(step, 'check for danger').ok).toBe(true);
    expect(grade(step, 'start pumping his chest').ok).toBe(false);
  });

  test('catches the wrong order with its own note', () => {
    // Compressions before calling for help is a specific error, and the learner
    // must hear why rather than "not recognised".
    const callStep = scenarios.ADULT_CARDIAC_ARREST.steps.find((s) => s.key === 'call_911')!;
    const verdict = grade(callStep, "I'd start chest compressions");
    expect(verdict.ok).toBe(false);
    expect(verdict.note).toBe('Call for help before compressions.');
  });

  test('an empty answer is a hint, not a crash', () => {
    const step = scenarios.ADULT_CARDIAC_ARREST.steps[0];
    expect(grade(step, '').note).toBe(step.hint);
  });
});

// ------------------------------------------------------------- progression

describe('progression', () => {
  test('a correct answer scores and holds the step until next', () => {
    const tutor = started();
    expect(tutor.answer('scene_safe', 'check the scene is safe').ok).toBe(true);
    expect(tutor.phase).toBe('coaching');
    const snapshot = tutor.snapshot();
    expect(snapshot.score).toEqual({ correct: 1, total: 1 });
    expect(snapshot.steps![0].status).toBe('done');
    expect(snapshot.steps![1].status).toBe('hidden');
  });

  test('next opens the following step and counts it', () => {
    const tutor = started();
    tutor.answer('scene_safe', 'is the scene safe');
    tutor.nextStep();
    const snapshot = tutor.snapshot();
    expect(snapshot.phase).toBe('answering');
    expect(snapshot.step_index).toBe(1);
    expect(snapshot.score).toEqual({ correct: 1, total: 2 });
    expect(snapshot.steps![1].status).toBe('current');
  });

  test('a wrong answer keeps the step open and counts the attempt', () => {
    const tutor = started();
    tutor.answer('scene_safe', 'I shout for a doctor');
    expect(tutor.phase).toBe('answering');
    expect(tutor.snapshot().attempts).toBe(1);
    expect(tutor.snapshot().last_verdict!.ok).toBe(false);
    expect(tutor.snapshot().score).toEqual({ correct: 0, total: 1 });
  });

  test('reveal resolves the step without scoring it', () => {
    const tutor = started();
    const verdict = tutor.reveal();
    expect(verdict.revealed).toBe(true);
    expect(verdict.note).toBe(scenarios.ADULT_CARDIAC_ARREST.steps[0].teach);
    expect(tutor.phase).toBe('coaching');
    expect(tutor.snapshot().score).toEqual({ correct: 0, total: 1 });
  });

  test('finishing the last step lands in debrief with the menu back', () => {
    const tutor = started('recovery_position');
    for (const _ of scenarios.RECOVERY_POSITION.steps) {
      resolveCurrent(tutor);
      tutor.nextStep();
    }
    const snapshot = tutor.snapshot();
    expect(snapshot.phase).toBe('debrief');
    expect(snapshot.catalog!.map((c) => c.id)).toEqual(SCENARIOS.map((s) => s.id));
  });
});

// --------------------------------------------------------------- refusals

describe('refusals', () => {
  test('answering between steps is refused by its sentence', () => {
    const tutor = started();
    tutor.reveal();   // -> coaching
    expect(refusal(() => tutor.answer('scene_safe', 'check the scene'))).toBe(BETWEEN_STEPS);
  });

  test('answering a step we are not on points back without naming the answer', () => {
    const tutor = started();
    const reason = refusal(() => tutor.answer('compressions', 'push on the chest'));
    expect(reason).toBe(wrongStep(1));
    // A refusal is not a hint: the live rung's words are the answer to the
    // question on screen, so they must not arrive by this door either.
    expect(reason.toLowerCase()).not.toContain('scene');
  });

  test('the live rung does not print its own answer', () => {
    // The drill asks "what do you do first?": a ladder that answers it beside
    // the question is reading practice, not recall practice.
    const rungs = started().snapshot().steps!;
    const live = rungs.filter((r) => r.status === 'current');
    expect(live).toHaveLength(1);
    expect(live[0].label).toBe('');
    expect(live[0].key).toBeTruthy();   // the key stays: the panel needs a stable identity
    expect(rungs.filter((r) => r.status === 'hidden').every((r) => r.label === '')).toBe(true);
  });

  test('a rung earns its words by being answered', () => {
    const tutor = started();
    const key = tutor.snapshot().steps![0].key;
    tutor.answer(key, 'check the scene is safe');
    const first = tutor.snapshot().steps![0];
    expect(first.status === 'done' && first.label).toBeTruthy();
  });

  test('a rung earns its words by being revealed', () => {
    const tutor = started();
    tutor.reveal();
    const first = tutor.snapshot().steps![0];
    expect(first.status === 'done' && first.label).toBeTruthy();
  });

  test('reveal after the scenario ends offers a new one', () => {
    const tutor = started('recovery_position');
    for (const _ of scenarios.RECOVERY_POSITION.steps) {
      resolveCurrent(tutor);
      tutor.nextStep();
    }
    expect(refusal(() => tutor.reveal())).toBe(SCENARIO_FINISHED);
  });

  test('next before answering refuses rather than skipping a step', () => {
    // Skipping is the failure that matters: a learner who never answered "call
    // 911" must not be walked past it.
    const tutor = started();
    expect(refusal(() => tutor.nextStep())).toBe(STEP_UNRESOLVED);
    expect(tutor.snapshot().step_index).toBe(0);
  });

  test('an unknown scenario says what is taught', () => {
    expect(refusal(() => new BlsTutor().startScenario('motorcycle_crash'))).toBe(UNKNOWN_SCENARIO);
  });

  test('reveal is refused once the step is resolved', () => {
    // This is what makes the two-strikes rescue single-shot: it does not need
    // to remember that it already rescued this step.
    const tutor = started();
    tutor.reveal();
    expect(() => tutor.reveal()).toThrow(TutorRefusal);
  });
});

// -------------------------------------------------------------- emergency

describe('emergency', () => {
  test('emergency replaces the drill and carries the exact line', () => {
    const tutor = started();
    tutor.emergency();
    const snapshot = tutor.snapshot();
    expect(snapshot.phase).toBe('emergency');
    expect(snapshot.emergency_message).toBe(EMERGENCY_LINE);
    expect('steps' in snapshot).toBe(false);
    expect('prompt' in snapshot).toBe(false);
  });

  test('the tutor stays out of protocol during an emergency', () => {
    const tutor = started();
    tutor.emergency();
    for (const call of [() => tutor.answer('scene_safe', 'check the scene'), () => tutor.reveal(), () => tutor.nextStep()]) {
      expect(refusal(call)).toContain('call 911 now');
    }
  });

  test('saying you are practising again reopens the drill', () => {
    const tutor = started();
    tutor.emergency();
    tutor.ackSafety();
    expect(tutor.phase).toBe('answering');
    expect(tutor.answer('scene_safe', 'check the scene is safe').ok).toBe(true);
  });

  test('a new scenario also leaves the emergency card', () => {
    const tutor = started();
    tutor.emergency();
    tutor.startScenario('choking_adult');
    expect(tutor.phase).toBe('answering');
  });

  test('resuming returns to the phase it left', () => {
    // ack_safety always restored `answering`, so a step already resolved came
    // back unanswered: `next` then refused a finished rung.
    const tutor = started();
    tutor.answer('scene_safe', 'check the scene is safe');
    expect(tutor.phase).toBe('coaching');
    tutor.emergency();
    tutor.emergency();   // the watch can fire twice on one turn
    tutor.ackSafety();
    expect(tutor.phase).toBe('coaching');
  });

  test('resuming before a scenario started goes back to the menu', () => {
    const tutor = new BlsTutor();
    tutor.emergency();
    tutor.ackSafety();
    expect(tutor.phase).toBe('intro');
  });
});

// --------------------------------------------------------------- snapshot

describe('snapshot', () => {
  test('unreached step labels are stripped from the snapshot', () => {
    // The label IS the answer. A panel or an avatar state carrying "Start chest
    // compressions" has answered the question the learner is being asked.
    const snapshot = started().snapshot();
    const hidden = snapshot.steps!.filter((r) => r.status === 'hidden');
    expect(hidden.length, 'nothing was hidden: the ladder leaked').toBeGreaterThan(0);
    expect(hidden.every((r) => r.label === '')).toBe(true);
    const blob = JSON.stringify(snapshot);
    for (const step of scenarios.ADULT_CARDIAC_ARREST.steps.slice(1)) {
      expect(blob).not.toContain(step.label);
      expect(blob).not.toContain(step.teach);
    }
  });

  test('the snapshot carries the safety line in every phase', () => {
    const tutor = new BlsTutor();
    expect(tutor.snapshot().safety_notice).toBe(SAFETY_LINE);
    tutor.startScenario();
    expect(tutor.snapshot().safety_notice).toBe(SAFETY_LINE);
    tutor.emergency();
    expect(tutor.snapshot().safety_notice).toBe(SAFETY_LINE);
  });

  test('the snapshot stays within its size budget', () => {
    // The original budgeted 1.5 KiB under the platform's 32 KiB envelope; here
    // it keeps every poll of the drill small.
    const tutor = started();
    tutor.answer('scene_safe', 'check the scene is safe');
    tutor.nextStep();
    expect(new TextEncoder().encode(JSON.stringify(tutor.snapshot())).length).toBeLessThan(1536);
  });

  test('the worst snapshot this app can build stays small', () => {
    // The longest scenario's debrief, where every label has been earned and
    // the catalog is carried too.
    const tutor = started('child_cardiac_arrest');
    for (const _ of scenarios.CHILD_CARDIAC_ARREST.steps) {
      resolveCurrent(tutor);
      tutor.nextStep();
    }
    expect(tutor.phase).toBe('debrief');
    expect(new TextEncoder().encode(JSON.stringify(tutor.snapshot())).length).toBeLessThan(32 * 1024);
  });

  test('the metronome rate only appears where a rate is taught', () => {
    const tutor = started();
    expect(tutor.snapshot().metronome_bpm).toBeNull();
    while (tutor.snapshot().prompt != null && tutor.snapshot().steps![tutor.snapshot().step_index!].key !== 'compressions') {
      resolveCurrent(tutor);
      tutor.nextStep();
    }
    expect(tutor.snapshot().metronome_bpm).toBe(110);
  });
});

// ---------------------------------------------------------------- the review
//
// The symptom these pin: you finish a drill, the screen says "3 of 5", and
// there is no way to find out WHICH two you missed. Each resolved rung carries
// how it got resolved.

describe('the review', () => {
  test('a step you got and a step you were shown are told apart', () => {
    const tutor = started();
    const first = tutor.currentStep()!;
    tutor.answer(first.key, 'make sure the scene is safe');
    tutor.nextStep();
    const second = tutor.currentStep()!;
    tutor.reveal();
    const outcomes = Object.fromEntries(tutor.snapshot().steps!.map((r) => [r.key, r.outcome]));
    expect(outcomes[first.key]).toBe('correct');
    expect(outcomes[second.key]).toBe('shown');
  });

  test('the debrief can still name every step you missed', () => {
    // By the debrief every rung is resolved, so the review has real labels to
    // print, and the ones that were handed over are still marked as handed.
    const tutor = started();
    const missed: string[] = [];
    while (tutor.phase !== 'debrief') {
      const step = tutor.currentStep();
      if (!step) break;
      if (missed.length < 2) {
        missed.push(step.key);
        tutor.reveal();
      } else {
        tutor.answer(step.key, step.expected[0]);
      }
      tutor.nextStep();
    }
    const steps = tutor.snapshot().steps!;
    expect(steps.filter((r) => r.outcome === 'shown').map((r) => r.key)).toEqual(missed);
    expect(steps.every((r) => r.label), 'the review has nothing to read').toBe(true);
  });

  test('an unresolved rung carries no outcome', () => {
    // The outcome must never become a second channel for the answer.
    for (const rung of started().snapshot().steps!) if (rung.status !== 'done') expect(rung.outcome ?? null).toBeNull();
  });

  test('a wrong answer alone does not mark the step as shown', () => {
    // It is still open; a rung they later get right must not be recorded as one they were handed.
    const tutor = started();
    const step = tutor.currentStep()!;
    tutor.answer(step.key, 'nothing at all');
    expect(tutor.snapshot().steps!.every((r) => (r.outcome ?? null) === null)).toBe(true);
    tutor.answer(step.key, 'check the scene is safe');
    expect(tutor.snapshot().steps!.find((r) => r.key === step.key)!.outcome).toBe('correct');
  });

  test('a new scenario starts the review empty', () => {
    const tutor = started();
    tutor.reveal();
    tutor.startScenario('choking_adult');
    expect(tutor.snapshot().steps!.every((r) => (r.outcome ?? null) === null)).toBe(true);
  });
});

// ---- leaving a scenario ----------------------------------------------------

describe('leaving a scenario', () => {
  test('a scenario can be left mid-step without answering it', () => {
    const tutor = started('choking_adult');
    expect(tutor.phase).toBe('answering');
    tutor.leaveScenario();
    expect(tutor.phase).toBe('intro');
    expect(tutor.scenario).toBeNull();
    expect(tutor.snapshot().catalog!.length).toBeGreaterThan(0);
  });

  test('leaving from the menu says so instead of doing nothing', () => {
    expect(refusal(() => new BlsTutor().leaveScenario())).toBe(ALREADY_AT_MENU);
  });

  test('leaving is refused on the emergency card', () => {
    const tutor = started();
    tutor.emergency();
    expect(() => tutor.leaveScenario()).toThrow(TutorRefusal);
    expect(tutor.phase).toBe('emergency');
  });
});

// ---- naming a scenario out loud -------------------------------------------

describe('naming a scenario out loud', () => {
  // The persona and the tool docs both promised these phrasings work. Looking
  // the whole normalised string up was an exact match in disguise: "the child
  // one" became "the_child_one" and missed.
  test.each([
    ['child', 'child_cardiac_arrest'],
    ['the child one', 'child_cardiac_arrest'],
    ['adult arrest', 'adult_cardiac_arrest'],
    ['let us do choking', 'choking_adult'],
    ['recovery position', 'recovery_position'],
    ['adult_cardiac_arrest', 'adult_cardiac_arrest'],
    // A left-to-right scan made "adult choking" start cardiac arrest: condition first.
    ['adult choking', 'choking_adult'],
  ])('%s', (spoken, expected) => {
    expect(scenarios.find(spoken)?.id).toBe(expected);
  });

  test('a phrase naming no scenario is still nothing', () => {
    expect(scenarios.find('the sandwich one')).toBeNull();
    expect(scenarios.find('')).toBeNull();
  });
});

// ---- the drill must not teach the wrong thing ------------------------------

describe('the drill must not teach the wrong thing', () => {
  test('calling first is wrong for a child you are alone with', () => {
    // The step asks "Call first, or start CPR?" and `expected` carried a bare
    // "first", so "call first" substring-matched and was graded CORRECT: the
    // exact inverse of what the step teaches.
    const step = scenarios.CHILD_CARDIAC_ARREST.steps.find((s) => s.key === 'cpr_first')!;
    for (const answer of ['call first', 'I would call 911 first', 'phone first', 'call before starting']) {
      const verdict = grade(step, answer);
      expect(verdict.ok, answer).toBe(false);
      expect(verdict.note.includes('2 minutes') || verdict.note.includes('two minutes'), answer).toBe(true);
    }
    for (const answer of ['start CPR', 'give two minutes of CPR', 'CPR for 2 minutes then call']) expect(grade(step, answer).ok, answer).toBe(true);
  });

  test('no step grades its own forbidden answer as correct', () => {
    // A LOOSE expected token that happens to match a forbidden phrase is the
    // trap; forbidden is checked first, and this keeps it so.
    for (const scenario of SCENARIOS) {
      for (const step of scenario.steps) {
        for (const phrase of step.forbidden) expect(grade(step, phrase).ok, `${scenario.id}/${step.key}: ${phrase}`).toBe(false);
      }
    }
  });
});

// ---- staged facts (new in the port) ---------------------------------------

describe('what is staged for the avatar', () => {
  test('only the live step, and only while it is being asked', () => {
    const tutor = started();
    const step = tutor.currentStep()!;
    expect(tutor.staged()).toEqual({ step: { label: step.label, teach: step.teach, hint: step.hint } });
    tutor.reveal();
    // Between steps: where "next" leads (the next question), not the next answer.
    const next = scenarios.ADULT_CARDIAC_ARREST.steps[1];
    expect(tutor.staged()).toEqual({ next: { step: 2, prompt: next.prompt } });
    expect(JSON.stringify(tutor.staged())).not.toContain(next.label);
    expect(JSON.stringify(tutor.staged())).not.toContain(next.teach);
  });

  test('the last step leads to the debrief, and the menu stages every scenario', () => {
    const tutor = started('recovery_position');
    const steps = scenarios.RECOVERY_POSITION.steps;
    for (let i = 0; i < steps.length - 1; i++) {
      tutor.reveal();
      tutor.nextStep();
    }
    tutor.reveal();
    expect(tutor.staged()).toEqual({ next: 'debrief' });
    tutor.nextStep();
    expect(tutor.staged()!.scenarios!.map((s) => s.firstPrompt)).toEqual(SCENARIOS.map((s) => s.steps[0].prompt));
  });

  test('nothing is staged on the emergency card', () => {
    const tutor = started();
    tutor.emergency();
    expect(tutor.staged()).toBeNull();
  });
});
