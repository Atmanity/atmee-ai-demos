// The reducer, the requests and the narration: the wired-up half. Ported from
// the original `tests/test_table.py`, which drove the tool bodies and the
// narrator; here the same requests arrive as buttons, typed lines and speech.
import { describe, expect, test, vi } from 'vitest';
import { ALREADY_CLEAR, AT_LAST_STEP, NO_EQUATION, NO_METHOD, NOT_A_QUADRATIC } from './board.ts';
import { UNREADABLE } from './director.ts';
import { NOT_FACTORABLE } from './methods.ts';
import { BAD_NUMBER, Table, UNREADABLE_BOX, type Ask } from './table.ts';

const PUT_UP = 'put up x squared minus four x plus three';

async function posed(equation = PUT_UP) {
  const table = new Table();
  await table.hear(equation, 'spoken');
  return table;
}

async function working(method = 'factoring', equation = PUT_UP) {
  const table = await posed(equation);
  table.press({ kind: 'set_method', method });
  return table;
}

const never: Ask = () => {
  throw new Error('the model was asked');
};

describe('intents', () => {
  test('a panel button and a spoken line go through the same door', async () => {
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

describe('requests in words (the original tools)', () => {
  test('every request returns the refusal sentence rather than swallowing it', async () => {
    // A refusal the teacher never hears is the worst failure: the avatar
    // confidently narrating something that is not on the board.
    const table = new Table();
    for (const [line, reason] of [['next', NO_EQUATION], ['clear the board', ALREADY_CLEAR], ['show the graph', 'Nothing to graph yet.']]) {
      const outcome = await table.hear(line, 'typed');
      expect(outcome.message, line).toBe(reason);
      expect(outcome.event, line).toContain(reason);
    }
    await table.hear(PUT_UP, 'typed');
    expect((await table.hear('next', 'typed')).event).toContain(NO_METHOD);
  });

  test('putting a linear equation up is refused out loud', async () => {
    const outcome = await new Table().hear('put up 2x plus 3', 'spoken');
    expect(outcome.event).toContain(NOT_A_QUADRATIC);
    expect(outcome.event).toContain('refused');
  });

  test('factoring an unfactorable quadratic is refused out loud', async () => {
    const table = await posed('put up x squared minus four x plus one');
    expect((await table.hear('factor it', 'typed')).event).toContain(NOT_FACTORABLE);
  });

  test('choosing a method does not reveal anything', async () => {
    // The teacher reveals; setting up must not jump the gun.
    const table = await posed();
    const outcome = await table.hear("let's complete the square", 'typed');
    expect(table.board.revealed).toBe(0);
    expect(outcome.event).toContain('none revealed');
  });

  test('the next-line event carries the exact words of the step', async () => {
    // The avatar must narrate the line the board just showed, not a paraphrase it composed.
    const table = await working('completing_square');
    const outcome = await table.hear('next', 'typed');
    expect(outcome.event).toContain(table.board.currentStep()!.say);
  });

  test('the next-line event names the line and nothing after it', async () => {
    const table = await working('factoring');
    const outcome = await table.hear('next', 'typed');
    expect(outcome.event).toContain('line 1 of 6');
    for (const step of table.board.derivation().slice(1)) expect(outcome.event).not.toContain(step.say);
  });

  test('the last line says it is the last', async () => {
    const table = await working('factoring');
    let event = '';
    for (let i = 0; i < 20 && !event.includes('last line'); i += 1) event = (await table.hear('next', 'typed')).event ?? '';
    expect(event).toContain('That was the last line.');
    expect((await table.hear('next', 'typed')).event).toContain(AT_LAST_STEP);
  });

  test('going back to blank tells the avatar not to repeat the lines', async () => {
    const table = await working('factoring');
    await table.hear('next', 'typed');
    const outcome = await table.hear('go back', 'typed');
    expect(outcome.event).toContain('back to blank');
    expect(outcome.event).toContain('Do not repeat');
  });

  test('show all gives the answer in exact values', async () => {
    const table = await working('formula', 'put up x squared minus four x plus one');
    const outcome = await table.hear('show it all', 'typed');
    expect(outcome.event).toContain('2 + √3');
    expect(outcome.event).toContain('2 - √3');
    expect(outcome.event).toContain('not decimals');
  });

  test('hiding the graph works and is acknowledged briefly', async () => {
    const table = await posed();
    const outcome = await table.hear('hide the graph', 'typed');
    expect(table.board.snapshot().graph_visible).toBe(false);
    expect(outcome.event).toContain('hidden');
  });

  test('the equation read-back offers only the methods that work', async () => {
    const outcome = await new Table().hear('put up x squared minus four x plus one', 'spoken');
    expect(outcome.event).not.toContain('factoring');
    expect(outcome.event).toContain('completing the square');
    expect(outcome.event).toContain('the quadratic formula');
    expect(outcome.event).toContain('heard right');
  });

  test('an equation and a method in one breath are both applied, and read back together', async () => {
    const table = new Table();
    const outcome = await table.hear('put up x squared minus five x plus six and factor it', 'spoken');
    expect(table.board.snapshot().method).toBe('factoring');
    expect(outcome.event).toContain('y = x² - 5x + 6');
    expect(outcome.event).toContain('set up for factoring');
  });
});

describe('the panel has a voice (the original narrator)', () => {
  test('a panel tap gets the line read out', async () => {
    // The buttons are the fallback for saying "next". A fallback that puts the
    // line up in silence has dropped the narration the teacher delegated.
    const table = await working('factoring');
    const outcome = table.press({ kind: 'reveal_step' });
    expect(outcome.event).toContain(table.board.currentStep()!.say);
    expect(outcome.event).toContain('themselves');
  });

  test('the narration says nothing for a change that speaks for itself', async () => {
    // An avatar announcing every button press is an avatar talking over a lesson.
    const table = await posed();
    expect(table.press({ kind: 'set_graph', visible: false }).event).toBeUndefined();
    expect(table.press({ kind: 'clear_board' }).event).toBeUndefined();
  });

  test('the narration never reads a line that is still hidden', async () => {
    const table = await working('factoring');
    const hidden = table.board.derivation().slice(1).map((step) => step.say);
    const outcome = table.press({ kind: 'reveal_step' });
    for (const line of hidden) expect(outcome.event).not.toContain(line);
  });

  test('a refused button is shown on the panel and not narrated', async () => {
    const table = await posed();
    const outcome = table.press({ kind: 'reveal_step' });
    expect(outcome.message).toBe(NO_METHOD);
    expect(outcome.event).toBeUndefined();
  });
});

describe('"next" never needs the model (the original AdvanceWatch)', () => {
  test('a bare spoken next puts the line up without asking the model', async () => {
    const table = await working('factoring');
    const outcome = await table.hear('next', 'spoken', never);
    expect(table.board.revealed).toBe(1);
    expect(outcome.handled).toBe(true);
  });

  test('a spoken next sends no event: the avatar already read the staged line', async () => {
    // The avatar answers "next" before the app hears it, from the state; an
    // event would make it read the line twice.
    const table = await working('factoring');
    const staged = table.view().next!.say;
    expect(staged).toBe(table.board.derivation()[0].say);
    const outcome = await table.hear('next', 'spoken');
    expect(outcome.event).toBeUndefined();
  });

  test('one next advances one line; saying it again advances again', async () => {
    const table = await working('factoring');
    await table.hear('next', 'spoken');
    expect(table.board.revealed).toBe(1);
    await table.hear('Next.', 'spoken');
    expect(table.board.revealed).toBe(2);
  });

  test('a line that is not a request leaves the board alone', async () => {
    const table = await working('factoring');
    await table.hear('next', 'spoken');
    const outcome = await table.hear('what do you think of this one?', 'spoken', never);
    expect(outcome.handled).toBe(false);
    expect(table.board.revealed).toBe(1);
  });

  test('a next with no method is refused on the panel; the avatar has the refusal in its state', async () => {
    const table = await posed();
    const outcome = await table.hear('next', 'spoken');
    expect(table.board.revealed).toBe(0);
    expect(outcome.message).toBe(NO_METHOD);
    expect(outcome.event).toBeUndefined();
  });

  test('a next at the end is refused the same way', async () => {
    const table = await working('factoring');
    table.press({ kind: 'reveal_all' });
    const outcome = await table.hear('next', 'spoken');
    expect(outcome.message).toBe(AT_LAST_STEP);
    expect(outcome.event).toBeUndefined();
  });
});

describe('the model fallback', () => {
  test('a line the rules cannot place goes to the model, with the board as context', async () => {
    const table = await posed();
    const ask = vi.fn<Ask>(async () => ({ actions: [{ action: 'put_equation', a: '1', b: '-4', c: '5' }] }));
    const outcome = await table.hear('change c to five', 'spoken', ask);
    expect(ask).toHaveBeenCalledOnce();
    expect(ask.mock.calls[0][0]).toContain('y = x² - 4x + 3');
    expect(table.board.snapshot().equation!.display).toBe('y = x² - 4x + 5');
    expect(outcome.event).toContain('y = x² - 4x + 5');
  });

  test('maths the rules cannot read is asked of the model', async () => {
    const ask = vi.fn<Ask>(async () => ({ actions: [{ action: 'put_equation', a: '1', b: '1', c: '-6' }] }));
    const table = new Table();
    await table.hear('put up (x - 2)(x + 3)', 'spoken', ask);
    expect(table.board.snapshot().equation!.display).toBe('y = x² + x - 6');
  });

  test('an equation neither the rules nor the model can read asks the teacher again', async () => {
    const table = new Table();
    const outcome = await table.hear('put up x squared five x plus six', 'spoken', async () => ({ actions: [{ action: 'put_equation', a: 'one', b: '', c: '' }] }));
    expect(outcome.message).toBe(UNREADABLE);
    expect(outcome.event).toContain('could not read');
    expect(table.board.isEmpty).toBe(true);
  });

  test('without a model, an unreadable equation still gets an answer', async () => {
    const outcome = await new Table().hear('x squared five x plus six', 'spoken');
    expect(outcome.handled).toBe(true);
    expect(outcome.message).toBe(UNREADABLE);
  });

  test('a model that fails leaves the rules\' reading standing', async () => {
    const table = await posed();
    const outcome = await table.hear('could we swap to the other method', 'typed', never);
    expect(outcome.handled).toBe(false);
  });

  test('a question goes to the avatar, and costs no model call', async () => {
    const table = await posed();
    const outcome = await table.hear("What's the discriminant?", 'typed', never);
    expect(outcome.handled).toBe(false);
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
    const ask = vi.fn<Ask>(async () => ({ actions: [{ action: 'put_equation', a: '2', b: '-8', c: '0' }] }));
    await table.enter('2x(x - 4)', ask);
    expect(ask.mock.calls[0][0]).toContain('equation box');
    expect(table.board.snapshot().equation!.display).toBe('y = 2x² - 8x');
  });

  test('what cannot be read is said on the panel, and the avatar is not told', async () => {
    const outcome = await new Table().enter('hello');
    expect(outcome.message).toBe(UNREADABLE_BOX);
    expect(outcome.event).toBeUndefined();
  });

  test('a linear entry is refused with the board\'s sentence', async () => {
    expect((await new Table().enter('2x + 3')).message).toBe(NOT_A_QUADRATIC);
  });
});
