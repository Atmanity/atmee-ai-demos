/**
 * The drawing arithmetic, pinned.
 *
 * A mirrored sky is the failure this file exists to catch: a sign flip on the
 * x axis puts east on the right, which looks completely correct on screen and
 * is wrong for everybody who goes outside and looks. So all four compass
 * points are asserted, not one.
 */
import { describe, expect, it } from "vitest";

import {
  compassLabelPoints,
  compassWord,
  domeFor,
  heightWord,
  nearestStar,
  project,
  starRadius,
} from "./projection.ts";
import type { VisibleStar } from "../engine/types.ts";

const DOME = domeFor(300, 300, 0); // cx 150, cy 150, r 150

function star(over: Partial<VisibleStar>): VisibleStar {
  return { id: "x", name: "X", alt: 40, az: 90, mag: 1, con: "Ori", ...over };
}

describe("project", () => {
  it("puts the zenith in the middle and the horizon on the rim", () => {
    expect(project(90, 0, DOME)).toEqual({ x: 150, y: 150 });
    const horizon = project(0, 0, DOME);
    expect(Math.hypot(horizon.x - 150, horizon.y - 150)).toBeCloseTo(150, 6);
  });

  it("draws the sky as seen looking UP, so east is on the left", () => {
    // North up, east left, south down, west right. Getting any of these
    // backwards mirrors the whole chart.
    expect(project(0, 0, DOME).y).toBeCloseTo(0, 6); // north, top
    expect(project(0, 90, DOME).x).toBeCloseTo(0, 6); // east, left
    expect(project(0, 180, DOME).y).toBeCloseTo(300, 6); // south, bottom
    expect(project(0, 270, DOME).x).toBeCloseTo(300, 6); // west, right
  });

  it("maps altitude linearly, so high stars are not crushed into a dot", () => {
    const forty_five = project(45, 0, DOME);
    expect(Math.hypot(forty_five.x - 150, forty_five.y - 150)).toBeCloseTo(75, 6);
  });
});

describe("domeFor", () => {
  it("returns nothing to draw before layout has happened", () => {
    expect(domeFor(0, 0).radius).toBe(0);
  });

  it("fits the shorter side, so a wide panel does not draw off the top", () => {
    expect(domeFor(600, 200, 10).radius).toBe(90);
  });
});

describe("starRadius", () => {
  it("draws a brighter star bigger", () => {
    expect(starRadius(-1.46)).toBeGreaterThan(starRadius(1.0));
    expect(starRadius(1.0)).toBeGreaterThan(starRadius(4.0));
  });

  it("never draws a faint star as nothing at all", () => {
    expect(starRadius(6)).toBeGreaterThan(0.5);
  });
});

describe("nearestStar", () => {
  const stars = [
    star({ id: "bright", mag: -1, alt: 0, az: 0 }),
    star({ id: "faint", mag: 3, alt: 0, az: 180 }),
  ];

  it("finds the star under the tap", () => {
    const at = project(0, 180, DOME);
    expect(nearestStar(at.x, at.y, stars, DOME)?.id).toBe("faint");
  });

  it("returns nothing for a tap on empty sky, rather than the nearest anything", () => {
    expect(nearestStar(150, 150, stars, DOME)).toBeNull();
  });

  it("keeps the brighter star when a tap sits between two", () => {
    // `visible` arrives brightest-first and ties keep the first seen, so a tap
    // equidistant between two lands on the one the user could actually see.
    const pair = [
      star({ id: "bright", mag: -1, alt: 45, az: 90 }),
      star({ id: "faint", mag: 4, alt: 45, az: 90 }),
    ];
    const at = project(45, 90, DOME);
    expect(nearestStar(at.x, at.y, pair, DOME)?.id).toBe("bright");
  });
});

describe("words", () => {
  it("names the direction the way the avatar says it out loud", () => {
    expect(compassWord(0)).toBe("north");
    expect(compassWord(90)).toBe("east");
    expect(compassWord(200)).toBe("south");
    expect(compassWord(315)).toBe("north-west");
    expect(compassWord(359)).toBe("north");
  });

  it("names the height without ever saying a number of degrees", () => {
    for (const alt of [5, 30, 50, 80]) {
      expect(heightWord(alt)).not.toMatch(/\d/);
    }
    expect(heightWord(80)).toBe("almost overhead");
    expect(heightWord(5)).toBe("low down");
  });
});

describe("the compass letters stay on the chart", () => {
  it("north and south are not pushed off a wide, short canvas", () => {
    // Found in live testing: the chart showed only E and W. The label offset
    // was a percentage of the rim, and on the real panel box (795x560) nine
    // percent of the dome was more overshoot than domeFor left as padding —
    // so N sat above the top edge and S below the bottom one, and there was
    // no way to tell which way you were facing.
    const width = 795;
    const height = 560;
    const dome = domeFor(width, height);
    for (const point of compassLabelPoints(dome)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(width);
      expect(point.y).toBeGreaterThanOrEqual(6);
      expect(point.y).toBeLessThanOrEqual(height - 6);
    }
    const labels = compassLabelPoints(dome).map((p) => p.label);
    expect(labels).toEqual(["N", "E", "S", "W"]);
  });
});
