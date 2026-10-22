// The wired board: an intent in, the board and the avatar's next line out.
// (Ported from the original test_table.py; its reducer, coach and tool cases
// all land on `perform`, the one path every input now takes.) The failures
// these catch are the silent ones: a refusal that reaches nobody, a rescue
// that never fires (or fires twice), a view carrying coordinates the learner
// has not earned, and the avatar saying the same thing twice.
import { describe, expect, test } from 'vitest';
import { EI, JUU, type Character } from './characters.ts';
import { perform, STROKE_IS_THE_USERS, type Source } from './lesson.ts';
import { resample } from './strokes.ts';
import { STROKE_UNRESOLVED, StrokeTutor } from './tutor.ts';
import type { Intent } from './types.ts';

const drawing = (character: Character, index: number) => resample(character.strokes[index].points, 40).map(([x, y]) => [Math.trunc(x), Math.trunc(y)]);

function board(...intents: Intent[]) {
  const tutor = new StrokeTutor();
  const outcomes = intents.map((intent) => perform(tutor, intent, 'panel'));
  return { tutor, outcomes, act: (intent: Intent, by: Source = 'panel') => perform(tutor, intent, by) };
}

describe('the board', () => {
  test('an accepted stroke scores, and says so', () => {
    const { outcomes } = board({ kind: 'start_character', id: 'juu' }, { kind: 'stroke', points: drawing(JUU, 0) });
    expect(outcomes[1].view.score).toEqual({ correct: 1, total: 1 });
    expect(outcomes[1].refused).toBeUndefined();
  });

  test('a refusal comes back as a sentence and changes nothing', () => {
    const { tutor, act } = board({ kind: 'start_character', id: 'juu' });
    const before = JSON.stringify(tutor.snapshot());
    const outcome = act({ kind: 'next_stroke' });
    expect(outcome.refused).toBe(STROKE_UNRESOLVED);
    expect(outcome.handled).toBe(true);
    expect(JSON.stringify(outcome.view)).toBe(before);
  });

  test('words cannot draw a stroke for the learner', () => {
    // A model that could submit a stroke would be grading itself, which is
    // what the deterministic grader exists to prevent.
    const { act } = board({ kind: 'start_character', id: 'juu' });
    const outcome = act({ kind: 'stroke', points: drawing(JUU, 0) }, 'words');
    expect(outcome.refused).toBe(STROKE_IS_THE_USERS);
    expect(outcome.view.score.correct).toBe(0);
  });

  test('an unknown intent kind is refused by name', () => {
    const { act } = board();
    const outcome = act({ kind: 'erase_everything' } as unknown as Intent);
    expect(outcome.refused).toContain('erase_everything');
  });

  test('a view never carries an unearned stroke', () => {
    // The leak, checked on what the page actually receives.
    const { outcomes } = board({ kind: 'start_character', id: 'ei' });
    expect(outcomes[0].view.strokes.every((s) => s.points.length === 0 && !s.teach && !s.name)).toBe(true);
    expect(JSON.stringify(outcomes[0])).not.toContain(EI.strokes[0].teach);
  });
});

