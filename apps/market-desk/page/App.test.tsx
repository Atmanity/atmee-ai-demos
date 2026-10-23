// @vitest-environment jsdom
/**
 * The page's wiring, with the call faked (no room, no microphone) and the
 * server scripted: Reese's tool calls reach the desk and come back as its
 * words; a button acts and Reese is told; the opening, Reese's picture of the
 * board, the screens for each phase of the call; and the safety net doing a
 * clear Reese only talked about.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvatarHandlers, AvatarPhase } from '../../../src/kit/useAvatar.ts';
import { say } from '../engine/director.ts';
import type { ActReply, Board, Quote } from '../engine/types.ts';

// ─── the fake call ───────────────────────────────────────────────────────

const call = vi.hoisted(() => ({
  handlers: {} as AvatarHandlers,
  setPhase: (_: string) => {},
  events: [] as string[],
  states: [] as string[],
  starts: [] as unknown[],
}));

vi.mock('../../../src/kit/index.ts', async (importOriginal) => {
  const kit = await importOriginal<typeof import('../../../src/kit/index.ts')>();
  return {
    ...kit,
    useAvatar: (_app: string, handlers: AvatarHandlers) => {
      const [phase, setPhase] = useState<AvatarPhase>('idle');
      call.handlers = handlers;
      call.setPhase = (p) => setPhase(p as AvatarPhase);
      return {
        phase, detail: '', speaking: false, caption: '', heard: '', lines: [], secondsLeft: 600, micOn: false, audioBlocked: false,
        videoRef: { current: null }, audioRef: { current: null },
        start: async (opts: unknown) => { call.starts.push(opts); },
        end: async () => {}, say: () => {}, record: () => {}, note: () => {},
        state: (text: string) => { call.states.push(text); },
        event: (text: string) => { call.events.push(text); },
        mute: () => {}, unmute: () => {}, setMic: () => {}, resumeAudio: () => {},
      };
    },
  };
});

// ─── the scripted server ─────────────────────────────────────────────────

function quote(symbol: string): Quote {
  return {
    symbol, name: `${symbol} Inc.`, currency: 'USD', exchange: 'NasdaqGS', price: 212.55, prev_close: 212.21, change: 0.34, change_pct: 0.16,
    wk52_high: 243.37, wk52_low: 164.27, series: [210, 211, 212.55], series_start_ts: Math.floor(Date.now() / 1000) - 90 * 86400, series_step: '1d',
    as_of: Math.floor(Date.now() / 1000), stale: false, error: null,
  };
}
const empty: Board = { watchlist: [], focus: null, fetching: [], last_error: null, max_symbols: 6 };
const withNvda: Board = { ...empty, watchlist: [quote('NVDA')], focus: 'NVDA' };

let posts: { path: string; body: any }[] = [];
let answer: (path: string, body: any) => ActReply;

class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {}
  close() { this.readyState = 2; }
}

// jsdom has no scrolling; the chat panel scrolls to its last line.
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};

beforeEach(() => {
  posts = [];
  call.events = [];
  call.states = [];
  call.starts = [];
  answer = () => ({ seq: 1, board: empty, text: 'ok' });
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    const path = url.replace('/api/apps/market-desk', '');
    const body = JSON.parse(init.body);
    posts.push({ path, body });
    const json = path === '/desks' ? { id: 'd1', seq: 0, board: empty } : answer(path, body);
    return { ok: true, status: 200, json: async () => json };
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const { App } = await import('./App.tsx');

async function enter(how: 'Talk to Reese' | 'Type instead' = 'Type instead') {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: how }));
  await waitFor(() => expect(posts.some((p) => p.path === '/desks')).toBe(true));
  await screen.findByText('Nothing on the board yet');
}

describe('the page', () => {
  it('opens on the front door, and placing the call opens the board with Reese on the way', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Call out a ticker');
    expect(posts).toEqual([]);   // no board until the user comes in
    fireEvent.click(screen.getByRole('button', { name: 'Type instead' }));
    expect(call.starts).toEqual([{ mic: false }]);
    expect(screen.getAllByText('Calling Reese…').length).toBeGreaterThan(0);
    // Reese's face fills the frame until the video plays.
    expect(document.querySelector('.oc-video .call-poster')!.getAttribute('src')).toMatch(/portrait\.jpg/);
    await screen.findByText('Nothing on the board yet');
    expect(call.states.at(-1)).toContain('[Live market board] The board is empty');
  });

  it('opens with the board as it is when Reese arrives', async () => {
    await enter();
    act(() => { call.setPhase('live'); call.handlers.onLive?.(); });
    expect(call.events).toEqual([say.start()]);
  });

  it('a tool call goes to the desk and its words come back for Reese; the board follows', async () => {
    await enter();
    answer = () => ({ seq: 2, board: withNvda, text: 'On the board now: NVDA at 212.55.' });
    let result: unknown;
    await act(async () => { result = await call.handlers.onToolCall!({ id: 't1', name: 'add_symbols', arguments: { stocks: ['Nvidia'] } }); });
    expect(posts.at(-1)).toEqual({ path: '/desks/d1/tool', body: { name: 'add_symbols', arguments: { stocks: ['Nvidia'] } } });
    expect(result).toBe('On the board now: NVDA at 212.55.');
    expect(await screen.findByRole('article', { name: 'On watch: NVDA' })).toBeTruthy();
    await waitFor(() => expect(call.states.at(-1)).toContain('NVDA 212.55 +0.16%'));
  });

  it('a tool call the board refused prints the refusal for the user too', async () => {
    await enter();
    answer = () => ({ seq: 2, board: empty, text: 'Did NOT go up…', refused: 'The board only holds six — drop one first.' });
    await act(async () => { await call.handlers.onToolCall!({ id: 't1', name: 'add_symbols', arguments: { stocks: ['Meta'] } }); });
    expect(screen.getByText('The board only holds six — drop one first.').className).toBe('oc-notice');
  });

  it('a button acts at once, and Reese is told what it did only while on the line', async () => {
    await enter();
    answer = () => ({ seq: 2, board: withNvda, text: 'The user pressed "Add NVDA" on screen. On the board now: NVDA…' });
    fireEvent.click(screen.getByRole('button', { name: 'NVDA' }));
    await waitFor(() => expect(posts.at(-1)).toEqual({ path: '/desks/d1/act', body: { command: 'add', symbol: 'NVDA' } }));
    expect(call.events).toEqual([]);   // not on the line yet: the opening will read the board
    act(() => call.setPhase('live'));
    fireEvent.click(await screen.findByLabelText('Refresh NVDA'));
    await waitFor(() => expect(call.events).toEqual(['The user pressed "Add NVDA" on screen. On the board now: NVDA…']));
  });

  it('the safety net does a clear Reese only talked about, and tells Reese', async () => {
    await enter();
    act(() => call.setPhase('live'));
    vi.useFakeTimers({ shouldAdvanceTime: false });
    answer = (_path, body) => ({ seq: 3, board: empty, text: body.name === 'clear_board' ? 'The board is clear.' : 'ok' });
    act(() => call.handlers.onUserSaid?.('Clear the board, please', 'spoken'));
    await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
    expect(posts.at(-1)).toEqual({ path: '/desks/d1/tool', body: { name: 'clear_board', arguments: {} } });
    expect(call.events.at(-1)).toMatch(/^You did not call clear_board, so the app did it for the player just now: The page cleared the board itself, not you: you had not called clear_board\. The board is clear\./);
  });

  it('the safety net brings a stock on the board to the front when Reese only said so', async () => {
    await enter();
    answer = () => ({ seq: 2, board: { ...withNvda, watchlist: [quote('NVDA'), quote('TSLA')] }, text: 'ok' });
    await act(async () => { await call.handlers.onToolCall!({ id: 't1', name: 'add_symbols', arguments: { stocks: ['NVDA', 'TSLA'] } }); });
    act(() => call.setPhase('live'));
    vi.useFakeTimers({ shouldAdvanceTime: false });
    answer = (_path, body) => ({ seq: 3, board: { ...withNvda, focus: 'TSLA' }, text: body.name === 'focus_symbol' ? 'Done: TSLA is front and centre now.' : 'ok' });
    // A while after the add (the net stands down if another tool ran just before the words).
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    act(() => call.handlers.onUserSaid?.('Pull up Tesla.', 'spoken'));
    await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
    expect(posts.at(-1)).toEqual({ path: '/desks/d1/tool', body: { name: 'focus_symbol', arguments: { stock: 'TSLA' } } });
    expect(call.events.at(-1)).toContain('The page brought TSLA to the front itself, not you: you had not called focus_symbol. Call focus_symbol yourself whenever the user says pull up, show me, bring up, go to or back to. Done: TSLA is front and centre now.');
  });

  it('the safety net stays out of it when Reese called the tool', async () => {
    await enter();
    act(() => call.setPhase('live'));
    vi.useFakeTimers({ shouldAdvanceTime: false });
    act(() => call.handlers.onUserSaid?.('Clear the board', 'spoken'));
    await act(async () => { await call.handlers.onToolCall!({ id: 't1', name: 'clear_board', arguments: {} }); });
    const before = posts.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
    expect(posts.length).toBe(before);
  });

  it('when the call ends, the closing sheet sums up the board', async () => {
    await enter();
    answer = () => ({ seq: 2, board: withNvda, text: 'ok' });
    await act(async () => { await call.handlers.onToolCall!({ id: 't1', name: 'add_symbols', arguments: { stocks: ['NVDA'] } }); });
    act(() => call.setPhase('ended'));
    expect(screen.getByRole('region', { name: 'Closing sheet' }).textContent).toContain('Your board when you hung up');
    fireEvent.click(screen.getAllByRole('button', { name: 'Call Reese again' })[0]);
    expect(call.starts.at(-1)).toEqual({ mic: false });
  });
});
