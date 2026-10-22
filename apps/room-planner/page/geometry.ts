/**
 * The drag arithmetic, kept pure so it can be tested without a browser.
 *
 * This is view-state maths only: where the pointer has dragged something to, in
 * centimetres. Whether that spot is LEGAL is not decided here — a drop becomes
 * one intent and the planner is the judge. A panel that pre-checks
 * placement is a second engine, and it will disagree.
 *
 * The one thing worth saying about the wall drag: the sign convention is the
 * planner's, not the panel's. A wall is published with `a` on the low side of the
 * line, and a positive delta gives floor to `a` — so dragging left or up (which
 * decreases the coordinate) is a negative delta and hands floor to `a`'s
 * neighbour. Getting that backwards moves the right wall the wrong way, which
 * looks exactly like the app misunderstanding the client.
 */

import type { Item, Opening, Rect, Wall } from "../engine/types.ts";

/** Centimetres per screen pixel for a plan drawn at `scale` px per cm. */
function cmFromPx(px: number, scale: number): number {
  return scale > 0 ? px / scale : 0;
}

/**
 * Where a dragged piece has been let go, snapped to the 10 cm grid the planner
 * works in. Clamped to the outside walls so a drag that overshoots lands flush
 * rather than being refused — an overshoot is a slip of the hand, not an
 * instruction.
 */
export function dropPosition(
  item: Item,
  dxPx: number,
  dyPx: number,
  scale: number,
  level: { w_cm: number; h_cm: number },
): { x: number; y: number } {
  const snap = (value: number) => Math.round(value / 10) * 10;
  const x = snap(item.x_cm + cmFromPx(dxPx, scale));
  const y = snap(item.y_cm + cmFromPx(dyPx, scale));
  return {
    x: Math.max(0, Math.min(x, level.w_cm - item.w_cm)),
    y: Math.max(0, Math.min(y, level.h_cm - item.h_cm)),
  };
}

/**
 * How far a wall has been dragged, in centimetres, signed the way the planner
 * wants it: positive gives floor to the wall's `a` room.
 *
 * Snapped to the grid and zero below half a cell, so a click that wobbles two
 * pixels does not become an intent the designer then talks about.
 */
export function wallDelta(wall: Wall, dxPx: number, dyPx: number, scale: number): number {
  const raw = cmFromPx(wall.axis === "v" ? dxPx : dyPx, scale);
  const snapped = Math.round(raw / 10) * 10;
  return Math.abs(snapped) < 10 ? 0 : snapped;
}

/** The line an opening sits on, in level coordinates. */
export function openingLine(opening: Opening): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const a = opening.start_cm;
  const b = opening.start_cm + opening.width_cm;
  return opening.axis === "v"
    ? { x1: opening.line_cm, y1: a, x2: opening.line_cm, y2: b }
    : { x1: a, y1: opening.line_cm, x2: b, y2: opening.line_cm };
}

/**
 * The quarter-circle a door sweeps, as an SVG path in level coordinates.
 *
 * Which side it opens into comes from `swing_into` rather than from a wall
 * name: an interior door has rooms on both sides, and "north" means nothing
 * to it.
 */
export function swingPath(opening: Opening): string | null {
  if (opening.kind !== "door" || !opening.swing_into) return null;
  const r = opening.width_cm;
  const intoLow = opening.swing_into === opening.a;
  const { x1, y1 } = openingLine(opening);
  if (opening.axis === "v") {
    const ex = intoLow ? x1 - r : x1 + r;
    return `M ${x1} ${y1 + r} A ${r} ${r} 0 0 ${intoLow ? 1 : 0} ${ex} ${y1} L ${x1} ${y1} Z`;
  }
  const ey = intoLow ? y1 - r : y1 + r;
  return `M ${x1 + r} ${y1} A ${r} ${r} 0 0 ${intoLow ? 0 : 1} ${x1} ${ey} L ${x1} ${y1} Z`;
}

/** Which room a wall grip should give floor to when dragged a given way. */
export function wallTargets(wall: Wall, delta: number): { gains: string; loses: string } {
  return delta >= 0 ? { gains: wall.a, loses: wall.b } : { gains: wall.b, loses: wall.a };
}

/** Metres, for the dimension labels — nobody reads "920 cm" off a plan. */
export function metres(cm: number): string {
  return `${(cm / 100).toFixed(2).replace(/\.?0+$/, "")} m`;
}

/** One square metre in square feet. */
const FT2_PER_M2 = 10.7639;

/**
 * An area in whichever unit the client asked for, always given square metres.
 *
 * One helper, used everywhere the panel prints an area, because the alternative
 * is what was here first: the schedule reading the planner's pre-converted field
 * and the plan doing its own multiplication, so a room read 133 in the table
 * and 134 on the drawing and neither was wrong enough to be obviously a bug.
 */
export function areaLabel(valueM2: number, unit: "m2" | "ft2"): string {
  return unit === "ft2"
    ? `${Math.round(valueM2 * FT2_PER_M2)} ft²`
    : `${valueM2.toFixed(1)} m²`;
}

/** The centre of a rectangle, for placing a label. */
export function centre(rect: Rect): { x: number; y: number } {
  return { x: (rect[0] + rect[2]) / 2, y: (rect[1] + rect[3]) / 2 };
}
