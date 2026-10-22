// The wired drill: inputs in, one outcome out. The cases from test_table.py,
// re-expressed against act(): the failures that were silent on the old
// platform (an answer applied but never spoken, a refusal that reaches nobody,
// a rescue that never fires or fires twice, the 911 line said twice) and the
// ones that are new here (an event for something the avatar already said).
import { describe, expect, test } from 'vitest';
import { act, viewOf } from './drill.ts';
import { EMERGENCY_LINE } from './lines.ts';
import { ADULT_CARDIAC_ARREST, RECOVERY_POSITION } from './scenarios.ts';
import { BETWEEN_STEPS, BlsTutor, STEP_UNRESOLVED, UNKNOWN_SCENARIO } from './tutor.ts';
import type { Intent, Source } from './types.ts';

const ADULT = ADULT_CARDIAC_ARREST.id;
const first = ADULT_CARDIAC_ARREST.steps[0];

function drill(scenario: string | null = ADULT) {
  const tutor = new BlsTutor();
  if (scenario) tutor.startScenario(scenario);
  return {
    tutor,
    press: (intent: Intent) => act(tutor, { intent, from: 'button' }),
    say: (text: string) => act(tutor, { text, from: 'spoken' }),
    type: (text: string) => act(tutor, { text, from: 'typed' }),
    line: (text: string, from: Source) => act(tutor, { text, from }),
  };
}

describe('intents', () => {
  test('an accepted intent changes the drill and says so once', () => {
    const d = drill(null);
    const out = d.press({ kind: 'start_scenario', id: ADULT });
    expect(out.applied).toBe(true);
    expect(out.view.phase).toBe('answering');
    expect(out.event).toContain(first.prompt);
    const answered = d.press({ kind: 'answer', step_key: 'scene_safe', text: 'is it safe' });
    expect(answered.view.score).toEqual({ correct: 1, total: 1 });
  });

  test('a refusal comes back as a sentence and changes nothing', () => {
    const d = drill();
    const out = d.press({ kind: 'next' });
    expect(out.applied).toBe(false);
    expect(out.reason).toBe(STEP_UNRESOLVED);
    expect(out.view.step_index).toBe(0);
    // A button's refusal is the panel's to show, as in the original.
    expect(out.event).toBeUndefined();
  });

  test('an unknown intent kind is refused by name', () => {
    const out = drill().press({ kind: 'defibrillate' } as unknown as Intent);
    expect(out.applied).toBe(false);
    expect(out.reason).toContain('defibrillate');
  });

  test('the scenario button refuses one it does not teach', () => {
    expect(drill(null).press({ kind: 'start_scenario', id: 'motorcycle_crash' }).reason).toBe(UNKNOWN_SCENARIO);
  });
});

describe('the verdict and the rescue (the old coach)', () => {
  test('one wrong attempt is nudged, not answered', () => {
    const out = drill().press({ kind: 'answer', text: 'no idea' });
    expect(out.view.phase).toBe('answering');
    expect(out.event).toContain(first.hint);
    expect(out.event).not.toContain(first.teach);
  });

  test('two wrong attempts are rescued: exactly one event, quoting the bundled teaching line', () => {
    const d = drill();
    d.press({ kind: 'answer', text: 'no idea' });
    const out = d.press({ kind: 'answer', text: 'still no idea' });
    expect(out.kind).toBe('rescue');
    expect(out.view.phase).toBe('coaching');
    expect(out.view.last_verdict).toMatchObject({ revealed: true, note: first.teach });
    expect(out.event).toContain(first.teach);
    expect(out.event).not.toContain(first.hint);   // not the nudge as well
  });

  test('two spoken misses still open the step', () => {
    // The claim that stopped the avatar repeating a nudge also silenced the
    // coach, so a learner answering OUT LOUD was nudged forever and never taught.
    const d = drill();
    expect(d.say('I shout for a doctor').event).toContain(first.hint);
    const out = d.say('I check his pockets');
    expect(out.view.phase).toBe('coaching');
    expect(out.event).toContain(first.teach);
  });

  test('a right answer is confirmed with every number as written', () => {
    const d = drill();
    for (let i = 0; i < 3; i++) { d.press({ kind: 'reveal' }); d.press({ kind: 'next' }); }
    const out = d.say('heel of my hand in the centre of the chest, push hard and fast');
    expect(out.event).toContain('100 to 120 a minute');
    expect(out.event).toContain('WITHOUT changing any number');
  });

  test('the shown step never invents a number', () => {
    const out = drill().press({ kind: 'reveal' });
    expect(out.event).toContain(first.teach);
    expect(out.event).toContain('exactly as written');
  });
});

