// Tests for the floor: when a typed turn
// may go to the avatar. The timings were settled in live staging sessions;
// these pin them down with fake time.
//
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createFloor, QUIET_MS, REPLY_WAIT_MS, type Floor } from './floor.ts';

let sent: string[], floor: Floor;
beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  sent = [];
  floor = createFloor(async (text) => { sent.push(text); });
});
afterEach(() => { floor.close(); vi.useRealTimers(); });

const tick = (ms: number) => vi.advanceTimersByTime(ms);
// The avatar speaks for `ms`, then falls quiet.
const reply = (ms = 3000) => { floor.speaking(true); tick(ms); floor.speaking(false); };

test('a turn typed while the avatar is quiet goes at once', async () => {
  await floor.say('hello');
  expect(sent).toEqual(['hello']);
});

test('a turn typed while it speaks waits for 1.5 s of quiet, through gaps inside the reply', async () => {
  floor.speaking(true);
  await floor.say('question');
  floor.speaking(false); tick(900); floor.speaking(true);   // a gap inside one reply
  tick(2000); floor.speaking(false);
  tick(QUIET_MS - 1);
  expect(sent).toEqual([]);
  tick(1);
  expect(sent).toEqual(['question']);
});

test('turns typed meanwhile go out together, as one turn', async () => {
  floor.speaking(true);
  await floor.say('first');
  await floor.say('second');
  floor.speaking(false); tick(QUIET_MS);
  expect(sent).toEqual(['first\nsecond']);
});

test('the next turn waits for the answer to the last one', async () => {
  await floor.say('one');
  await floor.say('two');
  expect(sent).toEqual(['one']);
  tick(2000); reply(); tick(QUIET_MS);
  expect(sent).toEqual(['one', 'two']);
});

test('without an answer, the next turn goes after the reply wait', async () => {
  await floor.say('one');
  await floor.say('two');
  tick(REPLY_WAIT_MS - 1);
  expect(sent).toEqual(['one']);
  tick(1);
  expect(sent).toEqual(['one', 'two']);
});

test('a waiting event holds turns until the avatar starts on it and finishes', async () => {
  floor.event(20);
  await floor.say('question');
  tick(5000);
  expect(sent).toEqual([]);
  floor.utterance(); reply(); tick(QUIET_MS);
  expect(sent).toEqual(['question']);
});

test('each queued event counts: the turn waits for the second one too', async () => {
  floor.event(20);
  floor.event(20);
  await floor.say('question');
  floor.utterance(); reply(); tick(QUIET_MS);
  expect(sent).toEqual([]);
  floor.utterance(); reply(); tick(QUIET_MS);
  expect(sent).toEqual(['question']);
});

test('an event never spoken stops holding turns once its ttl has passed', async () => {
  floor.event();            // Causeur's default, 10 s
  await floor.say('question');
  tick(10_000);
  expect(sent).toEqual([]);
  tick(50);
  expect(sent).toEqual(['question']);
});

test('an event that failed to send stops holding turns', async () => {
  const withdraw = floor.event(20);
  await floor.say('question');
  expect(sent).toEqual([]);
  withdraw();
  expect(sent).toEqual(['question']);
});

test('nothing goes after close', async () => {
  floor.speaking(true);
  await floor.say('late');
  floor.close();
  floor.speaking(false); tick(QUIET_MS + REPLY_WAIT_MS);
  expect(sent).toEqual([]);
});
