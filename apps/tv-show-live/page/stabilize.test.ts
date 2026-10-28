import { describe, expect, it } from 'vitest';
import { backgroundMask, edges, estimate, IDENTITY, N, type Warp } from './stabilize.ts';

// A still with structure everywhere (panels, a window grid), as her set has.
function still(): Float32Array {
  const g = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    g[y * N + x] = ((Math.floor(x / 7) + Math.floor(y / 11)) % 2) * 0.6 + (x % 13 < 2 ? 0.3 : 0) + (y % 17 < 2 ? 0.2 : 0);
  }
  return g;
}
// What the renderer's camera makes of it: zoomed by s about the centre, shifted by t.
function warp(src: Float32Array, w: Warp): Float32Array {
  const out = new Float32Array(N * N), c = (N - 1) / 2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const sx = Math.round(c + (x - c - w.tx) / w.s), sy = Math.round(c + (y - c - w.ty) / w.s);
    out[y * N + x] = sx >= 0 && sy >= 0 && sx < N && sy < N ? src[sy * N + sx] : 0;
  }
  return out;
}

describe('the stabilizer', () => {
  const ref = edges(still());
  const mask = backgroundMask();

  it('finds no movement in a frame that has not moved', () => {
    const { warp: w } = estimate(ref, ref, mask);
    expect(w.s).toBeCloseTo(1, 2);
    expect(Math.abs(w.tx)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(w.ty)).toBeLessThanOrEqual(0.5);
  });

  it.each([
    { s: 1.2, tx: 0, ty: 0 },
    { s: 1.1, tx: 3, ty: -2 },
    { s: 1.3, tx: -4, ty: 5 },
  ])('finds the zoom and shift the renderer made ($s, $tx, $ty)', (made) => {
    const frame = edges(warp(still(), made));
    const { warp: w, cost, identity } = estimate(ref, frame, mask);
    expect(w.s).toBeCloseTo(made.s, 1);
    expect(Math.abs(w.tx - made.tx)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(w.ty - made.ty)).toBeLessThanOrEqual(1.5);
    expect(cost).toBeLessThan(identity);
  });

  it('starts from no warp', () => { expect(IDENTITY).toEqual({ s: 1, tx: 0, ty: 0 }); });
});
