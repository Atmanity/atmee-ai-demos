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
  speaking: false,
}));

vi.mock('../../../src/kit/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/kit/index.ts')>();
  return {
    ...actual,
    useAvatar: (_app: string, handlers: AvatarHandlers) => {
      fake.handlers = handlers;
      return {
        phase: fake.phase, micOn: false, speaking: fake.speaking, caption: '', secondsLeft: null,
        state: (t: string) => fake.states.push(t),
        event: (text: string, ttl?: number) => fake.events.push({ text, ttl }),
        start: async (opts?: { mic?: boolean }) => { fake.starts.push(opts ?? {}); },
        say: () => {}, note: () => {}, record: () => {},
      };
    },
    HostVideo: ({ children, poster }: { children?: React.ReactNode; poster?: string }) => <div data-testid="host" data-poster={poster}>{children}</div>,
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
// A response held back: the server has acted, its answer reaches the page only on release (a slow network).
const holds: { match: (path: string) => boolean; fail?: boolean }[] = [];
const held: (() => void)[] = [];
const holdNext = (match: (path: string) => boolean, fail = false) => holds.push({ match, fail });
const release = () => act(async () => { held.shift()?.(); });
// A request that reaches the server late (another connection overtook it).
const lateRequests: ((path: string) => boolean)[] = [];
const arrivals: (() => void)[] = [];
const arriveLate = (match: (path: string) => boolean) => lateRequests.push(match);
const arrive = () => act(async () => { arrivals.shift()?.(); });
// Lessons the server no longer has (a deploy, a restart, the idle sweep).
const gone = new Set<string>();
// Lay-outs that fail once (the server cannot set up a new sheet).
let failLayouts = 0;
const lessonId = () => requests.map((r) => r.path.match(/^\/lessons\/([^/]+)/)?.[1]).filter(Boolean).pop()!;
async function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const path = url.replace('/api/apps/stroke-tutor', '');
  const body = init?.body ? JSON.parse(init.body) : undefined;
  requests.push({ path, body });
  // A late request meets the server as it is when it arrives.
  const late = lateRequests.findIndex((m) => m(path));
  if (late >= 0) {
    lateRequests.splice(late, 1);
    await new Promise<void>((resolve) => arrivals.push(resolve));
  }
  if ([...gone].some((id) => path.startsWith(`/lessons/${id}`))) return { ok: false, status: 404, json: async () => ({ error: 'no_lesson' }) };
  if (path === '/lessons' && failLayouts > 0) {
    failLayouts -= 1;
    return { ok: false, status: 502, json: async () => ({}) };
  }
  for (const [method, re, keys, fn] of routes) {
    const m = path.match(re);
    if (!m || method !== (init?.method ?? 'GET')) continue;
    return new Promise((resolve) => {
      let status = 200;
      const res = {
        status: (s: number) => { status = s; return res; },
        json: (data: unknown) => {
          const answer = { ok: status < 400, status, json: async () => data };
          const hold = holds.findIndex((h) => h.match(path));
          if (hold < 0) return resolve(answer);
          const { fail } = holds.splice(hold, 1)[0];
          held.push(() => resolve(fail ? { ok: false, status: 502, json: async () => ({}) } : answer));
        },
      };
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
  Object.assign(fake, { phase: 'idle', states: [], events: [], starts: [], speaking: false });
  requests.length = 0;
  holds.length = 0;
  held.length = 0;
  lateRequests.length = 0;
  arrivals.length = 0;
  gone.clear();
  failLayouts = 0;
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
    expect(screen.getByTestId('host').dataset.poster).toMatch(/portrait\.jpg/);   // Ren's face while the call connects
    await settle();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('What would you like to write?');
    expect(fake.events).toEqual([]);   // held until Ren can hear it
    fake.phase = 'live';
    view.rerender(<App />);
    await settle();
    expect(fake.events.map((e) => e.text)[0]).toMatch(/^You have just greeted them; do not greet or introduce yourself again\./);
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
    expect(fake.events.map((e) => e.text).join(' ')).toContain('Not right: wrong stroke ORDER');
    await act(async () => { draw([[150, 450], [850, 450]], { samples: 40 }); });     // the horizontal
    await settle();
    expect(screen.getByText('Correct')).toBeTruthy();
    expect(fake.events.map((e) => e.text).join(' ')).toContain('Right: the stroke they drew was correct');
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
    expect(result).toMatch(/^Refused: Finish this stroke first\./);
    expect(screen.getByText(/Write stroke/).textContent).toContain('1 of 2');
  });
});

