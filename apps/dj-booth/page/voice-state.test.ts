import { describe, expect, test } from 'vitest';
import { Talking, deliveryOutput } from './voice-state.ts';

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
