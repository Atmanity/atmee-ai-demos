// @vitest-environment jsdom
//
// The page's wiring, with the call replaced by a recorder and the app's real
// server routes answering its requests (the real safety net kept): the front
// door, the opening, Ren's tool calls answered by the sheet with the real
// outcome, strokes graded and told, buttons told as events, the safety net
// stepping in, and the finished character.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Router } from 'express';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvatarHandlers } from '../../../src/kit/index.ts';
import server from '../server.ts';
import { draw } from './live-draw.ts';

const fake = vi.hoisted(() => ({
  phase: 'idle' as string,
  handlers: {} as AvatarHandlers,
  states: [] as string[],
  events: [] as { text: string; ttl?: number }[],
  starts: [] as { mic?: boolean }[],
}));

vi.mock('../../../src/kit/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/kit/index.ts')>();
  return {
    ...actual,
    useAvatar: (_app: string, handlers: AvatarHandlers) => {
      fake.handlers = handlers;
      return {
        phase: fake.phase, micOn: false, speaking: false, caption: '', secondsLeft: null,
        state: (t: string) => fake.states.push(t),
        event: (text: string, ttl?: number) => fake.events.push({ text, ttl }),
        start: async (opts?: { mic?: boolean }) => { fake.starts.push(opts ?? {}); },
        say: () => {}, note: () => {}, record: () => {},
      };
    },
    HostVideo: ({ children }: { children?: React.ReactNode }) => <div data-testid="host">{children}</div>,
    CallStatus: () => null,
    CallControls: () => null,
    ChatPanel: () => null,
  };
});

const { App } = await import('./App.tsx');

// The app's own routes, answering the page's fetches in memory.
type Handler = (req: { params: Record<string, string>; body: unknown }, res: unknown) => void;
const routes: [string, RegExp, string[], Handler][] = [];
server.routes!({
  post: (path: string, fn: Handler) => routes.push(['POST', ...pattern(path), fn]),
  get: (path: string, fn: Handler) => routes.push(['GET', ...pattern(path), fn]),
} as unknown as Router);
function pattern(path: string): [RegExp, string[]] {
  const keys: string[] = [];
  const source = path.replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^/]+)'; });
  return [new RegExp(`^${source}$`), keys];
}
const requests: { path: string; body: any }[] = [];
async function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const path = url.replace('/api/apps/stroke-tutor', '');
  const body = init?.body ? JSON.parse(init.body) : undefined;
  requests.push({ path, body });
  for (const [method, re, keys, fn] of routes) {
    const m = path.match(re);
    if (!m || method !== (init?.method ?? 'GET')) continue;
    return new Promise((resolve) => {
      let status = 200;
      const res = { status: (s: number) => { status = s; return res; }, json: (data: unknown) => resolve({ ok: status < 400, status, json: async () => data }) };
      fn({ params: Object.fromEntries(keys.map((k, i) => [k, m[i + 1]])), body }, res);
    });
  }
  return { ok: false, status: 404, json: async () => ({}) };
}

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect;
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  Object.assign(fake, { phase: 'idle', states: [], events: [], starts: [] });
  requests.length = 0;
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

/** Lets the in-memory requests and React settle. */
const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); await vi.advanceTimersByTimeAsync(0); });
/** The page with Ren on the call and the opening already said. */
async function live() {
  fake.phase = 'starting';
  const view = render(<App />);
  await settle();
  fake.phase = 'live';
  view.rerender(<App />);
  await settle();
  return view;
}
/** A tool call from Ren; the promise is the result Ren speaks from. */
async function tool(name: string, args: Record<string, unknown> = {}) {
  let result = '';
  await act(async () => { result = String(await fake.handlers.onToolCall!({ id: `call-${name}`, name, arguments: args })); });
  return result;
}
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const lastState = () => fake.states[fake.states.length - 1];

describe('the front door', () => {
  it('says what Hanshi is and starts a lesson by voice or by typing', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Write every character in the right order.');
    expect(screen.getAllByText(/Hanshi/).length).toBeGreaterThan(0);
    fireEvent.click(button('Start with your voice'));
    fireEvent.click(button('Start by typing'));
    expect(fake.starts).toEqual([{ mic: true }, { mic: false }]);
  });
});