describe('nothing started for one call acts on another', () => {
  const heading = () => screen.getByRole('heading', { level: 1 }).textContent;
  /** A call that fails while its sheet is being laid out, then is placed again and goes live. */
  async function failedThenCalledAgain() {
    fake.phase = 'starting';
    const view = render(<App />);
    await settle();
    fake.phase = 'failed';
    view.rerender(<App />);
    await settle();
    fake.phase = 'starting';
    view.rerender(<App />);
    await settle();
    fake.phase = 'live';
    view.rerender(<App />);
    await settle();
    return view;
  }

  it("a sheet laid out for a failed call, answering after the next call laid its own, is dropped", async () => {
    holdNext((p) => p === '/lessons');
    await failedThenCalledAgain();
    fireEvent.click(button(/Tree, 4 strokes/));
    await settle();
    expect(heading()).toBe('Tree');
    fake.events.length = 0;
    await release();
    await settle();
    expect(heading()).toBe('Tree');           // not back to an empty menu
    expect(fake.events).toEqual([]);          // and no second opening
    expect(await tool('show_stroke')).toMatch(/^Done: they asked to be shown it/);   // Ren still acts on the learner's sheet
  });

  it("a failure from that stale lay-out does not break the sheet in use", async () => {
    holdNext((p) => p === '/lessons', true);
    await failedThenCalledAgain();
    await release();
    await settle();
    expect(screen.queryByText("Your sheet couldn't be laid out.")).toBeNull();
    expect(heading()).toBe('What would you like to write?');
  });

  it('a late answer never rolls the sheet back over a newer one, nor speaks for it', async () => {
    await live();
    await tool('choose_character', { character: 'ten' });
    holdNext((p) => p.endsWith('/stroke'));
    await act(async () => { draw([[500, 120], [500, 880]], { samples: 40 }); });   // out of order; graded, its answer slow
    await settle();
    await tool('show_stroke');                                                     // Ren shows the stroke meanwhile
    expect(screen.getByText('Shown to you')).toBeTruthy();
    fake.events.length = 0;
    await release();
    await settle();
    expect(screen.getByText('Shown to you')).toBeTruthy();
    expect(screen.queryByText('Wrong order')).toBeNull();
    expect(fake.events).toEqual([]);
  });

  it("the coaching line waiting for Ren's quiet is not sent after the page is gone", async () => {
    const view = await live();
    await tool('choose_character', { character: 'ten' });
    fake.speaking = true;
    view.rerender(<App />);
    fireEvent.click(button('Show me'));                                            // held while Ren speaks
    await settle();
    fake.speaking = false;
    view.rerender(<App />);                                                        // the quiet timer starts
    fake.events.length = 0;
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(fake.events).toEqual([]);
  });
});

describe('a sheet the server no longer has', () => {
  const heading = () => screen.getByRole('heading', { level: 1 }).textContent;

  it('a button on a lost sheet lays out a fresh one and says so, and the learner carries on', async () => {
    await live();
    await tool('choose_character', { character: 'ten' });
    gone.add(lessonId());
    fake.events.length = 0;
    fireEvent.click(button('Show me'));
    await settle();
    expect(heading()).toBe('What would you like to write?');
    expect(screen.getByRole('alert').textContent).toContain('Your sheet had to be set up again');
    expect(fake.events.map((e) => e.text).join(' ')).toContain('the sheet had been lost and has been set up again');
    fireEvent.click(button(/Tree, 4 strokes/));
    await settle();
    expect(heading()).toBe('Tree');
  });

  it("Ren's tool on a lost sheet lays out a fresh one and tells Ren, never an error", async () => {
    await live();
    await tool('choose_character', { character: 'ten' });
    gone.add(lessonId());
    expect(await tool('next_stroke')).toMatch(/^Not yet: the sheet had been lost and has been set up again/);
    expect(heading()).toBe('What would you like to write?');
    expect(await tool('choose_character', { character: 'river' })).toMatch(/^Done: 川 is on the sheet/);
  });

  it('a stroke on a lost sheet does the same', async () => {
    await live();
    await tool('choose_character', { character: 'ten' });
    gone.add(lessonId());
    await act(async () => { draw([[150, 450], [850, 450]], { samples: 40 }); });
    await settle();
    expect(heading()).toBe('What would you like to write?');
    expect(screen.getByRole('alert').textContent).toContain('Your sheet had to be set up again');
  });

  it('calling Ren again after the sheet was lost lays out a fresh one, not a welcome back to the dead one', async () => {
    const view = await live();
    await tool('choose_character', { character: 'ten' });
    fake.phase = 'ended';
    view.rerender(<App />);
    await settle();
    gone.add(lessonId());
    const layouts = requests.filter((r) => r.path === '/lessons').length;
    fake.phase = 'starting';
    view.rerender(<App />);
    await settle();
    fake.phase = 'live';
    view.rerender(<App />);
    await settle();
    expect(requests.filter((r) => r.path === '/lessons').length).toBe(layouts + 1);
    expect(heading()).toBe('What would you like to write?');
    const said = fake.events.map((e) => e.text).join(' ');
    expect(said).not.toContain('They are back at their sheet');
    expect(said).toContain('the sheet had been lost and has been set up again');
  });

  it('calling Ren again on a sheet that is still there welcomes the learner back to it', async () => {
    const view = await live();
    await tool('choose_character', { character: 'ten' });
    fake.phase = 'ended';
    view.rerender(<App />);
    await settle();
    fake.phase = 'starting';
    view.rerender(<App />);
    await settle();
    fake.phase = 'live';
    view.rerender(<App />);
    await settle();
    expect(heading()).toBe('Ten');
    expect(fake.events.map((e) => e.text).join(' ')).toContain('They are back at their sheet');
  });
});

