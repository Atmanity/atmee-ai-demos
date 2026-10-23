// "Save your sheet": the finished character as an image the learner keeps,
// in their own ink with Ren's vermilion where Ren showed a stroke, titled and
// dated like a practice sheet handed in.
import { firstTries } from '../engine/director.ts';
import type { Snapshot } from '../engine/types.ts';
import type { Marks } from './marks.ts';
import { INK, paintSheet, paintStroke } from './paint.ts';
import { earnedLayers } from './StrokeCanvas.tsx';

const W = 1080;
const H = 1350;

/** Draws the sheet into a new canvas; null where there is no 2-D canvas (a test, a refusing browser). */
export function sheetImage(view: Snapshot, marks: Marks, date = new Date()): HTMLCanvasElement | null {
  const character = view.character;
  if (!character) return null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;
  ctx.fillStyle = INK.paper;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = INK.sumi;
  ctx.textBaseline = 'alphabetic';
  ctx.font = '600 64px "Shippori Mincho B1", Georgia, serif';
  ctx.fillText(character.script === 'latin' ? `The letter ${character.glyph}` : `${character.glyph}  ${character.meaning}`, 90, 140);
  ctx.font = '400 28px "Zen Kaku Gothic New", system-ui, sans-serif';
  ctx.fillStyle = '#5d6669';
  const tries = `${firstTries(view)} of ${view.results.length} strokes right first try`;
  ctx.fillText(character.script === 'latin' ? tries : `Read ${character.reading} · ${tries}`, 90, 190);

  const square = { x: 90, y: 250, size: W - 180 };
  paintSheet(ctx, square, view.grid, earnedLayers(view.strokes, character.id, marks), { paper: true });

  ctx.font = '500 26px "Zen Kaku Gothic New", system-ui, sans-serif';
  ctx.fillStyle = '#5d6669';
  ctx.fillText(`Hanshi · written with Ren · ${date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`, 90, H - 80);
  // Hanshi's seal: vermilion, with one white brush stroke.
  const seal = { x: W - 90 - 56, y: H - 80 - 40, size: 56 };
  ctx.fillStyle = INK.shu;
  ctx.fillRect(seal.x, seal.y, seal.size, seal.size);
  paintStroke(ctx, seal, 1000, { points: [[200, 520], [500, 500], [800, 520]], color: INK.paper, weight: 3 });
  return canvas;
}

/** Downloads the sheet as a PNG. False when it could not be drawn. */
export function saveSheet(view: Snapshot, marks: Marks): boolean {
  const canvas = sheetImage(view, marks);
  if (!canvas || !view.character) return false;
  const name = `hanshi-${view.character.id}.png`;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, 'image/png');
  return true;
}
