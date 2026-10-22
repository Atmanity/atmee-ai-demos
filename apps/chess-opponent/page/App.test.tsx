// @vitest-environment jsdom
/**
 * The page's wiring, with the avatar faked: what the avatar is told (notes,
 * state, events), what goes to it as a typed turn, and what the board does,
 * for each way in (typing, speech, the model's judgement). No network: the
 * model route is a stubbed fetch.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  notes: [] as string[],
  states: [] as string[],
  events: [] as string[],
  said: [] as string[],
  recorded: [] as string[],
  onUserSaid: undefined as undefined | ((text: string, how: 'spoken' | 'typed') => void),
  onSubmit: undefined as undefined | ((text: string) => void),
  setPhase: undefined as undefined | ((phase: string) => void),
}));

vi.mock('../../../src/kit/index.ts', () => ({
  useAvatar: (_app: string, handlers: { onUserSaid?: (text: string, how: 'spoken' | 'typed') => void }) => {
    const [phase, setPhase] = useState('idle');
    fake.setPhase = setPhase;
    fake.onUserSaid = handlers.onUserSaid;
    return {
      phase,
      note: (t: string) => fake.notes.push(t),
      state: (t: string) => fake.states.push(t),
      event: (t: string) => fake.events.push(t),
      say: (t: string) => fake.said.push(t),
      record: (t: string) => fake.recorded.push(t),
    };
  },
  AvatarStage: () => null,
  Transcript: () => null,
  Composer: ({ onSubmit }: { onSubmit: (text: string) => void }) => {
    fake.onSubmit = onSubmit;
    return null;
  },
}));

import { App } from './App.tsx';

const lastState = () => fake.states[fake.states.length - 1] ?? '';
const say = (text: string) => act(() => fake.onUserSaid!(text, 'spoken'));
const type = (text: string) => act(() => fake.onSubmit!(text));

async function live() {
  render(<App />);
  act(() => fake.setPhase!('starting'));
  act(() => fake.setPhase!('live'));
  await waitFor(() => expect(fake.events.length).toBe(1));
}

beforeEach(() => {
  // react-chessboard measures a square to animate a move; jsdom lays nothing out.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 48, bottom: 48, width: 48, height: 48, toJSON: () => ({}) } as DOMRect);
  for (const list of [fake.notes, fake.states, fake.events, fake.said, fake.recorded]) list.length = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ kind: 'none', why: 'no_model' }))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the page', () => {
  it('sets up the board while the avatar arrives: notes, the state, and the opening', async () => {
    await live();
    expect(fake.notes).toHaveLength(2);
    expect(fake.events[0]).toContain('invite their first move');
    expect(lastState()).toContain("It is the player's move");
    expect(screen.getByText('Your move')).toBeTruthy();
  });

  it('a typed move is played, recorded, never sent as a turn, and answered by the opponent in one event', async () => {
    await live();
    await type('e4');
    await waitFor(() => expect(fake.events).toHaveLength(2), { timeout: 3000 });
    expect(fake.recorded).toEqual(['e4']);
    expect(fake.said).toEqual([]);
    expect(fake.events[1]).toContain('The player played e4');
    expect(lastState()).toMatch(/Moves so far: 1\. e4 \S+/);
  });

  it('a typed line that is not an action goes to the avatar as a turn', async () => {
    await live();
    await type('Hello! Ready to lose?');
    await waitFor(() => expect(fake.said).toEqual(['Hello! Ready to lose?']));
    expect(fake.events).toHaveLength(1);
  });

  it('a spoken "can I play black?" reseats the player and the opponent opens with the news', async () => {
    await live();
    await say('Can I play black instead?');
    await waitFor(() => expect(fake.events.some((e) => e.includes('player on Black'))).toBe(true), { timeout: 3000 });
    expect(document.querySelector('.chess-player-row--bottom .chess-side-chip')?.textContent).toBe('Black');
    expect(lastState()).toContain('The player is Black');
  });

  it('a spoken "go easier" changes the strength without a second line (it was staged)', async () => {
    await live();
    await say("Go easy on me, I'm a beginner.");
    await waitFor(() => expect(lastState()).toContain('beginner strength'));
    expect(fake.events).toHaveLength(1);
    expect(document.querySelector('.chess-difficulty')?.textContent).toBe('beginner');
  });

  it('a spoken illegal move is refused out loud and on screen', async () => {
    await live();
    await say('Rook to a five.');
    await waitFor(() => expect(fake.events.some((e) => e.includes('REFUSED'))).toBe(true));
    expect(screen.getByText(/not a legal move in this position/)).toBeTruthy();
  });

  it('a line only the model can read is judged on the server, and the board plays it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ kind: 'move', text: 'Nf3', via: 'model' }))));
    await live();
    await say('Okay, knight to f three then.');
    await waitFor(() => expect(fake.events.some((e) => e.includes('The player played Nf3'))).toBe(true), { timeout: 3000 });
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('/api/apps/chess-opponent/judge');
    expect(JSON.parse(String(init.body))).toMatchObject({ text: 'Okay, knight to f three then.', userColor: 'white', turn: 'user' });
  });

  it('commentary that looks like a move is talk when the model says so: nothing moves, nothing is said', async () => {
    await live();
    await say('Your knight on f3 is strong.');
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.events).toHaveLength(1);
    expect(lastState()).toContain('No moves have been played yet');
  });

  it('a spoken resignation ends the game with one thank-you', async () => {
    await live();
    await say('I resign.');
    await waitFor(() => expect(fake.events.some((e) => e.includes('resigned'))).toBe(true));
    expect(fake.events).toHaveLength(2);
    expect(screen.getByText('Opponent wins.')).toBeTruthy();
  });
});
