/**
 * Sky coordinates to screen coordinates, and back to the nearest star.
 *
 * Pure, and in its own module so it can be tested in node with no canvas and no
 * DOM. This is drawing arithmetic only — it decides where a star is PAINTED,
 * never where it IS. Altitude and azimuth are worked out by the chart
 * (engine/chart.ts) and arrive in the snapshot; nothing here could recompute
 * them, which is the point. (Ported unchanged from the original panel.)
 *
 * The layout is a planisphere: the horizon is the rim of a circle, the zenith
 * is the middle, and the observer is looking UP. That last part is why east
 * appears on the left — hold a star chart over your head and the map flips.
 * Getting it backwards mirrors the whole sky, which looks completely
 * plausible until somebody goes outside, so the compass letters are drawn on
 * the rim and the test below pins all four.
 */

import type { VisibleStar } from "../engine/types.ts";

/** The drawn circle: centre and radius, in CSS pixels. */
export interface Dome {
  cx: number;
  cy: number;
  radius: number;
}

/**
 * The largest dome that fits in a box, with room for the compass letters.
 * Returns a radius of 0 for a box with no size, which is what a canvas
 * measures before layout has happened.
 */
export function domeFor(width: number, height: number, pad = 18): Dome {
  const radius = Math.max(0, Math.min(width, height) / 2 - pad);
  return { cx: width / 2, cy: height / 2, radius };
}

/**
 * Where a star sits on the dome.
 *
 * Altitude maps linearly to distance from the centre — the zenith at the
 * middle, the horizon at the rim. Linear rather than a true stereographic
 * projection on purpose: stereographic crowds everything above sixty degrees
 * into a dot, and the stars worth pointing at are the high ones.
 */
export function project(alt: number, az: number, dome: Dome): { x: number; y: number } {
  const r = ((90 - clamp(alt, -90, 90)) / 90) * dome.radius;
  const theta = (az * Math.PI) / 180;
  return {
    // Minus on x: looking up, not down. East is on the left.
    x: dome.cx - r * Math.sin(theta),
    y: dome.cy - r * Math.cos(theta),
  };
}

/** Where the compass letters go, in the same projection as the stars. */
export function compassPoints(dome: Dome): { label: string; x: number; y: number }[] {
  return ["N", "E", "S", "W"].map((label, index) => {
    const point = project(0, index * 90, dome);
    return { label, x: point.x, y: point.y };
  });
}

/**
 * How far outside the rim a compass letter is drawn.
 *
 * A FIXED gap, not a percentage. It used to be the rim times 1.09, which is
 * fine on a square canvas and silently loses N and S on a wide, short one:
 * nine percent of a 262-pixel dome is 24 pixels of overshoot into 18 pixels
 * of padding, so both letters landed outside the canvas and the chart showed
 * only East and West. `domeFor`'s padding is the budget, and this has to fit
 * inside it with room for the text.
 */
export const COMPASS_GAP = 11;

/** Where the compass letters are actually drawn, gap included. */
export function compassLabelPoints(
  dome: Dome,
): { label: string; x: number; y: number }[] {
  const scale = dome.radius > 0 ? (dome.radius + COMPASS_GAP) / dome.radius : 1;
  return compassPoints(dome).map((point) => ({
    label: point.label,
    x: dome.cx + (point.x - dome.cx) * scale,
    y: dome.cy + (point.y - dome.cy) * scale,
  }));
}

/**
 * How big to draw a star, in CSS pixels.
 *
 * Magnitude is logarithmic and runs backwards, so this is a hand-tuned ramp
 * rather than a formula: the aim is that Sirius reads as obviously brighter
 * than Vega without a fourth-magnitude star vanishing entirely.
 */
export function starRadius(mag: number, scale = 1): number {
  return Math.max(0.9, (3.4 - 0.62 * mag)) * scale;
}

/**
 * The star nearest a tap, or null if the tap was not near one.
 *
 * `tolerance` is generous because this is a fingertip on a dark chart: a tap
 * that hits nothing at all is far more annoying than one that snaps to the
 * wrong neighbour, and the agent will name whatever it selected out loud, so a
 * mis-hit is immediately visible and one tap from being fixed.
 */
export function nearestStar(
  x: number,
  y: number,
  stars: VisibleStar[],
  dome: Dome,
  tolerance = 22,
): VisibleStar | null {
  let best: VisibleStar | null = null;
  let bestDistance = tolerance;
  for (const star of stars) {
    const point = project(star.alt, star.az, dome);
    const distance = Math.hypot(point.x - x, point.y - y);
    // Strictly nearer, so ties keep the brighter star: `visible` arrives
    // brightest-first, and a tap between two stars should land on the one the
    // user could actually see.
    if (distance < bestDistance) {
      best = star;
      bestDistance = distance;
    }
  }
  return best;
}

/** The direction a star lies in, in the words the avatar uses out loud. */
export function compassWord(az: number): string {
  const names = [
    "north", "north-east", "east", "south-east",
    "south", "south-west", "west", "north-west",
  ];
  return names[Math.floor((((az % 360) + 360 + 22.5) % 360) / 45)];
}

/** How high a star is, in the same words. */
export function heightWord(alt: number): string {
  if (alt > 70) return "almost overhead";
  if (alt > 45) return "high up";
  if (alt > 25) return "halfway up";
  return "low down";
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
