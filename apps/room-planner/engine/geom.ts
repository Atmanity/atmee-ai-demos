// Cells, rectangles, and the shapes you can read back off a grid.
//
// Pure arithmetic: no rooms, no plan. The rules that decide whether a shape is
// a room at all can be tested without building one.
//
// Why a cell grid at all. A floor made of free-floating room rectangles has no
// way to say "these two rooms share a wall" that survives a resize: nudge one
// and you get a 4 cm void, or an overlap. Ownership fixes it by construction:
// every cell belongs to exactly one room or to nobody, so a gap is a cell with
// no owner (nameable, drawable, complainable-about) and an overlap cannot be
// expressed. The grid is 10 cm: below what anyone reads off a drawing, while a
// 15 m floor stays 150 columns.
//
// Two projections matter, both to keep the drawing cheap:
// - strips: a room's cells as maximal horizontal rectangles (a rectangular room
//   is one strip, an L is two). The plan fills these.
// - boundary: the room's edge as merged straight segments. The plan strokes
//   these. Together they draw a rectilinear room without stitching a polygon,
//   which goes subtly wrong on a shape with a hole in it.
import { cmpTuple } from './num.ts';

/** Grid resolution. Every length in this app is a multiple of it. */
export const CELL_CM = 10;

/** x0, y0, x1, y1 in centimetres. */
export type Rect = [number, number, number, number];

/**
 * A cell (column, row) packed into one number, so a set of cells is a plain
 * Set<number>. Columns and rows may go slightly negative (a probe beside the
 * north wall); the offset keeps the key positive and the packing ordered the
 * way Python orders (column, row) tuples.
 */
export type Cell = number;
const OFFSET = 1024;
const STRIDE = 4096;
export const cell = (c: number, r: number): Cell => (c + OFFSET) * STRIDE + (r + OFFSET);
export const colOf = (k: Cell) => Math.floor(k / STRIDE) - OFFSET;
export const rowOf = (k: Cell) => (k % STRIDE) - OFFSET;

/** Cells of a half-open cell rectangle (columns c0..c1, rows r0..r1). */
export function block(c0: number, r0: number, c1: number, r1: number): Set<Cell> {
  const out = new Set<Cell>();
  for (let c = c0; c < c1; c++) for (let r = r0; r < r1; r++) out.add(cell(c, r));
  return out;
}

const asSet = (cells: Iterable<Cell>) => (cells instanceof Set ? cells : new Set(cells));

// ---------------------------------------------------------------- rectangles

/** True when two rectangles share floor. Touching edges do not count. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

export function spanOverlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * The corridor between two rectangles, if they face each other: ["y", cm] for
 * a north-south gap, ["x", cm] for an east-west one, or null when they do not
 * line up at all (a diagonal neighbour is not a walkway).
 */
export function gapBetween(a: Rect, b: Rect): ['x' | 'y', number] | null {
  if (spanOverlap(a[0], a[2], b[0], b[2]) > 0) {
    const gap = Math.max(b[1] - a[3], a[1] - b[3]);
    if (gap >= 0) return ['y', gap];
  }
  if (spanOverlap(a[1], a[3], b[1], b[3]) > 0) {
    const gap = Math.max(b[0] - a[2], a[0] - b[2]);
    if (gap >= 0) return ['x', gap];
  }
  return null;
}

/**
 * Every whole cell inside a centimetre rectangle. Rounds INWARD on purpose: a
 * rectangle covering half a cell does not own it, or a wardrobe overhanging the
 * hall by 5 cm would claim the hall's cell.
 */
export function rectCells(rect: Rect): Set<Cell> {
  const out = new Set<Cell>();
  forRectCells(rect, (k) => { out.add(k); });
  return out;
}

/** Visit rectCells(rect) without building the set; return false to stop early. */
export function forRectCells(rect: Rect, visit: (k: Cell) => boolean | void): boolean {
  const x0 = Math.ceil(rect[0] / CELL_CM);
  const y0 = Math.ceil(rect[1] / CELL_CM);
  const x1 = Math.floor(rect[2] / CELL_CM);
  const y1 = Math.floor(rect[3] / CELL_CM);
  for (let c = x0; c < x1; c++) {
    for (let r = y0; r < y1; r++) if (visit(cell(c, r)) === false) return false;
  }
  return true;
}

/** Whether every cell the rectangle covers is in the set. */
export function rectWithin(rect: Rect, cells: Set<Cell>): boolean {
  return forRectCells(rect, (k) => cells.has(k));
}

// ------------------------------------------------------------------ cell sets

