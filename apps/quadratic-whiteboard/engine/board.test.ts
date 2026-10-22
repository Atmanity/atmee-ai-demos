// The board's rules and its projection, ported from the original
// `tests/test_board.py`. Every refusal gets a test asserting the exact
// sentence: a refusal the teacher cannot act on is the same bug as no refusal,
// and rewording one silently is how that happens.
import { describe, expect, test } from 'vitest';
import {
  ALL_SHOWN, ALREADY_CLEAR, AT_FIRST_STEP, AT_LAST_STEP, Board, BoardRefusal, NO_EQUATION, NO_METHOD, NOT_A_QUADRATIC,
  NOTHING_TO_GRAPH, TOO_BIG, UNKNOWN_METHOD,
} from './board.ts';
import { q } from './fraction.ts';
import { NOT_FACTORABLE } from './methods.ts';
import type { MethodId } from './types.ts';

function posed(a = 1, b = -4, c = 3): Board {
  const board = new Board();
  board.setEquation(q(a), q(b), q(c));
  return board;
}

function working(method: MethodId = 'completing_square', a = 1, b = -4, c = 3): Board {
  const board = posed(a, b, c);
  board.setMethod(method);
  return board;
}

function refusal(act: () => void): string {
  try {
    act();
  } catch (err) {
    if (err instanceof BoardRefusal) return err.reason;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('refusals', () => {
  test('a linear equation is refused by name', () => {
    expect(refusal(() => new Board().setEquation(q(0), q(2), q(3)))).toBe(NOT_A_QUADRATIC);
  });

  test('choosing a method on an empty board says so', () => {
    expect(refusal(() => new Board().setMethod('factoring'))).toBe(NO_EQUATION);
  });

  test('an unknown method lists the three that exist', () => {
    expect(refusal(() => posed().setMethod(null))).toBe(UNKNOWN_METHOD);
  });

  test('factoring an unfactorable quadratic suggests the two that work', () => {
    expect(refusal(() => posed(1, -4, 1).setMethod('factoring'))).toBe(NOT_FACTORABLE);
  });

  test('revealing before a method is chosen says to pick one', () => {
    expect(refusal(() => posed().revealStep())).toBe(NO_METHOD);
  });

  test('revealing past the end says it is the last step', () => {
    const board = working();
    while (board.snapshot().remaining) board.revealStep();
    expect(refusal(() => board.revealStep())).toBe(AT_LAST_STEP);
  });

  test('going back from the start says so', () => {
    expect(refusal(() => working().backStep())).toBe(AT_FIRST_STEP);
  });

  test('revealing everything twice is refused', () => {
    const board = working();
    board.revealAll();
    expect(refusal(() => board.revealAll())).toBe(ALL_SHOWN);
  });

  test('graphing an empty board says there is nothing to graph', () => {
    expect(refusal(() => new Board().setGraph(true))).toBe(NOTHING_TO_GRAPH);
  });

  test('clearing an empty board is refused', () => {
    expect(refusal(() => new Board().clear())).toBe(ALREADY_CLEAR);
  });

  test('showing a graph that is already up is not a refusal', () => {
    // Correcting a teacher in front of a class over a no-op.
    const board = posed();
    board.setGraph(true);
    board.setGraph(true);
    expect(board.snapshot().graph_visible).toBe(true);
  });

  test('numbers too big to work with exactly are refused, not left to stall the server', () => {
    // New in the port: the surd's trial division runs on a shared server.
    expect(refusal(() => new Board().setEquation(q(1), q(123456789), q(1)))).toBe(TOO_BIG);
    expect(() => posed(1, -100, 2400)).not.toThrow();
  });
});

describe('reveal is one by one', () => {
  test('the snapshot carries only what has been revealed', () => {
    // The whole point of the app: the class cannot read ahead, and neither can the avatar.
    const board = working();
    const total = board.snapshot().total_steps;
    board.revealStep();
    board.revealStep();
    const snapshot = board.snapshot();
    expect(snapshot.steps).toHaveLength(2);
    expect(snapshot.revealed).toBe(2);
    expect(snapshot.remaining).toBe(total - 2);
  });

  test('no unrevealed working appears anywhere in the snapshot', () => {
    // Serialised and searched, because a leak through some other key is exactly the leak nobody notices.
    const board = working();
    const hidden = board.derivation().slice(1).map((step) => step.working);
    board.revealStep();
    const blob = JSON.stringify(board.snapshot());
    for (const line of hidden) expect(blob).not.toContain(line);
  });

  test('the answer is not on the board until the last line is revealed', () => {
    const board = working();
    board.revealStep();
    expect(JSON.stringify(board.snapshot())).not.toContain('x = 3 or x = 1');
  });

  test('going back takes the line off the board', () => {
    const board = working();
    board.revealStep();
    board.revealStep();
    board.backStep();
    expect(board.snapshot().revealed).toBe(1);
    expect(board.snapshot().steps).toHaveLength(1);
  });

  test('a new equation clears the working it does not match', () => {
    // Working carried over from the previous equation contradicts the line above it.
    const board = working();
    board.revealStep();
    board.setEquation(q(1), q(0), q(-9));
    const snapshot = board.snapshot();
    expect(snapshot.method).toBeNull();
    expect(snapshot.steps).toEqual([]);
    expect(snapshot.total_steps).toBe(0);
  });

  test('a new equation leaves a hidden graph hidden', () => {
    // A teacher working algebraically does not want the curve back every time they change the question.
    const board = posed();
    board.setGraph(false);
    board.setEquation(q(1), q(0), q(-9));
    expect(board.snapshot().graph_visible).toBe(false);
  });

  test('the next step is the one the next reveal puts up, and only that one', () => {
    // New in the port: the line staged for the avatar.
    const board = working();
    const lines = board.derivation();
    expect(board.nextStep()).toBe(lines[0]);
    expect(board.revealStep()).toBe(lines[0]);
    expect(board.nextStep()).toBe(lines[1]);
    board.revealAll();
    expect(board.nextStep()).toBeNull();
    expect(posed().nextStep()).toBeNull();
  });
});

describe('the view', () => {
  test('an empty board still projects every key', () => {
    // A page that has to null-check each field separately grows a bug per field.
    const empty = new Board().snapshot();
    expect(Object.keys(empty).sort()).toEqual(Object.keys(posed().snapshot()).sort());
    expect(empty.phase).toBe('empty');
  });

  test('the facts are exact, not decimal', () => {
    const facts = posed().snapshot().facts!;
    expect(facts.roots).toEqual(['3', '1']);
    expect(facts.vertex_display).toBe('(2, -1)');
    expect(facts.discriminant).toBe('4');
    expect(facts.opens).toBe('upward');
  });

  test('a curve with no real roots reports no crossings', () => {
    // An empty list is what the picture shows; two crossings would be a lie.
    expect(posed(1, 2, 5).snapshot().facts!.crossings).toEqual([]);
  });

  test('the view window frames the roots rather than a fixed range', () => {
    // Roots at 40 and 60 on a -10..10 window is an empty graph, and the page has no engine to notice.
    const view = posed(1, -100, 2400).snapshot().facts!.view;
    expect(view.x_min).toBeLessThan(40);
    expect(view.x_max).toBeGreaterThan(60);
  });

  test('the view window never collapses on a repeated root', () => {
    const view = posed(1, -4, 4).snapshot().facts!.view;
    expect(view.x_max - view.x_min).toBeGreaterThanOrEqual(10);
  });

  test('only the methods that work are offered', () => {
    expect(posed(1, -4, 3).snapshot().methods_available).toEqual(['factoring', 'completing_square', 'quadratic_formula']);
    expect(posed(1, -4, 1).snapshot().methods_available).toEqual(['completing_square', 'quadratic_formula']);
  });
});
