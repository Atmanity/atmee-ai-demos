import { useCallback, useEffect, useRef, useState } from 'react';
import type { Aim, RangeSnapshot } from '../engine/types.ts';
import { PAD, aimFromPointer, pointAt, project, sizeCanvas, worldView } from './scene.ts';

/**
 * The range itself: a canvas seen from the side, drawn to scale (ported from
 * the panel's flight/Field.tsx; only the data layer changed).
 *
 * Two kinds of local state live here and neither is a fact about the world.
 * The **drag** is a gesture (where a finger is right now) and it ends the
 * moment the pointer lifts, as a single `set_aim`; nothing is moved
 * optimistically, so a refused aim snaps back, which is the honest rendering
 * of "the launcher did not move". The **animation clock** is the other: this
 * component draws sixty frames a second along a curve the range computed, for
 * the `play_s` the range chose. It never lands the shot; the range does, on
 * its own clock, just after the animation ends.
 *
 * What is deliberately absent is any physics. There is no preview arc while
 * you drag, only an arrow: an arc drawn here would be a second engine, and an
 * arc that showed where the shot would land would turn a challenge about
 * reasoning into a challenge about dragging until the dot sits on the target.
 */

const COLOURS = {
  sky: '#0b1220',
  ground: '#1f2a3a',
  grid: '#1b2636',
  ink: '#8aa0bd',
  target: '#f0b429',
  ceiling: '#ef6461',
  arrow: '#38bdf8',
  shot: '#e2e8f0',
  cleared: '#4ade80',
  missed: '#64748b',
};

export function Field({ state, seq, onAim, locked: lockedFromOutside }: {
  state: RangeSnapshot;
  seq: number;
  onAim: (aim: Aim) => void;
  locked: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<(progress: number) => void>(() => {});
  const [box, setBox] = useState({ width: 640, height: 360 });
  const [drag, setDragState] = useState<Aim | null>(null);
  // The gesture's latest aim, read on pointer-up (a state updater may run twice).
  const dragRef = useRef<Aim | null>(null);
  const setDrag = (aim: Aim | null) => { dragRef.current = aim; setDragState(aim); };

  const flying = state.phase === 'flying';
  const locked = lockedFromOutside || flying;

  // ---- sizing: the CSS box, watched -------------------------------------
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setBox({ width: rect.width, height: rect.height });
    };
    measure();
    // jsdom has no ResizeObserver, and a component that threw here would render nothing under test.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // ---- the drawing -------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    sizeCanvas(canvas, box.width, box.height, dpr);
    // Null under jsdom, which has no 2-D context: everything visual is untested
    // by the page tests BY DESIGN; they test scene.ts and what this sends.
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ratio = Math.max(1, Math.min(dpr, 3));
    const view = worldView(state);
    const projection = project(view, box.width, box.height, PAD);
    const aim = drag ?? state.aim;

    drawRef.current = (progress: number) => {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, box.width, box.height);
      drawBackdrop(ctx, box, projection, view);
      drawTarget(ctx, state, projection, box);
      drawTrails(ctx, state, projection);
      drawArrow(ctx, aim, projection, box, state.limits);
      drawShot(ctx, state, projection, progress);
    };
    drawRef.current(flying ? 0 : 1);
  }, [state, box, drag, flying]);

  // ---- the animation clock ----------------------------------------------
  // Keyed on the seq that put a shot in the air, so one flight animates once,
  // and a remount mid-flight picks it up from the beginning rather than
  // leaving a frozen ball on the screen.
  const shot = state.last_shot;
  const flightKey = flying && shot ? seq : 0;
  useEffect(() => {
    if (!flightKey || !shot) return;
    if (typeof requestAnimationFrame === 'undefined') return;
    const duration = Math.max(0.1, shot.play_s) * 1000;
    const started = performance.now();
    let frame = 0;
    const step = () => {
      const progress = Math.min(1, (performance.now() - started) / duration);
      drawRef.current(progress);
      // Keep drawing the finished arc until the range says it has landed. The
      // drawing never decides that; it just stops moving the ball.
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightKey]);

  // ---- the drag ----------------------------------------------------------
  const aimAt = useCallback((clientX: number, clientY: number): Aim | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const projection = project(worldView(state), rect.width || box.width, rect.height || box.height, PAD);
    return aimFromPointer(clientX - rect.left, clientY - rect.top, projection, rect.width || box.width, state.limits);
  }, [state, box]);

  const startDrag = (event: React.PointerEvent) => {
    if (locked) return;
    event.preventDefault();
    const aim = aimAt(event.clientX, event.clientY);
    if (aim) setDrag(aim);
  };

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const aim = aimAt(event.clientX, event.clientY);
      if (aim) setDrag(aim);
    };
    const up = () => {
      const current = dragRef.current;
      setDrag(null);
      if (current) onAim(current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, aimAt, onAim]);

  const aim = drag ?? state.aim;
  return (
    <div className="tc-field" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className={`tc-canvas${locked ? ' tc-canvas--locked' : ''}`}
        style={{ width: '100%', height: '100%' }}
        onPointerDown={startDrag}
        role="img"
        aria-label={`${state.challenge.name}: ${state.challenge.blurb} Aimed at ${aim.angle_deg} degrees, ${aim.speed_ms} metres a second.`}
      />
      {drag && <div className="tc-drag-readout">{drag.angle_deg}° · {drag.speed_ms} m/s</div>}
    </div>
  );
}

