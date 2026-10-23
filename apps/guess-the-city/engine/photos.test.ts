import { expect, test } from 'vitest';
import { PhotoStore, tokenOf } from './photos.ts';

const jpeg = (bytes = 'img') => new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });

function fakeFetch(answer: (url: string) => Promise<Response>) {
  const calls: string[] = [];
  return { calls, fetcher: (url: string) => { calls.push(url); return answer(url); } };
}

test('a photo is fetched once, however many ask for it at the same time', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const f = fakeFetch(async () => { await gate; return jpeg(); });
  const store = new PhotoStore(f.fetcher);
  store.add('t1', 'https://upload.example/a.jpg');
  const warming = store.get('t1');          // the round's warm-up
  const page = store.get('t1');             // the page asking meanwhile
  release();
  const [a, b] = await Promise.all([warming, page]);
  expect(f.calls).toEqual(['https://upload.example/a.jpg']);
  expect(a?.type).toBe('image/jpeg');
  expect(b).toBe(a);
  expect(await store.get('t1')).toBe(a);    // and kept
  expect(f.calls).toHaveLength(1);
});

test('an unknown photo is null without a fetch; a failed one is null and tried again later', async () => {
  let ok = false;
  const f = fakeFetch(async () => (ok ? jpeg() : new Response('', { status: 503 })));
  const store = new PhotoStore(f.fetcher);
  expect(store.has('nope')).toBe(false);
  expect(await store.get('nope')).toBeNull();
  expect(f.calls).toHaveLength(0);
  store.add('t2', 'https://upload.example/b.jpg');
  expect(await store.get('t2')).toBeNull();
  ok = true;
  expect(await store.get('t2')).not.toBeNull();
  expect(f.calls).toHaveLength(2);
});

test('a fetch that throws is a missing photo, not a crash', async () => {
  const store = new PhotoStore(async () => { throw new Error('socket hang up'); });
  store.add('t3', 'https://upload.example/c.jpg');
  expect(await store.get('t3')).toBeNull();
});

test('the store stays bounded: the oldest photos go first', async () => {
  const store = new PhotoStore(async () => jpeg(), { sources: 2, bytes: 1 });
  store.add('a', 'https://x/a'); store.add('b', 'https://x/b'); store.add('c', 'https://x/c');
  expect(store.has('a')).toBe(false);
  expect(store.has('c')).toBe(true);
});

test('the token is the last part of the photo URL the page is given', () => {
  expect(tokenOf('/api/apps/guess-the-city/photo/abc123')).toBe('abc123');
});

test('a photo whose bytes are kept is still served after its source was evicted', async () => {
  const f = fakeFetch(async () => jpeg());
  const store = new PhotoStore(f.fetcher, { sources: 1, bytes: 4 });
  store.add('a', 'https://x/a');
  const kept = await store.get('a');
  store.add('b', 'https://x/b');            // a's source goes; its bytes stay
  expect(store.has('a')).toBe(true);
  expect(await store.get('a')).toBe(kept);
  expect(f.calls).toHaveLength(1);
});
