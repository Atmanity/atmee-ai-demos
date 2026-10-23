// @vitest-environment jsdom
//
// The page across calls, with the call replaced by a recorder and every server
// answer held until the test releases it: work started for one call (the
// opening, a tap, a limit re-read) that answers after that call ended, or
// once a newer call was placed, says nothing and installs nothing, and
// nothing heard in one call is used in the next.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AvatarHandlers } from '../../../src/kit/index.ts';
import { Coach } from '../engine/coach.ts';
import type { View } from '../engine/types.ts';

const fake = vi.hoisted(() => ({
  phase: 'idle' as string,
  events: [] as string[],
  handlers: {} as AvatarHandlers,
}));

vi.mock('../../../src/kit/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/kit/index.ts')>();
  return {
    ...actual,
    useAvatar: (_app: string, handlers: AvatarHandlers) => {
      fake.handlers = handlers;
      return {
        phase: fake.phase, micOn: false, lines: [], speaking: false, heard: '', caption: '', secondsLeft: null,
        state: () => {}, event: (t: string) => fake.events.push(t),
        start: async () => {}, end: async () => {}, say: () => {}, note: () => {}, record: () => {},
      };
    },
    HostVideo: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CallStatus: () => null,
    CallControls: () => null,
    ChatPanel: () => null,
  };
});

const { App } = await import('./App.tsx');

/** Every request the page makes, held until answered (or answered at once by `auto`). */
interface Request { url: string; body: { name?: string; arguments?: Record<string, unknown> } & Record<string, unknown>; answer: (body: unknown) => void }
let requests: Request[] = [];
let auto: (r: Request) => unknown = () => undefined;

const opened = (): View => new Coach({ seed: 'abc' }).open().view;
const opening = (id: string, words: string) => ({ id, view: opened(), opening: words });
const toolAnswer = (result: string) => ({ view: opened(), result });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  Object.assign(fake, { phase: 'idle', events: [], handlers: {} });
  requests = [];
  auto = () => undefined;
  vi.stubGlobal('EventSource', class { onmessage = null; close() {} });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => new Promise((resolve) => {
    const request: Request = { url, body: JSON.parse(String(init?.body ?? '{}')), answer: (body) => resolve(new Response(JSON.stringify(body), { status: 200 })) };
    requests.push(request);
    const answer = auto(request);
    if (answer !== undefined) request.answer(answer);
  })));
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The page, placed on a call phase by phase. */
function page() {
  fake.phase = 'idle';
  const view = render(<App />);
  return async (phase: string) => {
    fake.phase = phase;
    await act(async () => { view.rerender(<App />); });
  };
}
const opens = () => requests.filter((r) => r.url.endsWith('/sessions'));
const tools = () => requests.filter((r) => r.url.endsWith('/tool'));

test('an opening that answers after a newer call was placed never replaces it', async () => {
  const go = page();
  await go('starting');
  await go('failed');
  await go('starting');
  expect(opens()).toHaveLength(2);
  await act(async () => { opens()[1].answer(opening('second', 'Opening of the second call.')); });
  await act(async () => { opens()[0].answer(opening('first', 'Opening of the first call.')); });
  expect(fake.events).toEqual(['Opening of the second call.']);
  await go('live');
  auto = (r) => (r.url.endsWith('/tool') ? toolAnswer('Done: Started over.') : undefined);
  await act(async () => { await fake.handlers.onToolCall!({ id: 't', name: 'start_over', arguments: {} }); });
  expect(tools()[0].url).toContain('/sessions/second/tool');
});

test('an opening that answers after the call failed belongs to no call', async () => {
  const go = page();
  await go('starting');
  await go('failed');
  await act(async () => { opens()[0].answer(opening('first', 'Opening of a call that failed.')); });
  expect(fake.events).toEqual([]);
  await expect(fake.handlers.onToolCall!({ id: 't', name: 'start_over', arguments: {} })).rejects.toThrow('still opening');
});