describe('advancing on "next"', () => {
  test('a bare next moves the drill, and the advance itself adds no second voice', () => {
    // Spoken: the avatar asked the next question from the staged state already.
    const d = drill();
    d.press({ kind: 'reveal' });
    const out = d.say('next');
    expect(out.view.phase).toBe('answering');
    expect(out.view.step_index).toBe(1);
    expect(out.view.prompt).toBeTruthy();
    expect(out.event).toBeUndefined();
    expect(out.staged).toBe(true);
  });

  test('pressed or typed, it is said: the avatar cannot see a button', () => {
    const d = drill();
    d.press({ kind: 'reveal' });
    expect(d.press({ kind: 'next' }).event).toContain(ADULT_CARDIAC_ARREST.steps[1].prompt);
    d.press({ kind: 'reveal' });
    expect(d.type('next').event).toContain(ADULT_CARDIAC_ARREST.steps[2].prompt);
  });

  test('it does not skip an unanswered rung', () => {
    const d = drill();
    const out = d.say('next');
    expect(out.view.step_index).toBe(0);
    expect(out.reason).toBe(STEP_UNRESOLVED);
    // The answering state told the avatar to say so; a typed next is answered by event.
    expect(out.event).toBeUndefined();
    expect(d.type('next').event).toContain(STEP_UNRESOLVED);
  });

  test('an answer that merely contains next is graded, not an advance', () => {
    const d = drill();
    d.press({ kind: 'reveal' });
    const out = d.say('next I would check the airway');
    expect(out.view.step_index).toBe(0);
    expect(out.handled).toBe(false);   // between steps it is talk
  });

  test('finishing the scenario on a bare next still debriefs with the real score', () => {
    const d = drill(RECOVERY_POSITION.id);
    let out = d.press({ kind: 'reveal' });
    for (let i = 0; i < RECOVERY_POSITION.steps.length; i++) {
      if (i) d.press({ kind: 'reveal' });
      out = d.press({ kind: 'next' });
    }
    expect(out.view.phase).toBe('debrief');
    expect(out.event).toContain('0 out of 5');
    expect(out.event).not.toContain('""');
  });
});

describe('the real-emergency watch', () => {
  test('a turn that reads as a real emergency stops the drill, typed or spoken', () => {
    for (const from of ['spoken', 'typed'] as const) {
      const d = drill();
      const out = d.line("wait, he's not breathing", from);
      expect(out.kind).toBe('emergency');
      expect(out.view.phase).toBe('emergency');
      expect(out.view.emergency_message).toBe(EMERGENCY_LINE);
      expect(out.event).toContain(EMERGENCY_LINE);
      expect(out.ttl).toBe(60);
    }
  });

  test('the panel answer box crosses the watch too, before the grader', () => {
    const d = drill();
    const out = d.press({ kind: 'answer', step_key: 'scene_safe', text: 'this is real, he collapsed' });
    expect(out.view.phase).toBe('emergency');
    expect(d.tutor.snapshot().attempts).toBeUndefined();   // nothing was graded
  });

  test('practice speech leaves the drill alone', () => {
    const out = drill().say("I'd check whether he's breathing");
    expect(out.view.phase).not.toBe('emergency');
    expect(out.event ?? '').not.toContain(EMERGENCY_LINE);
  });

  test('the emergency line is said once, not on every following turn', () => {
    const d = drill();
    expect(d.say("he's not breathing").event).toContain(EMERGENCY_LINE);
    const again = d.say("he's not breathing, what do I do");
    expect(again.event).toBeUndefined();
    expect(again.view.phase).toBe('emergency');
    // A typed line on the card goes to the avatar as it is (it holds the emergency rules).
    expect(d.type('he is still not breathing').handled).toBe(false);
  });

  test('it is armed at the menu too', () => {
    expect(drill(null).say('my dad collapsed').view.phase).toBe('emergency');
  });

  test('choosing a scenario out loud does not trip the 911 card', () => {
    const out = drill(null).say("let's do the one where someone collapsed");
    expect(out.view.phase).toBe('answering');
    expect(out.view.scenario?.id).toBe(ADULT);
  });

  test('nothing but a plain resume clears the card; the rest is refused or ignored', () => {
    const d = drill();
    d.say("he's not breathing");
    for (const intent of [{ kind: 'reveal' }, { kind: 'next' }, { kind: 'leave_scenario' }, { kind: 'answer', text: 'start compressions' }] as Intent[]) {
      const out = d.press(intent);
      expect(out.applied, intent.kind).toBe(false);
      expect(out.view.phase).toBe('emergency');
    }
    for (const said of ['next', 'go back', "let's do choking", 'show me']) expect(d.say(said).view.phase, said).toBe('emergency');
  });
});

