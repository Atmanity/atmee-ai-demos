// Snapshots for the page tests, from the original panel's tests: a wall40
// shot at 45° and 20 m/s, landed and in the air (hand-written numbers, as
// the original's were; the engine's own are pinned in engine/golden.test.ts).
import type { RangeSnapshot, Shot } from '../engine/types.ts';

export const PATH: [number, number][] = [[0, 0], [10, 7.2], [20, 10.1], [30, 8.4], [40.77, 0]];

export const LANDED: Shot = {
  angle_deg: 45, speed_ms: 20, gravity: 9.81, wind_ms: 0, flight_s: 2.88, play_s: 2.5, path: PATH,
  range_m: 40.77, apex_m: 10.19, cleared: false, miss_m: 2.65, note: 'You were at 0.35 m going past 40 m, 2.65 m below the top.',
};

/** The same shot as the range projects it while it is still in the air. */
export const IN_FLIGHT: Shot = { angle_deg: 45, speed_ms: 20, gravity: 9.81, wind_ms: 0, flight_s: 2.88, play_s: 2.5, path: PATH };

export function snapshot(over: Partial<RangeSnapshot> = {}): RangeSnapshot {
  return {
    phase: 'scored',
    challenge: { id: 'wall40', name: 'Clear the wall', blurb: 'A three-metre wall, forty metres out. Get over it.', target: { kind: 'wall', x_m: 40, h_m: 3 }, wind_ms: 0, gravity: 9.81, ceiling_m: null },
    aim: { angle_deg: 45, speed_ms: 20 },
    limits: { angle: [5, 85], speed: [5, 40] },
    last_shot: LANDED,
    attempts: 1,
    best_miss_m: 2.65,
    history: [{ angle_deg: 45, speed_ms: 20, range_m: 40.77, cleared: false, path: PATH }],
    catalog: [{ id: 'wall40', name: 'Clear the wall', cleared: false }, { id: 'zone30', name: 'Land in the zone', cleared: false }],
    ...over,
  };
}
