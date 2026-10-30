import { describe, expect, test } from 'vitest';
import { QUIET_FOR_CUE_MS, Talking, cueMayGo, deliveryOutput, retryAfter } from './voice-state.ts';

describe('where a delivery plays', () => {
  test('through the face while it is up and wanted, else in the page', () => {
    expect(deliveryOutput('live', false)).toBe('face');
    expect(deliveryOutput('live', true)).toBe('page');      // the face came up too late: voice only
    expect(deliveryOutput('starting', false)).toBe('page');
    expect(deliveryOutput('idle', false)).toBe('page');
  });
});

describe('whether she is talking, from the deliveries', () => {
  test('from a delivery starting to play to its end; quiet since then', () => {
    let now = 1000;
    const t = new Talking(() => now);
    expect(t.talking).toBe(false);
    expect(t.started(1)).toBe(true);
    expect(t.talking).toBe(true);
    expect(t.quietFor()).toBe(0);
    now = 4000;
    expect(t.finished(1)).toBe(true);
    expect(t.talking).toBe(false);
    now = 4800;
    expect(t.quietFor()).toBe(800);
  });

  test('a delivery that never began to play changes nothing when it ends (cut before it started)', () => {
    let now = 0;
    const t = new Talking(() => now);
    now = 500;
    expect(t.finished(7)).toBe(false);
    expect(t.quietSince).toBe(0);
  });

  test('a start reported twice, or after its end, is one talk', () => {
    const t = new Talking(() => 0);
    expect(t.started(1)).toBe(true);
    expect(t.started(1)).toBe(false);
    expect(t.finished(1)).toBe(true);
    expect(t.finished(1)).toBe(false);
  });
});

describe('when a cue may go', () => {
  const at = (talking: boolean, quietForMs = 0, now = 10_000, retryAt = 0) => ({ talking, quietForMs, now, retryAt });

  test('a typed turn goes at once, even while she talks: the listener is waiting', () => {
    expect(cueMayGo({ typed: true }, at(true))).toBe(true);
  });

  test('once refused, a typed turn waits for her to stop, and is not sent again while she talks', () => {
    const typed = { typed: true, refused: true };
    expect(cueMayGo(typed, at(true, 0, 20_000))).toBe(false);
    expect(cueMayGo(typed, at(false, 0, 10_000, retryAfter(typed, 9_800)))).toBe(false);  // its short wait
    expect(cueMayGo(typed, at(false, 0, 10_000, retryAfter(typed, 9_000)))).toBe(true);   // no quiet spell needed
  });

  test('a cue waits for a quiet spell and its retry time', () => {
    const cue = { typed: false };
    expect(cueMayGo(cue, at(true, 5000))).toBe(false);
    expect(cueMayGo(cue, at(false, QUIET_FOR_CUE_MS - 1))).toBe(false);
    expect(cueMayGo(cue, at(false, QUIET_FOR_CUE_MS, 10_000, retryAfter(cue, 9_000)))).toBe(false);
    expect(cueMayGo(cue, at(false, QUIET_FOR_CUE_MS, 10_000, 0))).toBe(true);
  });
});