// --------------------------------------------------------------------------
// drawing helpers: plain canvas, no state, no decisions
// --------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;
type Box = { width: number; height: number };
type Projection = ReturnType<typeof project>;

function drawBackdrop(ctx: Ctx, box: Box, projection: Projection, view: { xMax: number }) {
  ctx.fillStyle = COLOURS.sky;
  ctx.fillRect(0, 0, box.width, box.height);

  const stepChoices = [5, 10, 20, 25, 50, 100];
  const step = stepChoices.find((candidate) => view.xMax / candidate <= 8) ?? 200;
  ctx.strokeStyle = COLOURS.grid;
  ctx.fillStyle = COLOURS.ink;
  ctx.lineWidth = 1;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let x = step; x <= view.xMax; x += step) {
    const [sx] = projection.toScreen(x, 0);
    ctx.beginPath();
    ctx.moveTo(sx, projection.originY);
    ctx.lineTo(sx, PAD.top);
    ctx.stroke();
    ctx.fillText(`${x} m`, sx, projection.originY + 16);
  }

  ctx.strokeStyle = COLOURS.ground;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PAD.left - 12, projection.originY);
  ctx.lineTo(box.width - PAD.right, projection.originY);
  ctx.stroke();
}

function drawTarget(ctx: Ctx, state: RangeSnapshot, projection: Projection, box: Box) {
  const { target, ceiling_m } = state.challenge;
  ctx.strokeStyle = COLOURS.target;
  ctx.fillStyle = COLOURS.target;
  ctx.lineWidth = 2;

  if (target.kind === 'wall' && target.x_m !== undefined && target.h_m !== undefined) {
    const [x, top] = projection.toScreen(target.x_m, target.h_m);
    const width = Math.max(4, 0.6 * projection.scale);
    ctx.fillRect(x - width / 2, top, width, projection.originY - top);
  } else if (target.kind === 'zone' && target.x_m !== undefined && target.w_m !== undefined) {
    const [x1] = projection.toScreen(target.x_m - target.w_m / 2, 0);
    const [x2] = projection.toScreen(target.x_m + target.w_m / 2, 0);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x1, projection.originY);
    ctx.lineTo(x2, projection.originY);
    ctx.stroke();
  } else if (target.min_m !== undefined) {
    const [x] = projection.toScreen(target.min_m, 0);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, projection.originY);
    ctx.lineTo(x, projection.originY - 26);
    ctx.lineTo(x + 18, projection.originY - 20);
    ctx.lineTo(x, projection.originY - 14);
    ctx.stroke();
  }

  if (ceiling_m !== null && ceiling_m !== undefined) {
    const [, y] = projection.toScreen(0, ceiling_m);
    ctx.strokeStyle = COLOURS.ceiling;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(PAD.left - 12, y);
    // The BOX width, not the canvas width: the backing store is in device
    // pixels and the context is already scaled to CSS ones.
    ctx.lineTo(box.width - PAD.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawTrails(ctx: Ctx, state: RangeSnapshot, projection: Projection) {
  state.history.forEach((attempt, index) => {
    ctx.strokeStyle = attempt.cleared ? COLOURS.cleared : COLOURS.missed;
    ctx.globalAlpha = 0.18 + (0.3 * (index + 1)) / state.history.length;
    ctx.lineWidth = 1.5;
    strokePath(ctx, attempt.path, projection, 1);
  });
  ctx.globalAlpha = 1;
}

function drawShot(ctx: Ctx, state: RangeSnapshot, projection: Projection, progress: number) {
  const shot = state.last_shot;
  if (!shot || state.phase === 'aiming') return;
  const done = state.phase !== 'flying';
  ctx.strokeStyle = shot.cleared ? COLOURS.cleared : COLOURS.shot;
  ctx.lineWidth = 2;
  ctx.globalAlpha = done ? 0.9 : 1;
  strokePath(ctx, shot.path, projection, done ? 1 : progress);
  ctx.globalAlpha = 1;

  const [x, y] = pointAt(shot.path, done ? 1 : progress);
  const [sx, sy] = projection.toScreen(x, y);
  ctx.fillStyle = shot.cleared ? COLOURS.cleared : COLOURS.shot;
  ctx.beginPath();
  ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
  ctx.fill();
}

function strokePath(ctx: Ctx, path: [number, number][], projection: Projection, upTo: number) {
  if (path.length < 2) return;
  const last = Math.max(1, Math.ceil((path.length - 1) * Math.min(1, Math.max(0, upTo))));
  ctx.beginPath();
  const [x0, y0] = projection.toScreen(path[0][0], path[0][1]);
  ctx.moveTo(x0, y0);
  for (let i = 1; i <= last && i < path.length; i += 1) {
    const [x, y] = projection.toScreen(path[i][0], path[i][1]);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawArrow(ctx: Ctx, aim: Aim, projection: Projection, box: Box, limits: RangeSnapshot['limits']) {
  const [lo, hi] = limits.speed;
  const reach = hi > lo ? (aim.speed_ms - lo) / (hi - lo) : 1;
  const length = 30 + reach * (box.width * 0.3 - 30);
  const radians = (aim.angle_deg * Math.PI) / 180;
  const x = projection.originX + Math.cos(radians) * length;
  const y = projection.originY - Math.sin(radians) * length;

  ctx.strokeStyle = COLOURS.arrow;
  ctx.fillStyle = COLOURS.arrow;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(projection.originX, projection.originY);
  ctx.lineTo(x, y);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(projection.originX, projection.originY, 7, Math.PI, Math.PI * 2);
  ctx.fill();
}
