// What Ren is told: never an unearned stroke, the live stroke's lesson in the
// state only once it is earned, tools that fit the API, and every text within
// the API's limits.
import { describe, expect, test } from 'vitest';
import { CHARACTERS, JUU, KI, type Character } from './characters.ts';
import { boardState, firstTryRecord, INSTRUCTIONS, say, TOOLS } from './director.ts';
import { perform } from './lesson.ts';
import { resample } from './strokes.ts';
import { StrokeTutor } from './tutor.ts';
import type { Snapshot } from './types.ts';

const drawing = (character: Character, index: number) => resample(character.strokes[index].points, 40).map(([x, y]) => [Math.trunc(x), Math.trunc(y)]);

/** Everything about one stroke that would give it away. */
function secretsOf(character: Character, index: number): string[] {
  const s = character.strokes[index];
  return [s.teach, s.hint, s.directionNote, s.startNote, s.name, ...s.points.map(([x, y]) => `${x}, ${y}`), ...s.points.map(([x, y]) => `${x},${y}`)];
}

/** Every board the learner can be looking at while `index` is the live stroke: before drawing, after a miss, after a clear. */
function boardsWhileLive(character: Character, index: number): Snapshot[] {
  const tutor = new StrokeTutor();
  tutor.startCharacter(character.id);
  for (let i = 0; i < index; i += 1) {
    tutor.reveal();
    tutor.nextStroke();
  }
  const boards = [tutor.snapshot()];
  // A miss: some other stroke of the character, or a scribble for a one-stroke character.
  const wrong = character.strokes.length > 1 ? drawing(character, index === 0 ? 1 : 0) : [[100, 900], [140, 700], [180, 900], [220, 700]];
  tutor.stroke(wrong);
  if (tutor.phase === 'writing') boards.push(tutor.snapshot());
  return boards;
}

describe('the leak', () => {
  test('the state never carries the live stroke or a later one, for any stroke of any character', () => {
    for (const character of CHARACTERS) {
      for (let index = 0; index < character.strokes.length; index += 1) {
        for (const view of boardsWhileLive(character, index)) {
          const state = boardState(view);
          const shown = view.last_verdict?.note;
          // Sentences an EARNED stroke legitimately brought (some notes are shared between strokes).
          const earned = new Set(character.strokes.slice(0, index).flatMap((s) => [s.teach, s.name]));
          for (let later = index; later < character.strokes.length; later += 1) {
            for (const secret of secretsOf(character, later)) {
              if (secret === shown || earned.has(secret) || [...earned].some((e) => e.includes(secret))) continue;
              expect(state, `${character.id} stroke ${index + 1} live; stroke ${later + 1}: "${secret}"`).not.toContain(secret);
            }
          }
        }
      }
    }
  });

  test('the state carries no coordinates at all', () => {
    for (const character of CHARACTERS) for (const view of boardsWhileLive(character, 0)) expect(boardState(view)).not.toMatch(/\d{3}/);
  });

  test('no event text before a reveal carries the live stroke', () => {
    const tutor = new StrokeTutor();
    const started = perform(tutor, { kind: 'start_character', id: 'juu' }, 'panel');
    const missed = perform(tutor, { kind: 'stroke', points: drawing(JUU, 1) }, 'panel');
    for (const text of [started.event!, missed.event!, say.resume(missed.view)]) {
      for (const secret of [JUU.strokes[0].teach, JUU.strokes[0].name, JUU.strokes[0].hint]) expect(text).not.toContain(secret);
    }
  });
});

