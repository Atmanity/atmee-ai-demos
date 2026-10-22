// The canvas plumbing the original panel took from its platform SDK
// (`@atmee/panel-sdk/canvas` `sizeCanvas` and `@atmee/panel-sdk/react`
// `useCanvas2D`), vendored here because the kit has no canvas helper. Pure
// DOM; the two problems it solves fail silently:
//
// - devicePixelRatio. A canvas whose backing store is not scaled by it renders
//   visibly soft on every retina screen. Nothing throws.
// - Resizing. Assigning `canvas.width` clears the canvas even when the value
//   is the same, so a ResizeObserver that resizes on every callback flickers.
import { useEffect, useState } from 'react';

/** Cap on the ratio: past 3x the extra pixels cost more than they show. */
const MAX_DPR = 3;

/** Resize a canvas's backing store to its CSS box × dPR. True only when it changed. */
export function sizeCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number, dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1): boolean {
  const ratio = Math.max(1, Math.min(dpr || 1, MAX_DPR));
  const width = Math.max(1, Math.round(cssWidth * ratio));
  const height = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

/**
 * A 2-D context sized to its element, redrawn on resize, drawing in CSS pixels.
 *
 *     const { ref, ctx, box } = useCanvas2D();
 *     useEffect(() => { if (ctx) draw(ctx, box); }, [ctx, box, data]);
 *     return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
 */
export function useCanvas2D(): {
  ref: (node: HTMLCanvasElement | null) => void;
  ctx: CanvasRenderingContext2D | null;
  box: { width: number; height: number; dpr: number };
} {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0, dpr: 1 });
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    if (!canvas) {
      setCtx(null);
      return;
    }
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width || canvas.clientWidth || 0;
      const height = rect.height || canvas.clientHeight || 0;
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, MAX_DPR));
      sizeCanvas(canvas, width, height, dpr);
      const context = canvas.getContext('2d');
      // Draw in CSS pixels: every app that skipped this multiplied by dpr in
      // its own draw code, and one of them forgot in one place.
      context?.setTransform(dpr, 0, 0, dpr, 0, 0);
      setCtx(context);
      setBox((prev) => (prev.width === width && prev.height === height && prev.dpr === dpr ? prev : { width, height, dpr }));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(canvas);
      return () => observer.disconnect();
    }
    // jsdom has no ResizeObserver, and neither do some older embedded views.
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [canvas]);

  return { ref: setCanvas, ctx, box };
}
