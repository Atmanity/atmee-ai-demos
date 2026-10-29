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
      say: async () => {}, send: async () => {},
      interrupt: async (t: string) => { session.sent.push(`interrupt:${t}`); }, setMicMuted: async () => {}, feedMic: async () => {},
      acceptsFiles: () => true,
      sendFiles: async (files: File[], o?: { caption?: string }) => {
        session.sent.push(`files:${files.map((f) => f.name).join(',')}:${o?.caption ?? ''}`);
        return files.map((f) => ({ name: f.name, status: 'ready' }));
      },
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

test("files go to the call with their caption, show as the user's line, and only while there is a call", async () => {
  const { result } = renderHook(() => useAvatar('demo'));
  await expect(result.current.sendFiles([new File(['x'], 'cv.pdf')])).rejects.toMatchObject({ code: 'no_call' });
  await act(async () => { await result.current.start(); });
  const seen: unknown[] = [];
  const listen = (e: Event) => seen.push((e as CustomEvent).detail);
  addEventListener('atmee:files', listen);
  let outcome: unknown;
  await act(async () => { outcome = await result.current.sendFiles([new File(['x'], 'cv.pdf'), new File(['y'], 'photo.png')], { caption: 'my CV' }); });
  removeEventListener('atmee:files', listen);
  expect(joins[0].session.sent).toContain('files:cv.pdf,photo.png:my CV');
  expect(outcome).toEqual([{ name: 'cv.pdf', status: 'ready' }, { name: 'photo.png', status: 'ready' }]);
  expect(result.current.lines.at(-1)).toMatchObject({ who: 'user', text: 'Shared cv.pdf and photo.png', files: ['cv.pdf', 'photo.png'] });
  expect(seen).toEqual([{ names: ['cv.pdf', 'photo.png'], caption: 'my CV' }]);
});

test('whether the host takes files follows its agent, and ends with the call', async () => {
  const { result } = renderHook(() => useAvatar('demo'));
  await act(async () => { await result.current.start(); });
  expect(result.current.filesAccepted).toBe(false);
  act(() => { joins[0].opts.onFilesAccepted?.(true); });
  expect(result.current.filesAccepted).toBe(true);
  await act(async () => { await result.current.end(); });
  expect(result.current.filesAccepted).toBe(false);
});

test('a push-to-talk start joins with the microphone muted, and says the mic is off', async () => {
  const stream = { getAudioTracks: () => [{}], getTracks: () => [] } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
  const { result } = renderHook(() => useAvatar('demo'));
  await act(async () => { await result.current.start({ mic: true, micMuted: true }); });
  expect(joins[0].opts.mic).toBe(stream);
  expect(joins[0].opts.micMuted).toBe(true);
  expect(result.current.micOn).toBe(false);
});

test('an interrupt goes to the call at once and is not shown as the user\'s line', async () => {
  const { result } = renderHook(() => useAvatar('demo'));
  await act(async () => { await result.current.start(); });
  act(() => { result.current.interrupt('The listener pressed Skip.'); });
  expect(joins[0].session.sent).toContain('interrupt:The listener pressed Skip.');
  expect(result.current.lines).toHaveLength(0);
});

test('a start with a camera hands its track to the join, and one without hands none', async () => {
  const camera = { kind: 'video' } as unknown as MediaStreamTrack;
  const { result } = renderHook(() => useAvatar('demo'));
  await act(async () => { await result.current.start({ camera }); });
  expect(joins[0].opts.camera).toBe(camera);
  await act(async () => { await result.current.end(); });
  await act(async () => { await result.current.start(); });
  expect(joins[1].opts.camera).toBeNull();
});