describe('a lesson', () => {
  it('lays out the menu while Ren is on the way, and Ren opens once there', async () => {
    fake.phase = 'starting';
    const view = render(<App />);
    expect(screen.getByText('Ren is laying out your sheet…')).toBeTruthy();
    await settle();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('What would you like to write?');
    expect(fake.events).toEqual([]);   // held until Ren can hear it
    fake.phase = 'live';
    view.rerender(<App />);
    await settle();
    expect(fake.events.map((e) => e.text)[0]).toContain('A lesson is starting');
    expect(lastState()).toContain('No character is on the sheet yet');
  });

  it("Ren's choose_character puts the character up, and the result is the sheet's own", async () => {
    await live();
    const result = await tool('choose_character', { character: 'the tree one' });
    expect(result).toContain('木 is on the sheet');
    expect(result).toContain('Stroke 1 of 4');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Tree');
    expect(screen.getByText(/Write stroke/).textContent).toContain('1 of 4');
    expect(lastState()).toContain('Stroke 1 of 4 is live');
  });

  it('a stroke drawn on the sheet is graded by the server and told to Ren', async () => {
    await live();
    await tool('choose_character', { character: 'ten' });
    fake.events.length = 0;
    await act(async () => { draw([[500, 120], [500, 880]], { samples: 40 }); });   // the vertical, out of order
    await settle();
    expect(requests.some((r) => r.path.endsWith('/stroke'))).toBe(true);
    expect(screen.getByText('Wrong order')).toBeTruthy();
    expect(fake.events.map((e) => e.text).join(' ')).toContain('Wrong stroke ORDER');
    await act(async () => { draw([[150, 450], [850, 450]], { samples: 40 }); });     // the horizontal
    await settle();
    expect(screen.getByText('Correct')).toBeTruthy();
    expect(fake.events.map((e) => e.text).join(' ')).toContain('That stroke was right');
    expect(button(/Next stroke/)).toBeTruthy();
  });

  it('a button acts at once and Ren is told', async () => {
    await live();
    await tool('choose_character', { character: 'ten' });
    fake.events.length = 0;
    fireEvent.click(button('Show me'));
    await settle();
    expect(screen.getByText('Shown to you')).toBeTruthy();
    expect(fake.events[0].text).toContain('The learner pressed "Show me" on the sheet.');
    expect(fake.events[0].text).toContain('asked to be shown');
  });

  it('when Ren only says "let me show you", the safety net shows the stroke and tells Ren', async () => {
    await live();
    await tool('choose_character', { character: 'ten' });
    fake.events.length = 0;
    // The host talks for a few seconds before the next words: a call that long ago is the last turn's, not a reply to them.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    act(() => fake.handlers.onUserSaid!('Which way does it go?', 'spoken'));
    await act(async () => { await vi.advanceTimersByTimeAsync(7_500); });
    await settle();
    expect(screen.getByText('Shown to you')).toBeTruthy();
    expect(fake.events.map((e) => e.text).join(' ')).toContain('You did not call show_stroke');
  });

  it('when Ren calls the tool itself, the safety net stays out of it', async () => {
    await live();
    await tool('choose_character', { character: 'ten' });
    act(() => fake.handlers.onUserSaid!('Show me.', 'spoken'));
    await tool('show_stroke');
    fake.events.length = 0;
    await act(async () => { await vi.advanceTimersByTimeAsync(7_500); });
    expect(fake.events.map((e) => e.text).join(' ')).not.toContain('You did not call');
  });

  it('finishing a character shows the summary, and the next character is one tap away', async () => {
    await live();
    await tool('choose_character', { character: 'one' });
    await tool('show_stroke');
    const debrief = await tool('next_stroke');
    expect(debrief).toContain('last stroke of 一');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('One, written');
    expect(screen.getByText('Shown when you asked')).toBeTruthy();
    expect(screen.getByLabelText('Written so far: 一')).toBeTruthy();
    fireEvent.click(button(/Next: 十 ten/));
    await settle();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ten');
  });

  it('a refused request is shown on the sheet, and not told to Ren as if it happened', async () => {
    await live();
    await tool('choose_character', { character: 'ten' });
    const result = await tool('next_stroke');
    expect(result).toContain('The sheet refused that: Finish this stroke first.');
    expect(screen.getByText(/Write stroke/).textContent).toContain('1 of 2');
  });
});