describe('the way off the emergency card', () => {
  // Seen live in the original: the learner said "false alarm, nobody is in
  // danger, can we start over?", the instructor said "glad everyone is okay,
  // let's start over", and the red card stayed, because only a button cleared it.
  test('said plainly, it clears the card and puts them back where they were', () => {
    const d = drill('choking_adult');
    d.say("he's not breathing");
    const out = d.say("False alarm, nobody's hurt.");
    expect(out.kind).toBe('resume');
    expect(out.view.phase).toBe('answering');
    expect(out.view.scenario?.id).toBe('choking_adult');
    // Never left to the avatar's own reply: it must not talk anyone off the card.
    expect(out.event).toContain("glad everyone is safe");
    expect(out.event).toContain(out.view.prompt!);
  });

  test('between steps it comes back between steps', () => {
    const d = drill();
    d.press({ kind: 'reveal' });
    d.say('this is happening right now');
    const out = d.press({ kind: 'ack_safety' });
    expect(out.view.phase).toBe('coaching');
    expect(out.event).toContain('say next');
  });

  test('before any scenario it lands back on the menu', () => {
    const d = drill(null);
    d.say("she's not breathing");
    const out = d.say("it's not a real emergency");
    expect(out.view.phase).toBe('intro');
    expect(out.event).toMatch(/which scenario/);
  });

  test('"nobody\'s hurt, let\'s do choking" goes straight into it', () => {
    const d = drill();
    d.say("he's not breathing");
    const out = d.say("false alarm, nobody's hurt, let's do choking instead");
    expect(out.view.phase).toBe('answering');
    expect(out.view.scenario?.id).toBe('choking_adult');
    expect(out.event).toContain('Choking at a dinner table');
  });

  test('"…new scenario please" goes to the menu, and the rest of the line is never graded', () => {
    const d = drill();
    d.say("he's not breathing");
    const out = d.say('not a real emergency, new scenario please');
    expect(out.view.phase).toBe('intro');
    expect(out.view.score).toEqual({ correct: 0, total: 0 });
  });
});

describe('the way out of a scenario', () => {
  // Seen live in the original: "actually this one is too hard, can I go back and
  // pick a different scenario?" was answered "You haven't answered this step yet".
  test('asking to leave is not answered with "answer this step"', () => {
    const d = drill('choking_adult');
    const out = d.say('This one is too hard, can I go back and pick a different scenario?');
    expect(out.kind).toBe('leave');
    expect(out.view.phase).toBe('intro');
    expect(out.view.catalog?.length).toBe(4);
    expect(out.applied).toBe(true);
  });

  test('leaving clears the score it belonged to', () => {
    const d = drill('choking_adult');
    d.press({ kind: 'reveal' });
    expect(d.press({ kind: 'leave_scenario' }).view.score).toEqual({ correct: 0, total: 0 });
  });

  test('a typed refusal is said; a spoken one was already answered from the state', () => {
    expect(drill(null).type('go back').event).toContain("You're already at the scenario menu");
    expect(drill(null).say('go back').event).toBeUndefined();
  });
});

describe('what the avatar already said from the staged state gets no event', () => {
  test('spoken "show me" (the teaching line was staged)', () => {
    const out = drill().say('Show me.');
    expect(out.kind).toBe('reveal');
    expect(out.view.phase).toBe('coaching');
    expect(out.event).toBeUndefined();
  });

  test('a scenario chosen out loud at the menu (its scene and first question were staged)', () => {
    expect(drill(null).say("Let's do choking.").event).toBeUndefined();
    // ...but not mid-scenario, where the other scenarios' openings are not staged.
    expect(drill().say("let's do choking instead").event).toContain('Choking at a dinner table');
  });

  test('talk is not an action: typed talk goes to the avatar as a typed turn', () => {
    const out = drill().type('Can I have a hint?');
    expect(out.handled).toBe(false);
    expect(out.view.attempts).toBe(0);
  });

  test('the answers are never staged: the verdict always follows', () => {
    expect(drill().say('check the scene is safe').event).toContain('RIGHT');
  });
});

describe('a typed answer between steps is the drill\'s refusal, not a grade', () => {
  test('pressed from the panel box', () => {
    const d = drill();
    d.press({ kind: 'reveal' });
    const out = d.press({ kind: 'answer', text: 'check the scene' });
    expect(out.reason).toBe(BETWEEN_STEPS);
  });

  test('views are what the page sees: never a hidden label', () => {
    const view = viewOf(drill().tutor);
    for (const step of ADULT_CARDIAC_ARREST.steps.slice(1)) expect(JSON.stringify(view)).not.toContain(step.label);
  });
});
