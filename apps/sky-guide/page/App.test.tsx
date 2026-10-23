// @vitest-environment jsdom
/**
 * Lodestar's screens with the call stood in for: the front door, the live
 * chart answering Mira's tool calls, a control told to her as it happens, and
 * the night to keep when the call ends. The call itself (useAvatar) is a fake
 * whose phase the test sets; everything else is the real app.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Avatar, AvatarHandlers } from '../../../src/kit/index.ts';

const call = vi.hoisted(() => ({ avatar: null as unknown as Avatar, handlers: null as unknown as AvatarHandlers }));

vi.mock('../../../src/kit/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/kit/index.ts')>();
  return { ...real, useAvatar: (_app: string, handlers: AvatarHandlers) => { call.handlers = handlers; return call.avatar; } };
});

const { App } = await import('./App.tsx');

const EPOCH = 1785931200;   // 2026-08-05, 8 pm in Taipei: the chart opens at 9 pm

function fakeAvatar(phase: Avatar['phase']): Avatar {
  return {
    phase, detail: '', speaking: false, caption: '', heard: '', lines: [], secondsLeft: null, micOn: false, audioBlocked: false,
    videoRef: { current: null }, audioRef: { current: null },
    start: vi.fn(async () => undefined), end: vi.fn(async () => undefined), say: vi.fn(), record: vi.fn(), state: vi.fn(), note: vi.fn(), event: vi.fn(),
    mute: vi.fn(), unmute: vi.fn(), setMic: vi.fn(), resumeAudio: vi.fn(),
  };
}

beforeAll(() => {
  // jsdom has no 2D context and no scrolling; the screens must render without either.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  Element.prototype.scrollTo = (() => undefined) as Element['scrollTo'];
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(EPOCH * 1000);
  window.history.replaceState({}, '', '/?place=Taipei');
  try { localStorage.clear(); } catch { /* no storage */ }
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the front door', () => {
  it('says what it is, shows tonight\'s real sky over the place, and lets them in by voice or typing', () => {
    call.avatar = fakeAvatar('idle');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Know what you're looking at.");
    expect((screen.getByLabelText('Your place') as HTMLSelectElement).value).toBe('taipei');
    expect(screen.getByText(/stars up, brightest/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your place'), { target: { value: 'sydney' } });
    expect((screen.getByLabelText('Your place') as HTMLSelectElement).value).toBe('sydney');
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Mira' }));
    expect(call.avatar.start).toHaveBeenCalledWith({ mic: true });
    fireEvent.click(screen.getByRole('button', { name: 'Chat by typing' }));
    expect(call.avatar.start).toHaveBeenCalledWith({ mic: false });
    expect(document.body.textContent).not.toMatch(/\b(?:session|avatar|API|Atmee|demo|sample|mini-app|tool)\b/i);
  });

  it('shows who they will talk to: Mira\'s face beside her name (so the photo itself is decorative)', () => {
    call.avatar = fakeAvatar('idle');
    const { container } = render(<App />);
    const guide = container.querySelector('.ls-guide')!;
    expect(guide.textContent).toContain('Your guide tonight is Mira');
    const face = guide.querySelector('img')!;
    expect(face.getAttribute('src')).toMatch(/portrait\.jpg/);
    expect(face.getAttribute('alt')).toBe('');
  });
});

