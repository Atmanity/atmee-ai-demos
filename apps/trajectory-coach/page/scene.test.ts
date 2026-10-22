// Scene arithmetic (ported from the "scene arithmetic" block of the panel's
// RangePanel.test.tsx): metres to pixels, pointer to aim, and the ball's walk
// along the range's polyline. None of it is physics.
import { describe, expect, it } from 'vitest';
import { IN_FLIGHT, LANDED, PATH, snapshot } from './fixtures.ts';
import { aimFromPointer, pointAt, project, readout, sizeCanvas, worldView } from './scene.ts';

describe('scene arithmetic', () => {
  const view = worldView(snapshot());
  const projection = project(view, 600, 300);

  it('the scale is the same on both axes, so the drawing cannot flatter an arc', () => {
    const [x1, y1] = projection.toScreen(10, 0);
    const [x2] = projection.toScreen(20, 0);
    const [, y2] = projection.toScreen(0, 10);
    expect(x2 - x1).toBeCloseTo(y1 - y2, 6);
  });

  it('the view grows to hold a shot that sailed past the target', () => {
    const near = worldView(snapshot({ history: [], last_shot: null }));
    const far = worldView(snapshot({ history: [], last_shot: { ...LANDED, path: [[0, 0], [60, 20], [120, 0]], range_m: 120 } }));
    expect(far.xMax).toBeGreaterThan(near.xMax);
    expect(far.xMax).toBeGreaterThan(120);
  });

  it("a drag maps to an angle and a speed inside the launcher's limits", () => {
    const limits = { angle: [5, 85] as [number, number], speed: [5, 40] as [number, number] };
    // Straight up and far away: the angle pins at the top of the rail and the
    // speed at the cap rather than growing without bound.
    const steep = aimFromPointer(projection.originX, projection.originY - 4000, projection, 600, limits);
    expect(steep.angle_deg).toBe(85);
    expect(steep.speed_ms).toBe(40);
    // Along the ground, right at the launcher: the bottom of both.
    const flat = aimFromPointer(projection.originX, projection.originY, projection, 600, limits);
    expect(flat.angle_deg).toBe(5);
    expect(flat.speed_ms).toBe(5);
  });

  it("a drag respects a challenge's own speed cap", () => {
    const capped = { angle: [5, 85] as [number, number], speed: [5, 18] as [number, number] };
    expect(aimFromPointer(projection.originX + 900, projection.originY - 900, projection, 600, capped).speed_ms).toBe(18);
  });

  it("the ball walks the range's polyline and nothing else", () => {
    expect(pointAt(PATH, 0)).toEqual([0, 0]);
    expect(pointAt(PATH, 1)).toEqual([40.77, 0]);
    // Halfway through a five-point path is the middle sample exactly.
    expect(pointAt(PATH, 0.5)).toEqual([20, 10.1]);
    // Out of range is clamped rather than extrapolated: the drawing must never
    // invent a position the range did not compute.
    expect(pointAt(PATH, 4)).toEqual([40.77, 0]);
    expect(pointAt(PATH, -1)).toEqual([0, 0]);
  });

  it('the canvas backing store is sized in device pixels, or it renders blurry', () => {
    const canvas = { width: 0, height: 0 };
    expect(sizeCanvas(canvas, 300, 150, 2)).toBe(true);
    expect(canvas).toEqual({ width: 600, height: 300 });
    // Idempotent: a resize observer that fires every frame must not keep
    // clearing the drawing by re-assigning the same size.
    expect(sizeCanvas(canvas, 300, 150, 2)).toBe(false);
    // A silly ratio is capped rather than allocating a huge backing store.
    sizeCanvas(canvas, 300, 150, 12);
    expect(canvas.width).toBe(900);
  });

  it('the readout never claims a result the snapshot does not carry', () => {
    expect(readout(null, 'aiming')).toBe('No shot yet.');
    expect(readout(IN_FLIGHT, 'flying')).toBe('In the air…');
    // Even asked for a landed phase, a shot with no verdict reports none.
    expect(readout(IN_FLIGHT, 'scored')).toBe('In the air…');
    expect(readout(LANDED, 'scored')).toBe('40.77 m · apex 10.19 m · 2.88 s');
  });
});
