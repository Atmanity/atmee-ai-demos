// @vitest-environment jsdom
/**
 * The tour with its calls stood in for: Edmund's (useAvatar('museum-guide'))
 * and a guest's (useAvatar('museum-guide/guest/<id>')) are fakes whose phase
 * the test sets, and the camera and the label scanner are fakes the test
 * drives. Everything else is the real page: a work's entry opening as it is
 * introduced, and the hand-over to a guest and back.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Avatar, AvatarHandlers } from '../../../src/kit/index.ts';
import type { Exhibit } from '../engine/catalogue.ts';

const calls = vi.hoisted(() => ({
  host: null as unknown as Avatar, guest: null as unknown as Avatar,
  handlers: {} as Record<'host' | 'guest', AvatarHandlers>, guestApp: '',
  label: null as null | ((e: Exhibit) => void), scanning: false, cameraStarts: 0, cameraState: 'on' as 'on' | 'off',
}));

vi.mock('../../../src/kit/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/kit/index.ts')>();
  return {
    ...real,
    useAvatar: (app: string, handlers: AvatarHandlers) => {
      const role = app === 'museum-guide' ? 'host' : 'guest';
      calls.handlers[role] = handlers;
      if (role === 'guest') calls.guestApp = app;
      return calls[role];
    },
  };
});

const track = { kind: 'video' } as unknown as MediaStreamTrack;
vi.mock('./camera.ts', () => ({
  useCamera: () => ({ state: calls.cameraState, videoRef: { current: null }, track, start: async () => { calls.cameraStarts++; calls.cameraState = 'on'; return track; }, stop: () => { calls.cameraState = 'off'; } }),
  useLabelScanner: (_video: unknown, active: boolean, onLabel: (e: Exhibit) => void) => { calls.label = onLabel; calls.scanning = active; },
  grabFrame: () => 'jpeg',
}));

const { App } = await import('./App.tsx');
const { exhibitById } = await import('../engine/catalogue.ts');

function fakeAvatar(phase: Avatar['phase']): Avatar {
  return {
    phase, detail: '', speaking: false, caption: '', heard: '', lines: [], secondsLeft: null, micOn: false, audioBlocked: false,
    videoRef: { current: null }, audioRef: { current: null },
    start: vi.fn(async () => undefined), end: vi.fn(async () => undefined), say: vi.fn(), record: vi.fn(), interrupt: vi.fn(), state: vi.fn(), note: vi.fn(), event: vi.fn(),
    mute: vi.fn(), unmute: vi.fn(), setMic: vi.fn(), feedMic: vi.fn(async () => {}), setCamera: vi.fn(async () => {}), resumeAudio: vi.fn(),
    filesAccepted: false, sendFiles: vi.fn(async () => []),
  };
}

const pearl = () => exhibitById('pearl-earring')!;
const mona = () => exhibitById('mona-lisa')!;
const events = (a: Avatar) => (a.event as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));

/** Through the front door, with Edmund live and greeted. */
async function onTour() {
  const view = render(<App />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Begin the tour' })); });
  // The call is placed without the camera; it opens once Edmund is on the line, and he is shown it.
  expect(calls.host.start).toHaveBeenCalledWith({ mic: true, micMuted: true, language: 'en' });
  expect(calls.cameraStarts).toBe(0);
  calls.host.phase = 'live';
  const rerender = () => view.rerender(<App />);
  await act(async () => { calls.handlers.host.onLive?.(); rerender(); });
  expect(calls.cameraStarts).toBe(1);
  expect(calls.host.setCamera).toHaveBeenCalledWith(track);
  return { ...view, update: () => act(() => rerender()) };
}

/** The guest's call goes live (as the kit reports it). */
function guestArrives(update: () => void) {
  calls.guest.phase = 'live';
  act(() => { calls.handlers.guest.onLive?.(); });
  update();
}

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  Element.prototype.scrollTo = (() => undefined) as Element['scrollTo'];
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  try { localStorage.clear(); } catch { /* no storage */ }
  calls.host = fakeAvatar('idle');
  calls.guest = fakeAvatar('idle');
  calls.label = null;
  calls.cameraStarts = 0;
  calls.cameraState = 'off';
});
afterEach(() => { cleanup(); });

