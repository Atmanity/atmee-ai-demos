// @vitest-environment jsdom
//
// The page's deal, with the call replaced by a recorder: every call is a new
// game dealt while Marco is on his way, and only the newest deal may install
// its game, whatever order the deals answer in.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AvatarHandlers } from '../../../src/kit/index.ts';
import type { View } from '../engine/types.ts';

const fake = vi.hoisted(() => ({ phase: 'idle' as string, states: [] as string[], events: [] as string[] }));

vi.mock('../../../src/kit/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/kit/index.ts')>();
  return {
    ...actual,
    useAvatar: (_app: string, _handlers: AvatarHandlers) => ({
      phase: fake.phase, micOn: false, lines: [], speaking: false,
      state: (t: string) => fake.states.push(t),
      event: (t: string) => fake.events.push(t),
      start: async () => {}, end: async () => {}, say: () => {}, note: () => {}, record: () => {},
    }),
    HostVideo: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CallStatus: () => null,
    CallControls: () => null,
    ChatPanel: () => null,
  };
});

const { App } = await import('./App.tsx');

const view = (round: number): View => ({
  round, rounds: 3, score: 0, over: false, hints: [], hintsTotal: 3, revealed: false, correct: false,
  photo: null, city: null, results: [],
});

beforeEach(() => { Object.assign(fake, { phase: 'idle', states: [], events: [] }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('a deal that answers after a newer one never replaces the game in play', async () => {
  // Two deals in flight: the first call's, then a second call's. The first answers last.
  const answers: ((body: unknown) => void)[] = [];
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
    answers.push((body) => resolve(new Response(JSON.stringify(body), { status: 200 })));
  })));
  fake.phase = 'starting';
  const page = render(<App />);
  fake.phase = 'failed';
  page.rerender(<App />);
  fake.phase = 'starting';
  page.rerender(<App />);
  expect(answers).toHaveLength(2);
  await act(async () => { answers[1]({ id: 'second', view: view(2), opening: 'Opening of the second game.' }); });
  await act(async () => { answers[0]({ id: 'first', view: view(1), opening: 'Opening of the first game.' }); });
  expect(fake.events).toEqual(['Opening of the second game.']);
  expect(fake.states.at(-1)).toContain('Round 2');
});
