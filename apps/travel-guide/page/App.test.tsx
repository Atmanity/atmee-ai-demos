// @vitest-environment jsdom
// The page's wiring, with the call faked (no room, no microphone) and the
// server answered in-process: the front door, the call connecting in Lumi's
// frame, a tool call answered from the server with the board following, a
// button told to Lumi, the safety net doing what Lumi forgot, and the trip
// shown when the call ends.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Snapshot } from '../engine/types.ts';
import { App } from './App.tsx';

const kit = vi.hoisted(() => ({ handlers: null as any, avatar: null as any }));
vi.mock('../../../src/kit/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/kit/index.ts')>();
  return { ...actual, useAvatar: (_app: string, handlers: unknown) => { kit.handlers = handlers; return kit.avatar; } };
});
vi.mock('./TravelMap.tsx', () => ({ TravelMap: ({ mode }: { mode: string }) => <div data-testid="map" data-mode={mode} /> }));

const world: Snapshot = {
  seq: 0, stage: 'welcome', travelerName: '', continent: '', pending: false, newsAvailable: false,
  map: null, news: null, food: null, spot: null, trip: { current: '', visited: [] },
};
const japan = (seq: number, foodShown = false): Snapshot => ({
  ...world, seq, stage: 'planning',
  map: { country: 'Japan', isoCode: 'JP', city: '', center: [36, 138], bbox: null, outline: null, attribution: '' },
  food: { country: 'Japan', dishes: [{ name: 'Ramen', description: 'Broth and noodles.', imageUrl: null }], shown: foodShown, loading: false },
  trip: { current: 'Japan', visited: [{ country: 'Japan', city: '', dishes: [], headlineCount: 0, silhouette: null }] },
});

let posts: { path: string; body: any }[];
beforeEach(() => {
  posts = [];
  Element.prototype.scrollTo = () => {};
  kit.avatar = {
    phase: 'idle', detail: '', speaking: false, caption: '', heard: '', lines: [], secondsLeft: null, micOn: false, audioBlocked: false,
    videoRef: { current: null }, audioRef: { current: null },
    start: vi.fn(() => { kit.avatar = { ...kit.avatar, phase: 'starting' }; }),
    end: vi.fn(), say: vi.fn(), record: vi.fn(), state: vi.fn(), note: vi.fn(), event: vi.fn(),
    mute: vi.fn(), unmute: vi.fn(), setMic: vi.fn(), resumeAudio: vi.fn(),
  };
  let seq = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('/api/apps/travel-guide', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    posts.push({ path, body });
    const reply = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
    if (path === '/trips') return reply({ id: 't1', snapshot: world, map: { tileUrl: 'https://tiles.test/{z}/{x}/{y}.png', attribution: 'OSM', maxZoom: 19 } });
    if (path === '/trips/t1/tool' && body.name === 'choose_destination') return reply({ snapshot: japan(++seq), result: 'Japan is on the map now.' });
    if (path === '/trips/t1/tool' && body.name === 'show_food') return reply({ snapshot: japan(++seq, true), result: 'One dish from Japan is on screen now: Ramen.' });
    if (path === '/trips/t1/act') return reply({ snapshot: japan(++seq, true), result: 'One dish from Japan is on screen now: Ramen.' });
    return { ok: false, status: 404, json: async () => ({ error: 'no_trip' }) };
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const relive = (rerender: (ui: React.ReactElement) => void, phase: string) => {
  kit.avatar = { ...kit.avatar, phase };
  rerender(<App />);
};

async function inCall() {
  const view = render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Chat by typing' }));
  await screen.findByText('The whole world is open');
  relive(view.rerender, 'live');
  act(() => kit.handlers.onLive());
  return view;
}

test('the front door says what it is and offers voice or typing', () => {
  render(<App />);
  expect(screen.getByRole('heading', { level: 1, name: 'Where to next?' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Talk to Lumi' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Chat by typing' }));
  expect(kit.avatar.start).toHaveBeenCalledWith({ mic: false });
  expect(screen.getByText('Calling Lumi…')).toBeTruthy(); // in Lumi's frame
  expect(posts[0].path).toBe('/trips');
});

test('Lumi opens from the board, and a tool call is answered from the server with the board following', async () => {
  await inCall();
  expect(kit.avatar.event).toHaveBeenCalledWith(expect.stringContaining('The map shows the whole world'), 60);
  expect(kit.avatar.state).toHaveBeenCalledWith(expect.stringContaining('no country chosen yet'));
  let said = '';
  await act(async () => { said = await kit.handlers.onToolCall({ id: 'c1', name: 'choose_destination', arguments: { place: 'Japan' } }); });
  expect(said).toBe('Japan is on the map now.');
  expect(posts.at(-1)).toEqual({ path: '/trips/t1/tool', body: { name: 'choose_destination', arguments: { place: 'Japan' } } });
  expect(screen.getByRole('heading', { level: 1, name: 'Japan' })).toBeTruthy();
  expect(screen.getByTestId('map').dataset.mode).toBe('country');
  expect(kit.avatar.state).toHaveBeenLastCalledWith(expect.stringContaining('On the map: Japan'));
});

test('a button acts at once and Lumi is told what it did', async () => {
  await inCall();
  await act(async () => { await kit.handlers.onToolCall({ id: 'c1', name: 'choose_destination', arguments: { place: 'Japan' } }); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What should I eat there?' })); });
  expect(posts.at(-1)).toEqual({ path: '/trips/t1/act', body: { action: { kind: 'food' } } });
  expect(await screen.findByText('Ramen')).toBeTruthy();
  expect(kit.avatar.event).toHaveBeenLastCalledWith('The user pressed "What should I eat there?" on screen. One dish from Japan is on screen now: Ramen.', 30);
});

test('when Lumi forgets the call, the safety net makes it and tells Lumi', async () => {
  await inCall();
  await act(async () => { await kit.handlers.onToolCall({ id: 'c1', name: 'choose_destination', arguments: { place: 'Japan' } }); });
  vi.useFakeTimers();
  act(() => kit.handlers.onUserSaid('What should I eat there?', 'spoken'));
  await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
  expect(posts.at(-1)).toEqual({ path: '/trips/t1/tool', body: { name: 'show_food', arguments: {} } });
  expect(kit.avatar.event).toHaveBeenLastCalledWith(expect.stringMatching(/^You did not call show_food.*Ramen/), 30);
});

test('when the call ends, the trip it made is on screen with a way to keep it', async () => {
  const view = await inCall();
  await act(async () => { await kit.handlers.onToolCall({ id: 'c1', name: 'choose_destination', arguments: { place: 'Japan' } }); });
  relive(view.rerender, 'ended');
  expect(screen.getByText('Your call has ended')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Download trip notes' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Call Lumi again' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Keep exploring' }));
  expect(screen.getByRole('heading', { level: 1, name: 'Japan' })).toBeTruthy();
});
