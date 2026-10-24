// @vitest-environment jsdom
/**
 * The page's wiring, with the call faked (no room, no microphone) and the
 * server scripted: Reese's tool calls reach the desk and come back as its
 * words; a button acts and Reese is told; the opening, Reese's picture of the
 * board, the screens for each phase of the call; the safety net doing a
 * clear Reese only talked about; and a file shared by the board.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileProgress } from '../../../src/avatar/files.ts';
import type { AvatarHandlers, AvatarPhase } from '../../../src/kit/useAvatar.ts';
import { FILES_NOTE, say } from '../engine/director.ts';
import type { ActReply, Board, Quote } from '../engine/types.ts';

// ─── the fake call ───────────────────────────────────────────────────────

const call = vi.hoisted(() => ({
  handlers: {} as AvatarHandlers,
  setPhase: (_: string) => {},
  setFilesAccepted: (_: boolean) => {},
  events: [] as string[],
  states: [] as string[],
  notes: [] as string[],
  drops: [] as { names: string[]; caption?: string }[],
  starts: [] as unknown[],
}));

vi.mock('../../../src/kit/index.ts', async (importOriginal) => {
  const kit = await importOriginal<typeof import('../../../src/kit/index.ts')>();
  return {
    ...kit,
    useAvatar: (_app: string, handlers: AvatarHandlers) => {
      const [phase, setPhase] = useState<AvatarPhase>('idle');
      const [filesAccepted, setFilesAccepted] = useState(false);
      call.handlers = handlers;
      call.setPhase = (p) => setPhase(p as AvatarPhase);
      call.setFilesAccepted = setFilesAccepted;
      return {
        phase, detail: '', speaking: false, caption: '', heard: '', lines: [], secondsLeft: 600, micOn: false, audioBlocked: false, filesAccepted,
        videoRef: { current: null }, audioRef: { current: null },
        start: async (opts: unknown) => { call.starts.push(opts); },
        end: async () => {}, say: () => {}, record: () => {},
        note: (text: string) => { call.notes.push(text); },
        // The host reads each file: every one is read here.
        sendFiles: async (files: File[], options?: { caption?: string; onStatus?: (p: FileProgress) => void }) => {
          call.drops.push({ names: files.map((f) => f.name), caption: options?.caption });
          files.forEach((f, index) => options?.onStatus?.({ index, name: f.name, status: 'ready' }));
          return files.map((f) => ({ name: f.name, status: 'ready' }));
        },
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
let answer: (path: string, body: any) => ActReply | Promise<ActReply>;

class FakeEventSource {
  static CLOSED = 2;
  static last: FakeEventSource | null = null;
  readyState = 1;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeEventSource.last = this; }
  close() { this.readyState = 2; }
  /** The server streaming one of the desk's own lines. */
  say(text: string, call?: number) { act(() => this.onmessage?.({ data: JSON.stringify({ type: 'say', text, ttl: 45, call }) })); }
}

/** A server answer the test releases when it wants. */
function later() {
  let release!: (reply: ActReply) => void;
  const reply = new Promise<ActReply>((resolve) => { release = resolve; });
  return { reply, release };
}

// jsdom has no scrolling; the chat panel scrolls to its last line.
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};