describe('the live chart', () => {
  beforeEach(() => { call.avatar = fakeAvatar('live'); });

  it('answers Mira\'s tool call with the chart\'s outcome, and the screen follows', async () => {
    render(<App />);
    let result: unknown;
    await act(async () => { result = await call.handlers.onToolCall!({ id: '1', name: 'point_out', arguments: { star: 'Vega' } }); });
    expect(String(result)).toMatch(/^Marked: Vega, /);
    expect(screen.getByRole('heading', { name: 'Vega' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Your night · 1' })).toBeTruthy();
    await act(async () => { result = await call.handlers.onToolCall!({ id: '2', name: 'move_chart', arguments: { place: 'Lisbon', time: 'midnight' } }); });
    expect(String(result)).toContain('the sky from Lisbon at about midnight');
    expect((screen.getByLabelText('The sky from') as HTMLSelectElement).value).toBe('lisbon');
    expect(screen.getByText('12:00 am')).toBeTruthy();
  });

  it('shows a refusal from a tool call on the chart, with the hour to come back', async () => {
    render(<App />);
    let result: unknown;
    await act(async () => { result = await call.handlers.onToolCall!({ id: '1', name: 'show_constellation', arguments: { name: 'Orion' } }); });
    expect(String(result)).toMatch(/^Not up now: Orion isn't up/);
    expect(screen.getByRole('button', { name: /Show the sky at \d+:\d\d am/ })).toBeTruthy();
  });

  it('refuses a call for a tool it does not have', async () => {
    render(<App />);
    await expect(call.handlers.onToolCall!({ id: '1', name: 'teleport', arguments: {} })).rejects.toThrow('no tool called teleport');
  });

  it('a control acts at once and Mira is told; "show the sky then" draws what was refused', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Orion' }));
    expect(screen.getByRole('status').textContent).toContain("Orion isn't up at this hour from Taipei");
    expect(call.avatar.event).toHaveBeenCalledWith(expect.stringMatching(/^The user pressed Orion on the chart, and it refused: /), 20);
    fireEvent.click(screen.getByRole('button', { name: /Show the sky at/ }));
    expect(screen.getByRole('button', { name: 'Orion' }).getAttribute('aria-pressed')).toBe('true');
    expect(call.avatar.event).toHaveBeenLastCalledWith(expect.stringContaining('The user lit Orion on the chart.'), 20);
    expect(screen.getByRole('button', { name: 'Your night · 1' })).toBeTruthy();
  });

  it('shows Mira\'s face in her frame until the video plays', () => {
    call.avatar = fakeAvatar('connecting');
    const { container } = render(<App />);
    expect(container.querySelector('.ls-host-video .call-poster')?.getAttribute('src')).toMatch(/portrait\.jpg/);
  });

  it('keeps Mira\'s picture of the chart current', async () => {
    render(<App />);
    await waitFor(() => expect(call.avatar.state).toHaveBeenCalledWith(expect.stringContaining('The sky from Taipei, at about 9 in the evening')));
  });

  it('opens with the place and hour on screen when Mira arrives', () => {
    render(<App />);
    call.handlers.onLive!();
    expect(call.avatar.event).toHaveBeenCalledWith(expect.stringMatching(/^You have just greeted them; do not greet or introduce yourself again\. Lodestar is open on their screen: the sky from Taipei at about 9 in the evening/), 60);
  });

  it('sends a typed line to Mira, who calls the tools for it too', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Message Mira'), { target: { value: 'Show me Orion' } });
    fireEvent.submit(screen.getByLabelText('Message Mira').closest('form')!);
    expect(call.avatar.say).toHaveBeenCalledWith('Show me Orion');
  });

  it('turns the red light on, and remembers it', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Red light' }));
    expect(document.documentElement.dataset.light).toBe('red');
    expect(localStorage.getItem('lodestar:red-light')).toBe('on');
  });

  it('never says the plumbing words on screen', () => {
    render(<App />);
    expect(document.body.textContent).not.toMatch(/\b(?:session|avatar|API|Atmee|demo|sample|mini-app|tool|state|event)\b/i);
  });
});

describe('nothing started for one call acts on another', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a model reading that answers after hang-up, or after a new call began, is dropped: the chart stays put', async () => {
    let answer!: (value: unknown) => void;
    const fetchMock = vi.fn(() => new Promise((resolve) => { answer = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    call.avatar = fakeAvatar('live');
    const { rerender } = render(<App />);
    // "Kyoto" is not a city the rules know, so the page asks the model.
    const pending = Promise.resolve(call.handlers.onToolCall!({ id: '1', name: 'move_chart', arguments: { place: 'Kyoto' } }));
    pending.catch(() => undefined);
    await act(async () => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Mira is checking the catalogue…')).toBeTruthy();
    // Hang up, then call again, before the model answers.
    call.avatar = fakeAvatar('ended');
    act(() => call.handlers.onEnded!());
    rerender(<App />);
    expect(screen.queryByText('Mira is checking the catalogue…')).toBeNull();
    call.avatar = fakeAvatar('live');
    rerender(<App />);
    await act(async () => { answer({ ok: true, json: async () => ({ model: true, intents: [{ kind: 'set_place', lat: 35, lon: 135.8 }] }) }); });
    await expect(pending).rejects.toThrow('ended');
    expect((screen.getByLabelText('The sky from') as HTMLSelectElement).value).toBe('taipei');
    expect(call.avatar.event).not.toHaveBeenCalled();
  });

  it('a control used while the call connects is not told to the call when it starts (the opening covers the chart)', () => {
    vi.useRealTimers();   // the Date-only fakes from beforeEach would make this a no-op
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(EPOCH * 1000);
    call.avatar = fakeAvatar('connecting');
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByLabelText('An hour later'));
    call.avatar = fakeAvatar('live');
    rerender(<App />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(call.avatar.event).not.toHaveBeenCalledWith(expect.stringContaining('The user moved the chart'), 20);
  });

  it('a control\'s line still pending at hang-up is never said, in this call or the next', () => {
    vi.useRealTimers();   // the Date-only fakes from beforeEach would make this a no-op
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(EPOCH * 1000);
    call.avatar = fakeAvatar('live');
    const { rerender } = render(<App />);
    const first = call.avatar;
    fireEvent.click(screen.getByLabelText('An hour later'));
    call.avatar = fakeAvatar('ended');
    act(() => call.handlers.onEnded!());
    rerender(<App />);
    call.avatar = fakeAvatar('live');
    rerender(<App />);
    act(() => { vi.advanceTimersByTime(3000); });
    for (const avatar of [first, call.avatar]) expect(avatar.event).not.toHaveBeenCalledWith(expect.stringContaining('The user moved the chart'), 20);
  });
});

describe('the end of the call', () => {
  it('turns your night into a card to keep, with a way back', async () => {
    call.avatar = fakeAvatar('live');
    const { rerender } = render(<App />);
    await act(async () => { await call.handlers.onToolCall!({ id: '1', name: 'point_out', arguments: { star: 'Vega' } }); });
    call.avatar = fakeAvatar('ended');
    act(() => call.handlers.onEnded!());
    rerender(<App />);
    expect(screen.getByRole('heading', { name: 'Your night under the stars' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Download the list' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Call ended').length).toBe(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Call Mira again' })[0]);
    expect(call.avatar.start).toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Your night under the stars' })).toBeNull();
  });
});
