// @vitest-environment jsdom
/**
 * The desk as a projection: snapshots in, one command or one stroke per
 * gesture out, nothing decided here. (The original panel's tests, ported to
 * Hanshi's screens.) What this pins is the page's half: render the server's
 * sheet, send exactly one stroke per gesture in grid units and under the cap,
 * show a refusal, never describe a stroke it was not given, and speak to the
 * learner in the product's words.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Command, Snapshot } from '../engine/types.ts';
import { Finished, Lesson, Picker, verdictLabel } from './Desk.tsx';
import { MAX_POINTS, type GridPoint } from './ink.ts';
import { draw } from './live-draw.ts';
import { CHARACTERS } from '../engine/characters.ts';
import { Lobby, MENU } from './Lobby.tsx';
import { markKey, type Marks } from './marks.ts';

// jsdom has no 2-D context; the canvas copes, but jsdom would log "not implemented" for every frame.
beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
afterEach(cleanup);

const CATALOG = [
  { id: 'ichi', glyph: '一', meaning: 'one', strokes_total: 1 },
  { id: 'juu', glyph: '十', meaning: 'ten', strokes_total: 2 },
  { id: 'kawa', glyph: '川', meaning: 'river', strokes_total: 3 },
  { id: 'ei', glyph: '永', meaning: 'eternity', strokes_total: 5 },
  { id: 'latin_a', glyph: 'A', meaning: 'the letter A', strokes_total: 3 },
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

function lesson(state: Snapshot = snapshot(), extra: { busy?: boolean; pending?: GridPoint[] | null; notice?: string; marks?: Marks } = {}) {
  const strokes: GridPoint[][] = [];
  const commands: Command[] = [];
  const picks: number[] = [];
  render(
    <Lesson
      view={state} marks={extra.marks ?? {}} busy={extra.busy ?? false} pending={extra.pending ?? null} miss={null} notice={extra.notice ?? ''}
      onStroke={(p) => strokes.push(p)} onCommand={(c) => commands.push(c)} onPick={() => picks.push(1)}
    />,
  );
  return { strokes, commands, picks };
}

/** The canvas, with a size: jsdom gives every element a zero-size box. */
function sheet(): HTMLCanvasElement {
  const canvas = screen.getByRole('img', { name: /Practice sheet/ }) as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return canvas;
}

function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(canvas, event);
}

/** Words that never belong on a learner's screen. */
const BACKSTAGE = /\b(sessions?|avatars?|api|atmee|demo|sample|mini-app|state|events?|tools?)\b/i;

