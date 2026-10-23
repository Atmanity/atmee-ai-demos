// @vitest-environment jsdom
/**
 * The page's wiring, with the call faked: Sasha's tool calls reach the board
 * and come back as the words she speaks from (her reply move included);
 * buttons act at once and she is told by an event; the safety net acts only
 * when she does not, and never on a move. The safety net itself is the kit's.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  states: [] as string[],
  events: [] as string[],
  said: [] as string[],
  recorded: [] as string[],
  starts: [] as unknown[],
  poster: undefined as unknown,
  chatProps: null as null | Record<string, unknown>,
  handlers: {} as {
    onToolCall?: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
    onUserSaid?: (text: string, how: 'spoken' | 'typed') => void;
  },
  setPhase: undefined as undefined | ((phase: string) => void),
}));

vi.mock('../../../src/kit/index.ts', async () => {
  const { useToolNet } = await vi.importActual<typeof import('../../../src/kit/useToolNet.ts')>('../../../src/kit/useToolNet.ts');
  return {
    useToolNet,
    useAvatar: (_app: string, handlers: typeof fake.handlers) => {
      const [phase, setPhase] = useState('idle');
      fake.setPhase = setPhase;
      fake.handlers = handlers;
      return {
        phase, secondsLeft: null, micOn: false,
        start: (opts: unknown) => { fake.starts.push(opts); setPhase('starting'); return Promise.resolve(); },
        state: (t: string) => fake.states.push(t),
        event: (t: string) => fake.events.push(t),
        say: (t: string) => fake.said.push(t),
        record: (t: string) => fake.recorded.push(t),
      };
    },
    HostVideo: ({ children, poster }: { children?: ReactNode; poster?: string }) => { fake.poster = poster; return <div className="host">{children}</div>; },
    CallStatus: () => null,
    CallControls: () => null,
    ChatPanel: (props: Record<string, unknown>) => { fake.chatProps = props; return null; },
  };
});

import { App } from './App.tsx';

const lastState = () => fake.states[fake.states.length - 1] ?? '';
const tool = (name: string, args: Record<string, unknown> = {}) => act(() => fake.handlers.onToolCall!({ id: `t-${name}`, name, arguments: args })) as Promise<unknown>;
const call = async (name: string, args: Record<string, unknown> = {}) => String(await tool(name, args));
const type = (text: string) => act(() => { (fake.chatProps!.onSubmit as (t: string) => void)(text); });
/** The player says `words`, `meanwhile` happens, and the safety net's 7 s pass (on a fake clock set before the words). */
async function netAfter(words: string, meanwhile: () => Promise<unknown> | void = () => {}) {
  vi.useFakeTimers();
  act(() => fake.handlers.onUserSaid!(words, 'spoken'));
  await act(async () => { await meanwhile(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
  vi.useRealTimers();
}

async function live() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Play with your voice' }));
  act(() => fake.setPhase!('live'));
  await waitFor(() => expect(fake.events.length).toBe(1));
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 48, bottom: 48, width: 48, height: 48, toJSON: () => ({}) } as DOMRect);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  for (const list of [fake.states, fake.events, fake.starts, fake.said, fake.recorded]) list.length = 0;
  fake.chatProps = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the front door', () => {
  it('says what it is and starts a voice or a typed game', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('A real game');
    expect(screen.getAllByText('Kibitz').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Play by typing' })).toBeTruthy();
    // Who you will play, before the call: her face beside her name (so the image itself is decorative).
    const card = document.querySelector('.kb-player-card')!;
    expect(card.textContent).toContain('Sasha');
    expect(card.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(card.querySelector('img')?.getAttribute('src')).toMatch(/portrait\.jpg/);
    fireEvent.click(screen.getByRole('button', { name: 'Play with your voice' }));
    expect(fake.starts).toEqual([{ mic: true }]);
  });
});

