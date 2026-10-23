// What the host is told: within the API's limits, and never a line of working
// before the board puts it up.
import { describe, expect, test } from 'vitest';
import { boardState, eventFor, INSTRUCTIONS, said, TOOLS } from './director.ts';
import { Table } from './table.ts';
import type { MethodId } from './types.ts';

const LIMIT_STATE = 3858;

async function working(method: MethodId = 'factoring', equation = 'x^2 - 4x + 3') {
  const table = new Table();
  await table.enter(equation);
  table.press({ kind: 'set_method', method });
  return table;
}

describe('the API limits', () => {
  test('the tools fit: names, descriptions, schemas, all await', () => {
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

  test('the instructions fit and name every tool', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
    for (const tool of TOOLS) expect(INSTRUCTIONS).toContain(tool.name);
  });

  test('the busiest board still fits the state limit', () => {
    // The longest derivation this app can write: fractional coefficients (every
    // line carries denominators), a leading coefficient to divide out, all
    // revealed. (The original's envelope test used the same quadratic.)
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

describe('the instructions keep the hard-won rules', () => {
  test.each([
    'never turn 2 + √3 into a decimal',
    'never work out, guess or describe a line yourself',
    'it never needs the board cleared or the equation put up again',
    'If nothing was asked of you, say nothing',
    'never re-read one you already read',
    'The board changes only when you call one of its tools',
    'Call the tool every time',
    'answer from the live board in your context, with no tool',
    'only when the teacher asks for it',
  ])('%s', (rule) => {
    expect(INSTRUCTIONS).toContain(rule);
  });

  test('they name no character: the host keeps its own', () => {
    // From the original's persona test: an app that ALSO names someone is
    // asserting who is on screen, and every app that did was caught out.
    for (const banned of ['Ada', 'Mrs.', 'Mr.', 'Professor', 'Dr.', 'your name is', 'You are called']) expect(INSTRUCTIONS).not.toContain(banned);
  });

  test('the resetting tool says it is for the teacher to ask', () => {
    expect(TOOLS.find((t) => t.name === 'clear_board')!.description).toContain('Only when the teacher asks');
  });
});

describe('nothing ahead of the reveal', () => {
  test('no unrevealed line is in the state or the view, by any method, at any point', async () => {
    // The marked-deck failure, in this app: the host narrating step six while
    // the room is looking at step two, or a student reading it in devtools.
    for (const method of ['factoring', 'completing_square', 'quadratic_formula'] as const) {
      for (const equation of ['x^2 - 4x + 3', 'x^2 - 4x + 1', '2x^2 + 3x + 5']) {
        const table = new Table();
        await table.enter(equation);
        if (table.press({ kind: 'set_method', method }).message) continue; // factoring declined
        const lines = table.board.derivation();
        for (let revealed = 0; revealed <= lines.length; revealed += 1) {
          const state = boardState(table.view());
          const view = JSON.stringify(table.view());
          const shown = new Set(lines.slice(0, revealed).flatMap((s) => [s.working, s.say]));
          for (const later of lines.slice(revealed)) {
            expect(state, `${method} ${equation} after ${revealed}: ${later.say}`).not.toContain(later.say);
            expect(view, `${method} ${equation} after ${revealed}: ${later.say}`).not.toContain(later.say);
            // A board line can repeat what is already public (line 1 is the equation set to zero).
            if (shown.has(later.working) || later.working === table.board.equation!.zeroForm) continue;
            expect(state, `${method} ${equation} after ${revealed}: ${later.working}`).not.toContain(later.working);
            expect(view, `${method} ${equation} after ${revealed}: ${later.working}`).not.toContain(JSON.stringify(later.working));
          }
          if (revealed < lines.length) table.press({ kind: 'reveal_step' });
        }
      }
    }
  });

  test('the state says how many lines are to come, and that only next_line knows them', async () => {
    const table = await working();
    const state = boardState(table.view());
    expect(state).toContain('6 more lines are still to come');
    expect(state).toContain('only next_line puts the next one up');
  });

  test('the answer is in the state only once every line is up', async () => {
    const table = await working();
    expect(boardState(table.view())).not.toContain('x = 3 or x = 1');
    table.press({ kind: 'reveal_all' });
    expect(boardState(table.view())).toContain('the answer, x = 3 or x = 1, is boxed on the board');
  });

  test('the state carries the equation and the exact facts', async () => {
    // What a teacher asks mid-lesson, and what the host must not get wrong.
    const table = new Table();
    await table.enter('x^2 - 4x + 1');
    const state = boardState(table.view());
    expect(state).toContain('y = x² - 4x + 1');
    expect(state).toContain('2 + √3');
    expect(state).toContain('vertex (2, -3)');
    expect(state).toContain('discriminant 12');
    expect(state).toContain('No method is chosen yet');
    expect(state).toContain('Factoring is not offered');
  });

  test('bookkeeping stays out of the state', async () => {
    const table = await working();
    expect(boardState(table.view())).not.toMatch(/last_action|reveal_step|set_method|seq/);
  });
});

describe('results and events', () => {
  test('the next-line result carries the exact line, its place, and nothing after it', async () => {
    const table = await working();
    const { result } = await table.tool('next_line', {});
    const [first, ...rest] = table.board.derivation();
    expect(result).toContain('Line 1 of 6');
    expect(result).toContain(first.working);
    expect(result).toContain(first.say);
    expect(result).toContain('5 more to come; wait to be asked');
    for (const later of rest) expect(result).not.toContain(later.say);
  });

  test('show-all says the answer exactly, not in decimals', async () => {
    const table = await working('quadratic_formula', 'x^2 - 4x + 1');
    table.press({ kind: 'reveal_all' });
    expect(said.revealAll(table.view())).toContain('x = 2 + √3 or x = 2 - √3');
    expect(said.revealAll(table.view())).toContain('not decimals');
  });

  test('the opening greets in one line and teaches nothing', () => {
    expect(said.start()).toContain('ONE short line');
    expect(said.start()).toContain('Do not teach');
  });

  test('calling back describes the board as the teacher left it, and reads no working', async () => {
    const table = await working();
    await table.tool('next_line', {});
    const text = said.resume(table.view());
    expect(text).toContain('y = x² - 4x + 3, factoring, 1 of 6 lines up');
    expect(text).toContain('Do not read any working');
    expect(said.resume(new Table().view())).toBe(said.start());
  });

  test('a key is narrated, except the graph and the wipe, which speak for themselves', async () => {
    const table = await working();
    const outcome = table.press({ kind: 'reveal_step' });
    expect(outcome.event).toContain(table.view().steps[0].say);
    expect(outcome.event).toContain('themselves');
    expect(eventFor({ ...table.view(), last_action: 'graph' })).toBeUndefined();
    expect(eventFor({ ...table.view(), last_action: 'clear' })).toBeUndefined();
  });

  test('no result asks the host to act on its own', async () => {
    // Live on Postmark, "offer a new game" made the host start one itself.
    const table = await working();
    const texts = [said.start(), said.clear(), said.method(table.view()), (await table.tool('next_line', {})).result];
    for (const text of texts) expect(text).not.toMatch(/\b(call|start solving|reveal the next)\b/i);
  });
});
