// The wired board: an intent in, the board and the avatar's next line out.
// (Ported from the original test_table.py; its reducer, coach and tool cases
// all land on `perform`, the one path every input now takes.) The failures
// these catch are the silent ones: a refusal that reaches nobody, a rescue
// that never fires (or fires twice), a view carrying coordinates the learner
// has not earned, and the avatar saying the same thing twice.
import { describe, expect, test } from 'vitest';
import { CHARACTERS, EI, JUU, type Character } from './characters.ts';
import { TOOLS } from './director.ts';
import { perform, resolveCharacter, runTool, STROKE_IS_THE_USERS, TOOL_NAMES, type Source } from './lesson.ts';
import { resample } from './strokes.ts';
import { ALREADY_RESOLVED, CHARACTER_FINISHED, STROKE_UNRESOLVED, StrokeTutor, UNKNOWN_CHARACTER } from './tutor.ts';
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

describe('what Ren is told', () => {
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
    expect(outcome.event).toContain('十 is on the sheet');
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
    expect(outcomes[0].event).toContain('A, the capital letter, is on the sheet, in 3 strokes');
  });
});

describe("Ren's tools", () => {
  const tool = (tutor: StrokeTutor, name: string, args: Record<string, unknown> = {}) => runTool(tutor, name, args);

  test('every declared tool is one the sheet answers, and the other way round', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    const tutor = new StrokeTutor();
    for (const name of TOOL_NAMES) expect(() => tool(tutor, name, { character: 'tree' })).not.toThrow();
    expect(() => tool(tutor, 'draw_stroke')).toThrow();
  });

  test('choose_character reads what the learner called it', () => {
    for (const [said, id] of [['tree', 'ki'], ['the tree one', 'ki'], ['木', 'ki'], ['eternity', 'ei'], ['the letter A', 'latin_a'], ['capital E', 'latin_e'], ['ten', 'juu'], ['juu', 'juu'], ['river', 'kawa'], ['one', 'ichi']] as const) {
      expect(resolveCharacter(said), said).toBe(id);
      const tutor = new StrokeTutor();
      const done = tool(tutor, 'choose_character', { character: said });
      expect(done.view.character?.id, said).toBe(id);
      expect(done.text).toContain('is on the sheet');
      expect(done.text).toContain('Stroke 1 of');
    }
  });

  test('choose_character refuses one it does not have, with the list, and changes nothing', () => {
    const tutor = new StrokeTutor();
    tool(tutor, 'choose_character', { character: 'ten' });
    const done = tool(tutor, 'choose_character', { character: 'dragon' });
    expect(done.refused).toBe(UNKNOWN_CHARACTER);
    expect(done.text).toMatch(/^Refused: "dragon" is not on the menu, so nothing changed\./);
    expect(done.text).toContain('永 eternity');
    expect(done.text).toContain('ask which of these they would like');
    expect(done.view.character?.id).toBe('juu');
  });

  test('choose_character for the character already up does not wipe the learner\'s progress', () => {
    const tutor = new StrokeTutor();
    tool(tutor, 'choose_character', { character: 'ten' });
    perform(tutor, { kind: 'stroke', points: drawing(JUU, 0) }, 'panel');
    const done = tool(tutor, 'choose_character', { character: '十' });
    expect(done.text).toContain('already on the sheet');
    expect(done.view.strokes[0].status).toBe('done');
    expect(done.view.score.correct).toBe(1);
  });

  test('choose_character with nothing named asks which one', () => {
    for (const args of [{ character: '  ' }, {}, { character: 7 }]) {
      const text = tool(new StrokeTutor(), 'choose_character', args).text;
      expect(text).toMatch(/^Not yet: no character was named/);
      expect(text).toContain('Ask them which one they would like');
    }
  });

  test('show_stroke draws the live stroke and hands back its lesson, told as asked for', () => {
    const tutor = new StrokeTutor();
    tool(tutor, 'choose_character', { character: 'ten' });
    const done = tool(tutor, 'show_stroke');
    expect(done.view.strokes[0].points.length).toBeGreaterThan(1);
    expect(done.text).toContain(JUU.strokes[0].teach);
    expect(done.text).toContain('asked to be shown');
    expect(done.view.strokes[1].points).toEqual([]);
  });

  test('a second show_stroke, as the safety net might make, is refused and changes nothing', () => {
    const tutor = new StrokeTutor();
    tool(tutor, 'choose_character', { character: 'ten' });
    tool(tutor, 'show_stroke');
    const before = JSON.stringify(tutor.snapshot());
    const again = tool(tutor, 'show_stroke');
    expect(again.refused).toBe(ALREADY_RESOLVED);
    expect(JSON.stringify(again.view)).toBe(before);
  });

  test('next_stroke is refused while the stroke is unfinished, then asks for the next by number only', () => {
    const tutor = new StrokeTutor();
    tool(tutor, 'choose_character', { character: 'ten' });
    expect(tool(tutor, 'next_stroke').refused).toBe(STROKE_UNRESOLVED);
    tool(tutor, 'show_stroke');
    const next = tool(tutor, 'next_stroke');
    expect(next.text).toContain('Stroke 2 of 2 of 十 is live');
    for (const secret of [JUU.strokes[1].teach, JUU.strokes[1].name, JUU.strokes[1].hint]) expect(next.text).not.toContain(secret);
    // Twice in a row (Ren, then the net): the second is refused, no stroke skipped.
    expect(tool(tutor, 'next_stroke').refused).toBe(STROKE_UNRESOLVED);
    expect(tutor.snapshot().stroke_index).toBe(1);
  });

  test('next_stroke after the last stroke finishes the character with a debrief', () => {
    const tutor = new StrokeTutor();
    tool(tutor, 'choose_character', { character: 'one' });
    tool(tutor, 'show_stroke');
    const done = tool(tutor, 'next_stroke');
    expect(done.view.phase).toBe('debrief');
    expect(done.text).toContain('last stroke of 一');
    expect(tool(tutor, 'next_stroke').refused).toBe(CHARACTER_FINISHED);
  });

  test('start_over puts the character back at stroke one; twice lands in the same place', () => {
    const tutor = new StrokeTutor();
    tool(tutor, 'choose_character', { character: 'ten' });
    perform(tutor, { kind: 'stroke', points: drawing(JUU, 0) }, 'panel');
    const once = tool(tutor, 'start_over');
    expect(once.text).toContain('back at the beginning of 十');
    const twice = tool(tutor, 'start_over');
    expect(JSON.stringify(twice.view)).toBe(JSON.stringify(once.view));
    expect(twice.view.strokes.every((s) => s.points.length === 0)).toBe(true);
  });

  test('next_character walks the lesson order', () => {
    const tutor = new StrokeTutor();
    expect(tool(tutor, 'next_character').view.character?.id).toBe('ichi');
    expect(tool(tutor, 'next_character').view.character?.id).toBe('juu');
  });

  test('no tool result carries a stroke the learner has not earned', () => {
    for (const character of CHARACTERS) {
      const tutor = new StrokeTutor();
      const texts = [tool(tutor, 'choose_character', { character: character.id }).text];
      for (let i = 0; i < character.strokes.length; i += 1) {
        const later = character.strokes.slice(i + 1).flatMap((s) => [s.teach, s.hint, s.name]);
        const earned = new Set(character.strokes.slice(0, i + 1).flatMap((s) => [s.teach, s.name]));
        texts.push(tool(tutor, 'show_stroke').text);
        const next = tool(tutor, 'next_stroke').text;
        for (const secret of later) if (!earned.has(secret)) expect(next, `${character.id} after stroke ${i + 1}`).not.toContain(secret);
      }
    }
  });
});