describe('the lesson', () => {
  it('asks for the live stroke by number without saying what it is', () => {
    lesson();
    expect(screen.getByRole('status', { name: '' }).textContent).toContain('Write stroke 2 of 2');
    expect(document.body.textContent).not.toMatch(/vertical|top to bottom/i);
    expect(screen.getByRole('img', { name: /Stroke 2 of 2 to write; 1 on the sheet/ })).toBeTruthy();
  });

  it('sends one stroke per gesture, in grid units and under the point cap', () => {
    const { strokes } = lesson();
    draw([[500, 100], [500, 900]], { canvas: sheet(), samples: 300 });
    expect(strokes.length).toBe(1);
    expect(strokes[0].length).toBeLessThanOrEqual(MAX_POINTS);
    expect(strokes[0][0]).toEqual([500, 100]);
    expect(strokes[0][strokes[0].length - 1]).toEqual([500, 900]);
  });

  it('does not send a tap, which would cost the learner an attempt they never made', () => {
    const { strokes } = lesson();
    const canvas = sheet();
    pointer(canvas, 'pointerdown', 200, 200);
    pointer(canvas, 'pointermove', 201, 201);
    pointer(canvas, 'pointerup', 201, 201);
    expect(strokes).toEqual([]);
  });

  it('takes no stroke between strokes, or while the last one is being graded', () => {
    const between = lesson(snapshot({ phase: 'coaching' }));
    draw([[500, 100], [500, 900]], { canvas: sheet() });
    expect(between.strokes).toEqual([]);
    cleanup();
    const grading = lesson(snapshot(), { pending: [[500, 100], [500, 900]] });
    draw([[500, 100], [500, 900]], { canvas: sheet() });
    expect(grading.strokes).toEqual([]);
  });

  it('offers Show me while writing, and Next stroke once the stroke is done', () => {
    const writing = lesson();
    expect(screen.queryByRole('button', { name: /Next stroke/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change character' }));
    expect(writing.commands).toEqual(['show', 'over']);
    expect(writing.picks).toEqual([1]);
    cleanup();
    const done = lesson(snapshot({ phase: 'coaching', stroke_index: 0, strokes: [{ index: 0, status: 'done', points: [[150, 450], [850, 450]], name: 'the horizontal', teach: 'T' }, { index: 1, status: 'hidden', points: [] }] }));
    expect(screen.queryByRole('button', { name: 'Show me' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Next stroke/ }));
    expect(done.commands).toEqual(['next']);
  });

  it('says "Finish" on the last stroke', () => {
    lesson(snapshot({ phase: 'coaching', strokes: [snapshot().strokes[0], { index: 1, status: 'done', points: [[500, 120], [500, 880]], name: 'the vertical', teach: 'T' }] }));
    expect(screen.getByRole('button', { name: /Finish 十/ })).toBeTruthy();
  });

  it('shows the verdict the sheet handed down, tagged by kind', () => {
    lesson(snapshot({ last_verdict: { ok: false, kind: 'direction', note: 'Verticals travel top to bottom — start at the top.' }, attempts: 1 }));
    expect(screen.getByText('Wrong direction')).toBeTruthy();
    expect(screen.getByText('Verticals travel top to bottom — start at the top.')).toBeTruthy();
  });

  it('says when a stroke was shown after two misses rather than on request', () => {
    const shown = { ok: false, kind: 'reveal', note: 'N', revealed: true } as const;
    expect(verdictLabel(shown, 0)).toBe('Shown to you');
    expect(verdictLabel(shown, 2)).toBe('Missed twice, shown');
  });

  it('shows a refusal instead of pretending the action landed', () => {
    lesson(snapshot(), { notice: 'Finish this stroke first.' });
    expect(screen.getByRole('alert').textContent).toBe('Finish this stroke first.');
  });

  it('marks each stroke on the progress dots: drawn, shown, now', () => {
    lesson(snapshot({ strokes: [snapshot().strokes[0], { index: 1, status: 'current', points: [] }] }), { marks: { [markKey('juu', 0)]: { how: 'shown', tries: 0, asked: true } } });
    const dots = screen.getByRole('list', { name: 'Stroke 2 of 2' }).querySelectorAll('li');
    expect([...dots].map((d) => d.className)).toEqual(['is-shown', 'is-now']);
  });
});

describe('the menu', () => {
  it('offers every character, counts one stroke as a stroke, and starts one with a tap', () => {
    const picks: string[] = [];
    render(<Picker view={snapshot({ phase: 'intro', character: null, stroke_index: 0, strokes: [], score: { correct: 0, total: 0 } })} busy={false} onPick={(id) => picks.push(id)} />);
    expect(screen.getAllByRole('button').length).toBe(CATALOG.length);
    expect(screen.getByText(/^1 stroke$/)).toBeTruthy();
    expect(screen.queryByText(/^1 strokes$/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Eternity, 5 strokes/ }));
    expect(picks).toEqual(['ei']);
  });

  it('mid-lesson, the character on the sheet is marked and the way back is offered', () => {
    const closed: number[] = [];
    render(<Picker view={snapshot()} busy={false} onPick={() => {}} onClose={() => closed.push(1)} />);
    expect((screen.getByRole('button', { name: /Ten, 2 strokes, on your sheet now/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back to 十' }));
    expect(closed).toEqual([1]);
  });

  it('while the sheet is being laid out, says so in the teacher\'s name', () => {
    render(<Picker view={null} busy onPick={() => {}} />);
    expect(screen.getByText('Ren is laying out your sheet…')).toBeTruthy();
  });
});

describe('the finished character', () => {
  const finished = () => snapshot({
    phase: 'debrief', stroke_index: 2, score: { correct: 1, total: 2 },
    strokes: [snapshot().strokes[0], { index: 1, status: 'done', points: [[500, 120], [500, 880]], name: 'the vertical', teach: 'T' }],
  });

  it('sums up each stroke and offers what comes next', () => {
    const commands: Command[] = [];
    const saved: number[] = [];
    const marks: Marks = { [markKey('juu', 0)]: { how: 'drawn', tries: 1, ink: [[150, 450], [850, 450]] }, [markKey('juu', 1)]: { how: 'shown', tries: 2, asked: false } };
    render(<Finished view={finished()} marks={marks} busy={false} onCommand={(c) => commands.push(c)} onPick={() => {}} onSave={() => saved.push(1)} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ten, written');
    expect(screen.getByText('Right first try')).toBeTruthy();
    expect(screen.getByText('Shown after two misses')).toBeTruthy();
    expect(screen.getByText('Horizontal')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Next: 川 river/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Write 十 again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save your sheet' }));
    expect(commands).toEqual(['another', 'over']);
    expect(saved).toEqual([1]);
  });
});

describe('the words on screen', () => {
  it('the front door starts a lesson by voice or by typing', () => {
    const starts: boolean[] = [];
    render(<Lobby onStart={(mic) => starts.push(mic)} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Write every character in the right order.');
    fireEvent.click(screen.getByRole('button', { name: 'Start with your voice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start by typing' }));
    expect(starts).toEqual([true, false]);
  });

  it("the front door's menu is the lessons' menu", () => {
    expect(MENU.map(([glyph, , n]) => [glyph, n])).toEqual(CHARACTERS.map((c) => [c.glyph, c.strokes.length]));
  });

  it('never speak of sessions, avatars, tools or demos', () => {
    const screens = [
      () => render(<Lobby onStart={() => {}} />),
      () => render(<Picker view={null} busy onPick={() => {}} />),
      () => render(<Picker view={snapshot({ phase: 'intro', character: null })} busy={false} onPick={() => {}} />),
      () => lesson(snapshot({ last_verdict: { ok: false, kind: 'order', note: 'N' }, attempts: 1 }), { notice: 'Finish this stroke first.' }),
      () => render(<Finished view={snapshot({ phase: 'debrief', stroke_index: 2 })} marks={{}} busy={false} onCommand={vi.fn()} onPick={vi.fn()} onSave={vi.fn()} />),
    ];
    for (const show of screens) {
      show();
      expect(document.body.textContent).not.toMatch(BACKSTAGE);
      cleanup();
    }
  });
});

describe('the live-test drawing helper', () => {
  it('follows a corner, so a shoulder drawn by the helper keeps its turn', () => {
    const { strokes } = lesson();
    draw([[270, 275], [510, 252], [462, 380]], { canvas: sheet(), samples: 120 });
    expect(strokes[0].some(([x, y]) => Math.abs(x - 510) < 12 && Math.abs(y - 252) < 12)).toBe(true);
  });
});
