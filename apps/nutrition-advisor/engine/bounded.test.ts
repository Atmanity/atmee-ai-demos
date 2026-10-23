// Ported from test_the_photo_leg_fails_in_silence.py (photos one at a time) and
// test_a_turn_that_never_ends.py (a call that never settles must not take the
// conversation with it).
import { describe, expect, it } from 'vitest';
import { bounded, serial, TimedOut } from './bounded.ts';

const tick = () => new Promise((r) => setTimeout(r, 1));

function reader(fail = false) {
  const seen: string[] = [];
  let live = 0;
  let overlap = 0;
  const read = async (photo: string) => {
    live += 1;
    overlap = Math.max(overlap, live);
    try {
      await tick(); // a read is not instantaneous
      if (fail) throw new Error('the model call failed');
      seen.push(photo);
    } finally {
      live -= 1;
    }
  };
  return { read, seen, get overlap() { return overlap; }, set fail(v: boolean) { fail = v; } };
}

describe('two photos at once', () => {
  it('are read one at a time, and both still get read', async () => {
    const r = reader();
    const one = serial();
    await Promise.all([one(() => r.read('first')), one(() => r.read('second'))]);
    expect(r.overlap).toBe(1);
    expect(r.seen).toEqual(['first', 'second']);
  });

  it('the queue outlives one photo', async () => {
    // A fresh lock per photo excludes nobody: the same bug with a lock in it.
    const r = reader();
    const one = serial();
    await one(() => r.read('first'));
    await Promise.all([one(() => r.read('second')), one(() => r.read('third'))]);
    expect(r.overlap).toBe(1);
  });

  it('one bad photo does not wedge the next', async () => {
    // A lock released only on the happy path is a leg that stops after its
    // first failure, with nothing anywhere to say why.
    const r = reader(true);
    const one = serial();
    await expect(one(() => r.read('blurry'))).rejects.toThrow('failed');
    r.fail = false;
    await bounded(one(() => r.read('clear')), 1000);
    expect(r.seen).toEqual(['clear']);
  });
});

describe('a call that never answers', () => {
  it('ends, rather than holding the turn forever', async () => {
    const never = new Promise<string>(() => {});
    await expect(bounded(never, 20, 'the card')).rejects.toBeInstanceOf(TimedOut);
  });

  it('says what timed out', async () => {
    await expect(bounded(new Promise(() => {}), 20, 'the recipe')).rejects.toThrow('the recipe did not answer');
  });

  it('a call that answers in time is untouched, and its failure is its own', async () => {
    await expect(bounded(Promise.resolve('card'), 1000)).resolves.toBe('card');
    await expect(bounded(Promise.reject(new Error('quota')), 1000)).rejects.toThrow('quota');
  });

  it('the turn after a wedged one works normally', async () => {
    const one = serial();
    await expect(one(() => bounded(new Promise(() => {}), 20))).rejects.toBeInstanceOf(TimedOut);
    await expect(one(async () => 'answered')).resolves.toBe('answered');
  });
});
