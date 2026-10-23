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
/** Requests held until the test releases them, to answer late (after a hang-up, a new call, a newer trip). */
let gates: { match: (path: string, body: any) => boolean; open: Promise<void> }[];
const hold = (match: (path: string, body: any) => boolean) => {
  let release!: () => void;
  gates.push({ match, open: new Promise<void>((r) => { release = r; }) });
  return () => release();
};
beforeEach(() => {
  posts = [];
  gates = [];
  Element.prototype.scrollTo = () => {};
  kit.avatar = {
    phase: 'idle', detail: '', speaking: false, caption: '', heard: '', lines: [], secondsLeft: null, micOn: false, audioBlocked: false,
    videoRef: { current: null }, audioRef: { current: null },
    start: vi.fn(() => { kit.avatar = { ...kit.avatar, phase: 'starting' }; }),
    end: vi.fn(), say: vi.fn(), record: vi.fn(), state: vi.fn(), note: vi.fn(), event: vi.fn(),
    mute: vi.fn(), unmute: vi.fn(), setMic: vi.fn(), resumeAudio: vi.fn(),
  };
  let seq = 0;
  let trips = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('/api/apps/travel-guide', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    posts.push({ path, body });
    const trip = path === '/trips' ? ++trips : 0; // numbered when asked for, not when answered
    const gate = gates.find((g) => g.match(path, body));
    if (gate) {
      gates = gates.filter((g) => g !== gate);
      await gate.open;
    }
    const reply = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
    // Each new trip has its own id; the second one is told apart by the continent its ideas come from.
    if (path === '/trips') return reply({ id: `t${trip}`, snapshot: trip === 2 ? { ...world, continent: 'Asia' } : world, map: { tileUrl: 'https://tiles.test/{z}/{x}/{y}.png', attribution: 'OSM', maxZoom: 19 } });
    if (/^\/trips\/t\d+\/tool$/.test(path) && body.name === 'choose_destination') return reply({ snapshot: japan(++seq), result: 'Japan is on the map now.' });
    if (/^\/trips\/t\d+\/tool$/.test(path) && body.name === 'show_food') return reply({ snapshot: japan(++seq, true), result: 'One dish from Japan is on screen now: Ramen.' });
    if (/^\/trips\/t\d+\/tool$/.test(path) && body.name === 'explore_near') return reply({ snapshot: japan(++seq), result: 'Done: around Alfama, São Jorge Castle is on screen.' });
    if (/^\/trips\/t\d+\/act$/.test(path)) return reply({ snapshot: japan(++seq, true), result: 'One dish from Japan is on screen now: Ramen.' });
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
  // Who they will talk to, before the call: her face beside her name (so the image itself says nothing).
  const tag = screen.getByText('Your guide').closest('.yd-guide-tag')!;
  expect(tag.textContent).toContain('Lumi');
  expect(tag.querySelector('img')!.getAttribute('src')).toMatch(/portrait\.jpg/);
  expect(tag.querySelector('img')!.getAttribute('alt')).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Chat by typing' }));
  expect(kit.avatar.start).toHaveBeenCalledWith({ mic: false });
  expect(screen.getByText('Calling Lumi…')).toBeTruthy(); // in Lumi's frame
  expect(document.querySelector('.yd-host .call-poster')!.getAttribute('src')).toMatch(/portrait\.jpg/); // her face while the call connects
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
  // Some time later (a call just before the words means Lumi acted on them her own way, and the net stands down).
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  act(() => kit.handlers.onUserSaid('What should I eat there?', 'spoken'));
  await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
  expect(posts.at(-1)).toEqual({ path: '/trips/t1/tool', body: { name: 'show_food', arguments: {} } });
  expect(kit.avatar.event).toHaveBeenLastCalledWith(expect.stringMatching(/^You did not call show_food.*Ramen/), 30);
});

test('when it was done meanwhile (here by a button), the safety net stands down quietly', async () => {
  await inCall();
  await act(async () => { await kit.handlers.onToolCall({ id: 'c1', name: 'choose_destination', arguments: { place: 'Japan' } }); });
  vi.useFakeTimers();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  act(() => kit.handlers.onUserSaid('What should I eat there?', 'spoken'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What should I eat there?' })); await vi.advanceTimersByTimeAsync(100); });
  const told = kit.avatar.event.mock.calls.length;
  const sent = posts.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
  expect(posts.length).toBe(sent);
  expect(kit.avatar.event.mock.calls.length).toBe(told);
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

// Nothing started for one call may act on another: late answers are dropped, timers end with their call.
const hangUpAndCallAgain = (rerender: (ui: React.ReactElement) => void) => {
  relive(rerender, 'ended');
  act(() => kit.handlers.onEnded());
  relive(rerender, 'starting');
  relive(rerender, 'live');
  act(() => kit.handlers.onLive());
};

test('a slow lookup that lands after the call ended is not told to the next call', async () => {
  const view = await inCall();
  vi.useFakeTimers();
  const release = hold((path, body) => path.endsWith('/tool') && body.name === 'explore_near');
  let said = '';
  void kit.handlers.onToolCall({ id: 'c9', name: 'explore_near', arguments: { place: 'Alfama' } }).then((r: string) => { said = r; });
  await act(async () => { await vi.advanceTimersByTimeAsync(21_000); }); // past its 20 s deadline
  expect(said).toMatch(/^Not yet: still working/);
  hangUpAndCallAgain(view.rerender);
  kit.avatar.event.mockClear();
  await act(async () => { release(); await vi.advanceTimersByTimeAsync(10); });
  expect(kit.avatar.event).not.toHaveBeenCalled();
});

test('a press answered after the call ended moves the board but is not told to the next call', async () => {
  const view = await inCall();
  await act(async () => { await kit.handlers.onToolCall({ id: 'c1', name: 'choose_destination', arguments: { place: 'Japan' } }); });
  const release = hold((path) => path.endsWith('/act'));
  fireEvent.click(screen.getByRole('button', { name: 'What should I eat there?' }));
  hangUpAndCallAgain(view.rerender);
  kit.avatar.event.mockClear();
  await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
  expect(await screen.findByText('Ramen')).toBeTruthy(); // the press happened: the board shows it
  expect(kit.avatar.event).not.toHaveBeenCalled();
});

test('only the newest trip lands: an older "new trip" that answers last does not replace it', async () => {
  await inCall();
  const slow = hold((path) => path === '/trips'); // the second trip answers last
  fireEvent.click(screen.getByRole('button', { name: /Your trip/ }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start a new trip' })); });
  fireEvent.click(screen.getByRole('button', { name: /Your trip/ }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start a new trip' })); });
  await screen.findByText('The whole world is open'); // trip 3, the newest
  await act(async () => { slow(); await new Promise((r) => setTimeout(r, 0)); });
  expect(screen.queryByText('Ideas in Asia')).toBeNull(); // trip 2's board
  await act(async () => { await kit.handlers.onToolCall({ id: 'c2', name: 'choose_destination', arguments: { place: 'Japan' } }); });
  expect(posts.at(-1)!.path).toBe('/trips/t3/tool');
});

test('hanging up clears what the call left running: the "looking" note and its timer', async () => {
  const view = await inCall();
  vi.useFakeTimers();
  hold((path, body) => path.endsWith('/tool') && body.name === 'explore_near'); // never answers
  void kit.handlers.onToolCall({ id: 'c9', name: 'explore_near', arguments: { place: 'Alfama' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(screen.getByText(/Lumi is looking around Alfama/)).toBeTruthy();
  relive(view.rerender, 'ended');
  act(() => kit.handlers.onEnded());
  expect(screen.queryByText(/Lumi is looking around/)).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