describe('the game', () => {
  it('sets up the board while Sasha arrives, and opens with one event', async () => {
    await live();
    // Her face fills the frame until the video plays.
    expect(String(fake.poster)).toMatch(/portrait\.jpg/);
    expect(fake.events[0]).toMatch(/^You have just greeted them; do not greet or introduce yourself again\. /);
    expect(fake.events[0]).toContain('invite their first move');
    expect(lastState()).toContain("It is the player's move");
    expect(screen.getAllByText('Your move').length).toBeGreaterThan(0);
    expect(screen.getByText('No moves yet. White starts.')).toBeTruthy();
  });

  it("play_move: the board plays the move and Sasha's reply, and the result says both", async () => {
    await live();
    const result = await call('play_move', { move: 'e4' });
    expect(result).toMatch(/^Done: the player played e4 and it is on the board/);
    expect(result).toMatch(/You replied \S+, already on the board/);
    expect(result).toContain('why you played it');
    await waitFor(() => expect(lastState()).toMatch(/Moves so far: 1\. e4 \S+/));
    expect(document.querySelector('.kb-sheet-moves')?.textContent).toContain('e4');
    expect(fake.events).toHaveLength(1);   // the result is the news: no event besides it
  });

  it('play_move with an illegal move: refused in the result and on screen, nothing moves', async () => {
    await live();
    const result = await call('play_move', { move: 'Rook to a five' });
    expect(result).toMatch(/^Refused:/);
    expect(result).toContain('NOT played');
    await waitFor(() => expect(screen.getByText(/not a legal move in this position/)).toBeTruthy());
    expect(lastState()).toContain('No moves have been played yet');
  });

  it("choose_side: a new game with the player on Black, and Sasha's first move in the same result", async () => {
    await live();
    const result = await call('choose_side', { side: 'black' });
    expect(result).toContain('player on Black');
    expect(result).toMatch(/You opened with \S+, already on the board/);
    await waitFor(() => expect(document.querySelector('.kb-strip.is-you .kb-chip')?.textContent).toBe('Black'));
    expect(lastState()).toContain('The player is Black');
  });

  it('set_strength: the chip shows it and the result says so', async () => {
    await live();
    expect(await call('set_strength', { level: 'beginner' })).toContain('beginner strength from your next move');
    await waitFor(() => expect(document.querySelector('.kb-chip.is-strength')?.textContent).toBe('beginner'));
  });

  it('resign: the game ends, the result screen shows, and another game is only offered', async () => {
    await live();
    const result = await call('resign');
    expect(result).toMatch(/^Done: the player resigned/);
    expect(result).toContain('start one only if they say so');
    await waitFor(() => expect(screen.getByText('Sasha wins.')).toBeTruthy());
    expect(await call('resign')).toContain('already over');
  });

  it('a call with a missing argument changes nothing and says what to ask; an unknown tool is an error', async () => {
    await live();
    expect(await call('choose_side', { side: 'purple' })).toContain('White or Black');
    await expect(tool('take_back')).rejects.toThrow(/unknown tool/);
  });

  it('a button acts at once and Sasha is told by an event', async () => {
    await live();
    fireEvent.click(screen.getByRole('button', { name: 'Resign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Really resign?' }));
    await waitFor(() => expect(fake.events).toHaveLength(2));
    expect(fake.events[1]).toMatch(/^The player pressed "Resign" on screen\. Done: the player resigned/);
  });

  it("a move made by hand is answered by Sasha's, and she is told about both", async () => {
    await live();
    fireEvent.click(document.querySelector("[data-square='e2']")!);
    fireEvent.click(document.querySelector("[data-square='e4']")!);
    await waitFor(() => expect(fake.events).toHaveLength(2), { timeout: 3000 });
    expect(fake.events[1]).toMatch(/^The player moved a piece by hand on screen\. Done: the player played e4/);
    expect(fake.events[1]).toContain('You replied');
  });
});

