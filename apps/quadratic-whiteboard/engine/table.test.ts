// The reducer, the host's tools, the keys and the equation box: the wired-up
// half. Ported from the original `tests/test_table.py`, which drove the tool
// bodies and the narrator; here the same requests arrive as tool calls (the
// host's), intents (the keys) and text (the box).
import { describe, expect, test, vi } from 'vitest';
import { ALL_SHOWN, ALREADY_CLEAR, AT_FIRST_STEP, AT_LAST_STEP, NO_EQUATION, NO_METHOD, NOT_A_QUADRATIC, NOTHING_TO_GRAPH, UNKNOWN_METHOD } from './board.ts';
import { UNREADABLE } from './director.ts';
import { NOT_FACTORABLE } from './methods.ts';
import { BAD_NUMBER, Table, UNREADABLE_BOX, type Ask } from './table.ts';

const SPOKEN = 'x squared minus four x plus three';

async function posed(equation = SPOKEN) {
  const table = new Table();
  await table.tool('put_up_equation', { equation });
  return table;
}

async function working(method = 'factoring', equation = SPOKEN) {
  const table = await posed(equation);
  await table.tool('choose_method', { method });
  return table;
}

const never: Ask = () => {
  throw new Error('the model was asked');
};

describe('intents', () => {
  test('a key and a tool go through the same door', async () => {
    const table = await posed();
    const outcome = table.press({ kind: 'set_method', method: 'factoring' });
    expect(outcome.message).toBeUndefined();
    expect(table.board.snapshot().method).toBe('factoring');
  });

  test('an unknown intent is refused by name, not ignored', () => {
    // A typo in the page must be visible, not a silent no-op.
    const outcome = new Table().press({ kind: 'reveal_stpe' } as never);
    expect(outcome.message).toContain('reveal_stpe');
  });

  test('coefficients that are not numbers are refused', () => {
    expect(new Table().press({ kind: 'set_equation', a: 'one', b: 2, c: 3 }).message).toBe(BAD_NUMBER);
    expect(new Table().press({ kind: 'set_equation', a: true, b: 2, c: 3 }).message).toBe(BAD_NUMBER);
    expect(new Table().press({ kind: 'set_equation', a: Number.NaN, b: 2, c: 3 }).message).toBe(BAD_NUMBER);
  });

  test('a decimal coefficient stays exact through the reducer', () => {
    // 0.5 must be one half, not the binary float nearest to it.
    const table = new Table();
    table.press({ kind: 'set_equation', a: 0.5, b: 1, c: -4 });
    expect(table.board.snapshot().equation!.display).toBe('y = (1/2)x² + x - 4');
  });

  test('a refused intent leaves the board exactly as it was', async () => {
    // Validate-before-mutate: the class must not see a half-applied change.
    const table = await working();
    table.press({ kind: 'reveal_step' });
    const before = table.view();
    const outcome = table.press({ kind: 'set_equation', a: 0, b: 1, c: 2 });
    expect(outcome.message).toBe(NOT_A_QUADRATIC);
    expect(table.view()).toEqual(before);
  });

  test('every accepted change bumps the version; a refusal does not', async () => {
    // So the page can drop a reply that arrives after a newer one.
    const table = await working();
    const seq = table.view().seq;
    table.press({ kind: 'reveal_step' });
    expect(table.view().seq).toBe(seq + 1);
    table.press({ kind: 'back_step' });
    table.press({ kind: 'back_step' }); // refused: already at the start
    expect(table.view().seq).toBe(seq + 2);
  });
});

