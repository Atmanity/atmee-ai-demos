// @vitest-environment jsdom
// Ported from the original panel's `BoardPanel.test.tsx`. Each test is named
// after the thing a class would see go wrong. `mount` plays the server: it
// records the intents the board and its tray send and answers them with a
// scripted view or refusal.
//
// Nothing here asserts on the canvas: jsdom has no 2-D context, so the strokes
// are untested by design and the arithmetic behind them lives in `graph.ts`.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Intent } from '../engine/table.ts';
import type { Snapshot } from '../engine/types.ts';
import { Board, Recap, Tray, type BoardStatus } from './Board.tsx';
import type { NoteEntry } from './notes.ts';
import { describe as describeGraph } from './Parabola.tsx';

beforeAll(() => {
  // jsdom logs "not implemented" for every getContext call; the board copes with null.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(cleanup);

const EMPTY: Snapshot = {
  phase: 'empty', equation: null, facts: null, method: null, method_label: null, methods_available: [],
  steps: [], revealed: 0, total_steps: 0, remaining: 0, graph_visible: true, last_action: null,
};

const FACTS: NonNullable<Snapshot['facts']> = {
  discriminant: '4', discriminant_sign: 'positive', nature: 'two_rational', roots: ['3', '1'], crossings: [1, 3],
  vertex: [2, -1], vertex_display: '(2, -1)', axis: 2, axis_display: '2', opens: 'upward', view: { x_min: -3, x_max: 7 },
};

const EQUATION: NonNullable<Snapshot['equation']> = {
  a: 1, b: -4, c: 3, a_display: '1', b_display: '-4', c_display: '3', display: 'y = x² - 4x + 3', zero_form: 'x² - 4x + 3 = 0',
};

function working(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    ...EMPTY,
    phase: 'working', equation: EQUATION, facts: FACTS, method: 'factoring', method_label: 'Factoring',
    methods_available: ['factoring', 'completing_square', 'quadratic_formula'],
    steps: [{ n: 1, working: 'x² - 4x + 3 = 0', say: 'Start by setting it to zero.' }],
    revealed: 1, total_steps: 6, remaining: 5,
    ...overrides,
  };
}

const posed = () => working({ phase: 'posed', method: null, method_label: null, steps: [], revealed: 0, total_steps: 0, remaining: 0 });

type Reply = { view?: Snapshot; message?: string };

/** The board and its tray with a stand-in server: inputs are recorded, and `script` decides the reply. */
function mount(snapshot: Snapshot | null, { live = true, status = 'ready' as BoardStatus } = {}) {
  const server = {
    intents: [] as Intent[],
    equations: [] as string[],
    reply: (() => ({})) as (input: Intent | string) => Reply,
    script(fn: (input: Intent | string) => Reply) { server.reply = fn; },
    broadcast: (_view: Snapshot) => {},
    retried: 0,
  };
  function Harness() {
    const [view, setView] = useState(snapshot);
    const [message, setMessage] = useState('');
    server.broadcast = (next) => act(() => setView(next));
    const answer = (input: Intent | string) => {
      const reply = server.reply(input);
      if (reply.view) setView(reply.view);
      setMessage(reply.message ?? '');
      return !reply.message;
    };
    const onIntent = (intent: Intent) => { server.intents.push(intent); answer(intent); };
    const onEquation = (text: string) => { server.equations.push(text); return answer(text); };
    return (
      <>
        <Board view={view} status={status} live={live} busy={false} message={message} onRetry={() => { server.retried += 1; }} onIntent={onIntent} onEquation={onEquation} />
        <Tray view={view} live={live} busy={false} onIntent={onIntent} onEquation={onEquation} />
      </>
    );
  }
  render(<Harness />);
  return server;
}

const button = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('before the board is up', () => {
  it('says it is being set up rather than drawing an empty board', () => {
    mount(null, { status: 'loading' });
    expect(screen.getByText('Ada is setting up your board…')).toBeTruthy();
  });

  it('says when it failed to load, with a way to try again', () => {
    const server = mount(null, { status: 'failed' });
    expect(screen.getByText('The board didn’t load.')).toBeTruthy();
    fireEvent.click(button(/Try again/i));
    expect(server.retried).toBe(1);
  });

  it('invites a call when there is none', () => {
    mount(null, { status: 'idle', live: false });
    expect(screen.getByText('Call Ada to set up your board.')).toBeTruthy();
  });
});

describe('the board', () => {
  it('invites an equation when it is clean, with three to start from', () => {
    const server = mount(EMPTY);
    expect(screen.getByText('A clean board.')).toBeTruthy();
    fireEvent.click(button(/No real roots/i));
    expect(server.equations).toEqual(['2x^2 + 3x + 5']);
  });

  it('shows the equation and its facts exactly, with real minus signs', () => {
    mount(working());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('y = x² − 4x + 3');
    expect(screen.getByText('(2, −1)')).toBeTruthy();
    expect(screen.getByText('x = 2')).toBeTruthy();
  });

  it('never renders a line of working that has not been revealed', () => {
    // The central property: the board is not told what the remaining lines
    // say, so there is nothing on screen for a class to read ahead to.
    mount(working());
    expect(screen.getByText('x² − 4x + 3 = 0')).toBeTruthy();
    expect(screen.queryByText(/\(x − 1\)\(x − 3\)/)).toBeNull();
    expect(screen.queryByText(/x = 3 or x = 1/)).toBeNull();
    expect(screen.getAllByText('Not revealed yet')).toHaveLength(5);
  });

  it('never draws the host\'s sentence for a line, only the line', () => {
    mount(working());
    expect(document.body.textContent).not.toContain('Start by setting it to zero.');
  });

  it('counts the lines so the teacher knows how far through they are', () => {
    mount(working());
    expect(screen.getByText('1 of 6')).toBeTruthy();
  });

  it('offers the methods, greys out one that cannot work, and says why', () => {
    const server = mount({ ...posed(), methods_available: ['completing_square', 'quadratic_formula'] });
    expect(screen.getByText('How shall we solve it?')).toBeTruthy();
    expect(button(/Factoring/i).disabled).toBe(true);
    expect(screen.getByText('Won’t factor over the rationals')).toBeTruthy();
    fireEvent.click(button(/Completing the square/i));
    expect(server.intents).toEqual([{ kind: 'set_method', method: 'completing_square' }]);
  });

  it('boxes the answer when the working is done, and offers the other methods', () => {
    const steps = ['x² - 4x + 3 = 0', 'need p·q = 3 and p + q = -4', 'p = -1, q = -3', '(x - 1)(x - 3) = 0', 'each factor = 0', 'x = 3 or x = 1']
      .map((line, i) => ({ n: i + 1, working: line, say: '' }));
    const server = mount(working({ steps, revealed: 6, remaining: 0 }));
    expect(screen.getByText('Solved')).toBeTruthy();
    expect(screen.getByText('x = 3 or x = 1').closest('li')!.className).toContain('is-answer');
    fireEvent.click(button(/Quadratic formula/i));
    expect(server.intents).toEqual([{ kind: 'set_method', method: 'quadratic_formula' }]);
  });

  it('surfaces a refusal on the board instead of swallowing it', async () => {
    // A refusal nobody sees is the worst failure: the board looks stuck and nothing on screen says why.
    const server = mount(working({ revealed: 0, steps: [], remaining: 6 }));
    server.script(() => ({ message: "We're back at the start already." }));
    fireEvent.click(button(/Show all/i));
    expect((await screen.findByRole('status')).textContent).toBe("We're back at the start already.");
  });

  it('redraws from a new view without being asked', async () => {
    const server = mount(working());
    server.broadcast(working({
      revealed: 2, remaining: 4,
      steps: [{ n: 1, working: 'x² - 4x + 3 = 0', say: '' }, { n: 2, working: 'need p·q = 3 and p + q = -4', say: '' }],
    }));
    expect(await screen.findByText('need p·q = 3 and p + q = −4')).toBeTruthy();
    expect(screen.getByText('2 of 6')).toBeTruthy();
  });

  it('drops the graph when it is hidden', () => {
    mount(working({ graph_visible: false }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(button(/Show graph/i)).toBeTruthy();
  });
});

describe('the tray', () => {
  // Offering a key whose refusal is already visible in the view makes a working board look broken.
  it('asks the server for the next line rather than deciding one itself', () => {
    const server = mount(working());
    fireEvent.click(button(/Next line/i));
    expect(server.intents).toEqual([{ kind: 'reveal_step' }]);
  });

  it('does not offer Back at the start of the working', () => {
    mount(working({ revealed: 0, steps: [], remaining: 6 }));
    expect(button(/Back/i).disabled).toBe(true);
  });

  it('does not offer Next once the last line is up', () => {
    mount(working({ revealed: 6, remaining: 0 }));
    expect(button(/Next line/i).disabled).toBe(true);
  });

  it('toggles the graph through the server, not locally', () => {
    const server = mount(working());
    fireEvent.click(button(/Hide graph/i));
    expect(server.intents).toEqual([{ kind: 'set_graph', visible: false }]);
  });

  it('is read-only until the call is live', () => {
    mount(working(), { live: false });
    for (const name of [/Back/i, /Next line/i, /Show all/i, /Hide graph/i, /Clear/i, /Write it up/i]) expect(button(name).disabled).toBe(true);
    expect((screen.getByLabelText('Equation') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('the equation box', () => {
  const typeAndSubmit = (text: string) => {
    const input = screen.getByLabelText('Equation') as HTMLInputElement;
    fireEvent.change(input, { target: { value: text } });
    fireEvent.submit(input.closest('form')!);
    return input;
  };

  it('sends what was typed, and clears once it went up', async () => {
    const server = mount(EMPTY);
    server.script(() => ({ view: posed() }));
    const input = typeAndSubmit('x^2 - 4x + 3');
    expect(server.equations).toEqual(['x^2 - 4x + 3']);
    await act(async () => {});
    expect(input.value).toBe('');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('y = x² − 4x + 3');
  });

  it('keeps the text when it could not be read, so it can be corrected', async () => {
    const server = mount(EMPTY);
    server.script(() => ({ message: "That didn't read as a quadratic." }));
    const input = typeAndSubmit('x squard');
    expect(await screen.findByText("That didn't read as a quadratic.")).toBeTruthy();
    expect(input.value).toBe('x squard');
  });

  it('sends nothing for an empty box', () => {
    const server = mount(EMPTY);
    typeAndSubmit('   ');
    expect(server.equations).toEqual([]);
  });
});

describe('the recap', () => {
  it('lists what the class saw, with the answers reached, and downloads the notes', () => {
    const notes: NoteEntry[] = [
      { equation: 'y = x² - 4x + 3', facts: '', answer: 'x = 3 or x = 1', worked: [{ method: 'factoring', label: 'Factoring', lines: Array(6).fill('l'), total: 6 }] },
      { equation: 'y = x² - 4x + 1', facts: '', answer: null, worked: [{ method: 'quadratic_formula', label: 'The quadratic formula', lines: ['a', 'b'], total: 6 }] },
    ];
    let downloads = 0;
    render(<Recap notes={notes} onDownload={() => { downloads += 1; }} />);
    expect(screen.getByText('2 equations, 1 solved')).toBeTruthy();
    expect(screen.getByText('x = 3 or x = 1')).toBeTruthy();
    expect(screen.getByText('The quadratic formula · 2 of 6 lines')).toBeTruthy();
    fireEvent.click(button(/Download lesson notes/i));
    expect(downloads).toBe(1);
  });
});

describe('the graph in words', () => {
  it('is built from the exact strings, not decimals', () => {
    // For a screen reader: "2 + √3", not 3.732.
    const label = describeGraph(
      { ...EQUATION, display: 'y = x² - 4x + 1' },
      { ...FACTS, roots: ['2 + √3', '2 - √3'], crossings: [0.27, 3.73], vertex_display: '(2, -3)' },
    );
    expect(label).toContain('2 + √3 and 2 - √3');
    expect(label).not.toContain('3.73');
    expect(describeGraph(EQUATION, { ...FACTS, crossings: [] })).toContain('does not cross');
  });
});
