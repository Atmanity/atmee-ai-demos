// The grid arithmetic every room shape is read off (ported from test_geom.py).
// These rules decide whether a shape is a room at all, so they are tested on
// shapes rather than rooms: a sliver is a sliver before anyone names it.
import { describe, expect, test } from 'vitest';
import {
  areaM2, bbox, block, boundary, CELL_CM, cell, gapBetween, isConnected, narrowestCm, rectCells, sharedEdge, strips, type Cell,
} from './geom.ts';
import { fmtG, pyRound } from './num.ts';

const union = (...sets: Set<Cell>[]) => new Set(sets.flatMap((s) => [...s]));
const sorted = (cells: Iterable<Cell>) => [...cells].sort((a, b) => a - b);

describe('basics', () => {
  test('bbox and area are in real units', () => {
    const cells = block(0, 0, 40, 30);   // 4 m x 3 m
    expect(bbox(cells)).toEqual([0, 0, 400, 300]);
    expect(areaM2(cells)).toBe(12.0);
  });

  test('an empty shape has no area and is not connected', () => {
    expect(areaM2(new Set())).toBe(0);
    expect(bbox(new Set())).toEqual([0, 0, 0, 0]);
    expect(isConnected(new Set())).toBe(false);
  });

  test('corner-touching shapes are two shapes', () => {
    // Four-connected on purpose: rooms meeting at a point share no wall, and
    // treating them as one would let a merge produce a shape you cannot walk.
    expect(isConnected(union(block(0, 0, 2, 2), block(2, 2, 4, 4)))).toBe(false);
    expect(isConnected(union(block(0, 0, 2, 2), block(2, 0, 4, 2)))).toBe(true);
  });

  test('rectCells rounds inward', () => {
    // Half a cell is not a cell you own: a wardrobe overhanging the hall by
    // 5 cm must not claim the hall's cell.
    expect(sorted(rectCells([0, 0, 20, 20]))).toEqual(sorted(block(0, 0, 2, 2)));
    expect(sorted(rectCells([5, 5, 25, 25]))).toEqual(sorted(block(1, 1, 2, 2)));
  });
});

describe('narrowness', () => {
  test('narrowest measures the tight place, not the average', () => {
    expect(narrowestCm(block(0, 0, 40, 9))).toBe(90);   // 4 m long, 90 cm wide
  });

  test('a long run does not rescue a neck', () => {
    // A 4 x 4 m room with a single-cell tail: the tail makes it unusable and
    // neither area nor bounding box can see it.
    expect(narrowestCm(union(block(0, 0, 40, 40), new Set([cell(40, 20)])))).toBe(CELL_CM);
  });

  test('a plain room is as narrow as its short side', () => {
    expect(narrowestCm(block(0, 0, 40, 30))).toBe(300);
  });
});

describe('strips', () => {
  test('a rectangular room travels as one rectangle', () => {
    expect(strips(block(0, 0, 40, 30))).toEqual([[0, 0, 400, 300]]);
  });

  test('an L shape is two rectangles', () => {
    expect(strips(union(block(0, 0, 4, 2), block(0, 2, 2, 4)))).toEqual([[0, 0, 40, 20], [0, 20, 20, 40]]);
  });

  test('strips cover exactly the cells they came from', () => {
    const shape = union(block(0, 0, 6, 3), block(2, 3, 8, 6), new Set([cell(9, 9)]));
    const covered = new Set<Cell>();
    for (const rect of strips(shape)) for (const k of rectCells(rect)) covered.add(k);
    expect(sorted(covered)).toEqual(sorted(shape));
  });

  test('a fully empty row between two equal runs is not filled in (fixed in the port)', () => {
    // Unassigned floor can be two separate bands with the same extent; the
    // original merged them across the rooms in between.
    const shape = union(block(0, 0, 4, 2), block(0, 5, 4, 7));
    const covered = new Set<Cell>();
    for (const rect of strips(shape)) for (const k of rectCells(rect)) covered.add(k);
    expect(sorted(covered)).toEqual(sorted(shape));
  });
});

describe('boundary', () => {
  test('a rectangle has four boundary segments', () => {
    const edges = boundary(block(0, 0, 4, 3));
    expect(edges).toHaveLength(4);
    expect(edges).toContainEqual([0, 0, 40, 0]);     // north
    expect(edges).toContainEqual([0, 30, 40, 30]);   // south
    expect(edges).toContainEqual([0, 0, 0, 30]);     // west
    expect(edges).toContainEqual([40, 0, 40, 30]);   // east
  });

  test('the boundary traces a hole', () => {
    // A stitched polygon has to decide what a void means; drawing every edge
    // does not. A room wrapped around a shaft has an inner edge.
    const donut = new Set([...block(0, 0, 5, 5)].filter((k) => !block(2, 2, 3, 3).has(k)));
    const edges = boundary(donut);
    expect(edges).toContainEqual([20, 20, 30, 20]);
    expect(edges).toContainEqual([20, 30, 30, 30]);
  });
});

describe('the shared wall', () => {
  test('two side-by-side rooms share a vertical wall', () => {
    expect(sharedEdge(block(0, 0, 4, 3), block(4, 0, 8, 3))).toEqual(['v', 40, 0, 30]);
  });

  test('rooms one above the other share a horizontal wall', () => {
    expect(sharedEdge(block(0, 0, 4, 3), block(0, 3, 4, 6))).toEqual(['h', 30, 0, 40]);
  });

  test('a corner touch is not a wall', () => {
    expect(sharedEdge(block(0, 0, 2, 2), block(2, 2, 4, 4))).toBeNull();
  });

  test('the longest shared stretch wins', () => {
    // An L-shaped pair can touch in two places; a door belongs in the long one.
    const left = block(0, 0, 2, 6);
    const right = union(block(2, 0, 4, 2), block(2, 4, 4, 6));
    const [axis, line, start, end] = sharedEdge(left, right)!;
    expect([axis, line]).toEqual(['v', 20]);
    expect(end - start).toBe(20);
  });
});

describe('gaps', () => {
  test('facing rectangles report the corridor between them', () => {
    expect(gapBetween([0, 0, 100, 100], [0, 170, 100, 270])).toEqual(['y', 70]);
  });

  test('diagonal neighbours are not a walkway', () => {
    expect(gapBetween([0, 0, 100, 100], [200, 200, 300, 300])).toBeNull();
  });
});

describe('Python arithmetic, kept', () => {
  test('rounding halves to even, as the original rounds', () => {
    expect(pyRound(44.5)).toBe(44);
    expect(pyRound(45.5)).toBe(46);
    expect(pyRound(-2.5)).toBe(-2);
    // 125 cells is 1.25 m², which the original shows as 1.2.
    expect(areaM2(block(0, 0, 25, 5))).toBe(1.2);
    expect(areaM2(block(0, 0, 27, 5))).toBe(1.4);
  });

  test('numbers print the way the original printed them', () => {
    expect(fmtG(12.0)).toBe('12');
    expect(fmtG(4.5)).toBe('4.5');
    expect(fmtG(9)).toBe('9');
  });
});
