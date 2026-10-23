// @vitest-environment jsdom
/**
 * The whole page with the real planner and the kit's real parts, the call
 * faked: the front door, the call connecting, the architect's tool calls
 * changing the plan and answering with its numbers, a typed line going to her,
 * the safety net, and the end of the call.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  states: [] as string[],
  events: [] as string[],
  said: [] as string[],
  started: [] as unknown[],
  handlers: undefined as undefined | {
    onToolCall?: (call: { id: string; name: string; arguments: Record<string, unknown> }) => unknown;
    onUserSaid?: (text: string, how: 'spoken' | 'typed') => void;
  },
  setPhase: undefined as undefined | ((phase: string) => void),
}));

vi.mock('../../../src/kit/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/kit/index.ts')>();
  const { useRef, useState } = await import('react');
  return {
    ...actual,
    useAvatar: (_app: string, handlers: typeof fake.handlers) => {
      const [phase, setPhase] = useState('idle');
      fake.setPhase = setPhase;
      fake.handlers = handlers;
      const videoRef = useRef<HTMLVideoElement>(null);
      const audioRef = useRef<HTMLAudioElement>(null);
      return {
        phase, detail: '', speaking: false, caption: '', heard: '', lines: [], secondsLeft: null, micOn: false, audioBlocked: false,
        videoRef, audioRef,
        start: async (opts: unknown) => { fake.started.push(opts); setPhase('starting'); },
        end: async () => setPhase('ended'),
        say: (text: string) => { fake.said.push(text); handlers?.onUserSaid?.(text, 'typed'); },
        record: () => {}, note: () => {},
        state: (text: string) => fake.states.push(text),
        event: (text: string) => fake.events.push(text),
        mute() {}, unmute() {}, setMic() {}, resumeAudio() {},
      };
    },
  };
});

import { App } from './App.tsx';

// jsdom lays nothing out, so the conversation has nothing to scroll.
Element.prototype.scrollTo ??= function scrollTo() {};

const lastState = () => fake.states[fake.states.length - 1] ?? '';
const tool = async (name: string, args: Record<string, unknown> = {}) => {
  let result: unknown;
  await act(async () => { result = await fake.handlers!.onToolCall!({ id: `t-${name}`, name, arguments: args }); });
  return String(result);
};

async function onTheCall() {
  render(<App />);
  fireEvent.click(screen.getByText('Start talking to Iris'));
  await waitFor(() => expect(fake.events.length).toBe(1));
  act(() => fake.setPhase!('live'));
}

beforeEach(() => {
  for (const list of [fake.states, fake.events, fake.said, fake.started]) list.length = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the front door', () => {
  it('says what Planwright is, shows a real plan, and lets you in by voice or by typing', () => {
    render(<App />);
    expect(screen.getByLabelText('Planwright home')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Talk your home into shape.');
    expect(screen.getByLabelText(/An example plan/)).toBeTruthy();
    // The example exchange carries the planner's own numbers.
    expect(screen.getByText(/^Done: the main bedroom is [\d.]+ square metres now, the /)).toBeTruthy();
    expect(screen.getByText('Start by typing')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\b(avatar|session|demo|sample|mini-app|Atmee|API|tools?|state|events?)\b/i);
  });

  it('starting a call shows Iris on her way, with the plan and the opening ready for her', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('Start by typing'));
    expect(fake.started).toEqual([{ mic: false }]);
    await waitFor(() => expect(screen.getByText('Calling Iris…')).toBeTruthy());
    expect(fake.events[0]).toContain('roughly how big the place is');
    expect(lastState()).toContain('Planwright, live plan');
    expect(screen.getByText('9 m × 7 m, nothing drawn yet')).toBeTruthy();
  });
});

describe('on the call', () => {
  it("Iris's tool call changes the plan, and its result is what she says", async () => {
    await onTheCall();
    const said = await tool('lay_out_floor', { bedrooms: 2, study: true });
    expect(said).toMatch(/^Done: the ground floor is laid out as/);
    await waitFor(() => expect(screen.getAllByText('Study').length).toBeGreaterThan(0));
    expect(lastState()).toContain('Rooms, biggest first');
    // The product speaks its own language on every screen.
    expect(document.body.textContent).not.toMatch(/\b(avatar|session|demo|sample|mini-app|Atmee|API|tools?|state|events?)\b/i);
  });

  it('a refusal goes back to her with its reason, and is marked on the plan', async () => {
    await onTheCall();
    const said = await tool('undo_change');
    expect(said).toContain("There's nothing to undo yet.");
    expect(screen.getByText("There's nothing to undo yet.")).toBeTruthy();
  });

  it('the sheet she draws opens on the page, ready to download', async () => {
    await onTheCall();
    await tool('lay_out_floor', { bedrooms: 1 });
    await tool('draw_sheet');
    await waitFor(() => expect(screen.getByAltText('Drawing sheet')).toBeTruthy());
    expect(screen.getByText('Download (SVG)').getAttribute('download')).toBe('planwright-ground.svg');
  });

  it('a typed line goes to Iris as it is', async () => {
    await onTheCall();
    fireEvent.change(screen.getByLabelText('Message Iris'), { target: { value: 'Give the kitchen a metre off the hall' } });
    fireEvent.submit(screen.getByLabelText('Message Iris').closest('form')!);
    expect(fake.said).toEqual(['Give the kitchen a metre off the hall']);
  });

  it('a change by hand is told to her when it is a milestone', async () => {
    await onTheCall();
    fireEvent.click(screen.getByText('Draw it'));
    await waitFor(() => expect(fake.events.some((e) => e.startsWith('The client changed the plan by hand: the ground floor is laid out'))).toBe(true));
  });
});

describe('the safety net', () => {
  it('when she does not call the tool, the page does it and tells her', async () => {
    await onTheCall();
    vi.useFakeTimers();
    act(() => fake.handlers!.onUserSaid!('Can I see that in square feet?', 'spoken'));
    await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
    expect(fake.events.some((e) => e.startsWith('You did not call switch_units, so the app did it'))).toBe(true);
    expect(screen.getByText('ft²').getAttribute('aria-pressed')).toBe('true');
  });

  it('when she does call it, the page leaves it alone', async () => {
    await onTheCall();
    vi.useFakeTimers();
    act(() => fake.handlers!.onUserSaid!('Can I see that in square feet?', 'spoken'));
    await tool('switch_units', { unit: 'ft2' });
    await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
    expect(fake.events.some((e) => e.startsWith('You did not call'))).toBe(false);
  });
});

describe('after the call', () => {
  it('the plan stays, with a way to take it away and a way back to Iris', async () => {
    await onTheCall();
    await tool('lay_out_floor', { bedrooms: 2 });
    act(() => fake.setPhase!('ended'));
    expect(screen.getByText('Call ended')).toBeTruthy();
    expect(screen.getByText('Call Iris again')).toBeTruthy();
    expect(screen.getByText('Your plan')).toBeTruthy();
    fireEvent.click(screen.getByText('Get the drawing sheet'));
    await waitFor(() => expect(screen.getByAltText('Drawing sheet')).toBeTruthy());
  });
});