/** The cell set's bounding box, in centimetres. Empty gives [0, 0, 0, 0]. */
export function bbox(cells: Iterable<Cell>): Rect {
  let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
  for (const k of cells) {
    const c = colOf(k), r = rowOf(k);
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }
  if (minC === Infinity) return [0, 0, 0, 0];
  return [minC * CELL_CM, minR * CELL_CM, (maxC + 1) * CELL_CM, (maxR + 1) * CELL_CM];
}

export const areaCm2 = (cells: Iterable<Cell>) => asSet(cells).size * CELL_CM * CELL_CM;

/**
 * Square metres to one decimal, rounded the way Python's round(x, 1) rounds.
 * Done in whole cells (a cell is a hundredth of a square metre) so 1.25 m²
 * rounds to 1.2 as it does in the original, not to 1.3.
 */
export function areaM2(cells: Iterable<Cell>): number {
  return areaOfCount(asSet(cells).size);
}

export function areaOfCount(n: number): number {
  const q = Math.floor(n / 10);
  const rem = n - q * 10;
  const tenths = rem > 5 ? q + 1 : rem < 5 ? q : q % 2 === 0 ? q : q + 1;
  return tenths / 10;
}

/**
 * True when you could walk the whole set without leaving it. Four-connected,
 * not eight: two rooms meeting at a corner point share no wall and no doorway,
 * and calling that one room would let a merge produce a shape nobody can walk.
 */