describe('what the avatar is told', () => {
  test('a stroke drawn on the board gets exactly one coaching line', () => {
    const { outcomes } = board({ kind: 'start_character', id: 'juu' }, { kind: 'stroke', points: drawing(JUU, 0) });
    expect(outcomes[1].event).toContain('WITHOUT changing');
    expect(outcomes[1].event).toContain(JUU.strokes[0].teach);
  });

  test('the board shows the stroke after a second miss and teaches it', () => {
    // The rescue. Without it a learner who cannot recall a stroke is stuck
    // drawing wrong shapes at a board that will not tell them anything.
    const { tutor, act } = board({ kind: 'start_character', id: 'juu' });
    const first = act({ kind: 'stroke', points: drawing(JUU, 1) });
    expect(first.event).toContain('ORDER');
    const second = act({ kind: 'stroke', points: drawing(JUU, 1) });
    expect(tutor.phase).toBe('coaching');
    expect(second.view.strokes[0].points).not.toEqual([]);
    expect(second.event).toContain('missed it twice');
    expect(second.event).toContain(JUU.strokes[0].teach);
  });

  test('the rescue fires once: the next stroke starts with a clean count', () => {
    const { act } = board({ kind: 'start_character', id: 'juu' });
    act({ kind: 'stroke', points: drawing(JUU, 1) });
    act({ kind: 'stroke', points: drawing(JUU, 1) });
    const next = act({ kind: 'next_stroke' });
    expect(next.view.attempts).toBe(0);
    const miss = act({ kind: 'stroke', points: drawing(JUU, 0) });
    expect(miss.view.phase).toBe('writing');
    expect(miss.event).not.toContain('missed it twice');
  });

  test('asking to be shown a stroke is not reported as missing it twice', () => {
    // The symptom: a learner presses "Show me" before drawing anything and the
    // teacher opens with "you missed it twice". The button and the rescue mint
    // the SAME verdict, so the story has to come from the attempt count.
    const { act } = board({ kind: 'start_character', id: 'juu' });
    const outcome = act({ kind: 'reveal' });
    expect(outcome.view.attempts).toBe(0);
    expect(outcome.event).toContain('asked to be shown');
    expect(outcome.event).not.toContain('missed it twice');
  });

  test('finishing the character from the board still gets a debrief', () => {
    // The symptom: the learner taps "Next stroke" after the last stroke and
    // the teacher simply goes quiet. The words path had a debrief; the panel
    // path had none.
    const { tutor, act } = board({ kind: 'start_character', id: 'ichi' }, { kind: 'reveal' });
    const outcome = act({ kind: 'next_stroke' });
    expect(tutor.phase).toBe('debrief');
    expect(outcome.event).toContain('last stroke');
    expect(outcome.event).toContain('0 of 1');
  });

  test('a refused request comes back as the sentence to say', () => {
    // The platform's worst failure is the avatar cheerfully confirming
    // something that never happened.
    const { act } = board({ kind: 'start_character', id: 'juu' });
    const outcome = act({ kind: 'next_stroke' }, 'words');
    expect(outcome.event).toContain(STROKE_UNRESOLVED);
    expect(outcome.event).toContain('do not claim anything happened');
  });

  test('choosing an unknown character hands back the list', () => {
    const { act } = board();
    expect(act({ kind: 'start_character', id: 'dragon' }, 'words').event).toContain("I don't have that one");
  });

  test('a new character is introduced, and its first stroke asked for without being described', () => {
    // The teacher asking "now the long vertical" has answered the question the
    // board is deliberately not drawing.
    const { outcomes } = board({ kind: 'start_character', id: 'ei' });
    const event = outcomes[0].event!;
    expect(event).toContain('means "eternity"');
    expect(event).toContain('Stroke 1 of 5');
    expect(event).toContain('Do NOT say what shape it is');
    for (const stroke of EI.strokes) expect(event).not.toContain(stroke.name);
  });

  test('starting over puts the same character back at stroke one', () => {
    const { tutor, act } = board({ kind: 'start_character', id: 'juu' }, { kind: 'stroke', points: drawing(JUU, 0) });
    const outcome = act({ kind: 'start_character' }, 'words');
    expect(outcome.event).toContain('back at the beginning');
    expect(tutor.snapshot().stroke_index).toBe(0);
    expect(tutor.snapshot().strokes[0].points).toEqual([]);
  });

  test('next character moves on and introduces it', () => {
    const { act } = board({ kind: 'start_character', id: 'ichi' });
    const outcome = act({ kind: 'next_character' }, 'words');
    expect(outcome.view.character?.id).toBe('juu');
    expect(outcome.event).toContain('十 is on the board');
  });

  test('clearing asks for the stroke again', () => {
    const { act } = board({ kind: 'start_character', id: 'juu' }, { kind: 'stroke', points: drawing(JUU, 1) });
    const outcome = act({ kind: 'clear_attempt' });
    expect(outcome.view.attempts).toBe(0);
    expect(outcome.event).toContain('cleared');
    expect(outcome.event).toContain('Stroke 1 of 2');
  });

  test('a Latin capital is introduced as a letter, not with a reading', () => {
    const { outcomes } = board({ kind: 'start_character', id: 'latin_a' });
    expect(outcomes[0].event).toContain('A, the capital letter, is on the board, in 3 strokes');
  });
});
