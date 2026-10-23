// @vitest-environment jsdom
/**
 * The page's wiring, with the call faked and the server played by the real
 * engine in-process: the front door, setting up a board while Ada arrives,
 * Ada's tool calls moving the board, the keys telling Ada, the safety net,
 * the recap when the call ends, and calling back to the same board.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_EQUATION } from '../engine/board.ts';
import { Table } from '../engine/table.ts';

type Call = { id: string; name: string; arguments: Record<string, unknown> };

const fake = vi.hoisted(() => ({
  states: [] as string[],
  events: [] as string[],
  started: [] as unknown[],
  onToolCall: undefined as undefined | ((call: Call) => Promise<unknown>),
  onUserSaid: undefined as undefined | ((text: string, how: 'spoken' | 'typed') => void),
  setPhase: undefined as undefined | ((phase: string) => void),
  poster: undefined as undefined | string,
}));

vi.mock('../../../src/kit/index.ts', async () => {
  const { useToolNet } = await vi.importActual<typeof import('../../../src/kit/useToolNet.ts')>('../../../src/kit/useToolNet.ts');
  return {
    useToolNet,
    clock: (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
    useAvatar: (_app: string, handlers: { onToolCall: (call: Call) => Promise<unknown>; onUserSaid: (text: string, how: 'spoken' | 'typed') => void }) => {
      const [phase, setPhase] = useState('idle');
      fake.setPhase = setPhase;
      fake.onToolCall = handlers.onToolCall;
      fake.onUserSaid = handlers.onUserSaid;
      return {
        phase, speaking: false, micOn: false, secondsLeft: null, lines: [], heard: '', caption: '',
        start: async (opts: unknown) => { fake.started.push(opts); setPhase('starting'); },
        state: (t: string) => fake.states.push(t),
        event: (t: string) => fake.events.push(t),
        note: () => {}, say: () => {}, record: () => {},
      };
    },
    HostVideo: ({ children, poster }: { children?: unknown; poster?: string }) => {
      fake.poster = poster;
      return children ?? null;
    },
    CallStatus: () => null,
    CallControls: () => null,
    ChatPanel: () => null,
  };
});

import { App } from './App.tsx';

/** The app's server routes, answered by the engine itself. */
function stubServer() {
  const tables = new Map<string, Table>();
  let made = 0;
  const json = (data: unknown) => new Response(JSON.stringify(data));
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('/api/apps/quadratic-whiteboard', '');
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (path === '/boards') {
      const kept = body.resume ? tables.get(body.resume) : undefined;
      if (kept) return json({ id: body.resume, view: kept.view(), opening: kept.resume() });
      const id = `board-${++made}`;
      const table = new Table();
      tables.set(id, table);
      return json({ id, view: table.view(), opening: table.open() });
    }
    const [, id, route] = /^\/boards\/([^/]+)\/(tool|act)$/.exec(path)!;
    const table = tables.get(id)!;
    if (route === 'tool') return json(await table.tool(body.name, body.arguments ?? {}));
    return json(body.intent ? table.press(body.intent) : await table.enter(body.equation));
  });
  return Object.assign(fetchFn, { tables });
}

/**
 * The server acts when asked, but its answers to matching requests are held
 * until released: to land an answer late, after its call is over.
 */
function holding(match: (path: string) => boolean) {
  const server = stubServer();
  const held: { path: string; release: () => void }[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const answer = server(url, init);
    const path = url.replace('/api/apps/quadratic-whiteboard', '');
    if (!match(path)) return answer;
    return new Promise<Response>((resolve) => { held.push({ path, release: () => resolve(answer) }); });
  });
  vi.stubGlobal('fetch', fetchFn);
  return { server, fetchFn, held };
}

const lastState = () => fake.states[fake.states.length - 1] ?? '';
const lastEvent = () => fake.events[fake.events.length - 1] ?? '';
const call = (name: string, args: Record<string, unknown> = {}) => act(() => fake.onToolCall!({ id: name, name, arguments: args })) as Promise<unknown>;
const heading = () => screen.getByRole('heading', { level: 1 }).textContent;
// Never on screen: the plumbing's words.
const PLUMBING = /\b(session|avatar|api|atmee|demo|sample|mini-app|tools?|state|event)\b/i;

