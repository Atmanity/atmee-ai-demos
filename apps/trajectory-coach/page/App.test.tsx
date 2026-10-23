// @vitest-environment jsdom
//
// The page's wiring, with the call replaced by a recorder (the real safety
// net kept): the front door, the opening, the host's tool calls answered by
// the range with its real outcome, the buttons told as events, the safety net
// stepping in, and the logbook when the call ends.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvatarHandlers } from '../../../src/kit/index.ts';

const fake = vi.hoisted(() => ({
  phase: 'idle' as string,
  handlers: {} as AvatarHandlers,
  states: [] as string[],
  events: [] as { text: string; ttl?: number }[],
  starts: [] as { mic?: boolean }[],
}));

vi.mock('../../../src/kit/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/kit/index.ts')>();
  return {
    ...actual,
    useAvatar: (_app: string, handlers: AvatarHandlers) => {
      fake.handlers = handlers;
      return {
        phase: fake.phase, micOn: false,
        state: (t: string) => fake.states.push(t),
        event: (text: string, ttl?: number) => fake.events.push({ text, ttl }),
        start: async (opts?: { mic?: boolean }) => { fake.starts.push(opts ?? {}); },
        say: () => {}, note: () => {}, record: () => {},
      };
    },
    HostVideo: ({ children, poster }: { children?: React.ReactNode; poster?: string }) => <div data-testid="host" data-poster={poster}>{children}</div>,
    CallStatus: () => null,
    CallControls: () => null,
    ChatPanel: () => null,
  };
});

const { App } = await import('./App.tsx');

beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as never; });
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(fake, { phase: 'idle', states: [], events: [], starts: [] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

/** The page with Theo on the call, everything sent while he was on his way cleared. */
function live() {
  fake.phase = 'starting';
  const view = render(<App />);
  fake.phase = 'live';
  view.rerender(<App />);
  Object.assign(fake, { events: [] });
  return view;
}
/** A tool call from Theo; the promise is the result he speaks from. */
const tool = (name: string, args: Record<string, unknown> = {}) => fake.handlers.onToolCall!({ id: `call-${name}`, name, arguments: args }) as Promise<string>;
const land = () => act(() => { vi.advanceTimersByTime(3_000); });
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('the front door', () => {
  it('says what Arcwise is and starts a call by voice or by typing', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Forty-five degrees');
    expect(screen.getAllByText(/Arcwise/).length).toBeGreaterThan(0);
    for (const name of ['Clear the wall', 'On the Moon']) expect(screen.getByText(name)).toBeTruthy();
    // Theo's face and name before the call: the photo is decorative, his name is beside it.
    const face = document.querySelector('.aw-coach-card img') as HTMLImageElement;
    expect(face.getAttribute('src')).toContain('portrait');
    expect(face.getAttribute('alt')).toBe('');
    expect(document.querySelector('.aw-coach-card')!.textContent).toContain('Coached by Theo');
    fireEvent.click(button('Start with your voice'));
    fireEvent.click(button('Start by typing'));
    expect(fake.starts).toEqual([{ mic: true }, { mic: false }]);
  });
});

describe('the call', () => {
  it('while Theo is on his way: the range is up but locked, and the opening names the challenge up', () => {
    fake.phase = 'starting';
    render(<App />);
    expect(screen.getByText('Theo is on his way to the range…')).toBeTruthy();
    expect(screen.getByTestId('host').dataset.poster).toContain('portrait');   // his face while the call connects
    expect(button('Fire').disabled).toBe(true);
    expect(fake.states.at(-1)).toContain('Challenge 1 of 6: Clear the wall');
    expect(fake.events).toEqual([{ text: expect.stringMatching(/^You have just greeted them;.*the challenge up is Clear the wall/), ttl: 60 }]);
  });
});

describe("Theo's tools: the range acts, and the result is what he says", () => {
  it('fire: the result arrives when the ball is down, with the numbers on screen at the same moment', async () => {
    live();
    let result: string | undefined;
    await act(async () => { void tool('fire').then((t) => { result = t; }); });
    expect(screen.getByText('In the air…')).toBeTruthy();
    expect(fake.states.at(-1)).toContain('in the air');
    expect(result).toBeUndefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(result).toContain('"You were at 0.76 m going past 40 m, 2.24 m below the top.');
    expect(screen.getByText(/0\.76 m going past 40 m/)).toBeTruthy();
    expect(fake.events).toEqual([]);   // the tool's result is the one account of it
  });

  it('aim: "try ninety" is refused with the numbers, on screen too; words go through the range\'s steps', async () => {
    live();
    let text = '';
    await act(async () => { text = await tool('aim', { angle_deg: 90 }); });
    expect(text).toContain('90 is off the rail');
    expect(screen.getByRole('status').textContent).toContain('90 is off the rail');
    expect(screen.getByText('45°')).toBeTruthy();
    await act(async () => { await tool('aim', { request: 'a bit steeper' }); });
    expect(screen.getByText('48°')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();   // the next change clears the refusal
  });

  it("aim: what the rules cannot read goes to the app's model", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ command: { kind: 'aim', angle_deg: 70 } })));
    vi.stubGlobal('fetch', fetchMock);
    live();
    await act(async () => { await tool('aim', { request: 'lob it like a mortar' }); });
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      text: 'lob it like a mortar', aim: { angle_deg: 45, speed_ms: 20 }, challengeId: 'wall40',
    });
    expect(screen.getByText('70°')).toBeTruthy();
  });

  it('choose_challenge puts it up and says how; the lesson shows only after a clear', async () => {
    live();
    let text = '';
    await act(async () => { text = await tool('choose_challenge', { challenge: 'moonshot' }); });
    expect(text).toMatch(/^Done: On the Moon is up/);
    expect(screen.getByRole('heading', { name: 'On the Moon' })).toBeTruthy();
    expect(fake.states.at(-1)).toContain('Challenge 6 of 6: On the Moon');
    expect(fake.events).toEqual([]);
  });
});

