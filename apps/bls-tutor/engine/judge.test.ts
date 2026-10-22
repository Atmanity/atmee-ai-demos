// Which action a line is, with the phrasings people actually use. The original
// left this to its model (which tool to call); here it is rules, so each rule's
// near-misses are pinned too.
import { describe, expect, test } from 'vitest';
import { interpret, isAdvanceRequest, isTalk, scenarioNamedIn, switchRequest, wantsOut } from './judge.ts';
import type { Phase } from './types.ts';

const kind = (text: string, phase: Phase, current: string | null = 'adult_cardiac_arrest') => {
  const intent = interpret(text, phase, current);
  return intent ? (intent.kind === 'start_scenario' ? `start:${intent.id}` : intent.kind) : null;
};

describe('a bare "next" (ported from test_table.py)', () => {
  test('an answer that merely contains next is not an advance', () => {
    expect(isAdvanceRequest('next')).toBe(true);
    expect(isAdvanceRequest('  Next. ')).toBe(true);
    expect(isAdvanceRequest("what's next")).toBe(true);
    expect(isAdvanceRequest('next I would check the airway')).toBe(false);
    expect(isAdvanceRequest('next to the pool')).toBe(false);
    expect(isAdvanceRequest('')).toBe(false);
  });
  test('as a recogniser writes it', () => {
    for (const said of ['Okay, next.', 'Next one, please.', "I'm ready.", "Let's move on.", 'Um, next step.']) expect(isAdvanceRequest(said), said).toBe(true);
  });
});

describe('at the menu', () => {
  test.each([
    ["Let's do choking.", 'start:choking_adult'],
    ['The child one, please.', 'start:child_cardiac_arrest'],
    ['adult choking', 'start:choking_adult'],
    ['Recovery position.', 'start:recovery_position'],
    ["Let's do the one where someone collapsed.", 'start:adult_cardiac_arrest'],
    ['The pool one.', 'start:child_cardiac_arrest'],
    ['The dinner table one', 'start:choking_adult'],
    ['the second one', 'start:child_cardiac_arrest'],
    ['Surprise me.', 'start:adult_cardiac_arrest'],
    ['Can we do the child one?', 'start:child_cardiac_arrest'],
    ['I want to practise CPR', 'start:adult_cardiac_arrest'],
  ])('%s', (said, expected) => {
    expect(kind(said, 'intro', null)).toBe(expected);
  });

  test.each(['Is the child one hard?', 'What scenarios are there?', 'Hello!', 'Yes.', 'next', 'Which one is the easiest?'])('talk, not a choice: %s', (said) => {
    expect(kind(said, 'intro', null)).toBeNull();
  });

  test('asking to leave the menu is the drill\'s to refuse', () => {
    expect(kind('go back', 'intro', null)).toBe('leave_scenario');
  });

  test('after a scenario, the same names start another', () => {
    expect(kind('choking please', 'debrief', 'adult_cardiac_arrest')).toBe('start:choking_adult');
    expect(kind('the adult one again', 'debrief', 'adult_cardiac_arrest')).toBe('start:adult_cardiac_arrest');
    expect(kind('next', 'debrief', 'adult_cardiac_arrest')).toBe('next');   // refused: the scenario is finished
  });
});

describe('while a step is asked', () => {
  test.each([
    ["I'd check the scene is safe", 'answer'],
    ['Check if he is breathing.', 'answer'],
    ['Is it to check the scene is safe?', 'answer'],
    ['What about checking the pulse?', 'answer'],
    ['Call nine one one and get an AED', 'answer'],
    ["let's do the heimlich", 'answer'],              // an answer in the choking drill, not a switch
    ['use the adult one if there are no child pads', 'answer'],
    ['Show me.', 'reveal'],
    ["I don't know.", 'reveal'],
    ["Um, I don't know, can you show me?", 'reveal'],
    ['no idea', 'reveal'],
    ['What do I do?', 'reveal'],
    ['Next.', 'next'],                                 // refused: you do not skip a rung
    ['Can we skip this one?', 'next'],
    ['This is too hard, can I go back?', 'leave_scenario'],
    ['Back to the scenarios.', 'leave_scenario'],
    ['Pick a different one', 'leave_scenario'],
    ['quit', 'leave_scenario'],
    ["Let's do choking instead.", 'start:choking_adult'],
    ['Can we switch to the child scenario?', 'start:child_cardiac_arrest'],
    ["This is too hard, let's do the recovery one", 'start:recovery_position'],
  ])('%s → %s', (said, expected) => {
    expect(kind(said, 'answering')).toBe(expected);
  });

  test.each(['Okay.', 'Hmm, let me think.', 'Can I have a hint?', 'Can you repeat the question?', "What's the compression rate again?", 'Are you a real paramedic?', 'Thanks!'])(
    'talk is not a wrong attempt: %s',
    (said) => {
      expect(kind(said, 'answering')).toBeNull();
      expect(isTalk(said)).toBe(true);
    },
  );

  test('naming the scenario already running is never a switch', () => {
    // "let's do child CPR" is an answer to "call first, or start CPR?"
    expect(kind("let's do child CPR", 'answering', 'child_cardiac_arrest')).toBe('answer');
    expect(switchRequest("let's do the child one", 'child_cardiac_arrest')).toBeNull();
  });

  test('"go back to compressions" is part of an answer, not the way out', () => {
    // The AED step's teaching line ends "go straight back to compressions".
    expect(kind('turn it on, pads on, then go back to compressions', 'answering')).toBe('answer');
    expect(wantsOut('push hard but not too hard')).toBe(false);
    expect(wantsOut("I'd stop when EMS takes over")).toBe(false);
  });
});

describe('between steps', () => {
  test.each([
    ['next', 'next'],
    ['Yes.', 'next'],
    ['Sure, go ahead.', 'next'],
    ['ready', 'next'],
    ['Okay.', null],                                   // an acknowledgement, not a request to move on
    ['next I would check the airway', null],
    ['show me', null],                                 // the step is already shown
    ['That makes sense, thanks', null],
    ['go back', 'leave_scenario'],
  ])('%s → %s', (said, expected) => {
    expect(kind(said, 'coaching')).toBe(expected);
  });
});

describe('on the emergency card', () => {
  test.each([
    ["False alarm, nobody's hurt.", 'ack_safety'],
    ["It's not a real emergency.", 'ack_safety'],
    ['Sorry, I was only asking.', 'ack_safety'],
    ["he's still not breathing", null],
    ['next', null],
    ["let's do choking", null],          // a scenario name does not clear a 911 card
    ['go back', null],                   // nor does the way out of a scenario
  ])('%s → %s', (said, expected) => {
    expect(kind(said, 'emergency')).toBe(expected);
  });
});

describe('scenario names in a line', () => {
  test('condition before audience, titles and ordinals', () => {
    expect(scenarioNamedIn('the adult choking one')).toBe('choking_adult');
    expect(scenarioNamedIn('the one at the bus stop')).toBe('recovery_position');
    expect(scenarioNamedIn('the last one')).toBe('recovery_position');
    expect(scenarioNamedIn('the sandwich one')).toBeNull();
  });
});
