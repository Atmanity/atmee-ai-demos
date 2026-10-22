// @vitest-environment jsdom
/**
 * The panel as a projection: snapshots in, one intent per gesture out,
 * nothing decided here. (Ported from the original StrokeTutorPanel.test.tsx;
 * its scripted fake agent became props and a spy.)
 *
 * What this pins is the page's half: render the server's state, send exactly
 * one `stroke` intent per gesture with the points in grid units and under the
 * cap, show a refusal from every branch, and never draw a stroke it was not given.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Intent, Snapshot } from '../engine/types.ts';
import { MAX_POINTS } from './ink.ts';
import { draw } from './live-draw.ts';
import { Loading, StrokeTutorPanel } from './StrokeTutorPanel.tsx';

// jsdom has no 2-D context; the canvas copes, but jsdom would log "not implemented" for every frame.
beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
afterEach(cleanup);

const CATALOG = [
  { id: 'ichi', glyph: '一', meaning: 'one', strokes_total: 1 },
  { id: 'ei', glyph: '永', meaning: 'eternity', strokes_total: 5 },
];

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    phase: 'writing',
    character: { id: 'juu', glyph: '十', meaning: 'ten', reading: 'jū', script: 'kanji', strokes_total: 2 },
    stroke_index: 1,
    strokes: [
      { index: 0, status: 'done', points: [[150, 450], [850, 450]], name: 'the horizontal', teach: 'The horizontal comes first.' },
      // The server withholds the live stroke's points: they are the answer.
      { index: 1, status: 'current', points: [] },
    ],
    attempts: 0,
    last_verdict: null,
    score: { correct: 1, total: 2 },
    grid: 1000,
    catalog: CATALOG,
    ...over,
  };
}

function setup(state: Snapshot | null = snapshot(), extra: { message?: string; pending?: boolean; disabled?: boolean } = {}) {
  const intents: Intent[] = [];
  const props = { state, pending: false, message: '', onIntent: (intent: Intent) => { intents.push(intent); }, ...extra };
  const view = render(<StrokeTutorPanel {...props} />);
  return { intents, rerender: (next: Partial<typeof props>) => view.rerender(<StrokeTutorPanel {...props} {...next} />) };
}

/** The canvas, with a size: jsdom gives every element a zero-size box. */
function board(): HTMLCanvasElement {
  const canvas = screen.getByRole('img', { name: 'Writing square' }) as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return canvas;
}

/**
 * One pointer event with real coordinates. jsdom has no `PointerEvent`, so
 * `fireEvent.pointerDown(el, { clientX })` builds a bare `Event` and the
 * coordinates are silently dropped; a `MouseEvent` carries them and React
 * dispatches on the event TYPE, not its class.
 */
function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(canvas, event);
}