export function isConnected(cells: Iterable<Cell>): boolean {
  const remaining = asSet(cells);
  if (!remaining.size) return false;
  const start = remaining.values().next().value as Cell;
  const seen = new Set<Cell>([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    const c = colOf(k), r = rowOf(k);
    for (const next of [cell(c + 1, r), cell(c - 1, r), cell(c, r + 1), cell(c, r - 1)]) {
      if (remaining.has(next) && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size === remaining.size;
}

/**
 * The tightest place in the shape, in centimetres: for every cell, the shorter
 * of the horizontal and vertical run through it; the shape's narrowness is the
 * smallest of those. A 90 x 400 corridor measures 90, and a one-cell tail
 * hanging off a bedroom measures 10, which is what makes slivers refusable. A
 * room 4 m wide everywhere except a 20 cm neck is not a usable room, and
 * neither area nor bounding box notices the neck.
 */
export function narrowestCm(cells: Iterable<Cell>): number {
  const owned = asSet(cells);
  if (!owned.size) return 0;
  let worst: number | null = null;
  for (const k of owned) {
    const c = colOf(k), r = rowOf(k);
    let across = 1;
    for (let s = c - 1; owned.has(cell(s, r)); s--) across++;
    for (let s = c + 1; owned.has(cell(s, r)); s++) across++;
    let down = 1;
    for (let s = r - 1; owned.has(cell(c, s)); s--) down++;
    for (let s = r + 1; owned.has(cell(c, s)); s++) down++;
    const here = Math.min(across, down);
    if (worst === null || here < worst) worst = here;
  }
  return (worst ?? 0) * CELL_CM;
}

const byTuple = (a: Rect, b: Rect) => cmpTuple(a, b);

/**
 * The cell set as maximal rectangles, for filling. Rows are merged into runs,
 * then vertically stacked runs with identical extents are merged again, so a
 * rectangular room is ONE rectangle rather than one per row.
 *
 * One change from the original: a run only extends the rectangle above it when
 * the rows are adjacent. The original also merged two equal runs with a fully
 * empty row between them, drawing floor over the gap; a connected room never
 * has such a row, but the unassigned floor can.
 */
export function strips(cells: Iterable<Cell>): Rect[] {
  const owned = asSet(cells);
  if (!owned.size) return [];
  const byRow = new Map<number, number[]>();
  for (const k of owned) {
    const r = rowOf(k);
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r)!.push(colOf(k));
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  const out: Rect[] = [];
  const open = new Map<string, { c0: number; c1: number; row0: number; row1: number }>();
  for (const row of rows) {
    const columns = byRow.get(row)!.sort((a, b) => a - b);
    const here = new Map<string, [number, number]>();
    let start = columns[0], prev = columns[0];
    for (const col of columns.slice(1)) {
      if (col === prev + 1) { prev = col; continue; }
      here.set(`${start},${prev + 1}`, [start, prev + 1]);
      start = prev = col;
    }
    here.set(`${start},${prev + 1}`, [start, prev + 1]);
    for (const [key, run] of [...open]) {
      if (here.has(key) && run.row1 === row) {
        run.row1 = row + 1;
      } else {
        open.delete(key);
        out.push([run.c0 * CELL_CM, run.row0 * CELL_CM, run.c1 * CELL_CM, run.row1 * CELL_CM]);
      }
    }
    for (const [key, [c0, c1]] of here) if (!open.has(key)) open.set(key, { c0, c1, row0: row, row1: row + 1 });
  }
  for (const run of open.values()) out.push([run.c0 * CELL_CM, run.row0 * CELL_CM, run.c1 * CELL_CM, run.row1 * CELL_CM]);
  return out.sort(byTuple);
}

/**
 * The shape's edge as merged straight segments, in centimetres, each with
 * x0 == x1 or y0 == y1. Every edge is emitted rather than a stitched polygon,
 * because stitching has to decide what a room enclosing a void means.
 */
export function boundary(cells: Iterable<Cell>): Rect[] {
  const owned = asSet(cells);
  const horizontal: [number, number, number][] = [];   // row line, c0, c1
  const vertical: [number, number, number][] = [];     // column line, r0, r1
  for (const k of owned) {
    const c = colOf(k), r = rowOf(k);
    if (!owned.has(cell(c, r - 1))) horizontal.push([r, c, c + 1]);
    if (!owned.has(cell(c, r + 1))) horizontal.push([r + 1, c, c + 1]);
    if (!owned.has(cell(c - 1, r))) vertical.push([c, r, r + 1]);
    if (!owned.has(cell(c + 1, r))) vertical.push([c + 1, r, r + 1]);
  }
  const out: Rect[] = [];
  for (const [line, runs] of group(horizontal)) for (const [a, b] of runs) out.push([a * CELL_CM, line * CELL_CM, b * CELL_CM, line * CELL_CM]);
  for (const [line, runs] of group(vertical)) for (const [a, b] of runs) out.push([line * CELL_CM, a * CELL_CM, line * CELL_CM, b * CELL_CM]);
  return out.sort(byTuple);
}

/** Collinear unit edges merged into runs, keyed by the line they sit on. */
function group(segments: [number, number, number][]): [number, [number, number][]][] {
  const byLine = new Map<number, [number, number][]>();
  for (const [line, a, b] of segments) {
    if (!byLine.has(line)) byLine.set(line, []);
    byLine.get(line)!.push([a, b]);
  }
  const out: [number, [number, number][]][] = [];
  for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
    const merged: [number, number][] = [];
    for (const [a, b] of byLine.get(line)!.sort((p, q) => cmpTuple(p, q))) {
      const last = merged[merged.length - 1];
      if (last && last[1] === a) last[1] = b;
      else merged.push([a, b]);
    }
    out.push([line, merged]);
  }
  return out;
}

export type Edge = ['v' | 'h', number, number, number];

/**
 * The wall two cell sets share, as [axis, line, start, end] in centimetres.
 * axis "v" is a north-south wall (the rooms are east and west of each other),
 * "h" an east-west one. The LONGEST shared run wins when they touch in more
 * than one place (an L-shaped pair can share two stretches, and the one worth
 * a door is the long one). Null when they only touch at a corner.
 *
 * Ties go to the first axis, then the lowest line, then the first run: the
 * original broke them by set iteration order, which no port can reproduce.
 */
export function sharedEdge(a: Iterable<Cell>, b: Iterable<Cell>): Edge | null {
  const left = asSet(a);
  const right = asSet(b);
  const vertical = new Map<number, number[]>();     // column line -> rows
  const horizontal = new Map<number, number[]>();   // row line -> columns
  const add = (map: Map<number, number[]>, line: number, along: number) => {
    if (!map.has(line)) map.set(line, []);
    map.get(line)!.push(along);
  };
  for (const k of left) {
    const c = colOf(k), r = rowOf(k);
    if (right.has(cell(c + 1, r))) add(vertical, c + 1, r);
    if (right.has(cell(c - 1, r))) add(vertical, c, r);
    if (right.has(cell(c, r + 1))) add(horizontal, r + 1, c);
    if (right.has(cell(c, r - 1))) add(horizontal, r, c);
  }
  let best: Edge | null = null;
  let bestLen = 0;
  for (const [axis, lines] of [['v', vertical], ['h', horizontal]] as const) {
    for (const line of [...lines.keys()].sort((x, y) => x - y)) {
      for (const [start, end] of runsOf(lines.get(line)!.sort((x, y) => x - y))) {
        if (end - start > bestLen) {
          bestLen = end - start;
          best = [axis, line * CELL_CM, start * CELL_CM, end * CELL_CM];
        }
      }
    }
  }
  return best;
}

/** Consecutive integers as half-open runs. */
function runsOf(values: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const value of values) {
    const last = out[out.length - 1];
    if (last && last[1] === value) last[1] = value + 1;
    else out.push([value, value + 1]);
  }
  return out;
}
