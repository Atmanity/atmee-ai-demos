// What the avatar is told: within the API's limits, and never a line of
// working beyond the one staged for the next "next".
import { describe, expect, test } from 'vitest';
import { boardState, eventFor, NOTES, refusalEvent, say } from './director.ts';
import { Table } from './table.ts';

const LIMIT_NOTE = 2000;
const LIMIT_STATE = 3858;

async function working(method = 'factoring', equation = 'x^2 - 4x + 3') {
  const table = new Table();
  await table.enter(equation);
  table.press({ kind: 'set_method', method });
  return table;
}

describe('limits', () => {
  test('every standing note fits the 2,000-character limit', () => {
    expect(NOTES.length).toBeGreaterThan(0);
    for (const note of NOTES) expect(note.length).toBeLessThanOrEqual(LIMIT_NOTE);
  });

  test('the busiest board still fits the state limit', () => {
    // The longest derivation this app can write: fractional coefficients (every
    // line carries denominators), a leading coefficient to divide out, all
    // revealed, plus a midway board with the staged line. (The original's
    // envelope test used the same quadratic.)
    for (const reveal of ['all', 'half'] as const) {
      const table = new Table();
      table.press({ kind: 'set_equation', a: -7, b: 111.5, c: -2048.125 });
      table.press({ kind: 'set_method', method: 'completing_square' });
      if (reveal === 'all') table.press({ kind: 'reveal_all' });
      else for (let i = 0; i < 4; i += 1) table.press({ kind: 'reveal_step' });
      expect(boardState(table.view()).length).toBeLessThan(LIMIT_STATE);
      expect(JSON.stringify(table.view()).length).toBeLessThan(8000);
    }
  });

  test('an empty board still has a state', () => {
    expect(boardState(new Table().view())).toContain('The board is empty');
  });
});

describe('never ahead of the reveal', () => {
  test('the state never carries a line beyond the next one, by any method', async () => {
    // The marked-deck failure, in this app: the avatar narrating step six
    // while the room is looking at step two.
    for (const method of ['factoring', 'completing_square', 'quadratic_formula']) {
      const table = await working(method);
      for (let revealed = 0; revealed < table.board.derivation().length; revealed += 1) {
        const state = boardState(table.view());
        const view = JSON.stringify(table.view());
        const lines = table.board.derivation();
        // The next line: its sentence is staged, its board line is not sent.
        expect(state).toContain(lines[revealed].say);
        if (!lines.slice(0, revealed).some((s) => s.working === lines[revealed].working) && lines[revealed].working !== table.board.equation!.zeroForm) {
          expect(view, `${method} line ${revealed + 1}`).not.toContain(JSON.stringify(lines[revealed].working));
        }
        // Everything after it: nowhere.
        for (const later of lines.slice(revealed + 1)) {
          expect(state, `${method}: ${later.say}`).not.toContain(later.say);
          expect(view, `${method}: ${later.say}`).not.toContain(later.say);
        }
        table.press({ kind: 'reveal_step' });
      }
    }
  });

  test('the staged line is marked as not on the board, and goes only when asked', async () => {
    const table = await working();
    const state = boardState(table.view());
    expect(state).toContain('Line 1 is NOT on the board yet');
    expect(state).toContain('Only when the teacher asks for the next line');
    expect(state).toContain('never say it');
  });

  test('nothing is staged before a method, or after the last line', async () => {
    const table = new Table();
    await table.enter('x^2 - 4x + 3');
    expect(table.view().next).toBeNull();
    expect(boardState(table.view())).toContain('No method is chosen yet');
    table.press({ kind: 'set_method', method: 'factoring' });
    table.press({ kind: 'reveal_all' });
    expect(table.view().next).toBeNull();
    expect(boardState(table.view())).toContain('Every line is up');
  });

  test('the state carries the equation and the exact facts', async () => {
    // What a teacher asks mid-lesson, and what the avatar must not get wrong.
    const table = new Table();
    await table.enter('x^2 - 4x + 1');
    const state = boardState(table.view());
    expect(state).toContain('y = x² - 4x + 1');
    expect(state).toContain('2 + √3');
    expect(state).toContain('vertex (2, -3)');
    expect(state).toContain('discriminant 12');
    expect(state).toContain(`Factoring is not offered`);
  });

  test('bookkeeping stays out of the state', async () => {
    const table = await working();
    expect(boardState(table.view())).not.toMatch(/last_action|reveal_step|set_method/);
  });
});

describe('events', () => {
  test('a spoken request gets no event: the avatar answered it from the state', async () => {
    const table = await working();
    table.press({ kind: 'reveal_step' });
    for (const action of ['reveal', 'back', 'reveal_all', 'method', 'graph', 'clear'] as const) {
      expect(eventFor({ ...table.view(), last_action: action }, 'spoken')).toBeUndefined();
    }
  });

  test('a button is narrated, except the graph and the wipe, which speak for themselves', async () => {
    const table = await working();
    table.press({ kind: 'reveal_step' });
    const view = table.view();
    expect(eventFor(view, 'button')).toContain(view.steps[0].say);
    expect(eventFor({ ...view, last_action: 'graph' }, 'button')).toBeUndefined();
    expect(eventFor({ ...view, last_action: 'clear' }, 'button')).toBeUndefined();
    expect(eventFor({ ...view, last_action: 'graph' }, 'typed')).toContain('Acknowledge');
  });

  test('refusals: typed are said, buttons are shown, spoken only for an equation', () => {
    expect(refusalEvent('Nope.', 'typed', 'reveal_step')).toContain('Nope.');
    expect(refusalEvent('Nope.', 'button', 'reveal_step')).toBeUndefined();
    expect(refusalEvent('Nope.', 'spoken', 'reveal_step')).toBeUndefined();
    expect(refusalEvent('Nope.', 'spoken', 'set_equation')).toContain('Nope.');
  });

  test('show-all says the answer exactly, not in decimals', async () => {
    const table = await working('quadratic_formula', 'x^2 - 4x + 1');
    table.press({ kind: 'reveal_all' });
    expect(say.revealAll(table.view())).toContain('x = 2 + √3 or x = 2 - √3');
  });

  test('the opening greets in one line and teaches nothing', () => {
    expect(say.start()).toContain('ONE short line');
    expect(say.start()).toContain('Do not teach');
  });

  test('the notes name no character: the avatar keeps its own', () => {
    // From the original's persona test: an app that ALSO names someone is
    // asserting who is on screen, and every app that did was caught out.
    for (const banned of ['Mrs.', 'Mr.', 'Professor', 'Dr.', 'your name is', 'You are called']) {
      for (const note of NOTES) expect(note).not.toContain(banned);
    }
  });

  test('the notes keep the hard-won rules', () => {
    const all = NOTES.join('\n');
    expect(all).toContain('never turn 2 + √3 into a decimal');
    expect(all).toContain('Never describe, hint at or work ahead to a line that is not up');
    expect(all).toContain('never needs the board cleared or the equation put up again');
    expect(all).toContain('If nothing was asked of you, say nothing');
  });
});
