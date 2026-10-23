/**
 * Turning a gesture into something the server can grade: pure, no React, no
 * DOM globals, so it is testable on its own. (Ported from the original panel.)
 *
 * Two jobs, both of which fail silently if skipped:
 *
 * * **Pixels never leave this file.** A pointer arrives in client coordinates
 *   at whatever size the page happens to be; the grader's world is a square
 *   grid (`Snapshot.grid`). Sending pixels would make a stroke drawn on a
 *   phone a different stroke from the same one drawn on a laptop.
 * * **A raw trail is decimated to at most `MAX_POINTS`.** A pointer fires
 *   hundreds of times per stroke. The server decimates again on arrival;
 *   neither end may assume the other did. The decimation keeps corners (RDP,
 *   not a uniform thinning): the turn in 永's shoulder carries the grade.
 */

export type GridPoint = [number, number];

/** Must not exceed the server's `strokes.MAX_POINTS`. */
export const MAX_POINTS = 40;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Client coordinates to grid coordinates, or `null` if the box has no size.
 *
 * The board is drawn as the largest square that fits, centred — the same
 * letterboxing `squareIn` computes for the canvas — so a point is mapped
 * against that square and not against the element, or the character would
 * stretch on a non-square panel.
 */
export function toGrid(
  clientX: number,
  clientY: number,
  rect: Rect,
  grid: number,
): GridPoint | null {
  const box = squareIn(rect);
  if (box.size <= 0) return null;
  const x = ((clientX - rect.left - box.x) / box.size) * grid;
  const y = ((clientY - rect.top - box.y) / box.size) * grid;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [Math.round(x), Math.round(y)];
}

/** The largest centred square inside a box, in the box's own coordinates. */
export function squareIn(rect: Rect): { x: number; y: number; size: number } {
  const size = Math.min(rect.width, rect.height);
  return { x: (rect.width - size) / 2, y: (rect.height - size) / 2, size };
}

/** Grid coordinates back to the box's own pixels, for drawing. */
export function toBox(
  point: GridPoint,
  box: { x: number; y: number; size: number },
  grid: number,
): [number, number] {
  return [box.x + (point[0] / grid) * box.size, box.y + (point[1] / grid) * box.size];
}

/** Total path length, in whatever units the points are in. */
export function pathLength(points: GridPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

/**
 * Thin a trail to at most `max` points, keeping its shape.
 *
 * Ramer–Douglas–Peucker, because it keeps corners (the turn in 永's shoulder
 * IS that stroke) and discards the straight runs where the samples are
 * densest. Endpoints always survive: a stroke that no longer starts where it
 * was started would be graded for a mistake nobody made.
 */
export function decimate(points: GridPoint[], max = MAX_POINTS): GridPoint[] {
  if (points.length <= max) return points;
  let epsilon = 4;
  let reduced = rdp(points, epsilon);
  while (reduced.length > max && epsilon < 200) {
    epsilon *= 1.8;
    reduced = rdp(points, epsilon);
  }
  if (reduced.length <= max) return reduced;
  const step = (reduced.length - 1) / (max - 1);
  const thinned = Array.from({ length: max }, (_, i) => reduced[Math.round(i * step)]);
  thinned[max - 1] = reduced[reduced.length - 1];
  return thinned;
}

function rdp(points: GridPoint[], epsilon: number): GridPoint[] {
  if (points.length < 3) return points;
  const start = points[0];
  const end = points[points.length - 1];
  let worstIndex = 0;
  let worst = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = pointToSegment(points[i], start, end);
    if (distance > worst) {
      worst = distance;
      worstIndex = i;
    }
  }
  if (worst <= epsilon) return [start, end];
  const left = rdp(points.slice(0, worstIndex + 1), epsilon);
  const right = rdp(points.slice(worstIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}

function pointToSegment(p: GridPoint, a: GridPoint, b: GridPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