beforeEach(() => {
  posts = [];
  call.events = [];
  call.states = [];
  call.notes = [];
  call.drops = [];
  call.starts = [];
  answer = () => ({ seq: 1, board: empty, text: 'ok' });
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    const path = url.replace('/api/apps/market-desk', '');
    const body = JSON.parse(init.body);
    posts.push({ path, body });
    const json = path === '/desks' ? { id: 'd1', seq: 0, board: empty } : await answer(path, body);
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
    expect(posts.at(-1)).toEqual({ path: '/desks/d1/tool', body: { name: 'add_symbols', arguments: { stocks: ['Nvidia'] }, call: 0 } });
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
    await waitFor(() => expect(posts.at(-1)).toEqual({ path: '/desks/d1/act', body: { command: 'add', symbol: 'NVDA', call: 0 } }));
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
    expect(posts.at(-1)).toEqual({ path: '/desks/d1/tool', body: { name: 'clear_board', arguments: {}, call: 1 } });
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
    expect(posts.at(-1)).toEqual({ path: '/desks/d1/tool', body: { name: 'focus_symbol', arguments: { stock: 'TSLA' }, call: 1 } });
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

  // ─── a file shared by the board ──────────────────────────────────────

  it('a file is offered only while Reese takes files, with the rule for it, and goes to Reese with no line of the page\'s own', async () => {
    await enter();
    const share = () => screen.getByRole('button', { name: 'Share a file' }) as HTMLButtonElement;
    expect(share().disabled).toBe(true);
    expect(screen.getByText("Once you're in the call with Reese.")).toBeTruthy();
    act(() => call.setPhase('live'));
    expect(share().disabled).toBe(true);
    expect(screen.getByText("Reese can't take files in this call.")).toBeTruthy();
    expect(call.notes).not.toContain(FILES_NOTE);
    act(() => call.setFilesAccepted(true));
    expect(share().disabled).toBe(false);
    expect(screen.getByText(/^Drop your positions or a watchlist \(a CSV or a screenshot\) and Reese puts up what fits/)).toBeTruthy();
    expect(call.notes).toEqual([FILES_NOTE]);
    const positions = new File(['Symbol,Quantity\nAAPL,10\nMSFT,4\n'], 'positions.csv', { type: 'text/csv' });
    await act(async () => { fireEvent.change(screen.getByLabelText('Share a file'), { target: { files: [positions] } }); });
    expect(call.drops).toEqual([{ names: ['positions.csv'], caption: undefined }]);
    expect(screen.getByText('Read')).toBeTruthy();
    // Reese reacts to the drop once by himself (and fills the board through add_symbols): an event too would have him speak twice.
    expect(call.events).toEqual([]);
    expect(posts.filter((p) => p.path !== '/desks')).toEqual([]);
  });

  // ─── nothing started in one call acts on another ──────────────────────

  it('a quote promised in one call is told only to that call; a 1% move goes to whichever is on', async () => {
    await enter();
    act(() => call.setPhase('live'));            // call 1
    act(() => call.setPhase('ended'));
    act(() => call.setPhase('live'));            // the next call
    const stream = FakeEventSource.last!;
    stream.say('The quote you said was coming is on the board now: AAPL…', 1);
    expect(call.events).toEqual([]);
    stream.say('The quote you said was coming is on the board now: NVDA…', 3);
    stream.say('NVDA, the stock on watch, is up 1.20%…');
    expect(call.events).toEqual(['The quote you said was coming is on the board now: NVDA…', 'NVDA, the stock on watch, is up 1.20%…']);
  });

  it('a tool call tags its request with the call, so what lands late is told to that call only', async () => {
    await enter();
    act(() => call.setPhase('live'));
    answer = () => ({ seq: 2, board: empty, text: 'Not yet: AAPL is still on its way…' });
    await act(async () => { await call.handlers.onToolCall!({ id: 't1', name: 'add_symbols', arguments: { stocks: ['Apple'] } }); });
    expect(posts.at(-1)!.body.call).toBe(1);
  });

  it('a button answered after the call ended and another began tells neither call', async () => {
    await enter();
    act(() => call.setPhase('live'));
    const slow = later();
    answer = () => slow.reply;
    fireEvent.click(screen.getByRole('button', { name: 'NVDA' }));   // an add waits for its quote
    await waitFor(() => expect(posts.at(-1)!.path).toBe('/desks/d1/act'));
    act(() => call.setPhase('ended'));
    act(() => call.setPhase('live'));
    await act(async () => { slow.release({ seq: 2, board: withNvda, text: 'The user pressed "Add NVDA" on screen. Done: on the board now: NVDA…' }); });
    expect(call.events).toEqual([]);
    expect(await screen.findByRole('article', { name: 'On watch: NVDA' })).toBeTruthy();   // the board itself follows
  });

  it('a tool call answered after hang-up prints no refusal for a call that is over', async () => {
    await enter();
    act(() => call.setPhase('live'));
    const slow = later();
    answer = () => slow.reply;
    let done!: Promise<unknown>;
    act(() => { done = call.handlers.onToolCall!({ id: 't1', name: 'add_symbols', arguments: { stocks: ['Meta'] } }) as Promise<unknown>; });
    act(() => call.setPhase('ended'));
    await act(async () => { slow.release({ seq: 2, board: empty, text: 'Not done…', refused: 'The board only holds six — drop one first.' }); await done; });
    expect(screen.queryByText('The board only holds six — drop one first.')).toBeNull();
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
