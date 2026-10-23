// Where a piece of furniture goes, given a relation rather than coordinates.
//
// The app's load-bearing decision: the words choose WHAT and ROUGHLY WHERE;
// code finds the rectangle that actually fits. A model asked for x and y
// guesses, gets refused for overlapping something it cannot see, and retries
// out loud until the client gives up.
//
// A room is a set of owned cells of any rectilinear shape, so containment is
// "every cell this piece covers belongs to the room", which is also what stops
// a wardrobe from sitting half in the hall. Raw coordinates are accepted only
// on a drag (Level.moveItem), because that is a human pointing at a spot.
import type { Piece } from './catalog.ts';
import { CELL_CM, colOf, gapBetween, overlaps, rectWithin, rowOf, type Cell, type Rect } from './geom.ts';
import { cmpTuple } from './num.ts';

/** What a person needs to walk past something. Narrower is a squeeze. */
export const WALKWAY_CM = 70;
/** Below this a gap is a snug fit (a bedside table against a bed), not a failed walkway. */
export const SNUG_CM = 20;
/** A bed wants this much on a side to be climbed into from it. */
export const BED_ACCESS_CM = 60;
/** Placement search step. Finer than anyone reads off the drawing. */
export const GRID_CM = CELL_CM;

export interface Spot { x_cm: number; y_cm: number; rot: number }
interface Placed { id: string; rect: Rect }

/**
 * True when every cell the rectangle covers is owned by the region. Rounds
 * inward, so an overhang of less than a cell is tolerated as drawing noise.
 */
export const fitsRegion = (rect: Rect, region: Set<Cell>) => rectWithin(rect, region);

/**
 * The best legal spot for the piece, or null when nothing fits.
 *
 * Hard rules: inside the region, off every other piece, out of every door's
 * swing. Soft rules: the relation's own distance, a bias towards a wall so
 * nothing floats mid-floor, and a penalty for pinching a walkway below 70 cm.
 * `anchors` maps a relation ("window", "door", "beside:i3") to the rectangles
 * that satisfy it; `ignore` leaves out the piece being moved.
 */
export function solve(piece: Piece, relation: string, opts: {
  region: Set<Cell>;
  items: Iterable<Placed>;
  swings: Iterable<Rect>;
  anchors: Record<string, Rect[]>;
  ignore?: string | null;
}): Spot | null {
  const { region, anchors } = opts;
  if (!region.size) return null;
  const others = [...opts.items].filter((i) => i.id !== opts.ignore);
  // The region's bounds are read once here; the original recomputed them for
  // every candidate, which is the same answer at a hundred times the cost.
  const bounds = regionBounds(region);
  const [x0, y0, x1, y1] = bounds;
  const swings = [...opts.swings];

  let best: [number, number, number, number] | null = null;
  for (const rot of rotationsFor(piece)) {
    const w = rot === 90 || rot === 270 ? piece.h_cm : piece.w_cm;
    const h = rot === 90 || rot === 270 ? piece.w_cm : piece.h_cm;
    if (w > x1 - x0 || h > y1 - y0) continue;
    for (const x of steps(x0, x1 - w)) {
      for (const y of steps(y0, y1 - h)) {
        const rect: Rect = [x, y, x + w, y + h];
        if (!fitsRegion(rect, region)) continue;
        if (others.some((other) => overlaps(rect, other.rect))) continue;
        if (swings.some((zone) => overlaps(rect, zone))) continue;
        const cost = relationCost(relation, rect, bounds, anchors) + pinchCost(rect, piece, others, bounds);
        const key: [number, number, number, number] = [cost, y, x, rot];
        if (best === null || cmpTuple(key, best) < 0) best = key;
      }
    }
  }
  if (best === null) return null;
  const [, y, x, rot] = best;
  return { x_cm: x, y_cm: y, rot };
}

// ---------------------------------------------------------------- costs

