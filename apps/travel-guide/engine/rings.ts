// A country's shape, from Nominatim's GeoJSON boundary to rings the page can
// draw: the outline over the map tiles, and a tiny silhouette on the trip
// strip. Ported from the original's staticmap.py, whose other half (a static
// map image fetched agent-side, because the old panel was a sandboxed iframe
// that could not load a tile) is gone: this page draws real tiles with Leaflet.
//
// What is kept is the part that was hard-won: the map fits the MAIN landmass,
// not everything a country administers, and an outline is shrunk to a budget
// without ever leaving a ring open.

/** The outline drawn over the tiles. Big enough to follow a coastline at country zoom. */
export const MAX_OUTLINE_BYTES = 40_000;
/** The trip strip's silhouette: a shape a few dozen pixels wide. */
export const MAX_SILHOUETTE_BYTES = 1_200;

/**
 * How far outside the main landmass a ring may sit and still be drawn with it,
 * as a multiple of the mainland's own span. Relative rather than absolute so it
 * means the same thing for Luxembourg and for Russia.
 *
 * Calibrated on Svalbard, which is the closest of the awkward cases: it sits
 * about 0.39 mainland-spans north of Norway, so anything above ~0.35 keeps it
 * and turns the map back into mostly ocean. Genuine coastal islands sit far
 * nearer than that.
 */
export const MAINLAND_MARGIN = 0.25;

type Ring = number[][];

/** [minLat, minLon, maxLat, maxLon] for a set of [lon, lat] rings. */
export function ringBounds(rings: Ring[]): [number, number, number, number] | null {
  const points = rings.flat();
  if (!points.length) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
}

/**
 * `rings` without the far-flung dependencies.
 *
 * A country's Nominatim bounding box covers everything it administers, and for
 * a surprising number of countries that is most of the planet: France reaches
 * -178°..172° because of French Polynesia, Norway -54°..81° from Bouvet Island
 * up to Svalbard, Chile out to Easter Island. Fitting a map to that box draws
 * the whole world with the country invisible somewhere inside it — which is
 * exactly what someone asking for Norway saw.
 *
 * Keep the biggest ring, keep anything sitting near it, and drop the rest from
 * both the drawing and the box the map is fitted to.
 */
export function mainlandRings(rings: Ring[]): Ring[] {
  if (rings.length <= 1) return [...rings];
  const main = rings.reduce((a, b) => (b.length > a.length ? b : a));
  const bounds = ringBounds([main]);
  if (!bounds) return [...rings];
  const [minLat, minLon, maxLat, maxLon] = bounds;
  // A margin of zero would drop islands that touch the mainland's own box edge.
  const padLat = Math.max(maxLat - minLat, 1) * MAINLAND_MARGIN;
  const padLon = Math.max(maxLon - minLon, 1) * MAINLAND_MARGIN;
  const kept = rings.filter((ring) => {
    const box = ringBounds([ring]);
    if (!box) return false;
    const [rMinLat, rMinLon, rMaxLat, rMaxLon] = box;
    // Overlap with the padded mainland box, not a centroid test: a long thin
    // island running alongside the coast has a centroid well offshore.
    return rMinLat <= maxLat + padLat && rMaxLat >= minLat - padLat && rMinLon <= maxLon + padLon && rMaxLon >= minLon - padLon;
  });
  return kept.length ? kept : [main];
}

/** The bounding box of the country's main landmass, or `fallback` when there is no usable geometry. */
export function primaryBbox(geojson: unknown, fallback: [number, number, number, number] | null = null) {
  return ringBounds(mainlandRings(outerRings(geojson))) ?? fallback;
}

/**
 * A GeoJSON boundary as drawable rings, small enough to send. Holes are dropped
 * (the map strokes an outline, it does not shade lakes) and rings are shrunk
 * until the whole thing fits: first by rounding coordinates, then by keeping
 * every nth vertex, then by dropping the smallest islands. A shape that still
 * will not fit is null; the map then shows the country without it.
 */
export function countryOutline(geojson: unknown, maxBytes = MAX_OUTLINE_BYTES): Ring[] | null {
  const rings = mainlandRings(outerRings(geojson));
  if (!rings.length) return null;
  // Biggest first: whatever survives the trimming should be the mainland.
  rings.sort((a, b) => b.length - a.length);

  // Steps double until even the longest coastline is down to a handful of
  // vertices. A fixed ceiling here silently returned nothing for Norway.
  const longest = Math.max(...rings.map((r) => r.length));
  const steps = [1];
  while (steps[steps.length - 1] < longest) steps.push(steps[steps.length - 1] * 2);

  for (const precision of [4, 3, 2]) {
    for (const step of steps) {
      const candidate = rings.map((ring) => decimate(ring, step, precision)).filter((ring) => ring.length >= 4);
      while (candidate.length) {
        if (JSON.stringify({ rings: candidate }).length <= maxBytes) return candidate;
        if (candidate.length === 1) break;
        candidate.pop(); // drop the smallest remaining island
      }
    }
  }
  return null;
}

/** Outer rings of a Polygon or MultiPolygon, as [[lon, lat], ...]. */
export function outerRings(geojson: unknown): Ring[] {
  if (typeof geojson !== 'object' || geojson === null) return [];
  const { type, coordinates } = geojson as { type?: unknown; coordinates?: unknown };
  if (!Array.isArray(coordinates)) return [];
  if (type === 'Polygon' && coordinates.length) return [points(coordinates[0])];
  if (type === 'MultiPolygon') return coordinates.filter((poly) => Array.isArray(poly) && poly.length).map((poly) => points(poly[0]));
  return [];
}

function points(ring: unknown): Ring {
  if (!Array.isArray(ring)) return [];
  const out: Ring = [];
  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (typeof point[0] === 'boolean' || typeof point[1] === 'boolean' || point[0] === null || point[1] === null) continue;
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat]);
  }
  return out;
}

const roundTo = (value: number, precision: number) => {
  const f = 10 ** precision;
  return Math.round(value * f) / f;
};

/**
 * Every nth vertex, rounded — with the ring kept closed. Dropping the closing
 * vertex leaves the map drawing an open shape with a straight line across the
 * middle of the country.
 */
function decimate(ring: Ring, step: number, precision: number): Ring {
  const kept = step > 1 ? ring.filter((_, i) => i % step === 0) : [...ring];
  const last = ring[ring.length - 1];
  if (kept.length && last && (kept[kept.length - 1][0] !== last[0] || kept[kept.length - 1][1] !== last[1])) kept.push(last);
  return kept.map(([lon, lat]) => [roundTo(lon, precision), roundTo(lat, precision)]);
}