describe('staging', () => {
  test("the live stroke's lesson is in the state once it is earned, and only then", () => {
    const tutor = new StrokeTutor();
    tutor.startCharacter('juu');
    expect(boardState(tutor.snapshot())).not.toContain(JUU.strokes[0].teach);
    tutor.stroke(drawing(JUU, 0));
    const earned = boardState(tutor.snapshot());
    expect(earned).toContain(JUU.strokes[0].teach);
    expect(earned).toContain('drawn correctly');
    tutor.nextStroke();
    const next = boardState(tutor.snapshot());
    expect(next).toContain(JUU.strokes[0].teach);
    expect(next).not.toContain(JUU.strokes[1].teach);
    expect(next).toContain('Stroke 2 of 2 is live');
  });

  test('a shown stroke says how it was earned', () => {
    const tutor = new StrokeTutor();
    tutor.startCharacter('juu');
    tutor.reveal();
    expect(boardState(tutor.snapshot())).toContain('shown to them because they asked');
  });

  test('the state pairs the ban on describing with the way out', () => {
    // Live, in the original: "which stroke comes first, and where do I start
    // it?" got "I can't describe stroke one". The ban needs its escape hatch.
    const tutor = new StrokeTutor();
    tutor.startCharacter('ei');
    const state = boardState(tutor.snapshot());
    expect(state).toContain('never describe it or guess it');
    expect(state).toContain('call show_stroke');
  });

  test('the last verdict is on the board, so "what did I do wrong?" has an answer', () => {
    const tutor = new StrokeTutor();
    tutor.startCharacter('juu');
    tutor.stroke(drawing(JUU, 0).reverse());
    expect(boardState(tutor.snapshot())).toContain('Wrong direction: "You drew it from right to left. This stroke goes from left to right."');
  });

  test('the menu is on the board before any character, and after the last stroke', () => {
    const tutor = new StrokeTutor();
    expect(boardState(tutor.snapshot())).toContain('永 eternity (5 strokes)');
    expect(boardState(tutor.snapshot())).toContain('一 one (1 stroke)');
    tutor.startCharacter('ichi');
    tutor.reveal();
    tutor.nextStroke();
    expect(boardState(tutor.snapshot())).toContain('The character is finished. Their record: 0 of 1 stroke right on the first try; stroke 1 was shown to them because they asked.');
  });
});

describe('limits', () => {
  test('the instructions fit the API and name every tool', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
    for (const tool of TOOLS) expect(INSTRUCTIONS).toContain(tool.name);
  });

  test('the tools fit the API: names, descriptions, schemas, all await', () => {
    expect(TOOLS.length).toBeLessThanOrEqual(30);
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
      expect(['web_search', 'lookup']).not.toContain(tool.name);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeLessThanOrEqual(500);
      expect(tool.parameters.type).toBe('object');
      expect(JSON.stringify(tool.parameters).length).toBeLessThanOrEqual(4096);
      expect(tool['x-atmee']?.mode).toBe('await');
      expect(tool['x-atmee']!.timeoutSeconds!).toBeGreaterThanOrEqual(1);
      expect(tool['x-atmee']!.timeoutSeconds!).toBeLessThanOrEqual(28);
    }
    expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(24576);
  });

  test('there is no tool for drawing: strokes are the hand\'s', () => {
    for (const tool of TOOLS) {
      expect(tool.name).not.toMatch(/draw|stroke_points|submit/);
      expect(JSON.stringify(tool.parameters)).not.toMatch(/points/);
    }
  });

  test('the schemas are lenient: nothing the platform could reject a fair call for', () => {
    const banned = /"(enum|pattern|format|minLength|const|additionalProperties)"/;
    for (const tool of TOOLS) {
      const schema = JSON.stringify(tool.parameters);
      expect(schema, tool.name).not.toMatch(banned);
      expect((tool.parameters as { required?: unknown }).required, tool.name).toBeUndefined();
      for (const m of schema.matchAll(/"maxLength":(\d+)/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(200);
    }
  });

  test('next_stroke asks to be called for the single word "next"', () => {
    expect(TOOLS.find((t) => t.name === 'next_stroke')!.description).toContain('even that one word');
  });

  test('a starting-over tool says it is only for when the learner asks', () => {
    expect(TOOLS.find((t) => t.name === 'start_over')!.description).toContain('Only when the learner asks');
  });

  test('the state stays under 3,858 characters on the longest board', () => {
    let longest = 0;
    for (const character of CHARACTERS) {
      const tutor = new StrokeTutor();
      tutor.startCharacter(character.id);
      for (let i = 0; i < character.strokes.length; i += 1) {
        tutor.stroke(drawing(character, (i + 1) % character.strokes.length));
        longest = Math.max(longest, boardState(tutor.snapshot()).length);
        if (tutor.phase === 'writing') tutor.reveal();
        longest = Math.max(longest, boardState(tutor.snapshot()).length);
        tutor.nextStroke();
      }
      longest = Math.max(longest, boardState(tutor.snapshot()).length);
    }
    expect(longest).toBeLessThan(3858);
  });

  test('the instructions keep the hard-won rules', () => {
    expect(INSTRUCTIONS).toContain('NEVER describe a stroke the learner has not earned');
    expect(INSTRUCTIONS).toContain('never guess them from your own knowledge');
    expect(INSTRUCTIONS).toContain("never say \"I can't describe it\"");
    expect(INSTRUCTIONS).toContain('WITHOUT changing what it claims');
    expect(INSTRUCTIONS).toContain('Never comment on neatness');
    expect(INSTRUCTIONS).toContain('The sheet changes only when you call');
    expect(INSTRUCTIONS).toContain('Every request that changes the sheet is a tool call, even one word');
    expect(INSTRUCTIONS).toContain('"Next." on its own');
    expect(INSTRUCTIONS).toContain('Never say an action happened');
    expect(INSTRUCTIONS).toContain('in the order given: what they drew, then which way it goes');
    expect(INSTRUCTIONS).toContain('Never invent an outcome');
    expect(INSTRUCTIONS).toContain('You cannot draw for them');
  });
});

