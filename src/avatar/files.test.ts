// Tests for a drop of files: how the page follows each file as the host's
// agent answers it, the answers that come before LiveKit says the drop is out,
// a drop that is never answered, and which participant is the agent.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FILE_WAIT_MS, MAX_CAPTION, agentIn, createDrops, cutCaption, openDrop, type FileProgress } from './files.ts';

const file = (name: string) => new File(['x'], name);
let progress: FileProgress[];
beforeEach(() => { vi.useFakeTimers(); progress = []; });
afterEach(() => vi.useRealTimers());

test('a drop resolves once every file is ready or refused, in order, each answer followed', async () => {
  const drop = openDrop([file('plan.pdf'), file('photo.png')], (p) => progress.push(p));
  drop.sent('b1');
  drop.answer({ index: 1, status: 'received' });
  drop.answer({ index: 0, status: 'received' });
  drop.answer({ index: 1, status: 'refused', reason: 'unsupported_type' });
  drop.answer({ index: 0, status: 'ready' });
  await expect(drop.done).resolves.toEqual([
    { name: 'plan.pdf', status: 'ready' },
    { name: 'photo.png', status: 'refused', reason: 'unsupported_type' },
  ]);
  expect(progress.map((p) => `${p.index}:${p.status}`)).toEqual(['1:received', '0:received', '1:refused', '0:ready']);
});

test('a file answered twice, or an index the drop does not have, changes nothing', async () => {
  const drop = openDrop([file('a.txt')], (p) => progress.push(p));
  drop.sent('b1');
  drop.answer({ index: 3, status: 'ready' });
  drop.answer({ index: 0, status: 'ready' });
  drop.answer({ index: 0, status: 'refused', reason: 'failed' });
  await expect(drop.done).resolves.toEqual([{ name: 'a.txt', status: 'ready' }]);
  expect(progress).toHaveLength(1);
});

test('answers that come before the drop is known to be out wait for it', async () => {
  const drops = createDrops();
  const drop = openDrop([file('a.txt')], (p) => progress.push(p));
  drops.add(drop);
  drops.answer({ batchId: 'b1', index: 0, status: 'received' });
  drops.answer({ batchId: 'b1', index: 0, status: 'ready' });
  expect(progress).toEqual([]);
  drops.sent(drop, 'b1');
  await expect(drop.done).resolves.toEqual([{ name: 'a.txt', status: 'ready' }]);
  expect(progress.map((p) => p.status)).toEqual(['received', 'ready']);
});

test('a sent drop without an answer for a while is refused, and each answer gives it longer', async () => {
  const drop = openDrop([file('a.mp4'), file('b.mp4')]);
  drop.sent('b1');
  vi.advanceTimersByTime(FILE_WAIT_MS - 1);
  drop.answer({ index: 0, status: 'ready' });   // a long read of the first, then its answer
  vi.advanceTimersByTime(FILE_WAIT_MS - 1);
  expect(drop.over).toBe(false);
  vi.advanceTimersByTime(1);
  await expect(drop.done).resolves.toEqual([
    { name: 'a.mp4', status: 'ready' },
    { name: 'b.mp4', status: 'refused', reason: 'failed' },
  ]);
});

test('a reconnect refuses only the drops still uploading; the end of the call, every one', async () => {
  const drops = createDrops();
  const out = openDrop([file('a.txt')]);
  const going = openDrop([file('b.txt')]);
  drops.add(out); drops.add(going);
  drops.sent(out, 'b1');
  drops.refuseUploading('unreadable');
  await expect(going.done).resolves.toEqual([{ name: 'b.txt', status: 'refused', reason: 'unreadable' }]);
  expect(out.over).toBe(false);
  drops.refuse('unreadable');
  await expect(out.done).resolves.toEqual([{ name: 'a.txt', status: 'refused', reason: 'unreadable' }]);
});

test('the agent is the one the renderer publishes for, else the agent publishing for nobody', () => {
  const agent = { identity: 'agent-1', isAgent: true, attributes: { 'atmee.files': '1' } };
  const renderer = { identity: 'renderer', isAgent: true, attributes: { 'lk.publish_on_behalf': 'agent-1' } };
  const room = (...ps: object[]) => ({ remoteParticipants: new Map(ps.map((p) => [(p as { identity: string }).identity, p])) }) as never;
  expect(agentIn(room(renderer, agent))?.identity).toBe('agent-1');
  expect(agentIn(room(agent))?.identity).toBe('agent-1');
  expect(agentIn(room(renderer))).toBeUndefined();
  expect(agentIn(room({ identity: 'other', isAgent: false, attributes: {} }))).toBeUndefined();
});

test('a caption is cut to what the agent reads, by characters, not bytes', () => {
  expect(cutCaption(undefined)).toBeUndefined();
  expect(cutCaption('é'.repeat(MAX_CAPTION + 5))).toHaveLength(MAX_CAPTION);
  expect(Array.from(cutCaption('😀'.repeat(MAX_CAPTION + 1))!)).toHaveLength(MAX_CAPTION);
});