describe('lenient arguments: the app normalises what the host passes', () => {
  test('capitalised names, synonyms and readings all choose the character', () => {
    for (const [said, id] of [['Tree', 'ki'], ['THE TREE', 'ki'], ['Wood', 'ki'], ['Eternity', 'ei'], ['The Letter A', 'latin_a'], ['Capital E', 'latin_e'], ['Jū', 'juu'], ['Kanji for river', 'kawa'], [' 永 ', 'ei']] as const) {
      expect(runTool(new StrokeTutor(), 'choose_character', { character: said }).view.character?.id, said).toBe(id);
    }
  });

  test('an extra unknown field is accepted, and a name under another key is still read', () => {
    expect(runTool(new StrokeTutor(), 'choose_character', { character: 'tree', confidence: 0.9 }).view.character?.id).toBe('ki');
    expect(runTool(new StrokeTutor(), 'choose_character', { name: 'river' }).view.character?.id).toBe('kawa');
    const tutor = new StrokeTutor();
    runTool(tutor, 'choose_character', { character: 'ten' });
    expect(runTool(tutor, 'show_stroke', { stroke: 1 }).text).toMatch(/^Done:/);
    expect(runTool(tutor, 'next_stroke', { reason: 'learner said next' }).text).toMatch(/^Done:/);
  });
});

describe('every result opens with the plain outcome, so a filler cannot pre-judge it', () => {
  test('across a whole lesson, done and refused alike', () => {
    const OUTCOME = /^(Done|Not yet|Refused|Nothing changed|Shown|Right|Not right): /;
    const tutor = new StrokeTutor();
    const texts = [
      runTool(tutor, 'choose_character', { character: '' }).text,
      runTool(tutor, 'choose_character', { character: 'dragon' }).text,
      runTool(tutor, 'next_stroke').text,                        // refused before any character
      runTool(tutor, 'choose_character', { character: 'ten' }).text,
      runTool(tutor, 'choose_character', { character: 'ten' }).text,
      runTool(tutor, 'next_stroke').text,                        // refused: unfinished
      runTool(tutor, 'show_stroke').text,
      runTool(tutor, 'show_stroke').text,                        // refused: already shown
      runTool(tutor, 'next_stroke').text,
      perform(tutor, { kind: 'stroke', points: drawing(JUU, 1).reverse() }, 'panel').event!,
      perform(tutor, { kind: 'stroke', points: drawing(JUU, 1) }, 'panel').event!,
      runTool(tutor, 'next_stroke').text,                        // the debrief
      runTool(tutor, 'start_over').text,
      runTool(tutor, 'next_character').text,
    ];
    for (const text of texts) expect(text, text).toMatch(OUTCOME);
  });
});