describe('cues', () => {
  const view = (verdict: Snapshot['last_verdict'], attempts = 1): Snapshot => ({
    phase: 'writing', character: { id: 'juu', glyph: '十', meaning: 'ten', reading: 'jū', script: 'kanji', strokes_total: 2 },
    stroke_index: 0, strokes: [], attempts, last_verdict: verdict, score: { correct: 0, total: 1 }, results: [], grid: 1000, catalog: [],
  });

  test('a stroke drawn backwards is told as what they drew, then which way it goes, in that order', () => {
    const cue = say.verdict(view({ ok: false, kind: 'direction', note: 'Top to bottom.', travel: { drawn: 'from the bottom up', right: 'from the top down' } }));
    expect(cue).toMatch(/^Not right: /);
    expect(cue).toContain('"You drew it from the bottom up. This stroke goes from the top down."');
    expect(cue).toContain('in this order');
    // The bare note, which live was heard as what they did, is not what Ren is handed.
    expect(cue).not.toContain('"Top to bottom."');
  });

  test('the opening does not greet again: the host has just greeted them', () => {
    expect(say.opening()).toMatch(/^You have just greeted them; do not greet or introduce yourself again\./);
    const tutor = new StrokeTutor();
    tutor.startCharacter('ki');
    expect(say.resume(tutor.snapshot())).toMatch(/^You have just greeted them; do not greet or introduce yourself again\./);
  });

  test('each verdict kind gets its own coaching line, quoting the note', () => {
    for (const [kind, marker] of [['order', 'ORDER'], ['direction', 'DIRECTION'], ['start', 'wrong place']] as const) {
      const cue = say.verdict(view({ ok: false, kind, note: 'N' }));
      expect(cue).toContain(marker);
      expect(cue).toContain('"N"');
    }
  });

  test('the correct cue forbids changing what the note claims', () => {
    expect(say.verdict(view({ ok: true, kind: 'ok', note: 'N' }))).toContain('WITHOUT changing');
  });

  test('a wrong-shape cue forbids giving the stroke away', () => {
    expect(say.verdict(view({ ok: false, kind: 'shape', note: 'N' }))).toContain('Do NOT tell them what it is');
  });

  test('a reveal is told as asked-for or as a rescue by the attempt count', () => {
    const shown = { ok: false, kind: 'reveal', note: 'N', revealed: true } as const;
    expect(say.verdict(view(shown, 0))).toContain('asked to be shown');
    expect(say.verdict(view(shown, 2))).toContain('missed it twice');
  });

  test('every result and event text is a short instruction, not a speech', () => {
    const tutor = new StrokeTutor();
    const texts = [say.opening(), say.refused('Finish this stroke first.')];
    tutor.startCharacter('ei');
    texts.push(say.started(tutor.snapshot()), say.next(tutor.snapshot()), say.resume(tutor.snapshot()), say.alreadyUp(tutor.snapshot()), say.restarted(tutor.snapshot()));
    tutor.reveal();
    texts.push(say.verdict(tutor.snapshot()), say.drawn(tutor.snapshot()));
    for (const text of texts) expect(text.length).toBeLessThan(600);
  });

  test('no result asks Ren to act on its own: the debrief asks, and acts only on a choice', () => {
    const tutor = new StrokeTutor();
    tutor.startCharacter('ichi');
    tutor.reveal();
    tutor.nextStroke();
    const debrief = say.debrief(tutor.snapshot());
    expect(debrief).toContain('ask which character they would like next');
    expect(debrief).toContain('only when they choose');
    expect(say.opening()).toContain('only when they choose');
  });
});

