import { describe, expect, it } from 'vitest';
import { cbcr, DEFAULT_KEY, estimateKey } from './chroma.ts';

/** A w×h RGBA frame of one colour, with `paint` drawing over it. */
function frame(w: number, h: number, rgb: [number, number, number], paint?: (x: number, y: number) => [number, number, number] | null) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint?.(x, y) ?? rgb;
      data.set([...c, 255], (y * w + x) * 4);
    }
  }
  return data;
}

describe('the green screen', () => {
  it('reads the screen colour from the top corners', () => {
    const data = frame(64, 64, [14, 148, 50], (x, y) => (x > 20 && x < 44 ? [200, 170, 150] : null));
    expect(estimateKey(data, 64, 64)).toEqual([14, 148, 50]);
  });

  it('takes the median, so a few odd pixels do not move it', () => {
    const data = frame(64, 64, [12, 151, 53], (x, y) => (x === 0 && y < 3 ? [0, 255, 0] : null));
    expect(estimateKey(data, 64, 64)).toEqual([12, 151, 53]);
  });

  it('reads one clean corner when he leans into the other', () => {
    const leaning = frame(64, 64, [12, 151, 53], (x, y) => (y < 8 && x < 40 ? [30, 30, 40] : null));
    expect(estimateKey(leaning, 64, 64)).toEqual([12, 151, 53]);
  });

  it('keeps the last key when the corners are not green', () => {
    expect(estimateKey(frame(64, 64, [0, 0, 0]), 64, 64)).toBeNull();
    const covered = frame(64, 64, [12, 151, 53], (x, y) => (y < 8 && (x < 10 || x > 52) ? [30, 30, 40] : null));
    expect(estimateKey(covered, 64, 64)).toBeNull();
  });

  it('keys the portrait\'s green far from his face and suit', () => {
    const k = cbcr(DEFAULT_KEY.map((v) => v / 255) as [number, number, number]);
    const far = (rgb: [number, number, number]) => Math.hypot(...cbcr(rgb.map((v) => v / 255) as [number, number, number]).map((v, i) => v - k[i]));
    expect(far([13, 146, 51])).toBeLessThan(0.07);   // the screen in shadow
    expect(far([224, 180, 160])).toBeGreaterThan(0.16);  // skin
    expect(far([40, 42, 48])).toBeGreaterThan(0.16);     // charcoal suit
    expect(far([120, 20, 40])).toBeGreaterThan(0.16);    // burgundy tie
  });
});