describe('a work, introduced', () => {
  it('opens its entry when its label is scanned, tells Edmund once, and pauses the scanner while it is open', async () => {
    const { update } = await onTour();
    expect(calls.scanning).toBe(true);
    act(() => calls.label!(pearl()));
    update();
    expect(screen.getByRole('region', { name: 'Girl with a Pearl Earring' })).toBeTruthy();
    expect(events(calls.host).some((e) => e.includes('just scanned the label of "Girl with a Pearl Earring"'))).toBe(true);
    expect(calls.scanning).toBe(false);
    // The same label again (still in view) is not a new arrival.
    act(() => calls.label!(pearl()));
    expect(events(calls.host).filter((e) => e.includes('scanned the label')).length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back to camera' }));
    expect(screen.queryByRole('region', { name: 'Girl with a Pearl Earring' })).toBeNull();
    expect(calls.scanning).toBe(true);
  });

  it('offers the guest on the entry of a work that has one, and not on one that does not', async () => {
    const { update } = await onTour();
    act(() => calls.label!(mona()));
    update();
    expect(screen.queryByRole('button', { name: /^Meet / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to camera' }));
    act(() => calls.label!(pearl()));
    update();
    expect(screen.getByRole('button', { name: 'Meet the girl' })).toBeTruthy();
  });
});

describe('the tour\'s language', () => {
  it('is picked at the front door: the calls are in it, Edmund keeps to it, and the screen and the works are in it', async () => {
    const view = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    fireEvent.click(screen.getByRole('radio', { name: /繁體中文/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: '開始導覽' })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '開始導覽' })); });
    expect(calls.host.start).toHaveBeenCalledWith({ mic: true, micMuted: true, language: 'zh-TW' });
    expect(String((calls.host.note as ReturnType<typeof vi.fn>).mock.calls[0][0])).toMatch(/Traditional Chinese.*Speak only in it/);
    calls.host.phase = 'live';
    await act(async () => { calls.handlers.host.onLive?.(); view.rerender(<App />); });
    act(() => calls.label!(pearl()));
    act(() => view.rerender(<App />));
    expect(screen.getByRole('region', { name: '戴珍珠耳環的少女' })).toBeTruthy();
    expect(screen.getByText('回到相機')).toBeTruthy();
    expect(screen.getByRole('button', { name: '和畫中少女說話' })).toBeTruthy();
    // Edmund is told the work in the visitor's language.
    expect(String((calls.host.state as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0])).toContain('They are at: "戴珍珠耳環的少女"');
    // And it is kept for the next visit.
    expect(localStorage.getItem('meridian-language')).toBe('zh-TW');
  });
});

describe('the camera button', () => {
  it('turns the camera off (taken from the call, scanner paused) and back on (shown to Edmund again)', async () => {
    const { update } = await onTour();
    fireEvent.click(screen.getByRole('button', { name: 'Turn the camera off' }));
    update();
    expect(calls.host.setCamera).toHaveBeenLastCalledWith(null);
    expect(calls.scanning).toBe(false);
    expect(screen.getByText(/The camera is off/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'What is this?' }) as HTMLButtonElement).disabled).toBe(true);
    expect(String((calls.host.state as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0])).toContain('camera is off');
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /Turn the camera on/ })[0]); });
    update();
    expect(calls.cameraStarts).toBe(2);
    expect(calls.host.setCamera).toHaveBeenLastCalledWith(track);
    expect(calls.scanning).toBe(true);
  });
});