describe('the first-try record', () => {
  /** 木 as the live run played it: stroke 1 drawn backwards, then right; the rest right first time. */
  function tree() {
    const tutor = new StrokeTutor();
    tutor.startCharacter('ki');
    tutor.stroke(drawing(KI, 0).reverse());
    tutor.stroke(drawing(KI, 0));
    for (let i = 1; i < 4; i += 1) { tutor.nextStroke(); tutor.stroke(drawing(KI, i)); }
    tutor.nextStroke();
    return tutor;
  }

  test('the debrief states the record plainly: a stroke right on its second try is not a first try', () => {
    const view = tree().snapshot();
    expect(view.score.correct).toBe(4);   // the engine's score: drawn right, on any try
    const debrief = say.debrief(view);
    expect(debrief).toContain('3 of 4 strokes right on the first try; stroke 1 took two tries.');
    expect(debrief).toContain('do NOT say every stroke was right first time');
    expect(boardState(view)).toContain('3 of 4 strokes right on the first try; stroke 1 took two tries.');
  });

  test('all right first time is said as such, with no warning', () => {
    const tutor = new StrokeTutor();
    tutor.startCharacter('juu');
    tutor.stroke(drawing(JUU, 0));
    tutor.nextStroke();
    tutor.stroke(drawing(JUU, 1));
    tutor.nextStroke();
    const debrief = say.debrief(tutor.snapshot());
    expect(debrief).toContain('2 of 2 strokes right on the first try.');
    expect(debrief).not.toContain('do NOT');
  });

  test('shown strokes say how: when they asked, or after two misses', () => {
    const tutor = new StrokeTutor();
    tutor.startCharacter('juu');
    tutor.reveal();
    tutor.nextStroke();
    tutor.stroke(drawing(JUU, 0));
    tutor.stroke(drawing(JUU, 0));
    tutor.reveal();   // the rescue, as lesson.ts makes it
    expect(firstTryRecord(tutor.snapshot())).toBe('0 of 2 strokes right on the first try; stroke 1 was shown to them because they asked; stroke 2 was shown to them after two misses.');
  });

  test('mid-character, the state carries the record so far, and nothing about strokes not reached', () => {
    const tutor = new StrokeTutor();
    tutor.startCharacter('ki');
    expect(boardState(tutor.snapshot())).toContain('No stroke of this character is finished yet.');
    tutor.stroke(drawing(KI, 0));
    expect(boardState(tutor.snapshot())).toContain('Their record on this character so far: 1 of 1 stroke right on the first try.');
  });
});
