/**
 * Drawing a country without a map library: the trip strip's little
 * silhouettes. (The main map is Leaflet over real tiles; the original panel,
 * a sandboxed iframe that could not load a tile, drew its whole map this way.)
 *
 * Web mercator, to match the map above it: a country that changes shape
 * between the map and its chip would look like a bug.
 */

/** Latitude to a 0..1 web-mercator ordinate, clamped at the usual cut-offs. */
export function mercatorY(lat: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

export interface Projected {
  paths: string[];
  width: number;
  height: number;
}

/**
 * Rings to SVG path data, fitted to a `size × size` box with `padding` around
 * it. Aspect ratio is preserved — squashing a country to fill the card is how
 * Chile ends up looking like Poland.
 *
 * Returns null when there is nothing drawable, so a caller can fall back
 * rather than render an empty `<svg>` that reads as a failed image.
 */
export function projectRings(
  rings: number[][][],
  size = 320,
  padding = 8,
): Projected | null {
  const points = rings.flat();
  if (points.length < 3) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [lon, lat] of points) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const y = mercatorY(lat);
    minX = Math.min(minX, lon);
    maxX = Math.max(maxX, lon);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  const span = Math.max(maxX - minX, (maxY - minY) * 360, 1e-6);
  const inner = size - padding * 2;
  // `* 360` above and `/ 360` here put longitude degrees and the 0..1 mercator
  // ordinate on one scale, which is what keeps the aspect honest.
  const scale = inner / span;
  const drawnWidth = (maxX - minX) * scale;
  const drawnHeight = (maxY - minY) * 360 * scale;
  const offsetX = padding + (inner - drawnWidth) / 2;
  const offsetY = padding + (inner - drawnHeight) / 2;

  const paths: string[] = [];
  for (const ring of rings) {
    const commands: string[] = [];
    for (const [lon, lat] of ring) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const x = offsetX + (lon - minX) * scale;
      const y = offsetY + (mercatorY(lat) - minY) * 360 * scale;
      commands.push(`${commands.length ? 'L' : 'M'}${round(x)} ${round(y)}`);
    }
    if (commands.length >= 3) paths.push(`${commands.join(' ')} Z`);
  }
  return paths.length ? { paths, width: size, height: size } : null;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** `[minLat, minLon, maxLat, maxLon]` as text a person can read aloud. */
export function describeBounds(
  center: [number, number] | null,
  bbox: [number, number, number, number] | null,
): string {
  if (center) return `${coordinate(center[0], 'N', 'S')}, ${coordinate(center[1], 'E', 'W')}`;
  if (bbox) {
    const midLat = (bbox[0] + bbox[2]) / 2;
    const midLon = (bbox[1] + bbox[3]) / 2;
    return `${coordinate(midLat, 'N', 'S')}, ${coordinate(midLon, 'E', 'W')}`;
  }
  return '';
}

function coordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(1)}° ${value >= 0 ? positive : negative}`;
}
