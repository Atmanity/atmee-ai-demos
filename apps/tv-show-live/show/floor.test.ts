import { describe, expect, it } from 'vitest';
import { createFloor } from './floor.ts';

describe('the floor', () => {
  it('belongs to whoever starts speaking first; the other is kept off the air meanwhile', () => {
    const floor = createFloor();
    floor.speaking('host', true);
    floor.speaking('guest', true);   // "mm-hmm" over her
    expect(floor.onAir('host')).toBe(true);
    expect(floor.onAir('guest')).toBe(false);
    floor.speaking('guest', false);
    expect(floor.wentOnAir('guest')).toBe(false);
    expect(floor.wentOnAir('host')).toBe(true);
  });

  it('is free between turns, so either can start', () => {
    const floor = createFloor();
    floor.speaking('host', true);
    floor.speaking('host', false);
    expect(floor.onAir('guest')).toBe(true);
    floor.speaking('guest', true);
    expect(floor.onAir('guest')).toBe(true);
    expect(floor.onAir('host')).toBe(false);
    expect(floor.wentOnAir('guest')).toBe(true);
  });

  it('passes to the other when the holder stops while the other is still speaking', () => {
    const floor = createFloor();
    floor.speaking('host', true);
    floor.speaking('guest', true);
    floor.speaking('host', false);
    expect(floor.onAir('guest')).toBe(true);
    // The rest of her stretch went out: its words are a line of the transcript.
    floor.speaking('guest', false);
    expect(floor.wentOnAir('guest')).toBe(true);
  });
});
