// @vitest-environment jsdom
//
// Nothing started for one call may act on another. The call is replaced by a
// recorder whose phase the test sets, and every request to the server waits
// until the test answers it, so answers can come late: after a hang-up, after
// a failed call was placed again, after a new call set a fresh table.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AvatarHandlers, ToolCall } from '../../../src/kit/index.ts';
import { Advisor } from '../engine/advisor.ts';
import type { NutritionData, Outcome, View } from '../engine/types.ts';

const fake = vi.hoisted(() => ({
  phase: 'idle' as string,
  states: [] as string[],
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
        phase: fake.phase, micOn: false, lines: [], speaking: false, secondsLeft: null,
        state: (t: string) => fake.states.push(t),
        event: (t: string) => fake.events.push(t),
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

/** Every request the page makes, held until the test answers it. */
let requests: { url: string; body: any; answer: (body: unknown) => void }[] = [];

beforeEach(() => {
  Object.assign(fake, { phase: 'idle', states: [], events: [], handlers: {} });
  requests = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => new Promise((resolve) => {
    requests.push({ url, body: JSON.parse(String(init?.body ?? '{}')), answer: (body) => resolve(new Response(JSON.stringify(body), { status: 200 })) });
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const food = (name: string): NutritionData => ({
  product_name: name, serving_size: '1 medium (118 g)', calories: 105,
  nutrients: { protein_g: 1.3, carbs_g: 27, fat_g: 0.4, fiber_g: 3.1, sugar_g: 14.4, sodium_mg: 1 },
  health_score: 9, health_summary: 'Sweet, with fiber.', recipes: [{ name: 'Banana oat smoothie', description: 'Blend it.' }],
  source: 'estimate', portion_assumed: true,
});
const empty = (): View => new Advisor().view();
const withCard = (name: string): View => { const a = new Advisor(); a.show(food(name)); return a.view(); };
const cardOutcome = (name: string): Outcome => ({ view: withCard(name), kind: 'card', card: true, text: `Done: on screen now, the nutrition card for "${name}".` });

const page = { rerender: (_: React.ReactElement) => {} };
function phase(next: string) {
  fake.phase = next;
  page.rerender(<App />);
}
/** A call placed and live, its table set from `first`. */
async function liveCall(id: string, first: View = empty()) {
  phase('starting');
  const setup = requests.at(-1)!;
  expect(setup.url).toMatch(/\/visits$/);
  await act(async () => { setup.answer({ id, view: first, opening: `Opening ${id}.` }); });
  phase('live');
}

test('a table set for a failed call never replaces the one set for the call placed after it', async () => {
  fake.phase = 'starting';
  Object.assign(page, render(<App />));
  phase('failed');
  phase('starting');
  expect(requests.map((r) => r.url)).toEqual(['/api/apps/nutrition-advisor/visits', '/api/apps/nutrition-advisor/visits']);
  await act(async () => { requests[1].answer({ id: 'second', view: empty(), opening: 'Opening second.' }); });
  await act(async () => { requests[0].answer({ id: 'first', view: withCard('Medium banana'), opening: 'Opening first.' }); });
  expect(fake.events).toEqual(['Opening second.']);
  expect(fake.states.at(-1)).not.toContain('Medium banana');
  // Rachel's next call goes to the second call's table.
  phase('live');
  await act(async () => { void Promise.resolve(fake.handlers.onToolCall!({ id: 't', name: 'look_up_food', arguments: { foods: ['apple'] } } as ToolCall)).catch(() => {}); });
  expect(requests.at(-1)!.url).toBe('/api/apps/nutrition-advisor/visits/second/tool');
});

test('a lookup that answers after the call ended and a new one began never lands on the new table', async () => {
  fake.phase = 'idle';
  Object.assign(page, render(<App />));
  await liveCall('v1');
  let result: Promise<unknown> | undefined;
  await act(async () => { result = Promise.resolve(fake.handlers.onToolCall!({ id: 't', name: 'look_up_food', arguments: { foods: ['banana'] } } as ToolCall)).catch(() => 'dropped'); });
  const lookup = requests.at(-1)!;
  expect(lookup.url).toMatch(/visits\/v1\/tool$/);
  phase('ended');
  await liveCall('v2');
  const before = requests.length;
  await act(async () => { lookup.answer(cardOutcome('Medium banana')); await result; });
  expect(fake.states.at(-1)).toMatch(/Nothing is on the user's screen yet/);
  expect(fake.states.some((s) => s.includes('Medium banana'))).toBe(false);
  // Nor is the old card's make-ahead sent to either table.
  expect(requests.slice(before).map((r) => r.body.command)).not.toContain('prepare');
});

test('a button pressed in one call says nothing and changes nothing once that call has ended', async () => {
  fake.phase = 'idle';
  Object.assign(page, render(<App />));
  await liveCall('v1');
  await act(async () => { fireEvent.click(screen.getByText('Banana')); });
  const pick = requests.at(-1)!;
  expect(pick.body).toEqual({ command: 'lookup', food: 'Banana' });
  phase('ended');
  const eventsBefore = fake.events.length;
  await act(async () => { pick.answer({ ...cardOutcome('Medium banana'), text: 'The user pressed "banana" on screen. Done.' }); });
  expect(fake.events.length).toBe(eventsBefore);
  expect(screen.queryByText(/Your notes from today/)).toBeNull();   // nothing was looked up in that call
  expect(screen.queryByText(/That didn't go through/)).toBeNull();
});

test('a recipe still loading when the call ends leaves no timer behind', async () => {
  vi.useFakeTimers();
  fake.phase = 'idle';
  Object.assign(page, render(<App />));
  await liveCall('v1', withCard('Medium banana'));
  await act(async () => { fireEvent.click(screen.getByText('Banana oat smoothie')); });
  expect(requests.at(-1)!.body).toMatchObject({ command: 'recipe', name: 'Banana oat smoothie' });
  expect(vi.getTimerCount()).toBe(1);   // the spinner's deadline, while the call is on
  phase('ended');
  expect(vi.getTimerCount()).toBe(0);
});

test('a new call starts from an empty table, not the last call\'s board', async () => {
  fake.phase = 'idle';
  Object.assign(page, render(<App />));
  await liveCall('v1', withCard('Medium banana'));
  expect(fake.states.at(-1)).toContain('Medium banana');
  phase('ended');
  phase('starting');   // the new table has not answered yet
  expect(fake.states.at(-1)).toMatch(/Nothing is on the user's screen yet/);
});

describe('an overtaken reply keeps its words, not its screen', () => {
  const smoothie = { recipe_name: 'Banana oat smoothie', description: 'Blend it.', ingredients: ['1 banana'], preparation_steps: ['Peel it.', 'Blend it.'] };
  const at = (seq: number, view: View): View => ({ ...view, seq });
  const toolCall = (name: string, args: Record<string, unknown> = {}) =>
    act(async () => { void Promise.resolve(fake.handlers.onToolCall!({ id: name, name, arguments: args } as ToolCall)).catch(() => {}); });

  test('a "start over" overtaken by a newer recipe neither closes it nor wipes the notes', async () => {
    fake.phase = 'idle';
    Object.assign(page, render(<App />));
    await liveCall('v1', at(1, withCard('Medium banana')));
    await toolCall('start_over');
    const clear = requests.at(-1)!;
    await toolCall('open_recipe', { recipe: 'the first one' });
    const open = requests.at(-1)!;
    await act(async () => { open.answer({ view: at(3, withCard('Medium banana')), kind: 'recipe', recipe: smoothie, text: 'Done: on screen now, the recipe.' }); });
    expect(fake.states.at(-1)).toContain('On screen: the recipe card "Banana oat smoothie"');
    await act(async () => { clear.answer({ view: at(2, empty()), kind: 'cleared', text: 'Done: cleared.' }); });
    expect(fake.states.at(-1)).toContain('On screen: the recipe card "Banana oat smoothie"');
    expect(fake.states.at(-1)).toContain('Steps 1 and 2 are lit up');
    expect(screen.getByText('Save notes').closest('button')!.disabled).toBe(false);
  });

  test('a recipe overtaken by a newer card never opens over it', async () => {
    fake.phase = 'idle';
    Object.assign(page, render(<App />));
    await liveCall('v1', at(1, withCard('Medium banana')));
    await toolCall('open_recipe', { recipe: 'the first one' });
    const open = requests.at(-1)!;
    await toolCall('look_up_food', { foods: ['apple'] });
    const lookup = requests.at(-1)!;
    await act(async () => { lookup.answer({ ...cardOutcome('Medium apple'), view: at(5, withCard('Medium apple')) }); });
    await act(async () => { open.answer({ view: at(4, withCard('Medium banana')), kind: 'recipe', recipe: smoothie, text: 'Done: on screen now, the recipe.' }); });
    expect(fake.states.at(-1)).not.toContain('On screen: the recipe card');
    expect(fake.states.at(-1)).toContain('the nutrition card for "Medium apple"');
  });
});
