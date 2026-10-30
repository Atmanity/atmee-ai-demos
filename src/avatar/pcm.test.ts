import { describe, expect, test } from 'vitest';
import { Resampler24to16 } from './pcm.ts';

const tone = (hz: number, seconds: number, rate = 24_000, amp = 0.5) =>
  Int16Array.from({ length: Math.round(rate * seconds) }, (_, i) => Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * amp * 0x7fff));

/** The RMS of 16-bit PCM, as a fraction of full scale, past the filter's start-up. */
const level = (pcm: Int16Array, skip = 200) => {
  let sum = 0;
  for (let i = skip; i < pcm.length; i++) sum += (pcm[i] / 0x7fff) ** 2;
  return Math.sqrt(sum / (pcm.length - skip));
};

/** How strongly `pcm` (at 16 kHz) contains `hz`: the magnitude of its correlation with that sine. */
const strength = (pcm: Int16Array, hz: number, rate = 16_000, skip = 200) => {
  let re = 0, im = 0;
  for (let i = skip; i < pcm.length; i++) {
    re += (pcm[i] / 0x7fff) * Math.cos((2 * Math.PI * hz * i) / rate);
    im += (pcm[i] / 0x7fff) * Math.sin((2 * Math.PI * hz * i) / rate);
  }
  return (2 * Math.hypot(re, im)) / (pcm.length - skip);
};

describe('24 to 16 kHz for the face', () => {
  test('two thirds as many samples come out, in pieces as in one', () => {
    const whole = new Resampler24to16().push(tone(440, 1));
    const r = new Resampler24to16();
    const input = tone(440, 1);
    const pieces: Int16Array[] = [];
    for (let at = 0; at < input.length; at += 480) pieces.push(r.push(input.subarray(at, at + 480)));
    const joined = Int16Array.from(pieces.flatMap((p) => [...p]));
    expect(Math.abs(whole.length - 16_000)).toBeLessThanOrEqual(2);
    expect(joined.length).toBe(whole.length);
    expect(Math.max(...joined.map((v, i) => Math.abs(v - whole[i])))).toBeLessThanOrEqual(1);
  });

  test('speech frequencies pass at their level', () => {
    const out = new Resampler24to16().push(tone(1_000, 1));
    expect(level(out)).toBeCloseTo(0.5 / Math.SQRT2, 1);
    expect(strength(out, 1_000)).toBeGreaterThan(0.45);
  });

  test('what 16 kHz cannot hold is removed, not folded back down (no aliasing)', () => {
    // 11 kHz is above 16 kHz's 8 kHz limit; a naive resampler folds it to 5 kHz.
    const out = new Resampler24to16().push(tone(11_000, 1));
    expect(strength(out, 5_000)).toBeLessThan(0.01);
    expect(level(out)).toBeLessThan(0.02);
    // And it is not silence that passes: the same filter keeps a tone below the limit.
    expect(level(new Resampler24to16().push(tone(6_000, 1)))).toBeGreaterThan(0.3);
  });
});

test('the check catches aliasing: the naive interpolation this replaced folds 11 kHz down to 5 kHz', () => {
  const pcm = tone(11_000, 1);
  const naive = new Int16Array(Math.floor((pcm.length * 2) / 3));
  for (let i = 0; i < naive.length; i++) {
    const x = i * 1.5, a = Math.floor(x), b = Math.min(a + 1, pcm.length - 1);
    naive[i] = Math.round(pcm[a] + (pcm[b] - pcm[a]) * (x - a));
  }
  expect(strength(naive, 5_000)).toBeGreaterThan(0.05);
});
