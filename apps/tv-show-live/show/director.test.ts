import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDirector, HOLD_MS, type Shot } from './director.ts';

function setup() {
  const shots: Shot[] = [];
  const director = createDirector({ onShot: (s) => shots.push(s) });
  return { director, shots };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the director', () => {
  it('keeps Jada on camera 1 until the guest is on', () => {
    const { director, shots } = setup();
    for (const s of ['greeting', 'introducing', 'trailer', 'inviting', 'dialing'] as const) director.stage(s);
    director.speaking('host', true);
    expect(director.shot).toBe('host-front');
    expect(shots).toEqual([]);
  });

  it('follows the speaker on air: Jada on camera 2, the guest on theirs, both together', () => {
    const { director } = setup();
    director.stage('on-air');
    expect(director.shot).toBe('host-side');
    vi.advanceTimersByTime(HOLD_MS);
    director.speaking('guest', true);
    expect(director.shot).toBe('guest');
    vi.advanceTimersByTime(HOLD_MS);
    director.speaking('host', true);
    expect(director.shot).toBe('two');
  });

  it('holds a shot for HOLD_MS before cutting to a new speaker', () => {
    const { director } = setup();
    director.stage('on-air');
    director.speaking('guest', true);
    expect(director.shot).toBe('host-side');
    vi.advanceTimersByTime(HOLD_MS);
    expect(director.shot).toBe('guest');
  });

  it('stays on the last speaker when nobody is speaking', () => {
    const { director } = setup();
    director.stage('on-air');
    vi.advanceTimersByTime(HOLD_MS);
    director.speaking('guest', true);
    director.speaking('guest', false);
    vi.advanceTimersByTime(HOLD_MS * 3);
    expect(director.shot).toBe('guest');
  });

  it('cuts to the two-shot for the goodbyes', () => {
    const { director } = setup();
    director.stage('on-air');
    director.stage('closing');
    expect(director.shot).toBe('two');
  });

  it("follows the producer's choice at once, and goes back to following the speaker on auto", () => {
    const { director } = setup();
    director.stage('on-air');
    director.mode('two');
    expect(director.shot).toBe('two');
    director.speaking('guest', true);
    vi.advanceTimersByTime(HOLD_MS);
    expect(director.shot).toBe('two');
    director.mode('auto');
    expect(director.shot).toBe('guest');
  });
});
