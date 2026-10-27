// @vitest-environment jsdom
//
// The page answers Hester's tool calls from the stores, with the call replaced
// by a recorder: the counter follows each call, and her picture of the window
// follows the counter.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AvatarHandlers } from '../../../src/kit/index.ts';

const fake = vi.hoisted(() => ({ phase: 'live' as string, states: [] as string[], events: [] as string[], handlers: {} as AvatarHandlers }));

vi.mock('../../../src/kit/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/kit/index.ts')>();
  return {
    ...actual,
    useAvatar: (_app: string, handlers: AvatarHandlers) => {
      fake.handlers = handlers;
      return {
        phase: fake.phase, micOn: false, lines: [], speaking: false,
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

const call = (name: string, args: Record<string, unknown> = {}) =>
  act(async () => (await fake.handlers.onToolCall!({ id: `c-${name}`, name, arguments: args })) as string);

beforeEach(() => { Object.assign(fake, { phase: 'live', states: [], events: [], handlers: {} }); });
afterEach(() => { cleanup(); });

test('the page says nothing at the start: Hester greets on her own, and the window is in her state', () => {
  fake.phase = 'starting';
  render(<App />);
  expect(fake.events).toEqual([]);
  expect(fake.states.at(-1)).toContain('30 chits');
});

test('checking the shelves lights the ledger row; the result is what she says', async () => {
  render(<App />);
  const result = await call('check_shelves', { item: 'pump gaskets' });
  expect(result).toMatch(/^In stock: Pump gasket: 2 on shelf C-4/);
  const row = screen.getByRole('rowheader', { name: /Pump gasket/ }).closest('tr')!;
  expect(row.getAttribute('aria-current')).toBe('true');
});

test('a stamp puts the slip on the counter, takes the chits and lowers the shelf', async () => {
  render(<App />);
  const result = await call('stamp_slip', { item: 'pump gasket', quantity: 1, department: 'Hydroponics', purpose: 'the drip pump leaks' });
  expect(result).toMatch(/^Stamped: slip 18-0417/);
  const slip = screen.getByRole('article', { name: 'Slip 18-0417, stamped' });
  expect(within(slip).getByText('Hydroponics')).toBeTruthy();
  expect(within(slip).getByText('the drip pump leaks')).toBeTruthy();
  expect(document.querySelector('.rq-purse b')!.textContent).toBe('18');
  expect(within(screen.getByRole('rowheader', { name: /Pump gasket/ }).closest('tr')!).getByText('1')).toBeTruthy();
  expect(fake.states.at(-1)).toContain('18 chits of the 30');
  expect(fake.states.at(-1)).toContain('18-0417, stamped');
});

test('a refusal of her own puts a refused slip on the counter, and an unknown tool is an error she hears', async () => {
  render(<App />);
  await call('refuse_slip', { item: 'a pistol', reason: 'Deputies only, and not from me' });
  expect(screen.getByRole('article', { name: 'Slip 18-0417, refused' })).toBeTruthy();
  expect(screen.getByText('Deputies only, and not from me')).toBeTruthy();
  await expect(call('open_airlock')).rejects.toThrow('unknown tool open_airlock');
});

test('the front door offers talking and typing', () => {
  fake.phase = 'idle';
  render(<App />);
  expect(screen.getByRole('button', { name: 'Step up and talk' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Step up and type' })).toBeTruthy();
});