describe('StrokeTutorPanel', () => {
  it('shows which stroke is live without saying what it is', () => {
    setup();
    expect(screen.getByText('Stroke 2 of 2 — draw it.')).toBeTruthy();
    // Nothing on screen describes the stroke being asked for.
    expect(screen.queryByText(/vertical/i)).toBeNull();
    expect(screen.queryByText(/top to bottom/i)).toBeNull();
  });

  it('sends one stroke intent per gesture, in grid units and under the point cap', () => {
    const { intents } = setup();
    // 400px box, grid 1000: the centre line, from y=100 down to y=900, in 300 pointer moves.
    draw([[500, 100], [500, 900]], { canvas: board(), samples: 300 });
    expect(intents.length).toBe(1);
    const intent = intents[0] as { kind: string; points: [number, number][] };
    expect(intent.kind).toBe('stroke');
    expect(intent.points.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(intent.points[0]).toEqual([500, 100]);
    expect(intent.points[intent.points.length - 1]).toEqual([500, 900]);
  });

  it('does not send a tap, which would cost the learner an attempt they never made', () => {
    const { intents } = setup();
    const canvas = board();
    pointer(canvas, 'pointerdown', 200, 200);
    pointer(canvas, 'pointermove', 201, 201);
    pointer(canvas, 'pointerup', 201, 201);
    expect(intents).toEqual([]);
  });

  it('draws nothing while the board is between strokes', () => {
    const { intents } = setup(snapshot({ phase: 'coaching' }));
    expect(screen.getByText(/done\. Say next/)).toBeTruthy();
    draw([[500, 100], [500, 900]], { canvas: board() });
    expect(intents).toEqual([]);
  });

  it('draws nothing, and presses nothing, while no session is running', () => {
    const { intents } = setup(snapshot(), { disabled: true });
    draw([[500, 100], [500, 900]], { canvas: board() });
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(intents).toEqual([]);
  });

  it('shows a refusal instead of pretending the intent landed', () => {
    const { intents, rerender } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Next stroke' }));
    expect(intents[0]).toEqual({ kind: 'next_stroke' });
    rerender({ message: 'Finish this stroke first.' });
    expect(screen.getByText('Finish this stroke first.')).toBeTruthy();
  });

  it('renders a refusal from the pre-lesson branch too, not only once state has arrived', () => {
    // The bug this prevents, which the original shipped once: a refusal
    // stranded behind an early return.
    render(<Loading refusal={<p className="st-message">Finish this stroke first.</p>} />);
    expect(screen.getByText('Inking the brush…')).toBeTruthy();
    expect(screen.getByText('Finish this stroke first.')).toBeTruthy();
  });

  it('waits for the first snapshot rather than drawing an empty board', () => {
    setup(null, { message: '' });
    expect(screen.getByText('Inking the brush…')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Writing square' })).toBeNull();
  });

  it('asks to be shown a stroke, to clear, and to advance, with no rules of its own', () => {
    const { intents } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next character' }));
    expect(intents).toEqual([{ kind: 'reveal' }, { kind: 'clear_attempt' }, { kind: 'next_character' }]);
  });

  it('starts a character from the menu', () => {
    const { intents } = setup(snapshot({ phase: 'intro', character: null, stroke_index: 0, strokes: [], score: { correct: 0, total: 0 } }));
    fireEvent.click(screen.getByRole('button', { name: /eternity/ }));
    expect(intents).toEqual([{ kind: 'start_character', id: 'ei' }]);
  });

  it('renders the verdict the server handed it, tagged by kind', () => {
    setup(snapshot({ last_verdict: { ok: false, kind: 'direction', note: 'Verticals travel top to bottom — start at the top.' }, attempts: 1 }));
    expect(screen.getByText('Wrong direction')).toBeTruthy();
    expect(screen.getByText('Verticals travel top to bottom — start at the top.')).toBeTruthy();
  });

  it('says when a stroke was shown after two misses rather than on request', () => {
    const shown = { ok: false, kind: 'reveal', note: 'The vertical, top to bottom.', revealed: true } as const;
    const { rerender } = setup(snapshot({ phase: 'coaching', last_verdict: shown, attempts: 0 }));
    expect(screen.getByText('Shown to you')).toBeTruthy();
    rerender({ state: snapshot({ phase: 'coaching', last_verdict: shown, attempts: 2 }) });
    expect(screen.getByText('Missed twice, shown')).toBeTruthy();
  });

  it('shows the debrief and the menu when the character is finished', () => {
    const { rerender } = setup();
    rerender({ state: snapshot({ phase: 'debrief', stroke_index: 2 }) });
    expect(screen.getByText(/Finished — 1 of 2 first time/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /eternity/ })).toBeTruthy();
  });

  it('counts one stroke as a stroke', () => {
    // 一 has exactly one, and "1 strokes" on the very first card a learner
    // sees is a small thing that reads as carelessness.
    setup(snapshot({ phase: 'intro', character: null, stroke_index: 0, strokes: [], score: { correct: 0, total: 0 } }));
    expect(screen.getByText(/^1 stroke$/)).toBeTruthy();
    expect(screen.queryByText(/^1 strokes$/)).toBeNull();
  });
});

describe('a number that does not say what it counts', () => {
  // The symptom: the corner read "1 of 2" three lines above "Stroke 2 of 2",
  // and nothing on screen distinguished them.
  it('says what the fraction counts, on screen and not only to a screen reader', () => {
    setup();
    expect(screen.getByText('right first try')).toBeTruthy();
  });
});

describe('no way back to the character list', () => {
  // The symptom: mid-character the only exit was "Next character", which
  // walks forwards through the teaching order.
  it('offers every character as a switch while writing, and it is one intent', () => {
    const { intents } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Switch to eternity/ }));
    expect(intents).toEqual([{ kind: 'start_character', id: 'ei' }]);
  });

  it('does not offer a switch to the character already on the board', () => {
    setup(snapshot({ character: { id: 'ei', glyph: '永', meaning: 'eternity', reading: 'ei', script: 'kanji', strokes_total: 5 } }));
    const chip = screen.getByRole('button', { name: /Switch to eternity/ }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
  });
});

describe('the live-test drawing helper', () => {
  it('follows a corner, so a shoulder drawn by the helper keeps its turn', () => {
    const onIntent = vi.fn();
    render(<StrokeTutorPanel state={snapshot()} pending={false} message="" onIntent={onIntent} />);
    draw([[270, 275], [510, 252], [462, 380]], { canvas: board(), samples: 120 });
    const points = onIntent.mock.calls[0][0].points as [number, number][];
    expect(points.some(([x, y]) => Math.abs(x - 510) < 12 && Math.abs(y - 252) < 12)).toBe(true);
  });
});