describe('typing', () => {
  it('a typed line that is exactly a legal move is played at once, recorded, and told to Sasha', async () => {
    // Seen live: typed "Nf6" went to Sasha as chat, she praised it, and the board never moved.
    await live();
    type('e4');
    await waitFor(() => expect(fake.events).toHaveLength(2), { timeout: 3000 });
    expect(fake.recorded).toEqual(['e4']);
    expect(fake.said).toEqual([]);
    expect(fake.events[1]).toMatch(/^The player typed the move "e4" on screen\. Done: the player played e4 and it is on the board\. You replied/);
    expect(lastState()).toMatch(/Moves so far: 1\. e4 \S+/);
  });

  it('a move in UCI is played the same way', async () => {
    await live();
    type('g1f3');
    await waitFor(() => expect(fake.events).toHaveLength(2), { timeout: 3000 });
    expect(fake.events[1]).toContain('Done: the player played Nf3');
  });

  it('a typed move the board cannot play is refused under the board, and Sasha is told', async () => {
    // Seen live: typed "Nf6" as White went to Sasha, who said it was played; nothing moved, nothing said why.
    await live();
    type('Nf6');
    await waitFor(() => expect(fake.events).toHaveLength(2));
    expect(fake.recorded).toEqual(['Nf6']);
    expect(fake.said).toEqual([]);
    expect(fake.events[1]).toMatch(/^The player typed the move "Nf6" on screen\. Refused: the board did not play the player's move 'Nf6'/);
    expect(screen.getByText(/'Nf6' is not a legal move in this position\./)).toBeTruthy();
    expect(lastState()).toContain('No moves have been played yet');
  });

  it('anything not written as a move goes to Sasha: talk, a move in words', async () => {
    await live();
    for (const text of ['Nice to meet you!', 'knight to f3', 'nf3', 'e4 please']) type(text);
    expect(fake.said).toEqual(['Nice to meet you!', 'knight to f3', 'nf3', 'e4 please']);
    expect(fake.recorded).toEqual([]);
    expect(fake.events).toHaveLength(1);
    expect(lastState()).toContain('No moves have been played yet');
  });
});

describe('choosing a side', () => {
  it('asked twice, Black is dealt once: the second call and the net both leave the game alone', async () => {
    // Seen live: "Can I play black instead?", then "Yes, start over as Black." dealt a second fresh game.
    await live();
    expect(await call('choose_side', { side: 'black' })).toContain('player on Black');
    const dealt = lastState();
    let second = '';
    await netAfter('Yes, start over as Black.', async () => { second = await call('choose_side', { side: 'black' }); });
    expect(second).toContain('Nothing changed: the player is already playing Black');
    expect(fake.events.some((e) => e.startsWith('You did not call'))).toBe(false);
    expect(lastState()).toBe(dealt);
  });
});

describe('the safety net', () => {
  it('"I resign" with no call: the page resigns after a few seconds and tells Sasha', async () => {
    await live();
    vi.useFakeTimers();
    act(() => fake.handlers.onUserSaid!('I resign.', 'spoken'));
    await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
    vi.useRealTimers();
    await waitFor(() => expect(fake.events.some((e) => e.startsWith('You did not call resign'))).toBe(true));
    expect(screen.getByText('Sasha wins.')).toBeTruthy();
  });

  it('when Sasha calls the tool herself, the net stays out of it', async () => {
    await live();
    vi.useFakeTimers();
    act(() => fake.handlers.onUserSaid!('Go easy on me.', 'spoken'));
    await call('set_strength', { level: 'casual' });
    await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
    vi.useRealTimers();
    expect(fake.events.some((e) => e.startsWith('You did not call'))).toBe(false);
  });

  it('a button pressed for the same thing counts: the net does not do it again', async () => {
    await live();
    await netAfter('Go easy on me.', () => { fireEvent.click(screen.getByRole('button', { name: 'Casual' })); });
    expect(fake.events).toHaveLength(2);
    expect(fake.events[1]).toContain('casual strength from your next move');
    expect(fake.events.some((e) => e.startsWith('You did not call'))).toBe(false);
  });

  it('never plays a move, even one said plainly', async () => {
    await live();
    vi.useFakeTimers();
    act(() => fake.handlers.onUserSaid!('e4', 'spoken'));
    await act(async () => { await vi.advanceTimersByTimeAsync(7100); });
    vi.useRealTimers();
    expect(fake.events).toHaveLength(1);
    expect(lastState()).toContain('No moves have been played yet');
  });
});
