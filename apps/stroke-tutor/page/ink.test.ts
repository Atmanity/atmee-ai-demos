/**
 * The two things that fail silently between a finger and the grader: pixels
 * that never became grid units, and a trail that never got thinned.
 * (Ported from the original panel's ink.test.ts.)
 */
import { describe, expect, it } from "vitest";

import type { GridPoint } from "./ink.ts";
import { MAX_POINTS, decimate, pathLength, squareIn, toBox, toGrid } from "./ink.ts";

const rect = (width: number, height: number, left = 0, top = 0) => ({
  left,
  top,
  width,
  height,
});

describe("toGrid", () => {
  it("maps a pointer to grid units, so the same stroke on any screen is the same stroke", () => {
    expect(toGrid(200, 200, rect(400, 400), 1000)).toEqual([500, 500]);
    expect(toGrid(400, 400, rect(400, 400), 1000)).toEqual([1000, 1000]);
  });

  it("maps against the centred square, not the box, so a wide panel does not stretch the character", () => {
    // 800x400: the square is 400 wide, offset 200 from the left.
    expect(toGrid(400, 200, rect(800, 400), 1000)).toEqual([500, 500]);
    expect(toGrid(200, 0, rect(800, 400), 1000)).toEqual([0, 0]);
  });

  it("subtracts the element's own offset in the page", () => {
    expect(toGrid(140, 90, rect(400, 400, 40, 90), 1000)).toEqual([250, 0]);
  });

  it("returns null for a box with no size rather than sending NaN to the server", () => {
    expect(toGrid(10, 10, rect(0, 0), 1000)).toBeNull();
  });
});

describe("toBox", () => {
  it("round-trips a grid point back to pixels for drawing", () => {
    const square = squareIn(rect(800, 400));
    expect(toBox([500, 500], square, 1000)).toEqual([400, 200]);
  });
});

describe("decimate", () => {
  const dense = (n: number): GridPoint[] =>
    Array.from({ length: n }, (_, i) => [Math.round((i * 1000) / n), 500] as GridPoint);

  it("caps a raw pointer trail, so a stroke is never hundreds of points on the wire", () => {
    const thinned = decimate(dense(600));
    expect(thinned.length).toBeLessThanOrEqual(MAX_POINTS);
  });

  it("keeps the endpoints, or the stroke no longer starts where it started", () => {
    const raw = dense(600);
    const thinned = decimate(raw);
    expect(thinned[0]).toEqual(raw[0]);
    expect(thinned[thinned.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it("keeps a corner, which for 永's shoulder IS the stroke", () => {
    const corner: GridPoint[] = [
      ...Array.from({ length: 200 }, (_, i) => [200 + i * 1.5, 300] as GridPoint),
      ...Array.from({ length: 200 }, (_, i) => [500, 300 + i * 1.5] as GridPoint),
    ];
    const thinned = decimate(corner);
    expect(thinned.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(thinned.some(([x, y]) => Math.abs(x - 500) < 12 && Math.abs(y - 300) < 12)).toBe(
      true,
    );
  });

  it("leaves a short trail alone", () => {
    const short = dense(8);
    expect(decimate(short)).toBe(short);
  });
});

describe("pathLength", () => {
  it("measures the trail so a tap can be told from a stroke", () => {
    expect(pathLength([[0, 0], [3, 4]])).toBe(5);
    expect(pathLength([[0, 0]])).toBe(0);
  });
});
