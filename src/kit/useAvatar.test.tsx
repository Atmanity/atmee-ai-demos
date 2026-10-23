// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { AvatarSession, JoinOptions } from '../avatar/room.ts';

// A fake room: each join returns a session that records what it was sent.
const joins: { opts: JoinOptions; session: AvatarSession & { sent: string[]; ended: boolean } }[] = [];
let failNote = false;
vi.mock('../avatar/room.ts', async (real) => ({
  ...(await real<typeof import('../avatar/room.ts')>()),
  joinAvatar: vi.fn(async (opts: JoinOptions) => {
    const session = {
      sent: [] as string[], ended: false,
      note: async (t: string) => { if (failNote) throw new Error('room closed'); session.sent.push(`note:${t}`); },
      state: async (t: string) => { session.sent.push(`state:${t}`); },
      event: async (t: string) => { session.sent.push(`event:${t}`); },
      say: async () => {}, send: async () => {}, setMicMuted: async () => {},
      end: async () => { session.ended = true; opts.onEnd?.('ended by the app'); },
    } as unknown as AvatarSession & { sent: string[]; ended: boolean };
    joins.push({ opts, session });
    return session;
  }),
}));
const { useAvatar } = await import('./useAvatar.ts');

beforeEach(() => { joins.length = 0; failNote = false; });

test('a start that fails after joining ends that session, and a new start can go ahead', async () => {
  const { result } = renderHook(() => useAvatar('demo'));
  act(() => { result.current.note('standing rule'); });
  failNote = true;
  await act(async () => { await result.current.start(); });
  expect(result.current.phase).toBe('failed');
  expect(joins[0].session.ended).toBe(true);
  failNote = false;
  await act(async () => { await result.current.start(); });
  expect(joins).toHaveLength(2);
});

test("events from after a call ended do not reach the next call; the board and the rules do", async () => {
  const { result } = renderHook(() => useAvatar('demo'));
  await act(async () => { await result.current.start(); });
  await act(async () => { await result.current.end(); });
  act(() => {
    result.current.event('The game you just played ended 3-1.');
    result.current.state('Board: a new game');
    result.current.note('standing rule');
  });
  await act(async () => { await result.current.start(); });
  const sent = joins[1].session.sent;
  expect(sent).not.toContain('event:The game you just played ended 3-1.');
  expect(sent).toContain('state:Board: a new game');
  expect(sent).toContain('note:standing rule');
});

test('an event said while a call is being placed reaches it', async () => {
  const { result } = renderHook(() => useAvatar('demo'));
  await act(async () => {
    const starting = result.current.start();
    result.current.event('Opening: round 1 is on the screen.');
    await starting;
  });
  expect(joins[0].session.sent).toContain('event:Opening: round 1 is on the screen.');
});
