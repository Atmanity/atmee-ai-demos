/**
 * The drawing arithmetic, kept pure so it can be tested without a browser
 * (ported unchanged from the panel's flight/scene.ts).
 *
 * Every function here is about turning metres into pixels and a pointer back
 * into an aim. **None of it is physics.** The page does not work out how far a
 * shot goes, whether it cleared anything, or what the coach should say: it
 * walks a polyline the range computed and stops. The parameters and the curve
 * are domain state; the sixty frames a second that walk along it are not.
 *
 * The one place the drawing decides anything is `aimFromPointer`, and what it
 * decides is where a finger is, which is a gesture and not a rule. It clamps to
 * the launcher's limits because an arrow that keeps growing past what the
 * machine can do is a lie about the control; a *spoken* request outside the
 * limits is never clamped, and comes back refused with the numbers.
 */
import type { Attempt, Point, RangeSnapshot } from '../engine/types.ts';

export interface Pad { left: number; right: number; top: number; bottom: number }

export const PAD: Pad = { left: 44, right: 18, top: 20, bottom: 34 };

/** The arm length, as a fraction of panel width, that means "full power". */
export const ARM_FRACTION = 0.3;

/** Metres of world visible, horizontally and vertically. */
export interface View { xMax: number; yMax: number }

/**
 * How much world has to fit on screen.
 *
 * Grown from everything currently drawn (the target, the roof, the live shot,
 * the ghost trails) so a shot that sails past the wall stays inside the
 * picture instead of being cropped at exactly the moment it is interesting.
 */
export function worldView(state: RangeSnapshot): View {
  const { challenge } = state;
  const target = challenge.target;
  let xMax = 20;
  if (target.x_m !== undefined) xMax = Math.max(xMax, target.x_m + (target.w_m ?? 0) / 2);
  if (target.min_m !== undefined) xMax = Math.max(xMax, target.min_m);

  let yMax = Math.max(4, (target.h_m ?? 0) + 1, challenge.ceiling_m ?? 0);

  const paths: Point[][] = state.history.map((attempt: Attempt) => attempt.path);
  if (state.last_shot) paths.push(state.last_shot.path);
  for (const path of paths) {
    for (const [x, y] of path) {
      if (x > xMax) xMax = x;
      if (y > yMax) yMax = y;
    }
  }
  return { xMax: xMax * 1.08, yMax: Math.max(yMax * 1.15, xMax * 0.2) };
}

export interface Projection {
  /** Pixels per metre. Uniform: the scene is to scale in both directions. */
  scale: number;
  originX: number;
  originY: number;
  toScreen(x: number, y: number): [number, number];
}

/**
 * Metres to pixels, at one scale for both axes.
 *
 * Uniform on purpose. A stretched vertical axis makes every arc look like the
 * lob the student was told not to take, and an app that teaches by drawing
 * cannot afford a drawing that argues with the numbers under it.
 */
export function project(view: View, width: number, height: number, pad: Pad = PAD): Projection {
  const usableW = Math.max(1, width - pad.left - pad.right);
  const usableH = Math.max(1, height - pad.top - pad.bottom);
  const scale = Math.max(0.01, Math.min(usableW / view.xMax, usableH / view.yMax));
  const originX = pad.left;
  const originY = height - pad.bottom;
  return { scale, originX, originY, toScreen: (x: number, y: number) => [originX + x * scale, originY - y * scale] };
}

/**
 * Where the aiming arrow says to point, from where the pointer is.
 *
 * View state, all of it: this runs on every pointer move and nothing it
 * produces leaves the drawing until the finger comes up, at which point exactly
 * one `set_aim` is applied.
 */
export function aimFromPointer(
  px: number,
  py: number,
  projection: Projection,
  width: number,
  limits: { angle: [number, number]; speed: [number, number] },
): { angle_deg: number; speed_ms: number } {
  const dx = px - projection.originX;
  const dy = projection.originY - py;
  const angle = clamp((Math.atan2(Math.max(dy, 0), Math.max(dx, 0.0001)) * 180) / Math.PI, limits.angle[0], limits.angle[1]);
  const arm = Math.max(1, width * ARM_FRACTION);
  const reach = Math.min(1, Math.hypot(dx, Math.max(dy, 0)) / arm);
  const speed = clamp(limits.speed[0] + reach * (limits.speed[1] - limits.speed[0]), limits.speed[0], limits.speed[1]);
  return { angle_deg: round1(angle), speed_ms: round1(speed) };
}

/**
 * Where along the range's polyline the shot is, `t` from 0 to 1.
 *
 * Linear between samples, which is why flight.ts samples uniformly in TIME: a
 * path sampled uniformly in x could not be walked at a constant rate without
 * the page doing physics of its own.
 */
export function pointAt(path: Point[], t: number): Point {
  if (path.length === 0) return [0, 0];
  if (path.length === 1) return path[0];
  const clamped = clamp(t, 0, 1);
  const span = (path.length - 1) * clamped;
  const index = Math.min(path.length - 2, Math.floor(span));
  const frac = span - index;
  const [x0, y0] = path[index];
  const [x1, y1] = path[index + 1];
  return [x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac];
}

/**
 * Size a canvas for the display it is on.
 *
 * Two sizes, and forgetting the second is why a canvas ships blurry: the CSS
 * box is in layout pixels, the backing store must be in device pixels, and the
 * context then has to be scaled so drawing code can keep speaking CSS pixels.
 * Returns false when nothing needed changing, so a resize observer firing on
 * every frame does not clear the drawing.
 */
export function sizeCanvas(canvas: { width: number; height: number }, cssWidth: number, cssHeight: number, dpr: number): boolean {
  const ratio = Math.max(1, Math.min(dpr || 1, 3));
  const width = Math.max(1, Math.round(cssWidth * ratio));
  const height = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

/** Whether the target has been passed, for the ghost trail's colour. */
export function trailTone(attempt: Attempt): string {
  return attempt.cleared ? 'cleared' : 'missed';
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
