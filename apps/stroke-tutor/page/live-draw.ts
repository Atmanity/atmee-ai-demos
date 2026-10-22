// Drawing without a hand, for live tests: the reviewer's devtools (or a
// browser driver) can draw a stroke on the writing square by grid
// coordinates, through the same pointer events a finger makes. Never imported
// by the app itself, and it knows no stroke: you pass the points.
//
//   const d = await import('/apps/stroke-tutor/page/live-draw.ts');
//   d.draw([[150, 450], [850, 450]]);        // 十's first stroke, left to right
//   d.draw([[500, 880], [500, 120]]);        // a vertical drawn upwards
export type GridPoint = [number, number];

/** Dispatch one pointer event at a grid point of the square inside `canvas`. */
function fire(canvas: HTMLCanvasElement, type: string, point: GridPoint, grid: number) {
  const rect = canvas.getBoundingClientRect();
  const size = Math.min(rect.width, rect.height);
  const clientX = rect.left + (rect.width - size) / 2 + (point[0] / grid) * size;
  const clientY = rect.top + (rect.height - size) / 2 + (point[1] / grid) * size;
  // jsdom has no PointerEvent; a MouseEvent carries the coordinates and React
  // dispatches on the event TYPE, not its class.
  const Ctor: typeof MouseEvent = (globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
  const event = new Ctor(type, { clientX, clientY, bubbles: true, cancelable: true });
  if (!('pointerId' in event) || (event as PointerEvent).pointerId === undefined) Object.defineProperty(event, 'pointerId', { value: 1 });
  canvas.dispatchEvent(event);
}

/**
 * Draw one stroke through `points` (grid units), with `samples` pointer moves
 * spread along it by length, as a hand would make them.
 */
export function draw(points: GridPoint[], { samples = 60, grid = 1000, canvas }: { samples?: number; grid?: number; canvas?: HTMLCanvasElement } = {}): boolean {
  const target = canvas ?? document.querySelector<HTMLCanvasElement>('.st-canvas');
  if (!target || points.length < 2) return false;
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  const along = (d: number): GridPoint => {
    for (let i = 0; i < lengths.length; i += 1) {
      if (d <= lengths[i] || i === lengths.length - 1) {
        const t = lengths[i] ? Math.min(1, d / lengths[i]) : 0;
        return [points[i][0] + t * (points[i + 1][0] - points[i][0]), points[i][1] + t * (points[i + 1][1] - points[i][1])];
      }
      d -= lengths[i];
    }
    return points[points.length - 1];
  };
  fire(target, 'pointerdown', points[0], grid);
  for (let i = 1; i <= samples; i += 1) fire(target, 'pointermove', along((total * i) / samples), grid);
  fire(target, 'pointerup', points[points.length - 1], grid);
  return true;
}