describe('a guest from the painting', () => {
  it('is introduced by Edmund\'s tool only at a work with a guest', async () => {
    await onTour();
    let result: unknown;
    await act(async () => { result = await calls.handlers.host.onToolCall?.({ id: '1', name: 'introduce_guest', arguments: {} }); });
    expect(String(result)).toMatch(/^No guest: the visitor is not at a work/);
    expect(calls.guest.start).not.toHaveBeenCalled();
  });

  it('joins on its own call; Edmund steps aside, muted, without leaving', async () => {
    const { update } = await onTour();
    act(() => calls.label!(pearl()));
    update();
    let result: unknown;
    await act(async () => { result = await calls.handlers.host.onToolCall?.({ id: '1', name: 'introduce_guest', arguments: {} }); });
    expect(String(result)).toMatch(/^Handing over: the girl/);
    update();
    expect(calls.guestApp).toBe('museum-guide/guest/girl');
    expect(calls.guest.start).toHaveBeenCalledWith({ mic: true, micMuted: true, camera: track, language: 'en' });
    // A second introduction while the first is under way does nothing.
    await act(async () => { result = await calls.handlers.host.onToolCall?.({ id: '2', name: 'introduce_guest', arguments: {} }); });
    expect(String(result)).toMatch(/^Not now/);

    guestArrives(update);
    expect(calls.host.mute).toHaveBeenCalled();
    expect(calls.host.end).not.toHaveBeenCalled();
    expect((calls.guest.state as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('You are the girl from "Girl with a Pearl Earring"');
    expect(screen.getByText('Talking with')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Call Edmund back' })).toBeTruthy();
  });

  it('hands back to Edmund at once when called: he is told whom the visitor met, and the guest\'s call ends', async () => {
    const { update } = await onTour();
    act(() => calls.label!(pearl()));
    update();
    fireEvent.click(screen.getByRole('button', { name: 'Meet the girl' }));
    update();
    expect(events(calls.host).some((e) => e.startsWith('The visitor pressed "Meet the girl"'))).toBe(true);
    guestArrives(update);

    fireEvent.click(screen.getByRole('button', { name: 'Call Edmund back' }));
    expect(events(calls.guest).some((e) => e.startsWith('The visitor asked for Edmund'))).toBe(true);
    await waitFor(() => expect(calls.host.unmute).toHaveBeenCalled(), { timeout: 4000 });
    update();
    expect(calls.host.start).toHaveBeenCalledTimes(1);   // no new session: he was still there
    expect(events(calls.host).some((e) => e.includes('you are back after the visitor talked with the girl at "Girl with a Pearl Earring"'))).toBe(true);
    expect(calls.guest.end).toHaveBeenCalled();
    expect(screen.queryByText('Talking with')).toBeNull();
    expect(screen.getByText('You are at')).toBeTruthy();
  });

  it('when his session ran out meanwhile, calling him back starts a new one, and the tour goes on', async () => {
    const { update } = await onTour();
    act(() => calls.label!(pearl()));
    update();
    fireEvent.click(screen.getByRole('button', { name: 'Meet the girl' }));
    update();
    guestArrives(update);
    calls.host.phase = 'ended';
    act(() => { calls.handlers.host.onEnded?.(); });
    update();
    expect(screen.getByText('Talking with')).toBeTruthy();   // not the visit card
    fireEvent.click(screen.getByRole('button', { name: 'Call Edmund back' }));
    expect(calls.host.start).toHaveBeenCalledTimes(2);
  });

  it('could not come: Edmund carries on and says so', async () => {
    const { update } = await onTour();
    act(() => calls.label!(pearl()));
    update();
    fireEvent.click(screen.getByRole('button', { name: 'Meet the girl' }));
    update();
    calls.guest.phase = 'failed';
    update();
    expect(events(calls.host).some((e) => e.startsWith('Guest not coming: the girl could not join just now'))).toBe(true);
    // The entry closed for the hand-over; reopened, the visitor can try again.
    fireEvent.click(screen.getByRole('button', { name: /You are at/ }));
    expect(screen.getByRole('button', { name: 'Meet the girl' })).toBeTruthy();
  });

  it('End while a guest talks ends both calls and shows the visit', async () => {
    const { update } = await onTour();
    act(() => calls.label!(pearl()));
    update();
    fireEvent.click(screen.getByRole('button', { name: 'Meet the girl' }));
    update();
    guestArrives(update);
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    expect(calls.host.end).toHaveBeenCalled();
    expect(calls.guest.end).toHaveBeenCalled();
    calls.guest.phase = 'ended';
    act(() => { calls.handlers.guest.onEnded?.(); });
    update();
    expect(screen.getByText('Thank you for visiting')).toBeTruthy();
  });
});
