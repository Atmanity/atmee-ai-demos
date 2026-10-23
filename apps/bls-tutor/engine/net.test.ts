// The safety net's phrases: what the page does when the learner clearly asks
// for something safe to do twice and Alex does not call it, and only that.
// Plus the page's copies of the content, kept in step with scenarios.ts.
import { describe, expect, test } from 'vitest';
import { DRILLS, PREVIEW } from '../page/drills.ts';
import { clearedBy, isAdvanceRequest, MENU_ORDER, mustDo, namesScenario, switchRequest, wantsOut, wantsShown } from './net.ts';
import { catalog, SCENARIOS } from './scenarios.ts';
import type { Phase } from './types.ts';

const did = (text: string, phase: Phase, current: string | null = 'adult_cardiac_arrest') => {
  const call = mustDo(text, phase, current);
  return call ? (call.name === 'start_scenario' ? `start:${call.arguments.scenario}` : call.name) : null;
};

describe('while a step is asked', () => {
  test.each([
    ['Show me.', 'show_step'],
    ["I don't know.", 'show_step'],
    ["Um, I don't know, can you show me?", 'show_step'],
    ['No idea.', 'show_step'],
    ['I give up', 'show_step'],
    ['This is too hard, can I go back?', 'leave_scenario'],
    ['Back to the scenarios.', 'leave_scenario'],
    ['Can I pick a different one?', 'leave_scenario'],
    ['quit', 'leave_scenario'],
    ["Let's do choking instead.", "start:Let's do choking instead."],
    ['Can we switch to the child scenario?', 'start:Can we switch to the child scenario?'],
  ])('%s → %s', (said, expected) => {
    expect(did(said, 'answering')).toBe(expected);
  });

  test.each([
    "I'd check the scene is safe",           // an answer: Alex grades it, the net never does
    'Check if he is breathing.',
    'Call nine one one and get an AED',
    "let's do the heimlich",                   // an answer in the choking drill, not a switch
    'use the adult one if there are no child pads',
    'Can I have a hint?',                      // a hint is Alex's to give
    'What do I do?',                           // may be a hint request: left to Alex
    'Next.',                                   // the step is unanswered: nothing to move to
    'Okay.',
    'turn it on, pads on, then go back to compressions',
  ])('left to Alex: %s', (said) => {
    expect(did(said, 'answering')).toBeNull();
  });

  test('naming the drill already running is never a switch', () => {
    expect(did("let's do child CPR", 'answering', 'child_cardiac_arrest')).toBeNull();
    expect(switchRequest("let's do the child one", 'child_cardiac_arrest')).toBeNull();
  });
});

describe('between steps', () => {
  test.each([
    ['next', 'next_step'],
    ['Okay, next.', 'next_step'],
    ["I'm ready.", 'next_step'],
    ["Let's move on.", 'next_step'],
    ['go back', 'leave_scenario'],
  ])('%s → %s', (said, expected) => {
    expect(did(said, 'coaching')).toBe(expected);
  });

  test.each(['Yes.', 'Sure.', 'next I would check the airway', 'show me', 'That makes sense, thanks'])('left to Alex: %s', (said) => {
    // A bare yes answers whatever Alex asked; it is not a clear "next".
    expect(did(said, 'coaching')).toBeNull();
  });
});

describe('choosing a drill', () => {
  test.each(["Let's do choking.", 'The pool one.', 'the second one', 'Surprise me.', 'Can we do the child one?', 'I want to practise CPR'])('%s starts one', (said) => {
    expect(did(said, 'intro', null)).toBe(`start:${said}`);
    expect(did(said, 'debrief')).toBe(`start:${said}`);
  });

  test.each(['Is the child one hard?', 'What scenarios are there?', 'Hello!', 'Yes.', 'next', 'Which one is the easiest?', 'How about choking?'])('left to Alex: %s', (said) => {
    expect(did(said, 'intro', null)).toBeNull();
  });
});

describe('on the emergency card', () => {
  test.each([
    ["False alarm, nobody's hurt.", 'resume_practice'],
    ["It's not a real emergency.", 'resume_practice'],
    ['Sorry, I was only asking.', 'resume_practice'],
    ["he's still not breathing", null],
    ['next', null],
    ["let's do choking", null],
    ['show me', null],
  ])('%s → %s', (said, expected) => {
    expect(did(said, 'emergency')).toBe(expected);
  });

  test('a real emergency is never an action, in any phase: the page\'s own watch has it', () => {
    for (const phase of ['intro', 'answering', 'coaching', 'debrief'] as Phase[]) {
      expect(did("my dad collapsed, I don't know", phase)).toBeNull();
      expect(did('this is real, go back', phase)).toBeNull();
    }
  });
});

describe('the way off the card is in the learner\'s own words', () => {
  test.each([
    [["False alarm, nobody's hurt."], true],
    [['Sorry.', 'I was only asking.'], true],
    [['false alarm', 'yes'], true],
    [["false alarm... no wait, he's not breathing"], false],
    [['false alarm', "no wait, he's not breathing"], false],
    [["he's not breathing", 'nobody is hurt, just practising'], true],
    [['okay'], false],
    [[], false],
  ])('%j → %s', (lines, expected) => {
    expect(clearedBy(lines)).toBe(expected);
  });
});

describe('the phrase rules', () => {
  test('a bare "next", matched whole', () => {
    expect(isAdvanceRequest('  Next. ')).toBe(true);
    expect(isAdvanceRequest('Um, next step.')).toBe(true);
    expect(isAdvanceRequest('next to the pool')).toBe(false);
    expect(isAdvanceRequest('')).toBe(false);
  });

  test('"show me", matched whole', () => {
    expect(wantsShown('Okay, show me please.')).toBe(true);
    expect(wantsShown("I don't know if he's breathing")).toBe(false);
  });

  test('"go back to compressions" is part of an answer, not the way out', () => {
    expect(wantsOut('push hard but not too hard')).toBe(false);
    expect(wantsOut("I'd stop when EMS takes over")).toBe(false);
    expect(wantsOut('Can we go back?')).toBe(true);
  });

  test('naming a drill at the list, not asking about one', () => {
    expect(namesScenario('the bus stop one')).toBe(true);
    expect(namesScenario('is the bus stop one long?')).toBe(false);
    expect(namesScenario('the sandwich one')).toBe(false);
  });
});

describe('the page\'s copies of the content', () => {
  test('the menu order is the content\'s', () => {
    expect([...MENU_ORDER]).toEqual(SCENARIOS.map((s) => s.id));
  });

  test('the front door\'s drills match the catalog: ids, titles, step counts', () => {
    expect(DRILLS.map(({ id, title, steps }) => ({ id, title, steps }))).toEqual(catalog().map(({ id, title, steps }) => ({ id, title, steps })));
  });

  test('the front door\'s preview quotes the compressions step word for word', () => {
    const step = SCENARIOS[0].steps[PREVIEW.step - 1];
    expect(step.label).toBe(PREVIEW.label);
    expect(step.teach).toBe(PREVIEW.teach);
    expect(step.metronomeBpm).toBe(PREVIEW.bpm);
    expect(SCENARIOS[0].steps.length).toBe(PREVIEW.of);
  });
});