test('a tap that answers after the hang-up tells no one', async () => {
  const go = page();
  await go('starting');
  await act(async () => { opens()[0].answer(opening('s1', 'Opening.')); });
  await go('live');
  await act(async () => { fireEvent.click(screen.getAllByRole('button')[0]); });
  const tap = requests.find((r) => r.url.endsWith('/act'))!;
  await go('ended');
  await act(async () => { tap.answer({ view: opened(), event: 'The user tapped the goal on the screen. Done: …' }); });
  expect(fake.events).not.toContain('The user tapped the goal on the screen. Done: …');
});

test('a tap still on its way when the call ended does not hold the next call’s buttons', async () => {
  const go = page();
  await go('starting');
  await act(async () => { opens()[0].answer(opening('s1', 'Opening.')); });
  await go('live');
  await act(async () => { fireEvent.click(screen.getAllByRole('button')[0]); });
  // The tap never answers. The call ends, and Sammy is called again.
  await go('ended');
  await go('starting');
  await go('live');
  for (const tile of screen.getAllByRole('button')) expect((tile as HTMLButtonElement).disabled).toBe(false);
});

test('words heard in the last call are not read into the next call’s limits', async () => {
  const go = page();
  await go('starting');
  await act(async () => { opens()[0].answer(opening('s1', 'Opening.')); });
  await go('live');
  act(() => { fake.handlers.onUserSaid!('I only have twenty minutes.', 'spoken'); });
  await go('ended');
  await go('starting');
  await go('live');
  auto = (r) => (r.url.endsWith('/tool') ? toolAnswer('Done: Noted on your knee.') : undefined);
  await act(async () => { await fake.handlers.onToolCall!({ id: 't', name: 'add_limits', arguments: { words: 'my knee is bad' } }); });
  expect(tools()).toHaveLength(1);
  expect(tools()[0].body.arguments?.heard).toBe('');
  // Nor does a limit said early in the new call count as one the last call's add_limits missed.
  act(() => { fake.handlers.onUserSaid!('and only twenty minutes', 'spoken'); });
  expect(tools()).toHaveLength(2);   // the re-read for this call's own add_limits, just made
});

test('a limit re-read that answers after the hang-up is not told to anyone', async () => {
  const go = page();
  await go('starting');
  await act(async () => { opens()[0].answer(opening('s1', 'Opening.')); });
  await go('live');
  auto = (r) => (r.url.endsWith('/tool') && r.body.arguments?.words === 'bad knee' ? toolAnswer('Done: Noted on your knee.') : undefined);
  await act(async () => { await fake.handlers.onToolCall!({ id: 't', name: 'add_limits', arguments: { words: 'bad knee' } }); });
  act(() => { fake.handlers.onUserSaid!('my knee is bad and I only have twenty minutes', 'spoken'); });
  const reread = tools()[1];
  expect(reread.body.arguments?.words).toBe('my knee is bad and I only have twenty minutes');
  await go('ended');
  await act(async () => { reread.answer(toolAnswer('Done: Noted on 20 minutes. Their plan will be built around it.')); });
  expect(fake.events.some((e) => e.includes('your add_limits call left out'))).toBe(false);
});

test('a limit re-read in the same call is told to Sammy', async () => {
  const go = page();
  await go('starting');
  await act(async () => { opens()[0].answer(opening('s1', 'Opening.')); });
  await go('live');
  auto = (r) => (r.url.endsWith('/tool') ? toolAnswer(r.body.arguments?.words === 'bad knee' ? 'Done: Noted on your knee.' : 'Done: Noted on 20 minutes.') : undefined);
  await act(async () => { await fake.handlers.onToolCall!({ id: 't', name: 'add_limits', arguments: { words: 'bad knee' } }); });
  await act(async () => { fake.handlers.onUserSaid!('my knee is bad and I only have twenty minutes', 'spoken'); });
  expect(fake.events.some((e) => e.includes('your add_limits call left out'))).toBe(true);
});
