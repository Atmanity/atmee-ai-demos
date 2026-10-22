// @vitest-environment jsdom
// Ported from the original panel's `BoardPanel.test.tsx`. Each test is named
// after the thing a class would see go wrong. The original drove the panel
// through the platform's `fakeAgent`; here `mount` plays the server: it
// records the intents the panel sends and answers them with a scripted view
// or refusal.
//
// Nothing here asserts on the canvas: jsdom has no 2-D context, so the strokes
// are untested by design and the arithmetic behind them lives in `graph.ts`.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Intent } from '../engine/table.ts';
import type { Snapshot } from '../engine/types.ts';
import { BoardPanel } from './BoardPanel.tsx';
import { describe as describeGraph } from './Parabola.tsx';

beforeAll(() => {
  // jsdom logs "not implemented" for every getContext call; the panel copes with null.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(cleanup);

const EMPTY: Snapshot = {
  phase: 'empty',
  equation: null,
  facts: null,
  method: null,
  method_label: null,
  methods_available: [],
  steps: [],
  revealed: 0,
  total_steps: 0,
  remaining: 0,
  graph_visible: true,
  last_action: null,
};

const FACTS: NonNullable<Snapshot['facts']> = {
  discriminant: '4',
  discriminant_sign: 'positive',
  nature: 'two_rational',
  roots: ['3', '1'],
  crossings: [1, 3],
  vertex: [2, -1],
  vertex_display: '(2, -1)',
  axis: 2,
  axis_display: '2',
  opens: 'upward',
  view: { x_min: -3, x_max: 7 },
};

const EQUATION: NonNullable<Snapshot['equation']> = {
  a: 1,
  b: -4,
  c: 3,
  a_display: '1',
  b_display: '-4',
  c_display: '3',
  display: 'y = x² - 4x + 3',
  zero_form: 'x² - 4x + 3 = 0',
};

function working(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    ...EMPTY,
    phase: 'working',
    equation: EQUATION,
    facts: FACTS,
    method: 'factoring',
    method_label: 'Factoring',
    methods_available: ['factoring', 'completing_square', 'quadratic_formula'],
    steps: [{ n: 1, working: 'x² - 4x + 3 = 0', say: 'Start by setting it to zero.' }],
    revealed: 1,
    total_steps: 6,
    remaining: 5,
    ...overrides,
  };
}

type Reply = { view?: Snapshot; message?: string };

/** The panel with a stand-in server: intents are recorded, and `script` decides the reply. */
function mount(snapshot: Snapshot | null, { live = true } = {}) {
  const server = {
    intents: [] as Intent[],
    equations: [] as string[],
    reply: (() => ({})) as (input: Intent | string) => Reply,
    script(fn: (input: Intent | string) => Reply) { server.reply = fn; },
    broadcast: (_view: Snapshot) => {},
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
    return (
      <BoardPanel
        view={view}
        live={live}
        busy={false}
        message={message}
        onIntent={(intent) => {
          server.intents.push(intent);
          answer(intent);
        }}
        onEquation={(text) => {
          server.equations.push(text);
          return answer(text);
        }}
      />
    );
  }
  render(<Harness />);
  return server;
}

const button = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('BoardPanel', () => {
  it('says it is setting up rather than rendering an empty board before the first view', () => {
    mount(null);
    expect(screen.getByText(/Setting up the board/i)).toBeTruthy();
  });

  it('invites an equation when the board is clear', () => {
    mount(EMPTY);
    expect(screen.getByText(/Board is clear/i)).toBeTruthy();
    expect(screen.getByText(/Name a quadratic/i)).toBeTruthy();
  });

  it('shows the equation and its facts exactly as the engine wrote them', () => {
    mount(working());
    expect(screen.getByText('y = x² - 4x + 3')).toBeTruthy();
    expect(screen.getByText('(2, -1)')).toBeTruthy();
    expect(screen.getByText('x = 2')).toBeTruthy();
  });

  it('never renders a line of working that has not been revealed', () => {
    // The central property: the panel is not told what the remaining lines
    // say, so there is nothing on screen for a class to read ahead to.
    mount(working());
    expect(screen.getByText('x² - 4x + 3 = 0')).toBeTruthy();
    expect(screen.queryByText(/\(x - 1\)\(x - 3\)/)).toBeNull();
    expect(screen.queryByText(/x = 3 or x = 1/)).toBeNull();
    expect(screen.getAllByLabelText('not revealed yet')).toHaveLength(5);
  });

  it('never draws the line staged for the avatar', () => {
    // New in the port: the view carries the next line's sentence for the
    // avatar's state. It must not reach the screen.
    const staged = 'Those two numbers are -1 and -3.';
    const view = { ...working(), seq: 3, next: { n: 2, say: staged } };
    mount(view);
    expect(screen.queryByText(staged)).toBeNull();
    expect(document.body.textContent).not.toContain('-1 and -3');
  });

  it('counts the lines so the teacher knows how far through they are', () => {
    mount(working());
    expect(screen.getByText('1 / 6')).toBeTruthy();
  });

  it('asks the server for the next line rather than deciding one itself', () => {
    const server = mount(working());
    fireEvent.click(button(/Next line/i));
    expect(server.intents).toEqual([{ kind: 'reveal_step' }]);
  });

  it('surfaces a refusal on screen instead of swallowing it', async () => {
    // A refusal nobody sees is the worst failure: the board looks stuck and nothing on screen says why.
    const server = mount(working({ revealed: 0, steps: [], remaining: 6 }));
    server.script(() => ({ message: "We're back at the start already." }));
    fireEvent.click(button(/Show all/i));
    expect(await screen.findByText("We're back at the start already.")).toBeTruthy();
  });

  // Offering an intent whose refusal is already visible in the view makes a working board look broken.

  it('does not offer Back at the start of the working', () => {
    mount(working({ revealed: 0, steps: [], remaining: 6 }));
    expect(button(/Back/i).disabled).toBe(true);
  });

  it('does not offer Next once the last line is up', () => {
    mount(working({ revealed: 6, remaining: 0 }));
    expect(button(/Next line/i).disabled).toBe(true);
  });

  it('greys out a method this equation cannot use, and says why', () => {
    mount(working({ method: null, method_label: null, steps: [], revealed: 0, total_steps: 0, remaining: 0, methods_available: ['completing_square', 'quadratic_formula'] }));
    expect(button(/Factoring/i).disabled).toBe(true);
    expect(screen.getByText(/won’t factor/i)).toBeTruthy();
  });

  it('sends the method the teacher picked', () => {
    const server = mount(working({ method: null, method_label: null, steps: [], revealed: 0, remaining: 0 }));
    fireEvent.click(button(/Completing the square/i));
    expect(server.intents).toEqual([{ kind: 'set_method', method: 'completing_square' }]);
  });

  it('toggles the graph through the server, not locally', () => {
    const server = mount(working());
    fireEvent.click(button(/Hide graph/i));
    expect(server.intents).toEqual([{ kind: 'set_graph', visible: false }]);
    expect(screen.getByRole('button', { name: /Hide graph/i })).toBeTruthy();
  });

  it('redraws from a new view without being asked', async () => {
    const server = mount(working());
    server.broadcast(working({
      revealed: 2,
      remaining: 4,
      steps: [
        { n: 1, working: 'x² - 4x + 3 = 0', say: '' },
        { n: 2, working: 'need p·q = 3 and p + q = -4', say: '' },
      ],
    }));
    expect(await screen.findByText('need p·q = 3 and p + q = -4')).toBeTruthy();
    expect(screen.getByText('2 / 6')).toBeTruthy();
  });

  it('is read-only until the session is live', () => {
    mount(working(), { live: false });
    for (const name of [/Back/i, /Next line/i, /Show all/i, /Hide graph/i, /Clear/i]) expect(button(name).disabled).toBe(true);
    expect((screen.getByLabelText('Equation') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('the equation box (new in the port)', () => {
  const typeAndSubmit = (text: string) => {
    const input = screen.getByLabelText('Equation') as HTMLInputElement;
    fireEvent.change(input, { target: { value: text } });
    fireEvent.submit(input.closest('form')!);
    return input;
  };

  it('sends what was typed, and clears once it went up', async () => {
    const server = mount(EMPTY);
    server.script(() => ({ view: working({ method: null, method_label: null, steps: [], revealed: 0, total_steps: 0, remaining: 0 }) }));
    const input = typeAndSubmit('x^2 - 4x + 3');
    expect(server.equations).toEqual(['x^2 - 4x + 3']);
    await act(async () => {});
    expect(input.value).toBe('');
    expect(screen.getByText('y = x² - 4x + 3')).toBeTruthy();
  });

  it('keeps the text when it could not be read, so it can be corrected', async () => {
    const server = mount(EMPTY);
    server.script(() => ({ message: "I couldn't read that as a quadratic." }));
    const input = typeAndSubmit('x squard');
    expect(await screen.findByText("I couldn't read that as a quadratic.")).toBeTruthy();
    expect(input.value).toBe('x squard');
  });

  it('sends nothing for an empty box', () => {
    const server = mount(EMPTY);
    typeAndSubmit('   ');
    expect(server.equations).toEqual([]);
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
