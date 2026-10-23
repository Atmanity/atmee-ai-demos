// Which drill the learner named, as Alex passes it to start_scenario.
import { describe, expect, test } from 'vitest';
import { resolveScenario, scenarioNamedIn } from './judge.ts';

describe('the drill named', () => {
  test.each([
    ["Let's do choking.", 'choking_adult'],
    ['The child one, please.', 'child_cardiac_arrest'],
    ['adult choking', 'choking_adult'],
    ['Recovery position.', 'recovery_position'],
    ["Let's do the one where someone collapsed.", 'adult_cardiac_arrest'],
    ['The pool one.', 'child_cardiac_arrest'],
    ['The dinner table one', 'choking_adult'],
    ['the one at the bus stop', 'recovery_position'],
    ['the second one', 'child_cardiac_arrest'],
    ['the last one', 'recovery_position'],
    ['Surprise me.', 'adult_cardiac_arrest'],
    ['I want to practise CPR', 'adult_cardiac_arrest'],
    ['How about choking?', 'choking_adult'],
    ['child_cardiac_arrest', 'child_cardiac_arrest'],
    ['Choking at a dinner table', 'choking_adult'],
    ['Unresponsive but breathing', 'recovery_position'],
    ['Child unresponsive by a pool', 'child_cardiac_arrest'],
    ['Adult collapse in a café', 'adult_cardiac_arrest'],
  ])('%s → %s', (words, id) => {
    expect(resolveScenario(words)).toBe(id);
  });

  test('a drill it does not have is none', () => {
    expect(resolveScenario('the sandwich one')).toBeNull();
    expect(resolveScenario('motorbike crash')).toBeNull();
    expect(resolveScenario('')).toBeNull();
    expect(scenarioNamedIn('   ')).toBeNull();
  });
});
