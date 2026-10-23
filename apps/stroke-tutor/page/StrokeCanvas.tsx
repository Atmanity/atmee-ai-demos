import { useCallback, useEffect, useRef, useState } from 'react';
import type { StrokeView } from '../engine/types.ts';
import { decimate, pathLength, squareIn, toGrid, type GridPoint } from './ink.ts';
import { markKey, type Marks } from './marks.ts';
import { INK, paintSheet, type Layer } from './paint.ts';

/**
 * The practice sheet: the 田 grid, the strokes already earned (the learner's
 * own ink for a stroke they drew right, Ren's vermilion for one Ren showed,
 * numbered as a stroke-order chart numbers them), and the ink under the
 * finger right now.
 *
 * Canvas rather than SVG because the live trail is redrawn on every pointer
 * sample, and a hundred DOM nodes a second is a different kind of app.
 *
 * The trail is VIEW STATE. It lives in a ref, never crosses the network, and
 * becomes ONE stroke the moment the pointer lifts. Nothing is drawn as if it
 * counted: the stroke waits in grey-blue while the sheet grades it, and only a
 * stroke the server calls done is drawn in ink.
 */

/** Below this, in grid units, the gesture was a tap and is not sent. */
export const MIN_TRAIL = 60;
/** How long Ren's brush takes to draw a stroke it shows. */
export const SHOW_MS = 1100;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The earned strokes as the sheet paints them. A stroke with no points is one the server withheld: there is nothing to draw. */
export function earnedLayers(strokes: StrokeView[], character: string | null, marks: Marks, showing?: { index: number; progress: number } | null): Layer[] {
  const layers: Layer[] = [];
  for (const stroke of strokes) {
    if (stroke.status !== 'done' || stroke.points.length < 2) continue;
    const mark = character ? marks[markKey(character, stroke.index)] : undefined;
    const number = stroke.index + 1;
    if (mark?.how === 'drawn' && mark.ink && mark.ink.length >= 2) layers.push({ points: mark.ink, color: INK.sumi, number });
    else if (mark?.how === 'shown') layers.push({ points: stroke.points, color: INK.shu, number, arrow: true, progress: showing?.index === stroke.index ? showing.progress : 1 });
    else layers.push({ points: stroke.points, color: INK.sumi, number });
  }
  return layers;
}

export function StrokeCanvas({
  strokes,
  character,
  marks,
  grid,
  disabled = false,
  onStroke,
  pending,
  miss,
  label,
  resetKey = '',
}: {
  strokes: StrokeView[];
  /** The character's id, which the marks are keyed by. */
  character: string | null;
  marks: Marks;
  grid: number;
  disabled?: boolean;
  /** Absent: the sheet is for looking at (the finished character). */
  onStroke?: (points: GridPoint[]) => void;
  /** A stroke being graded, drawn in wet ink until the verdict. */
  pending?: GridPoint[] | null;
  /** The last missed attempt, faint, so the learner sees what they drew. */
  miss?: GridPoint[] | null;
  label: string;
  /** Changing this drops a stroke being drawn (the sheet moved on under the finger). */
  resetKey?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trail = useRef<GridPoint[]>([]);
  const drawing = useRef(false);
  // A counter, not the trail itself: the trail is mutated per sample and a
  // state update per point would re-render React hundreds of times a stroke.
  const [tick, setTick] = useState(0);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const seen = useRef<Set<string> | null>(null);
  const [showing, setShowing] = useState<{ index: number; start: number } | null>(null);
  const [now, setNow] = useState(0);

  // Size the backing store for the device pixel ratio: a stretched canvas
  // renders every stroke soft, which reads as bad handwriting in an app about
  // handwriting. Re-measured on resize because the layout changes with the window.
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
  }, [resetKey]);

  // A stroke Ren has just shown is drawn as a brush would draw it, start to
  // end: its direction is the lesson. Strokes already shown when the sheet
  // appears are simply there.
  useEffect(() => {
    if (!character) return;
    const shown = strokes.filter((s) => s.status === 'done' && marks[markKey(character, s.index)]?.how === 'shown').map((s) => s.index);
    const keys = shown.map((i) => markKey(character, i));
    if (seen.current === null) {
      seen.current = new Set(keys);
      return;
    }
    const fresh = shown.filter((i) => !seen.current!.has(markKey(character, i)));
    for (const key of keys) seen.current.add(key);
    if (fresh.length && !reducedMotion()) setShowing({ index: fresh[fresh.length - 1], start: performance.now() });
  }, [strokes, marks, character]);

  useEffect(() => {
    if (!showing || typeof requestAnimationFrame !== 'function') return;
    let id = 0;
    const frame = (t: number) => {
      setNow(t);
      if (t - showing.start < SHOW_MS) id = requestAnimationFrame(frame);
      else setShowing(null);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [showing]);

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
    const progress = showing ? Math.max(0, Math.min(1, (now - showing.start) / SHOW_MS)) : 1;
    const layers = earnedLayers(strokes, character, marks, showing ? { index: showing.index, progress } : null);
    if (miss && miss.length >= 2) layers.unshift({ points: miss, color: INK.ash, weight: 0.85 });
    if (pending && pending.length >= 2) layers.push({ points: pending, color: INK.wet, weight: 0.9 });
    if (trail.current.length >= 2) layers.push({ points: trail.current, color: INK.wet, weight: 0.9 });
    paintSheet(ctx, square, grid, layers);
  }, [strokes, character, marks, grid, box, tick, pending, miss, showing, now]);

  const pointAt = useCallback((clientX: number, clientY: number): GridPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return toGrid(clientX, clientY, canvas.getBoundingClientRect(), grid);
  }, [grid]);

  const writable = Boolean(onStroke) && !disabled;

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!writable) return;
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
    // A tap is not an attempt. Sending it would earn a refusal the learner did not ask for.
    if (drawn.length < 2 || pathLength(drawn) < MIN_TRAIL) return;
    onStroke?.(decimate(drawn));
  };

  return (
    <canvas
      ref={canvasRef}
      className={`hs-canvas${writable ? ' is-writable' : ''}`}
      role="img"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    />
  );
}