async function live() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Start by typing' }));
  await waitFor(() => expect(fake.events).toHaveLength(1));
  act(() => fake.setPhase!('live'));
}

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
beforeEach(() => {
  for (const list of [fake.states, fake.events, fake.started]) list.length = 0;
  vi.stubGlobal('fetch', stubServer());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the front door', () => {
  it('says what Chalkline is, how a lesson goes, and offers voice and typing', () => {
    render(<App />);
    expect(heading()).toBe('Say the equation. Reveal the working one line at a time.');
    expect(screen.getByRole('button', { name: 'Start with your voice' })).toBeTruthy();
    expect(screen.getByText('Reveal at your pace')).toBeTruthy();
    // Who they will talk to, before the call: Ada's face beside her name (so the photo is decorative).
    const tag = screen.getByText(/is the board’s voice/).closest('p')!;
    expect(tag.textContent).toContain('Ada');
    expect(tag.querySelector('img')!.getAttribute('alt')).toBe('');
    expect(tag.querySelector('img')!.getAttribute('src')).toMatch(/portrait\.jpg/);
    expect(document.body.textContent).not.toMatch(PLUMBING);
  });

  it('starts a call by typing without the microphone, with Ada\'s face in the frame while it connects', async () => {
    await live();
    expect(fake.started).toEqual([{ mic: false }]);
    expect(fake.poster).toMatch(/portrait\.jpg/);
  });
});