function relationCost(relation: string, rect: Rect, bounds: Rect, anchors: Record<string, Rect[]>): number {
  const [x0, y0, x1, y1] = bounds;
  const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
  const midX = (x0 + x1) / 2, midY = (y0 + y1) / 2;

  if (relation === 'center') return Math.abs(cx - midX) + Math.abs(cy - midY);

  if (relation.endsWith('_wall')) {
    const wall = relation.slice(0, -5);
    const along = wall === 'north' || wall === 'south' ? Math.abs(cx - midX) : Math.abs(cy - midY);
    // Both orientations sit flush against a wall, so without this a 90 x 210
    // sofa asked for the south wall gets drawn on its end, jutting two metres
    // into the room while the designer says it is "against the south wall".
    // Facing the wall with the long side is what the phrase means; the weight
    // is small, so it settles near-ties rather than overriding the wall asked for.
    let width = rect[2] - rect[0], depth = rect[3] - rect[1];
    if (wall === 'east' || wall === 'west') [width, depth] = [depth, width];
    const endOn = Math.max(0, depth - width) * 0.5;
    return wallDistance(wall, rect, bounds) * 4 + along * 0.2 + endOn;
  }

  const targets = anchors[relation] ?? [];
  if (!targets.length) return relationCost('center', rect, bounds, anchors);
  let cheapest = Infinity;
  for (const target of targets) {
    const tx = (target[0] + target[2]) / 2, ty = (target[1] + target[3]) / 2;
    // Beside means alongside: a piece that does not face it at all is merely
    // nearby, and pays for the difference.
    const facing = gapBetween(rect, target) !== null ? 0 : 150;
    cheapest = Math.min(cheapest, Math.abs(cx - tx) + Math.abs(cy - ty) + facing);
  }
  return cheapest;
}

/** What this spot would cost in walkways and clearance. */
function pinchCost(rect: Rect, piece: Piece, others: Placed[], bounds: Rect): number {
  let cost = 0.0;
  for (const other of others) {
    const found = gapBetween(rect, other.rect);
    if (found === null) continue;
    const gap = found[1];
    if (SNUG_CM < gap && gap < WALKWAY_CM) cost += (WALKWAY_CM - gap) * 2;
  }
  const walls = ['north', 'south', 'east', 'west'] as const;
  if (piece.clearance_cm) {
    // A wardrobe or a desk wants open floor on at least one long side.
    const best = Math.max(...walls.map((wall) => wallDistance(wall, rect, bounds)));
    if (best < piece.clearance_cm) cost += (piece.clearance_cm - best) * 2;
  }
  // Furniture belongs against something; a bias, not a rule, so the middle of
  // the room stays reachable when it is the only free floor.
  cost += Math.min(...walls.map((wall) => wallDistance(wall, rect, bounds))) * 0.3;
  return cost;
}

// --------------------------------------------------------------- helpers

export function regionBounds(region: Iterable<Cell>): Rect {
  let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
  for (const k of region) {
    const c = colOf(k), r = rowOf(k);
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }
  return [minC * CELL_CM, minR * CELL_CM, (maxC + 1) * CELL_CM, (maxR + 1) * CELL_CM];
}

/**
 * How far the rectangle sits from one side of the region's bounding box. The
 * bounding box rather than the true edge: for an L-shaped room this is an
 * approximation, and it only ever biases a preference, never a rule.
 */
function wallDistance(wall: string, rect: Rect, bounds: Rect): number {
  const [x0, y0, x1, y1] = bounds;
  if (wall === 'north') return rect[1] - y0;
  if (wall === 'south') return y1 - rect[3];
  if (wall === 'west') return rect[0] - x0;
  return x1 - rect[2];
}

/** Gridded offsets, always including the flush-against-the-far-wall one. */
function steps(start: number, limit: number): number[] {
  if (limit < start) return [];
  const values: number[] = [];
  for (let v = start; v <= limit; v += GRID_CM) values.push(v);
  if (values[values.length - 1] !== limit) values.push(limit);
  return values;
}

/** Square pieces have one orientation worth trying; everything else gets both. */
const rotationsFor = (piece: Piece) => (piece.w_cm === piece.h_cm ? [0] : [0, 90]);