describe('put_up_equation', () => {
  test.each([
    [SPOKEN, 'y = x² - 4x + 3'],
    ['x^2 - 4x + 3', 'y = x² - 4x + 3'],
    ['2x² + 5', 'y = 2x² + 5'],
    ['1, -4, 3', 'y = x² - 4x + 3'],
    ['x squared equals five x minus six', 'y = x² - 5x + 6'],
    ['put up half x squared minus two', 'y = (1/2)x² - 2'],
    ['y = x^{2} - 4x + 3', 'y = x² - 4x + 3'],
    ['x² − 4x + 3 = 0', 'y = x² - 4x + 3'],
  ])('reads %j without a model', async (equation, display) => {
    const table = new Table();
    const { result, view } = await table.tool('put_up_equation', { equation }, never);
    expect(view.equation!.display).toBe(display);
    expect(result).toContain(`${display} is on the board`);
  });

  test('the result asks for a read-back and offers only the methods that work', async () => {
    const { result } = await new Table().tool('put_up_equation', { equation: 'x squared minus four x plus one' });
    expect(result).toContain('heard right');
    expect(result).not.toContain('factoring');
    expect(result).toContain('completing the square or the quadratic formula');
    expect(result).toContain('Do not start solving');
  });

  test('an equation and a method in one call are both applied, and read back together', async () => {
    const table = new Table();
    const { result } = await table.tool('put_up_equation', { equation: 'x squared minus five x plus six', method: 'factoring' });
    expect(table.board.snapshot().method).toBe('factoring');
    expect(result).toContain('y = x² - 5x + 6');
    expect(result).toContain('set up for factoring');
    expect(table.board.revealed).toBe(0);
  });

  test('a method that does not fit still leaves the equation up, and says why', async () => {
    const table = new Table();
    const outcome = await table.tool('put_up_equation', { equation: 'x squared minus four x plus one', method: 'factoring' });
    expect(table.board.snapshot().equation!.display).toBe('y = x² - 4x + 1');
    expect(table.board.method).toBeNull();
    expect(outcome.result).toContain(NOT_FACTORABLE);
    expect(outcome.message).toBe(NOT_FACTORABLE);
  });

  test('a linear equation is refused with the board\'s sentence', async () => {
    const outcome = await new Table().tool('put_up_equation', { equation: 'put up 2x plus 3' });
    expect(outcome.result).toContain(NOT_A_QUADRATIC);
    expect(outcome.result).toContain('do not claim anything happened');
    expect(outcome.message).toBe(NOT_A_QUADRATIC);
  });

  test('the same equation again changes nothing, so the class keeps its lines', async () => {
    // The safety net may put up what the host already did; a teacher may repeat themselves.
    const table = await working();
    await table.tool('next_line', {});
    const seq = table.view().seq;
    const { result } = await table.tool('put_up_equation', { equation: 'x^2 - 4x + 3' });
    expect(result).toContain('Already done: y = x² - 4x + 3 is on the board, so nothing changed');
    expect(table.board.revealed).toBe(1);
    expect(table.view().seq).toBe(seq);
  });

  test('the same equation with a new method switches method only', async () => {
    const table = await working();
    const { result } = await table.tool('put_up_equation', { equation: SPOKEN, method: 'quadratic_formula' });
    expect(table.board.method).toBe('quadratic_formula');
    expect(result).toContain('set up for the quadratic formula');
  });

  test('a new equation clears the working of the last one', async () => {
    const table = await working();
    await table.tool('next_line', {});
    await table.tool('put_up_equation', { equation: 'x squared minus nine' });
    expect(table.board.method).toBeNull();
    expect(table.board.revealed).toBe(0);
  });

  test('what the rules cannot read goes to the model, with the board as context', async () => {
    const table = await posed();
    const ask = vi.fn<Ask>(async () => ({ readable: true, a: '1', b: '-4', c: '5' }));
    const { result } = await table.tool('put_up_equation', { equation: 'change c to five' }, ask);
    expect(ask).toHaveBeenCalledOnce();
    expect(ask.mock.calls[0][0]).toContain('y = x² - 4x + 3');
    expect(ask.mock.calls[0][0]).toContain('"change c to five"');
    expect(table.board.snapshot().equation!.display).toBe('y = x² - 4x + 5');
    expect(result).toContain('y = x² - 4x + 5 is on the board');
  });

  test('brackets are expanded by the model', async () => {
    const table = new Table();
    await table.tool('put_up_equation', { equation: '(x - 2)(x + 3)' }, async () => ({ readable: true, a: '1', b: '1', c: '-6' }));
    expect(table.board.snapshot().equation!.display).toBe('y = x² + x - 6');
  });

  test('an equation nobody can read asks the teacher again, and nothing goes up', async () => {
    for (const ask of [undefined, never, (async () => ({ readable: false })) as Ask, (async () => ({ readable: true, a: 'one' })) as Ask]) {
      const table = new Table();
      const outcome = await table.tool('put_up_equation', { equation: 'x squared five x plus six' }, ask);
      expect(outcome.result).toContain('could not read "x squared five x plus six"');
      expect(outcome.result).toContain('Do not guess the numbers');
      expect(outcome.message).toBe(UNREADABLE);
      expect(table.board.isEmpty).toBe(true);
    }
  });

  test('an empty equation asks which one', async () => {
    expect((await new Table().tool('put_up_equation', { equation: '  ' })).result).toContain('which equation');
    expect((await new Table().tool('put_up_equation', {})).result).toContain('which equation');
  });

  test('extra fields are accepted, and a, b, c stand in for the words', async () => {
    const table = new Table();
    await table.tool('put_up_equation', { equation: 'x^2 - 9', note: 'from the teacher', confidence: 0.9 });
    expect(table.board.snapshot().equation!.display).toBe('y = x² - 9');
    await table.tool('put_up_equation', { a: 2, b: '-3', c: 1 });
    expect(table.board.snapshot().equation!.display).toBe('y = 2x² - 3x + 1');
    await table.tool('next_line', { please: true });
    await table.tool('choose_method', { method: 'Factoring', why: 'it factors' });
    expect(table.board.method).toBe('factoring');
  });

  test('a method word the board cannot place leaves the equation up, and the result asks for one', async () => {
    const table = new Table();
    const { result } = await table.tool('put_up_equation', { equation: 'x^2 - 5x + 6', method: 'the usual way' });
    expect(table.board.snapshot().equation!.display).toBe('y = x² - 5x + 6');
    expect(table.board.method).toBeNull();
    expect(result).toContain('ask which method they want');
  });

  test('a capitalised method named with the equation works', async () => {
    const table = new Table();
    await table.tool('put_up_equation', { equation: 'x^2 - 4x + 1', method: 'Quadratic Formula' });
    expect(table.board.method).toBe('quadratic_formula');
  });
});