describe('a stroke in flight while the sheet moves on', () => {
  it('a stroke that reaches the server after Ren started the character over is not graded on the fresh sheet', async () => {
    await live();
    await tool('choose_character', { character: 'ten' });
    await tool('show_stroke');
    await tool('next_stroke');                                                       // stroke 2 of 2 is live
    arriveLate((p) => p.endsWith('/stroke'));
    await act(async () => { draw([[150, 450], [850, 450]], { samples: 40 }); });   // aimed at stroke 2; slow to arrive
    await settle();
    await tool('start_over');                                                        // reaches the server first
    await arrive();
    await settle();
    expect(screen.getByText(/Write stroke/).textContent).toContain('1 of 2');
    expect(screen.queryByText('Correct')).toBeNull();                                // not graded against stroke 1
    expect(screen.getByRole('alert').textContent).toContain('The sheet moved on before that stroke arrived');
  });
});

describe("Ren's tool on a lost sheet says what really happened", () => {
  /** A coaching line waiting for Ren to finish speaking, about the sheet that is about to be lost. */
  async function lineWaiting() {
    const view = await live();
    await tool('choose_character', { character: 'ten' });
    fake.speaking = true;
    view.rerender(<App />);
    await act(async () => { draw([[150, 450], [850, 450]], { samples: 40 }); });   // right: its line waits for Ren's quiet
    await settle();
    gone.add(lessonId());
    return view;
  }
  async function quietNow(view: ReturnType<typeof render>) {
    fake.events.length = 0;
    fake.speaking = false;
    view.rerender(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  }

  it('a fresh sheet: Ren is told so, and the old sheet\'s waiting line is dropped', async () => {
    const view = await lineWaiting();
    expect(await tool('next_stroke')).toMatch(/^Not yet: the sheet had been lost and has been set up again/);
    await quietNow(view);
    expect(fake.events.map((e) => e.text).join(' ')).not.toContain('Right: the stroke they drew was correct');
  });

  it('no fresh sheet either: Ren is not told there is one, and the old line is dropped', async () => {
    const view = await lineWaiting();
    failLayouts = 1;
    const result = await tool('next_stroke');
    expect(result).toMatch(/^Refused: their sheet was lost and a new one could not be set up/);
    expect(result).not.toContain('has been set up again');
    expect(screen.getByText("Your sheet couldn't be laid out.")).toBeTruthy();
    await quietNow(view);
    expect(fake.events.map((e) => e.text).join(' ')).not.toContain('Right: the stroke they drew was correct');
  });

  it('a button on a lost sheet with no fresh one either: Ren hears that, not a fresh sheet', async () => {
    await live();
    await tool('choose_character', { character: 'ten' });
    gone.add(lessonId());
    failLayouts = 1;
    fake.events.length = 0;
    fireEvent.click(button('Show me'));
    await settle();
    const said = fake.events.map((e) => e.text).join(' ');
    expect(said).not.toContain('has been set up again');
    expect(said).toContain('their sheet was lost and a new one could not be set up');
  });
});

describe('a stroke in flight for stroke 1 when Ren starts the same character over', () => {
  it('is not graded on the cleared sheet', async () => {
    await live();
    await tool('choose_character', { character: 'ten' });
    arriveLate((p) => p.endsWith('/stroke'));
    await act(async () => { draw([[150, 450], [850, 450]], { samples: 40 }); });   // stroke 1, right, slow to arrive
    await settle();
    await tool('start_over');                                                        // back to stroke 1 of the same character, first
    await arrive();
    await settle();
    expect(screen.getByText(/Write stroke/).textContent).toContain('1 of 2');
    expect(screen.queryByText('Correct')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('The sheet moved on before that stroke arrived');
  });
});

describe('two recoveries of one lost sheet', () => {
  it('the slower one, overtaken, says nothing: the newer one has laid out the sheet and said so', async () => {
    await live();
    await tool('choose_character', { character: 'ten' });
    arriveLate((p) => p.endsWith('/stroke'));
    await act(async () => { draw([[150, 450], [850, 450]], { samples: 40 }); });   // a stroke on its way, slowly
    await settle();
    gone.add(lessonId());
    holdNext((p) => p === '/lessons');                                               // the first recovery's lay-out is slow
    let first: Promise<unknown> = Promise.resolve();
    act(() => { first = fake.handlers.onToolCall!({ id: 'call-next', name: 'next_stroke', arguments: {} }) as Promise<unknown>; });
    await settle();
    fake.events.length = 0;
    await arrive();                                                                  // the stroke hits the lost sheet too: a second recovery, which lands first
    await settle();
    await release();                                                                 // then the first, overtaken
    await settle();
    let result = '';
    await act(async () => { result = String(await first); });
    expect(result).not.toContain('could not be set up');
    expect(result).not.toContain('has been set up again');
    const said = fake.events.map((e) => e.text).join(' ');
    expect(said).not.toContain('could not be set up');
    expect(said).toContain('has been set up again');
    expect(screen.queryByText("Your sheet couldn't be laid out.")).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('What would you like to write?');
  });
});