describe('the lesson', () => {
  it('sets up a clean board while Ada arrives, and opens with it', async () => {
    await live();
    expect(fake.events[0]).toMatch(/^You have just greeted them; do not greet or introduce yourself again\. The board is clean and ready/);
    expect(lastState()).toContain('The board is empty');
    expect(screen.getByText('A clean board.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(PLUMBING);
  });

  it('moves the board on Ada\'s calls and hands her the result to speak from', async () => {
    await live();
    expect(await call('put_up_equation', { equation: 'x squared minus four x plus three' })).toContain('y = x² - 4x + 3 is on the board');
    expect(heading()).toBe('y = x² − 4x + 3');
    expect(await call('choose_method', { method: 'factoring' })).toContain('set up for factoring');
    expect(screen.getAllByText('Not revealed yet')).toHaveLength(6);
    const line = await call('next_line');
    expect(line).toContain('Done: line 1 of 6');
    expect(screen.getByText('x² − 4x + 3 = 0')).toBeTruthy();
    expect(lastState()).toContain('1 of 6 lines are up');
    expect(document.body.textContent).not.toMatch(PLUMBING);
  });

  it('shows a refused call on the board as well as telling Ada', async () => {
    await live();
    expect(await call('next_line')).toContain(NO_EQUATION);
    expect(screen.getByRole('status').textContent).toBe(NO_EQUATION);
  });

  it('acts on a key at once, and tells Ada what the teacher did', async () => {
    await live();
    await call('put_up_equation', { equation: 'x^2 - 5x + 6', method: 'factoring' });
    fireEvent.click(screen.getByRole('button', { name: /Next line/ }));
    await waitFor(() => expect(lastEvent()).toContain('The teacher put the next line up on the board themselves'));
    expect(screen.getByText('1 of 6')).toBeTruthy();
  });

  it('puts an example equation up from the clean board', async () => {
    await live();
    fireEvent.click(screen.getByRole('button', { name: /Roots in surds/ }));
    await waitFor(() => expect(heading()).toBe('y = x² − 4x + 1'));
    expect(lastEvent()).toContain('wrote an equation');
  });
});

describe('the safety net', () => {
  it('hides the graph itself when Ada only says she will, and tells her', async () => {
    await live();
    await call('put_up_equation', { equation: 'x^2 - 4x + 3' });
    vi.useFakeTimers();
    // The host talks for a few seconds before the next words: a call that long ago is the last turn's, not a reply to them.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    act(() => fake.onUserSaid!('Hide the graph, please.', 'spoken'));
    await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
    vi.useRealTimers();
    await waitFor(() => expect(lastEvent()).toContain('You did not call hide_graph'));
    expect(screen.getByRole('button', { name: 'Show graph' })).toBeTruthy();
  });

  it('gives a typed line longer: live, typed turns were answered up to a turn late', async () => {
    await live();
    await call('put_up_equation', { equation: 'x^2 - 4x + 3' });
    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    act(() => fake.onUserSaid!('Hide the graph.', 'typed'));
    await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
    expect(fake.events.some((e) => e.includes('You did not call'))).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    vi.useRealTimers();
    await waitFor(() => expect(lastEvent()).toContain('You did not call hide_graph'));
  });

  it('does nothing more when Ada made the call', async () => {
    await live();
    await call('put_up_equation', { equation: 'x^2 - 4x + 3' });
    vi.useFakeTimers();
    act(() => fake.onUserSaid!('hide the graph', 'spoken'));
    await call('hide_graph');
    const before = fake.events.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
    expect(fake.events.length).toBe(before);
  });

  it('never puts a line up for Ada: a second one would move the board twice', async () => {
    await live();
    await call('put_up_equation', { equation: 'x^2 - 4x + 3', method: 'factoring' });
    vi.useFakeTimers();
    act(() => fake.onUserSaid!('next', 'spoken'));
    await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
    expect(screen.getAllByText('Not revealed yet')).toHaveLength(6);
  });
});

describe('one call never acts on another', () => {
  it('drops a board set up for a call that failed when it answers after the next call\'s', async () => {
    const { server, held } = holding((path) => path === '/boards');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Start by typing' }));
    await waitFor(() => expect(held).toHaveLength(1));
    act(() => fake.setPhase!('failed'));
    act(() => fake.setPhase!('starting'));
    await waitFor(() => expect(held).toHaveLength(2));
    await act(async () => held[1].release());
    await waitFor(() => expect(fake.events).toHaveLength(1));
    await act(async () => held[0].release());
    await act(async () => {});
    expect(fake.events).toHaveLength(1);
    act(() => fake.setPhase!('live'));
    await call('put_up_equation', { equation: 'x^2 - 1' });
    expect(server.mock.calls.at(-1)![0]).toContain('/boards/board-2/tool');
  });

  it('draws nothing on the next call\'s board from a tool call answered after its own call ended', async () => {
    const { server, held } = holding((path) => path.endsWith('/tool'));
    await live();
    const late = fake.onToolCall!({ id: 'late', name: 'put_up_equation', arguments: { equation: 'x^2 - 5x + 6' } });
    await waitFor(() => expect(held).toHaveLength(1));
    act(() => fake.setPhase!('ended'));
    server.tables.clear(); // the server has let the board go by the time Ada is called back
    act(() => fake.setPhase!('starting'));
    await waitFor(() => expect(fake.events).toHaveLength(2));
    act(() => fake.setPhase!('live'));
    await act(async () => { held[0].release(); await late; });
    expect(screen.getByText('A clean board.')).toBeTruthy();
    expect(lastState()).toContain('The board is empty');
  });

  it('a key still waiting when its call ends neither holds the keys nor speaks in the next call', async () => {
    const { held } = holding((path) => path.endsWith('/act'));
    await live();
    fireEvent.click(screen.getByRole('button', { name: /Factors neatly/ }));
    await waitFor(() => expect(held).toHaveLength(1));
    act(() => fake.setPhase!('ended'));
    act(() => fake.setPhase!('starting'));
    await waitFor(() => expect(lastEvent()).toContain('as they left it'));
    act(() => fake.setPhase!('live'));
    const events = fake.events.length;
    expect((screen.getByRole('button', { name: 'Hide graph' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => held[0].release());
    await act(async () => {});
    expect(fake.events).toHaveLength(events);
  });
});

describe('answers that cross', () => {
  it('never shows a refusal from a key that answers after a newer change from Ada', async () => {
    // The box's refusal is decided first (the board as it was), Ada's method lands after it, then the refusal's answer arrives.
    const { held } = holding((path) => path.endsWith('/act') && held.length === 0);
    await live();
    await call('put_up_equation', { equation: 'x^2 - 4x + 1' });
    const input = screen.getByLabelText('Equation') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2x + 3' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(held).toHaveLength(1));
    await call('choose_method', { method: 'completing the square' });
    await act(async () => held[0].release());
    await act(async () => {});
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Completing the square');
  });

  it('never shows a refusal from Ada that answers after her own newer change', async () => {
    // The keys wait while Ada's calls run, but her calls do not wait for each other.
    const { held } = holding((path) => path.endsWith('/tool') && held.length === 0);
    await live();
    fireEvent.click(screen.getByRole('button', { name: /Factors neatly/ }));
    await waitFor(() => expect(heading()).toBe('y = x² − 5x + 6'));
    const late = fake.onToolCall!({ id: 'early', name: 'next_line', arguments: {} }); // refused: no method yet
    await waitFor(() => expect(held).toHaveLength(1));
    await call('choose_method', { method: 'factoring' });
    await act(async () => { held[0].release(); await late; });
    expect(screen.getByText('0 of 6')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('after the call', () => {
  it('shows today\'s board with the notes to download, and calling back resumes the same board', async () => {
    await live();
    await call('put_up_equation', { equation: 'x^2 - 4x + 3', method: 'factoring' });
    await call('show_all_working');
    act(() => fake.setPhase!('ended'));
    expect(screen.getByText('1 equation, 1 solved')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download lesson notes' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(PLUMBING);

    act(() => fake.setPhase!('starting'));
    await waitFor(() => expect(lastEvent()).toContain('as they left it'));
    expect(heading()).toBe('y = x² − 4x + 3');
  });
});