describe('choose_method', () => {
  test('sets the working up without revealing any of it', async () => {
    // The teacher reveals; setting up must not jump the gun.
    const table = await posed();
    const { result } = await table.tool('choose_method', { method: 'completing_square' });
    expect(table.board.revealed).toBe(0);
    expect(result).toContain('none up yet');
    expect(result).toContain('Do not read or describe any of the working');
  });

  test('factoring an unfactorable quadratic is refused out loud and on the board', async () => {
    const table = await posed('x squared minus four x plus one');
    const outcome = await table.tool('choose_method', { method: 'factoring' });
    expect(outcome.result).toContain(NOT_FACTORABLE);
    expect(outcome.message).toBe(NOT_FACTORABLE);
  });

  test('the same method again keeps the lines up; a new one starts its own working', async () => {
    const table = await working();
    await table.tool('next_line', {});
    await table.tool('next_line', {});
    expect((await table.tool('choose_method', { method: 'factoring' })).result).toContain('Already done: the board is set up for factoring, with 2 of 6 lines up');
    expect(table.board.revealed).toBe(2);
    await table.tool('choose_method', { method: 'quadratic_formula' });
    expect(table.board.revealed).toBe(0);
  });

  test('no equation is refused; a word the board cannot place is asked about, and nothing changes', async () => {
    expect((await new Table().tool('choose_method', { method: 'factoring' })).message).toBe(NO_EQUATION);
    const table = await posed();
    const seq = table.view().seq;
    for (const method of ['guessing', '', undefined]) {
      const outcome = await table.tool('choose_method', { method });
      expect(outcome.result).toMatch(/^Not done: /);
      expect(outcome.result).toContain('Ask the teacher in one short line which they want: factoring, completing the square or the quadratic formula');
      expect(outcome.message).toBeUndefined();
    }
    expect(table.view().seq).toBe(seq);
    expect(UNKNOWN_METHOD).toContain('three methods');
  });

  test.each([
    ['Quadratic Formula', 'quadratic_formula'], ['the formula', 'quadratic_formula'], ['QUADRATIC_FORMULA', 'quadratic_formula'],
    ['Factorise', 'factoring'], ['by factoring', 'factoring'], ['Completing-the-square', 'completing_square'], ['complete the square', 'completing_square'],
  ])('a method in the teacher\'s words, %j, is %s', async (method, id) => {
    const table = await posed();
    const { result } = await table.tool('choose_method', { method });
    expect(table.board.method).toBe(id);
    expect(result).toMatch(/^Done: /);
  });
});

