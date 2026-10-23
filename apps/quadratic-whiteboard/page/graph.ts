/**
 * Turning the engine's view window into pixels.
 *
 * Pure functions, no React and no canvas, because this is the part of the
 * drawing that can actually be wrong in a way a test can catch — jsdom has no
 * 2-D context, so the strokes themselves are untested by design and everything
 * worth asserting lives here.
 *
 * The panel chooses none of the maths. `x_min`/`x_max` and the roots come from
 * the engine; what this file decides is where they land on a rectangle, and how
 * far up and down to go so the vertex is on screen with room to breathe.
 */

import type { EquationView, FactsView } from "../engine/types.ts";

export const PAD = { left: 44, right: 16, top: 16, bottom: 30 };

export interface Projection {
  toScreen: (x: number, y: number) => [number, number];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Where y = 0 and x = 0 sit on screen, for the axes. */
  originX: number;
  originY: number;
}

/** `y` at `x`, the only evaluation the panel does — for pixels, not for facts. */
export function evaluate(equation: EquationView, x: number): number {
  return equation.a * x * x + equation.b * x + equation.c;
}

/**
 * The y range to show, given the x window.
 *
 * Sampling the curve rather than solving for it: the extremes of a parabola on
 * a bounded interval are at its ends or its vertex, and sampling gets that
 * right for free while also keeping this honest about being a drawing helper
 * rather than a second engine. Always includes y = 0, so the x-axis is on
 * screen even for a curve that never comes near it.
 */
export function yRange(
  equation: EquationView,
  xMin: number,
  xMax: number,
): { yMin: number; yMax: number } {
  let low = 0;
  let high = 0;
  const samples = 64;
  for (let i = 0; i <= samples; i += 1) {
    const y = evaluate(equation, xMin + ((xMax - xMin) * i) / samples);
    low = Math.min(low, y);
    high = Math.max(high, y);
  }
  if (high - low < 1e-9) {
    // A flat window (a = b = 0 cannot happen, but c = 0 with a tiny span can)
    // would divide by zero below.
    low -= 1;
    high += 1;
  }
  const margin = (high - low) * 0.12;
  return { yMin: low - margin, yMax: high + margin };
}

export function project(
  equation: EquationView,
  facts: FactsView,
  width: number,
  height: number,
): Projection {
  const xMin = facts.view.x_min;
  const xMax = facts.view.x_max;
  const { yMin, yMax } = yRange(equation, xMin, xMax);

  const plotWidth = Math.max(1, width - PAD.left - PAD.right);
  const plotHeight = Math.max(1, height - PAD.top - PAD.bottom);

  const toScreen = (x: number, y: number): [number, number] => [
    PAD.left + ((x - xMin) / (xMax - xMin)) * plotWidth,
    PAD.top + ((yMax - y) / (yMax - yMin)) * plotHeight,
  ];

  const [originX] = toScreen(0, 0);
  const [, originY] = toScreen(0, 0);
  return { toScreen, xMin, xMax, yMin, yMax, originX, originY };
}

/**
 * Gridline positions at a round spacing, aiming for about `target` of them.
 *
 * Round meaning 1, 2, 5, 10, 20, 50… — a grid at 3.7 intervals is a grid
 * nobody can read a coordinate off, which is the only thing a maths grid is
 * for.
 */
export function ticks(min: number, max: number, target = 8): number[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const rough = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const step =
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) *
    magnitude;

  const out: number[] = [];
  // Guarded: a pathological span/step could otherwise spin. 200 gridlines is
  // already far more than a readable graph has.
  for (let v = Math.ceil(min / step) * step; v <= max && out.length < 200; v += step) {
    // Snap away float drift, so a tick lands on 0 rather than 4.44e-16 and is
    // labelled "0" instead of "0.00000000000000044".
    out.push(Math.abs(v) < step / 1e6 ? 0 : v);
  }
  return out;
}

/** A tick label: short, and never `-0`. */
export function tickLabel(value: number): string {
  if (Object.is(value, -0) || value === 0) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

/**
 * The curve as screen points.
 *
 * One point per pixel column: the panel has the three coefficients, so a
 * smooth curve costs nothing here and there is no reason for the engine to send
 * a sampled path over a 32 KiB wire.
 */
export function curvePoints(
  equation: EquationView,
  projection: Projection,
  width: number,
): [number, number][] {
  const columns = Math.max(2, Math.floor(width));
  const points: [number, number][] = [];
  for (let i = 0; i <= columns; i += 1) {
    const x = projection.xMin + ((projection.xMax - projection.xMin) * i) / columns;
    points.push(projection.toScreen(x, evaluate(equation, x)));
  }
  return points;
}
