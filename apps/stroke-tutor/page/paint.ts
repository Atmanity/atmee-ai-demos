// Painting the practice sheet onto a 2-D canvas: the vermilion 田 grid of a
// school practice sheet, and strokes as a brush leaves them (a press at the
// start, a taper at the end). Used by the live sheet and by the saved image.
// Pure drawing: no React, no data of its own. It draws only the points it is
// handed, and the server hands over a stroke's points only once it is earned.
import { toBox, type GridPoint } from './ink.ts';

/** The sheet's inks: the learner writes in sumi; Ren's strokes, the grid and the numbers are vermilion, as a teacher's corrections are. */
export const INK = {
  paper: '#fcfcfa',
  sumi: '#16181b',
  shu: '#e2462f',
  wet: '#33434c',
  ash: '#bcc4c6',
} as const;

export interface Square { x: number; y: number; size: number }

export interface Layer {
  points: GridPoint[];
  color: string;
  /** The stroke's number, written beside its start as stroke-order charts do. */
  number?: number;
  /** An arrowhead past its end, for a stroke Ren shows: the direction is the lesson. */
  arrow?: boolean;
  /** How much of it is drawn yet, 0 to 1 (a stroke being shown is drawn as a brush would). */
  progress?: number;
  /** Width relative to the sheet's brush (a trail under the finger is a touch thinner). */
  weight?: number;
}

/** The 田 grid: a solid frame, a dashed cross through the middle, faint diagonals. */
export function paintGrid(ctx: CanvasRenderingContext2D, sq: Square) {
  ctx.save();
  ctx.strokeStyle = INK.shu;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = Math.max(1.5, sq.size * 0.004);
  ctx.strokeRect(sq.x + ctx.lineWidth / 2, sq.y + ctx.lineWidth / 2, sq.size - ctx.lineWidth, sq.size - ctx.lineWidth);
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  ctx.setLineDash?.([sq.size * 0.012, sq.size * 0.014]);
  ctx.beginPath();
  ctx.moveTo(sq.x + sq.size / 2, sq.y);
  ctx.lineTo(sq.x + sq.size / 2, sq.y + sq.size);
  ctx.moveTo(sq.x, sq.y + sq.size / 2);
  ctx.lineTo(sq.x + sq.size, sq.y + sq.size / 2);
  ctx.stroke();
  ctx.globalAlpha = 0.2;
  ctx.setLineDash?.([2, sq.size * 0.016]);
  ctx.beginPath();
  ctx.moveTo(sq.x, sq.y);
  ctx.lineTo(sq.x + sq.size, sq.y + sq.size);
  ctx.moveTo(sq.x + sq.size, sq.y);
  ctx.lineTo(sq.x, sq.y + sq.size);
  ctx.stroke();
  ctx.restore();
}

/** The brush's width along a stroke, as a share of its full width: a press at the start, a taper at the end. */
export function brushWidth(t: number): number {
  if (t < 0.06) return 0.8 + (t / 0.06) * 0.3;
  if (t < 0.6) return 1.1 - ((t - 0.06) / 0.54) * 0.1;
  return 1 - ((t - 0.6) / 0.4) * 0.45;
}

/** Points along a polyline every `step` pixels, each with its share of the length. */
function along(points: [number, number][], step: number): { p: [number, number]; t: number }[] {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total === 0) return points.length ? [{ p: points[0], t: 0 }] : [];
  const out: { p: [number, number]; t: number }[] = [];
  const count = Math.max(2, Math.ceil(total / step));
  let seg = 0;
  let walked = 0;
  for (let i = 0; i <= count; i += 1) {
    const d = (total * i) / count;
    while (seg < lengths.length - 1 && d > walked + lengths[seg]) { walked += lengths[seg]; seg += 1; }
    const f = lengths[seg] ? Math.min(1, (d - walked) / lengths[seg]) : 0;
    const a = points[seg];
    const b = points[seg + 1];
    out.push({ p: [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])], t: d / total });
  }
  return out;
}

/** One stroke as a brush leaves it. */
export function paintStroke(ctx: CanvasRenderingContext2D, sq: Square, grid: number, layer: Layer) {
  if (layer.points.length < 2) return;
  const px = layer.points.map((p) => toBox(p, sq, grid));
  const width = Math.max(3, sq.size * 0.05) * (layer.weight ?? 1);
  const progress = Math.max(0, Math.min(1, layer.progress ?? 1));
  const samples = along(px, Math.max(1.5, width / 5)).filter((s) => s.t <= progress + 1e-9);
  ctx.save();
  ctx.strokeStyle = layer.color;
  ctx.fillStyle = layer.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < samples.length; i += 1) {
    ctx.lineWidth = width * brushWidth(samples[i].t);
    ctx.beginPath();
    ctx.moveTo(samples[i - 1].p[0], samples[i - 1].p[1]);
    ctx.lineTo(samples[i].p[0], samples[i].p[1]);
    ctx.stroke();
  }
  const [start] = px;
  const second = px.find((p) => Math.hypot(p[0] - start[0], p[1] - start[1]) > 1) ?? px[1];
  if (layer.number !== undefined) {
    // Behind the start, against the direction of travel, as a stroke-order chart writes it.
    const dx = second[0] - start[0];
    const dy = second[1] - start[1];
    const len = Math.hypot(dx, dy) || 1;
    const gap = width * 0.9 + sq.size * 0.03;
    const at: [number, number] = [start[0] - (dx / len) * gap, start[1] - (dy / len) * gap];
    const size = Math.max(11, sq.size * 0.04);
    ctx.font = `700 ${size}px "Zen Kaku Gothic New", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK.paper;
    ctx.strokeText(String(layer.number), at[0], at[1]);
    ctx.fillStyle = INK.shu;
    ctx.fillText(String(layer.number), at[0], at[1]);
  }
  if (layer.arrow && progress >= 1) {
    const end = px[px.length - 1];
    const before = [...px].reverse().find((p) => Math.hypot(p[0] - end[0], p[1] - end[1]) > 1) ?? px[px.length - 2];
    const dx = end[0] - before[0];
    const dy = end[1] - before[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const tip: [number, number] = [end[0] + ux * (width * 0.7 + sq.size * 0.03), end[1] + uy * (width * 0.7 + sq.size * 0.03)];
    const arm = sq.size * 0.03;
    const spread = 0.5;   // radians either side
    ctx.strokeStyle = INK.shu;
    ctx.lineWidth = Math.max(2, sq.size * 0.007);
    ctx.beginPath();
    for (const side of [-1, 1]) {
      const a = Math.atan2(-uy, -ux) + side * spread;
      ctx.moveTo(tip[0], tip[1]);
      ctx.lineTo(tip[0] + Math.cos(a) * arm, tip[1] + Math.sin(a) * arm);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** The whole sheet: paper, grid, then the strokes in order. */
export function paintSheet(ctx: CanvasRenderingContext2D, sq: Square, grid: number, layers: Layer[], { paper = false } = {}) {
  if (paper) {
    ctx.fillStyle = INK.paper;
    ctx.fillRect(sq.x, sq.y, sq.size, sq.size);
  }
  paintGrid(ctx, sq);
  for (const layer of layers) paintStroke(ctx, sq, grid, layer);
}