describe('next_line and the rest', () => {
  test('the next line carries the exact words of the step', async () => {
    // The host must narrate the line the board just showed, not a paraphrase it composed.
    const table = await working('completing_square');
    const { result } = await table.tool('next_line', {});
    expect(result).toContain(table.board.currentStep()!.say);
    expect(result).toContain(table.board.currentStep()!.working);
  });

  test('one call, one line', async () => {
    const table = await working();
    await table.tool('next_line', {});
    expect(table.board.revealed).toBe(1);
    await table.tool('next_line', {});
    expect(table.board.revealed).toBe(2);
  });

  test('the last line says it is the last, and the next is refused', async () => {
    const table = await working();
    let result = '';
    for (let i = 0; i < 6; i += 1) result = (await table.tool('next_line', {})).result;
    expect(result).toContain('That was the last line');
    const outcome = await table.tool('next_line', {});
    expect(outcome.message).toBe(AT_LAST_STEP);
    expect(outcome.result).toContain(AT_LAST_STEP);
  });

  test('every request returns the refusal sentence rather than swallowing it', async () => {
    // A refusal the teacher never hears is the worst failure: the host
    // confidently narrating something that is not on the board.
    const empty = new Table();
    for (const [name, reason] of [['next_line', NO_EQUATION], ['clear_board', ALREADY_CLEAR], ['show_graph', NOTHING_TO_GRAPH]] as const) {
      const outcome = await empty.tool(name, {});
      expect(outcome.message, name).toBe(reason);
      expect(outcome.result, name).toContain(reason);
    }
    expect((await (await posed()).tool('next_line', {})).message).toBe(NO_METHOD);
    expect((await (await working()).tool('previous_line', {})).message).toBe(AT_FIRST_STEP);
  });

  test('going back to blank tells the host not to repeat the lines', async () => {
    const table = await working();
    await table.tool('next_line', {});
    const { result } = await table.tool('previous_line', {});
    expect(table.board.revealed).toBe(0);
    expect(result).toContain('back to blank');
    expect(result).toContain('Do not repeat');
  });

  test('show all gives the answer in exact values, and only once', async () => {
    const table = await working('quadratic_formula', 'x squared minus four x plus one');
    const { result } = await table.tool('show_all_working', {});
    expect(result).toContain('2 + √3');
    expect(result).toContain('2 - √3');
    expect(result).toContain('not decimals');
    expect((await table.tool('show_all_working', {})).message).toBe(ALL_SHOWN);
  });

  test('the graph hides and shows, and saying it twice is not a refusal', async () => {
    const table = await posed();
    expect((await table.tool('hide_graph', {})).result).toContain('hidden');
    expect(table.board.snapshot().graph_visible).toBe(false);
    expect((await table.tool('hide_graph', {})).message).toBeUndefined();
    await table.tool('show_graph', {});
    expect(table.board.snapshot().graph_visible).toBe(true);
  });

  test('clearing wipes the board and does not mention what was on it', async () => {
    const table = await working();
    const { result } = await table.tool('clear_board', {});
    expect(table.board.isEmpty).toBe(true);
    expect(result).toContain('Do not refer to the equation you just wiped');
    expect(result).not.toContain('x²');
  });
});

describe('the keys have a voice (the original narrator)', () => {
  test('a tapped Next line gets the line read out', async () => {
    // The keys are the fallback for saying "next". A fallback that puts the
    // line up in silence has dropped the narration the teacher delegated.
    const table = await working();
    const outcome = table.press({ kind: 'reveal_step' });
    expect(outcome.event).toContain(table.board.currentStep()!.say);
    expect(outcome.event).toContain('themselves');
  });

  test('the narration says nothing for a change that speaks for itself', async () => {
    // A voice announcing every tap is a voice talking over a lesson.
    const table = await posed();
    expect(table.press({ kind: 'set_graph', visible: false }).event).toBeUndefined();
    expect(table.press({ kind: 'clear_board' }).event).toBeUndefined();
  });

  test('the narration never reads a line that is still hidden', async () => {
    const table = await working();
    const hidden = table.board.derivation().slice(1).map((step) => step.say);
    const outcome = table.press({ kind: 'reveal_step' });
    for (const line of hidden) expect(outcome.event).not.toContain(line);
  });

  test('a refused key is shown on the board and not narrated', async () => {
    const table = await posed();
    const outcome = table.press({ kind: 'reveal_step' });
    expect(outcome.message).toBe(NO_METHOD);
    expect(outcome.event).toBeUndefined();
  });
});

describe('the equation box', () => {
  test('takes typed maths, words, or a, b, c', async () => {
    const table = new Table();
    await table.enter('x^2 - 5x + 6');
    expect(table.board.snapshot().equation!.display).toBe('y = x² - 5x + 6');
    await table.enter('two x squared plus x minus one');
    expect(table.board.snapshot().equation!.display).toBe('y = 2x² + x - 1');
    await table.enter('1, -4, 3');
    expect(table.board.snapshot().equation!.display).toBe('y = x² - 4x + 3');
  });

  test('a typed equation is announced, not read back as if misheard', async () => {
    const outcome = await new Table().enter('x^2 - 4x + 3');
    expect(outcome.event).toContain('Say in one short line that it is up');
    expect(outcome.event).not.toContain('heard right');
  });

  test('brackets are expanded by the model', async () => {
    const table = new Table();
    const ask = vi.fn<Ask>(async () => ({ readable: true, a: '2', b: '-8', c: '0' }));
    await table.enter('2x(x - 4)', ask);
    expect(ask.mock.calls[0][0]).toContain('"2x(x - 4)"');
    expect(table.board.snapshot().equation!.display).toBe('y = 2x² - 8x');
  });

  test('what cannot be read is said on the board, and the host is not told', async () => {
    const outcome = await new Table().enter('hello');
    expect(outcome.message).toBe(UNREADABLE_BOX);
    expect(outcome.event).toBeUndefined();
  });

  test('a linear entry is refused with the board\'s sentence', async () => {
    expect((await new Table().enter('2x + 3')).message).toBe(NOT_A_QUADRATIC);
  });
});

describe('openings', () => {
  test('a new board opens empty; a resumed one describes itself', async () => {
    expect(new Table().open()).toContain('The board is clean and ready');
    const table = await working();
    expect(table.resume()).toContain('as they left it');
  });
});
