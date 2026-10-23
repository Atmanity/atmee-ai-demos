import { describe, expect, it } from 'vitest';

import { describeBounds, mercatorY, projectRings } from './outline.ts';

/**
 * The silhouette renderer (ported as-is from the original panel, where it drew
 * the whole map whenever the static image failed): "it draws something
 * sensible" is a tested property, not a hope.
 */

const SQUARE: number[][][] = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];

describe('projectRings', () => {
  it('turns a ring into a closed SVG path inside the box', () => {
    const projected = projectRings(SQUARE, 100, 10);
    expect(projected?.paths).toHaveLength(1);
    expect(projected?.paths[0].startsWith('M')).toBe(true);
    expect(projected?.paths[0].endsWith('Z')).toBe(true);

    const numbers = (projected?.paths[0].match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(100);
  });

  it('keeps the aspect ratio instead of filling the card', () => {
    // A long thin country stretched to a square is how Chile ends up looking
    // like Poland.
    const thin: number[][][] = [[[0, 0], [1, 0], [1, 20], [0, 20], [0, 0]]];
    const projected = projectRings(thin, 100, 0);
    const xs = extract(projected!.paths[0], 0);
    const ys = extract(projected!.paths[0], 1);
    expect(width(xs)).toBeLessThan(width(ys));
  });

  it('draws every island, not just the mainland', () => {
    const projected = projectRings([...SQUARE, [[20, 20], [21, 20], [21, 21], [20, 20]]]);
    expect(projected?.paths).toHaveLength(2);
  });

  it('skips a ring that is not a shape', () => {
    expect(projectRings([[[0, 0], [1, 1]]])).toBeNull();
  });

  it('ignores non-finite coordinates rather than emitting NaN commands', () => {
    // `MNaN NaN` renders as nothing at all, with no error anywhere.
    const projected = projectRings([[[0, 0], [10, 0], [Number.NaN, 5], [10, 10], [0, 10]]]);
    expect(projected?.paths[0]).not.toContain('NaN');
  });

  it.each([[[] as number[][][]], [[[]] as number[][][]]])('returns null for %p', (rings) => {
    expect(projectRings(rings)).toBeNull();
  });
});

describe('mercatorY', () => {
  it('puts the equator in the middle and the north above it', () => {
    expect(mercatorY(0)).toBeCloseTo(0.5, 6);
    expect(mercatorY(60)).toBeLessThan(mercatorY(0));
  });

  it('clamps the poles instead of returning infinity', () => {
    expect(Number.isFinite(mercatorY(90))).toBe(true);
    expect(Number.isFinite(mercatorY(-90))).toBe(true);
  });
});

describe('describeBounds', () => {
  it('reads a centre as hemispherical coordinates', () => {
    expect(describeBounds([39.6, -8.1], null)).toBe('39.6° N, 8.1° W');
  });

  it('falls back to the middle of the bounding box', () => {
    expect(describeBounds(null, [-10, 100, 10, 140])).toBe('0.0° N, 120.0° E');
  });

  it('says nothing when it knows nothing', () => {
    expect(describeBounds(null, null)).toBe('');
  });
});

function extract(path: string, offset: number): number[] {
  const numbers = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  return numbers.filter((_, index) => index % 2 === offset);
}

function width(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}
