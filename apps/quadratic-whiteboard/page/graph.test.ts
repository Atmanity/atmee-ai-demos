import { describe, expect, it } from "vitest";

import { curvePoints, evaluate, project, tickLabel, ticks, yRange } from "./graph.ts";
import type { EquationView, FactsView } from "../engine/types.ts";

const EQUATION: EquationView = {
  a: 1,
  b: -4,
  c: 3,
  a_display: "1",
  b_display: "-4",
  c_display: "3",
  display: "y = x² - 4x + 3",
  zero_form: "x² - 4x + 3 = 0",
};

const FACTS: FactsView = {
  discriminant: "4",
  discriminant_sign: "positive",
  nature: "two_rational",
  roots: ["3", "1"],
  crossings: [1, 3],
  vertex: [2, -1],
  vertex_display: "(2, -1)",
  axis: 2,
  axis_display: "2",
  opens: "upward",
  view: { x_min: -3, x_max: 7 },
};

describe("ticks", () => {
  it("lands on round numbers a class can read a coordinate off", () => {
    expect(ticks(-3, 7)).toEqual([-2, 0, 2, 4, 6]);
  });

  it("does not label zero as float drift", () => {
    /* Accumulating a step lands on 4.44e-16 rather than 0, which then renders
       as a tick labelled "0.00000000000000044". */
    expect(ticks(-1, 1)).toContain(0);
    expect(tickLabel(0)).toBe("0");
    expect(tickLabel(-0)).toBe("0");
  });

  it("scales to a wide window instead of drawing hundreds of lines", () => {
    const wide = ticks(-500, 500);
    expect(wide.length).toBeLessThan(20);
    expect(wide).toContain(0);
  });

  it("returns nothing for a degenerate range rather than looping", () => {
    expect(ticks(5, 5)).toEqual([]);
    expect(ticks(0, Number.NaN)).toEqual([]);
  });
});

describe("yRange", () => {
  it("always includes the x-axis, even for a curve that never comes near it", () => {
    /* Otherwise a parabola sitting entirely above zero is drawn with no
       x-axis on screen, and the roots have nothing to be absent from. */
    const range = yRange({ ...EQUATION, c: 500 }, -3, 7);
    expect(range.yMin).toBeLessThanOrEqual(0);
  });

  it("contains the vertex", () => {
    const range = yRange(EQUATION, -3, 7);
    expect(range.yMin).toBeLessThan(-1);
  });
});

describe("project", () => {
  it("puts the roots and the vertex where the algebra says they are", () => {
    const projection = project(EQUATION, FACTS, 400, 300);
    const [x1] = projection.toScreen(1, 0);
    const [x3] = projection.toScreen(3, 0);
    const [vx] = projection.toScreen(2, -1);

    expect(x1).toBeLessThan(vx);
    expect(vx).toBeLessThan(x3);
    // The vertex is the axis of symmetry, so it sits midway between the roots.
    expect(vx).toBeCloseTo((x1 + x3) / 2, 6);
  });

  it("puts a larger y higher up the screen", () => {
    const projection = project(EQUATION, FACTS, 400, 300);
    const [, high] = projection.toScreen(0, 10);
    const [, low] = projection.toScreen(0, -10);
    expect(high).toBeLessThan(low);
  });

  it("survives a zero-sized box rather than dividing by it", () => {
    /* jsdom measures everything as 0×0, and so does a panel for one frame
       before layout. */
    const projection = project(EQUATION, FACTS, 0, 0);
    const [x, y] = projection.toScreen(1, 0);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });
});

describe("curvePoints", () => {
  it("evaluates the polynomial the agent sent, and nothing else", () => {
    expect(evaluate(EQUATION, 1)).toBe(0);
    expect(evaluate(EQUATION, 3)).toBe(0);
    expect(evaluate(EQUATION, 2)).toBe(-1);
  });

  it("spans the whole window", () => {
    const projection = project(EQUATION, FACTS, 400, 300);
    const points = curvePoints(EQUATION, projection, 400);
    expect(points.length).toBeGreaterThan(100);
    expect(points[0][0]).toBeCloseTo(projection.toScreen(-3, 0)[0], 6);
    expect(points[points.length - 1][0]).toBeCloseTo(projection.toScreen(7, 0)[0], 6);
  });
});
