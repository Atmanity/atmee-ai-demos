import { useCallback, useEffect, useRef, useState } from 'react';
import type { StrokeView } from '../engine/types.ts';
import { decimate, pathLength, squareIn, toBox, toGrid, type GridPoint } from './ink.ts';

/**
 * The writing square: a faint grid, the strokes already earned, and the ink
 * under the finger right now. (Ported from the original panel.)
 *
 * Canvas rather than SVG because the live trail is redrawn on every pointer
 * sample, and a hundred DOM nodes a second is a different kind of app.
 *
 * The trail is VIEW STATE. It lives in a ref, never crosses the network, and
 * is dropped the moment the pointer lifts, at which point the whole gesture
 * becomes ONE `stroke` intent. Nothing is drawn optimistically: if the server
 * refuses or fails the stroke, the square goes back to what the snapshot
 * says, which is the honest rendering of "that did not count".
 */

/** Below this, in grid units, the gesture was a tap and is not sent. */
export const MIN_TRAIL = 60;

export function StrokeCanvas({
  strokes,
  grid,
  disabled,
  onStroke,
  clearKey,
}: {
  strokes: StrokeView[];
  grid: number;
  disabled: boolean;
  onStroke: (points: GridPoint[]) => void;
  /** Changing this wipes the live trail: "clear" and "start over" both do. */
  clearKey: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trail = useRef<GridPoint[]>([]);
  const drawing = useRef(false);
  // A counter, not the trail itself: the trail is mutated per sample and a
  // state update per point would re-render React hundreds of times a stroke.
  const [tick, setTick] = useState(0);
  const [box, setBox] = useState({ width: 0, height: 0 });

  // Size the backing store for the device pixel ratio. Without this the canvas
  // is stretched from CSS pixels and every stroke renders soft on any modern
  // screen, which reads as bad handwriting in an app about handwriting.
  // Re-measured on resize because the layout changes with the window.
  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const rect = parent.getBoundingClientRect();
      setBox({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    trail.current = [];
    drawing.current = false;
    setTick((n) => n + 1);
  }, [clearKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    // jsdom has no 2-D context, and a browser can refuse one under memory
    // pressure. Neither is a reason to take the page down.
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = box.width || canvas.clientWidth || 0;
    const height = box.height || canvas.clientHeight || 0;
    if (width <= 0 || height <= 0) return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const square = squareIn({ left: 0, top: 0, width, height });
    const at = (point: GridPoint) => toBox(point, square, grid);

    // the square and its guides
    ctx.strokeStyle = 'rgba(120, 132, 160, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(square.x, square.y, square.size, square.size);
    ctx.save();
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = 'rgba(120, 132, 160, 0.28)';
    ctx.beginPath();
    ctx.moveTo(square.x + square.size / 2, square.y);
    ctx.lineTo(square.x + square.size / 2, square.y + square.size);
    ctx.moveTo(square.x, square.y + square.size / 2);
    ctx.lineTo(square.x + square.size, square.y + square.size / 2);
    ctx.stroke();
    ctx.restore();

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // The strokes already earned. A stroke with no points is one the server
    // withheld; there is nothing here that could draw it anyway.
    ctx.strokeStyle = 'rgba(24, 28, 40, 0.92)';
    ctx.lineWidth = Math.max(4, square.size * 0.045);
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      const [x0, y0] = at(stroke.points[0]);
      ctx.moveTo(x0, y0);
      for (const point of stroke.points.slice(1)) {
        const [x, y] = at(point);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // the ink under the finger right now
    if (trail.current.length >= 2) {
      ctx.strokeStyle = 'rgba(198, 60, 60, 0.9)';
      ctx.lineWidth = Math.max(4, square.size * 0.04);
      ctx.beginPath();
      const [x0, y0] = at(trail.current[0]);
      ctx.moveTo(x0, y0);
      for (const point of trail.current.slice(1)) {
        const [x, y] = at(point);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [strokes, grid, box, tick]);

  const pointAt = useCallback((clientX: number, clientY: number): GridPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return toGrid(clientX, clientY, canvas.getBoundingClientRect(), grid);
  }, [grid]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    // Capture so a stroke that leaves the square still ends here rather than
    // being abandoned mid-gesture with no pointerup. A browser may refuse it
    // (a synthetic pointer, as the live-test helper sends); drawing goes on.
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* not capturable */ }
    drawing.current = true;
    trail.current = [point];
    setTick((n) => n + 1);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    const last = trail.current[trail.current.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) return;
    trail.current.push(point);
    setTick((n) => n + 1);
  };

  const finish = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* not captured */ }
    const drawn = trail.current;
    trail.current = [];
    setTick((n) => n + 1);
    // A tap is not an attempt. Sending it would earn a refusal the learner did
    // not ask for.
    if (drawn.length < 2 || pathLength(drawn) < MIN_TRAIL) return;
    onStroke(decimate(drawn));
  };

  return (
    <div className="st-board">
      <canvas
        ref={canvasRef}
        className={`st-canvas${disabled ? ' is-disabled' : ''}`}
        role="img"
        aria-label="Writing square"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
    </div>
  );
}
