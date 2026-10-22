// @vitest-environment jsdom
//
// The page's wiring, with the avatar kit replaced by a recorder: which input
// does what to the range, what the avatar is sent (and what it is NOT sent),
// and whether a typed line is kept by the app or handed to the avatar.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvatarHandlers } from '../../../src/kit/index.ts';
import { NOTES, say } from '../engine/director.ts';

const fake = vi.hoisted(() => ({
  phase: 'starting' as string,
  handlers: {} as AvatarHandlers,
  submit: undefined as ((text: string) => unknown) | undefined,
  notes: [] as string[],
  states: [] as string[],
  events: [] as { text: string; ttl?: number }[],
  said: [] as string[],
  recorded: [] as string[],
}));

vi.mock('../../../src/kit/index.ts', () => ({
  useAvatar: (_app: string, handlers: AvatarHandlers) => {
    fake.handlers = handlers;
    return {
      phase: fake.phase,
      note: (t: string) => fake.notes.push(t),
      state: (t: string) => fake.states.push(t),
      event: (text: string, ttl?: number) => fake.events.push({ text, ttl }),
      say: (t: string) => fake.said.push(t),
      record: (t: string) => fake.recorded.push(t),
    };
  },
  AvatarStage: () => null,
  Composer: ({ onSubmit }: { onSubmit: (t: string) => unknown }) => { fake.submit = onSubmit; return null; },
  Transcript: () => null,
}));

const { App } = await import('./App.tsx');

beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as never; });
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(fake, { phase: 'starting', notes: [], states: [], events: [], said: [], recorded: [] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

/** The page with the session on, everything said while it was starting cleared. */
function live() {
  const view = render(<App />);
  fake.phase = 'live';
  view.rerender(<App />);
  Object.assign(fake, { events: [], said: [], recorded: [] });
  return view;
}
const type = async (text: string) => { await act(async () => { fake.submit!(text); }); };
const speak = async (text: string) => { await act(async () => { fake.handlers.onUserSaid!(text, 'spoken'); }); };
const land = () => act(() => { vi.advanceTimersByTime(3_000); });

describe('the session', () => {
  it('starting sends the rules, the range and an opening that names the challenge up', () => {
    render(<App />);
    expect(fake.notes).toEqual(NOTES);
    expect(fake.states.at(-1)).toContain('Challenge: Clear the wall');
    expect(fake.events).toEqual([{ text: expect.stringContaining('The first challenge is Clear the wall'), ttl: 60 }]);
  });
});

describe('speech: the avatar is already answering, so the app only adds what it cannot know', () => {
  it('"fire": no line at launch, then exactly one line, the landing, with the range\'s numbers', async () => {
    live();
    await speak('Fire!');
    expect(screen.getByText('In the air…')).toBeTruthy();
    expect(fake.states.at(-1)).toContain('in the air');
    expect(fake.events).toEqual([]);
    land();
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0].text).toContain('0.76 m going past 40 m, 2.24 m below the top');
    expect(screen.getByText(/0\.76 m going past 40 m/)).toBeTruthy();
  });

  it('an aim moves the arrow and says nothing; a refused one is on the panel and told to the avatar', async () => {
    live();
    await speak('Make it steeper.');
    expect(screen.getByText('50° · 20 m/s')).toBeTruthy();
    expect(fake.events).toEqual([]);
    await speak('Try ninety degrees.');
    expect(screen.getByText('50° · 20 m/s')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('90 is off the rail');
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0].text).toContain('If you have not already told them');
  });

  it('a question is left alone', async () => {
    live();
    await speak('Should I fire flatter?');
    expect(screen.getByText('No shot yet.')).toBeTruthy();
    expect(fake.events).toEqual([]);
  });

  it('a challenge by voice goes up with no line (the list is staged in the state)', async () => {
    live();
    await speak("Let's do the moon.");
    expect(screen.getAllByText('On the Moon')).toHaveLength(2);
    expect(fake.events).toEqual([]);
    expect(fake.states.at(-1)).toContain('Challenge: On the Moon');
  });
});

describe('typing: judged first, then kept or handed over', () => {
  it('an action is kept by the app and gets its line; anything else goes to the avatar', async () => {
    live();
    await type('try forty degrees');
    expect(fake.recorded).toEqual(['try forty degrees']);
    expect(fake.said).toEqual([]);
    expect(fake.events.map((e) => e.text)).toEqual([say.aimed()]);
    expect(screen.getByText('40° · 20 m/s')).toBeTruthy();
    await type('why did that miss?');
    expect(fake.said).toEqual(['why did that miss?']);
  });

  it('"45 at 24 and fire": one shot, one line (the landing), no opinion on the aim first', async () => {
    live();
    await type('45 at 24 and fire');
    expect(fake.events).toEqual([]);
    land();
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0].text).toContain('they cleared it');
    expect(screen.getByText(/Forty-five degrees maximises range/)).toBeTruthy();
  });

  it('what the rules cannot read goes to the app\'s model, and its answer is applied', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ command: { kind: 'aim', angle_deg: 70 } })));
    vi.stubGlobal('fetch', fetchMock);
    live();
    await type('lob it like a mortar');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      text: 'lob it like a mortar', aim: { angle_deg: 45, speed_ms: 20 }, challengeId: 'wall40',
    });
    expect(screen.getByText('70° · 20 m/s')).toBeTruthy();
    expect(fake.recorded).toEqual(['lob it like a mortar']);
  });

  it('with no model (or no answer) the line goes to the avatar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ command: null, reason: 'no_model' }))));
    live();
    await type('give it some welly');
    expect(fake.said).toEqual(['give it some welly']);
  });
});

describe('the panel: the avatar cannot see it, so it is told what changed', () => {
  it('a chip puts a challenge up with its intro; a drag-free Fire gets only the landing', () => {
    live();
    fireEvent.click(screen.getByRole('button', { name: 'Into the headwind' }));
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0].text).toContain('A new challenge is up: Into the headwind');
    fireEvent.click(screen.getByRole('button', { name: 'Fire' }));
    expect(fake.events).toHaveLength(1);
    land();
    expect(fake.events[1].text).toContain('4.69 m short of the wall');
  });

  it('nothing is said to a session that is not on', () => {
    const view = live();
    fireEvent.click(screen.getByRole('button', { name: 'Fire' }));
    fake.phase = 'ended';
    view.rerender(<App />);
    land();
    expect(fake.events).toEqual([]);
  });
});