describe('the student\'s hands: Theo cannot see the screen, so he is told', () => {
  it('Fire: one event, when it lands, with the range\'s numbers', () => {
    live();
    fireEvent.click(button('Fire'));
    expect(fake.events).toEqual([]);
    land();
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0].text).toMatch(/^The student pressed Fire on screen\. Landed, missed: "You were at 0\.76 m/);
  });

  it('a challenge from the list is told with its setup; dragging or stepping the aim is not', () => {
    live();
    fireEvent.click(button('Angle up one degree'));
    expect(fake.events).toEqual([]);
    fireEvent.click(button(/Into the headwind/));
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0].text).toContain('The student picked "Into the headwind" on screen');
  });

  it('nothing is said to a call that is not on', () => {
    const view = live();
    fireEvent.click(button('Fire'));
    fake.phase = 'ended';
    view.rerender(<App />);
    land();
    expect(fake.events).toEqual([]);
  });
});

describe('the safety net', () => {
  it('"fire" with no call from Theo: the range fires after 7 s and tells him where it landed', async () => {
    live();
    await act(async () => { fake.handlers.onUserSaid!('Fire!', 'spoken'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6_900); });
    expect(screen.getByText(/No shot yet/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText('In the air…')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0].text).toMatch(/^You did not call fire, so the app did it.*Landed, missed/);
  });

  it('when Theo calls fire himself, the net stays out of it: one shot', async () => {
    live();
    await act(async () => { fake.handlers.onUserSaid!('Fire!', 'spoken'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); void tool('fire'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fake.events).toEqual([]);
    expect(fake.states.at(-1)).toContain('Shots on this challenge: 1');
  });

  it('a question about firing is left to Theo', async () => {
    live();
    await act(async () => { fake.handlers.onUserSaid!('Should I fire flatter?', 'spoken'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText(/No shot yet/)).toBeTruthy();
    expect(fake.events).toEqual([]);
  });
});

describe('the logbook', () => {
  it('opens when the call ends with shots taken, and offers the call again', () => {
    const view = live();
    fireEvent.click(button('Fire'));
    land();
    fake.phase = 'ended';
    view.rerender(<App />);
    expect(screen.getByRole('heading', { name: /0 of 6 cleared/ })).toBeTruthy();
    expect(screen.getByText('Not cleared yet: 1 shot')).toBeTruthy();
    fireEvent.click(button('Call Theo again'));
    expect(fake.starts).toHaveLength(1);
  });

  it('is a tab away during the call, with each cleared challenge\'s lesson', async () => {
    live();
    await act(async () => { void tool('aim', { angle_deg: 45, speed_ms: 24, then_fire: true }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    fireEvent.click(button(/Logbook/));
    expect(screen.getByRole('heading', { name: /1 of 6 cleared/ })).toBeTruthy();
    expect(screen.getByText(/Forty-five degrees maximises range/)).toBeTruthy();
  });
});
